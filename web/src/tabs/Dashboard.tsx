import type { MatchupSide } from "@lib/engine/liveContext";
import type { PageModel } from "../model";
import { fmtDateTime, fmtGameDate, fmtPoints } from "../format";
import { Note, Section, slotLabel } from "../ui";

function points(live: number | null, projected: number) {
  return (
    <span className="tabular-nums">
      {live !== null ? fmtPoints(live) : "-"}
      <span className="text-neutral-400"> / {fmtPoints(projected)}</span>
    </span>
  );
}

function MatchupCard({ mine, opponent }: { mine: MatchupSide; opponent: MatchupSide }) {
  return (
    <div className="rounded-md border border-neutral-200">
      <div className="grid grid-cols-2 gap-2 border-b border-neutral-200 p-3">
        {[mine, opponent].map((side) => (
          <div key={side.rosterId} className="min-w-0">
            <p className="truncate text-sm font-semibold">{side.teamName}</p>
            <p className="text-2xl font-semibold tabular-nums">{side.livePoints !== null ? fmtPoints(side.livePoints) : "-"}</p>
            <p className="text-xs text-neutral-500">Projected {fmtPoints(side.projectedTotal)}</p>
          </div>
        ))}
      </div>
      <ul className="divide-y divide-neutral-100 text-xs">
        {mine.starters.map((s, i) => {
          const o = opponent.starters[i];
          return (
            <li key={i} className="grid grid-cols-[2.5rem_1fr_1fr] items-center gap-2 px-3 py-1.5">
              <span className="font-semibold text-neutral-500">{slotLabel(s.slot)}</span>
              <span className="flex min-w-0 flex-col">
                <span className="truncate">{s.name}</span>
                {points(s.live, s.projected)}
              </span>
              <span className="flex min-w-0 flex-col">
                <span className="truncate">{o?.name ?? "Empty"}</span>
                {o ? points(o.live, o.projected) : null}
              </span>
            </li>
          );
        })}
      </ul>
      <p className="px-3 py-2 text-[11px] text-neutral-400">Live points / projected</p>
    </div>
  );
}

export default function Dashboard({ model }: { model: PageModel }) {
  const { ctx, compliance, mismatches, events, tradeDeadlineLabel, playoffsLabel } = model;

  return (
    <div className="flex flex-col gap-6">
      <Section title={`Week ${ctx.week} matchup`}>
        {ctx.matchup ? (
          <MatchupCard mine={ctx.matchup.mine} opponent={ctx.matchup.opponent} />
        ) : (
          <Note>No matchup data for this week yet.</Note>
        )}
      </Section>

      <Section title="Compliance">
        {compliance.length === 0 ? (
          <Note tone="good">
            Sleeper starters are compliant ({ctx.activeRosterSize} active players, {ctx.irCount} on IR).
          </Note>
        ) : (
          <ul className="flex flex-col gap-1">
            {compliance.map((issue, i) => (
              <li key={i} className="text-sm text-red-700">
                {issue.detail}
              </li>
            ))}
          </ul>
        )}
      </Section>

      {mismatches.length > 0 && (
        <section data-testid="mismatches" className="rounded-md border border-amber-300 bg-amber-50 p-3">
          <h2 className="text-sm font-semibold text-amber-900">Rules vs. Sleeper settings</h2>
          {mismatches.map((m) => (
            <p key={m.kind} className="mt-1 text-sm text-amber-900">
              {m.detail}
            </p>
          ))}
        </section>
      )}

      <Section title="Next up">
        <ul className="flex flex-col gap-1 text-sm text-neutral-700">
          {events.map((e) => (
            <li key={e.name}>
              {e.name}: {fmtDateTime(e.at)}
            </li>
          ))}
          {tradeDeadlineLabel && <li data-testid="trade-deadline">{tradeDeadlineLabel}</li>}
          {playoffsLabel && (
            <li>
              Playoffs begin: Week {playoffsLabel.week}
              {playoffsLabel.date ? `, ${fmtGameDate(playoffsLabel.date)}` : ""}
            </li>
          )}
        </ul>
      </Section>

      <Section title="Bye planner">
        {ctx.byePlan.length === 0 ? (
          <Note>No upcoming weeks on the schedule.</Note>
        ) : (
          <ul className="flex flex-col gap-1 text-sm">
            {ctx.byePlan.map((w) => (
              <li key={w.week}>
                <span className="font-medium">Week {w.week}:</span>{" "}
                {w.starters.length === 0 ? (
                  <span className="text-neutral-500">none of your current starters on bye</span>
                ) : (
                  w.starters.map((s) => `${s.name} (${s.team})`).join(", ")
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
