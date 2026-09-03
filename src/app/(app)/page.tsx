// Live DB + Sleeper state on every request, never prerendered/cached at build time.
export const dynamic = "force-dynamic";

import { and, eq } from "drizzle-orm";
import { db } from "@db/client";
import { matchups as matchupsTable, owners as ownersTable, schedule as scheduleTable } from "@db/schema";
import { SEASON, MY_ROSTER_ID } from "@lib/config";
import { loadRosterContext } from "@lib/rosterData";
import { computeOptimalLineup } from "@lib/engine/lineup";
import { checkCompliance } from "@lib/engine/compliance";
import { detectScoringMismatches } from "@lib/engine/mismatches";
import { nextEvents } from "@lib/engine/calendar";

async function loadWeekKickoffs(week: number) {
  const rows = await db
    .select({ kickoffUtc: scheduleTable.kickoffUtc })
    .from(scheduleTable)
    .where(and(eq(scheduleTable.season, SEASON), eq(scheduleTable.week, week)));
  const kickoffs = rows.map((r) => r.kickoffUtc).filter((d): d is Date => d !== null);
  return kickoffs.length ? kickoffs.reduce((min, d) => (d < min ? d : min)) : undefined;
}

async function loadCurrentMatchup(week: number) {
  const [mine] = await db
    .select()
    .from(matchupsTable)
    .where(and(eq(matchupsTable.season, SEASON), eq(matchupsTable.week, week), eq(matchupsTable.rosterId, MY_ROSTER_ID)));
  if (!mine || mine.matchupId === null) return null;

  const opponents = await db
    .select()
    .from(matchupsTable)
    .where(and(eq(matchupsTable.season, SEASON), eq(matchupsTable.week, week), eq(matchupsTable.matchupId, mine.matchupId)));
  const opponent = opponents.find((m) => m.rosterId !== MY_ROSTER_ID);
  if (!opponent) return null;

  const [myOwner, oppOwner] = await Promise.all([
    db.select().from(ownersTable).where(eq(ownersTable.rosterId, MY_ROSTER_ID)).then((r) => r[0]),
    db.select().from(ownersTable).where(eq(ownersTable.rosterId, opponent.rosterId)).then((r) => r[0]),
  ]);

  return {
    myPoints: mine.points ?? 0,
    myTeamName: myOwner?.teamName ?? myOwner?.displayName ?? "Mine",
    oppPoints: opponent.points ?? 0,
    oppTeamName: oppOwner?.teamName ?? oppOwner?.displayName ?? "Opponent",
  };
}

export default async function DashboardPage() {
  const ctx = await loadRosterContext();
  const optimal = computeOptimalLineup(ctx.slots, ctx.roster);

  const currentStarters = ctx.slots
    .filter((slot) => slot !== "BN")
    .map((slot, i) => ({
      slot,
      player: ctx.roster.find((p) => p.playerId === ctx.currentStarterIdsBySlot[i]) ?? null,
    }));

  const compliance = checkCompliance({ starters: currentStarters, rosterSize: ctx.rosterSize });
  const mismatches = detectScoringMismatches(ctx.scoringSettings, ctx.slots);

  const [tradeDeadline, playoffsStart, matchup] = await Promise.all([
    loadWeekKickoffs(12),
    loadWeekKickoffs(15),
    loadCurrentMatchup(ctx.week),
  ]);
  const events = nextEvents(new Date(), 3, { 12: tradeDeadline, 15: playoffsStart });

  return (
    <div className="flex flex-col gap-6">
      <section>
        <h1 className="text-lg font-semibold">Week {ctx.week}</h1>
        {matchup ? (
          <p className="mt-1 text-sm text-neutral-700">
            {matchup.myTeamName} {matchup.myPoints.toFixed(1)} — {matchup.oppTeamName}{" "}
            {matchup.oppPoints.toFixed(1)}
          </p>
        ) : (
          <p className="mt-1 text-sm text-neutral-500">No matchup synced for this week yet.</p>
        )}
      </section>

      <section>
        <h2 className="text-sm font-semibold text-neutral-500 uppercase">Compliance</h2>
        {compliance.length === 0 ? (
          <p className="mt-1 text-sm text-green-700">Lineup is compliant.</p>
        ) : (
          <ul className="mt-1 flex flex-col gap-1">
            {compliance.map((issue, i) => (
              <li key={i} className="text-sm text-red-700">
                {issue.detail}
              </li>
            ))}
          </ul>
        )}
      </section>

      {mismatches.length > 0 && (
        <section className="rounded-md border border-amber-300 bg-amber-50 p-3">
          <h2 className="text-sm font-semibold text-amber-800">Settings mismatch</h2>
          {mismatches.map((m, i) => (
            <p key={i} className="mt-1 text-sm text-amber-800">
              {m.detail}
            </p>
          ))}
        </section>
      )}

      <section>
        <h2 className="text-sm font-semibold text-neutral-500 uppercase">Next up</h2>
        <ul className="mt-1 flex flex-col gap-1">
          {events.map((e, i) => (
            <li key={i} className="text-sm text-neutral-700">
              {e.name} — {e.at.toLocaleString("en-US", { timeZone: "America/New_York", weekday: "short", hour: "numeric", minute: "2-digit", timeZoneName: "short" })}
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="text-sm font-semibold text-neutral-500 uppercase">Projected optimal points</h2>
        <p className="mt-1 text-2xl font-semibold">{optimal.totalProjectedPoints.toFixed(1)}</p>
      </section>
    </div>
  );
}
