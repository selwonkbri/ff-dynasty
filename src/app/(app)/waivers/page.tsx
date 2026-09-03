// Live DB + Sleeper state on every request, never prerendered/cached at build time.
export const dynamic = "force-dynamic";

import { isNull, eq, and } from "drizzle-orm";
import { db } from "@db/client";
import { players as playersTable, rosterPlayers, projections as projectionsTable } from "@db/schema";
import { SEASON } from "@lib/config";
import { rankFreeAgents, type FreeAgentCandidate } from "@lib/engine/freeAgents";
import { fetchState } from "@lib/sleeper";

const REGULAR_SEASON_WEEKS = 14; // rules.md IV: regular season is weeks 1-14

export default async function WaiversPage() {
  const state = await fetchState();
  const week = state.week;
  const gamesRemaining = Math.max(0, REGULAR_SEASON_WEEKS - week + 1);

  const unrostered = await db
    .select({
      sleeperId: playersTable.sleeperId,
      fullName: playersTable.fullName,
      position: playersTable.position,
      leaguePts: projectionsTable.leaguePts,
    })
    .from(playersTable)
    .leftJoin(rosterPlayers, eq(rosterPlayers.playerId, playersTable.sleeperId))
    .leftJoin(
      projectionsTable,
      and(
        eq(projectionsTable.playerId, playersTable.sleeperId),
        eq(projectionsTable.season, SEASON),
        eq(projectionsTable.week, week),
      ),
    )
    .where(isNull(rosterPlayers.playerId));

  const candidates: FreeAgentCandidate[] = unrostered
    .filter((r) => r.position === "QB" || r.position === "RB" || r.position === "WR" || r.position === "TE")
    .map((r) => ({
      playerId: r.sleeperId,
      name: r.fullName ?? r.sleeperId,
      position: r.position as FreeAgentCandidate["position"],
      weeklyProjectedPoints: r.leaguePts ?? 0,
    }));

  const ranked = rankFreeAgents(candidates, gamesRemaining).slice(0, 50);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-lg font-semibold">Free agents, week {week}</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Ranked by projection only: a simple sort, not the Phase 2 clearing-price bid model. Rest-of-season is a
          weekly-projection x games-remaining placeholder, not a real ROS projection yet.
        </p>
      </div>
      <ul className="flex flex-col divide-y divide-neutral-100">
        {ranked.map((r, i) => (
          <li key={r.playerId} className="flex items-center justify-between py-2 text-sm">
            <span className="w-6 shrink-0 text-neutral-400">{i + 1}</span>
            <span className="flex-1">
              {r.name} <span className="text-neutral-500">{r.position}</span>
            </span>
            <span className="tabular-nums text-neutral-600">{r.weeklyProjectedPoints.toFixed(1)}</span>
            <span className="ml-3 w-14 tabular-nums text-neutral-400">{r.restOfSeasonProjectedPoints.toFixed(0)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
