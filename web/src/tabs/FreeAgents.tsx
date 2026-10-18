import { useState } from "react";
import type { PageModel } from "../model";
import { fmtPoints } from "../format";
import { InjuryChip, LockChip, Note, Section } from "../ui";

const FILTERS = ["All", "QB", "RB", "WR", "TE"] as const;
type Filter = (typeof FILTERS)[number];
const SHOWN = 50;

function dollars(n: number): string {
  return `$${n.toLocaleString("en-US")}`;
}

export default function FreeAgents({ model }: { model: PageModel }) {
  const [filter, setFilter] = useState<Filter>("All");
  const { ctx, freeAgents } = model;
  const rows = freeAgents.filter((r) => filter === "All" || r.player.position === filter).slice(0, SHOWN);

  return (
    <div className="flex flex-col gap-4">
      <Section title="FAAB">
        {ctx.faab ? (
          <p className="text-sm">
            <span className="font-semibold">{dollars(ctx.faab.remaining)}</span> left of {dollars(ctx.faab.budget)} (
            {dollars(ctx.faab.used)} spent)
          </p>
        ) : (
          <Note>{"FAAB left: unknown (Sleeper didn't report spending for this roster)."}</Note>
        )}
      </Section>

      <Section title={`Free agents, week ${ctx.week}`}>
        <div className="flex gap-1.5" role="group" aria-label="Position filter">
          {FILTERS.map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              aria-pressed={filter === f}
              className={`rounded-full px-3 py-1 text-xs font-semibold ${
                filter === f ? "bg-neutral-900 text-white" : "bg-neutral-100 text-neutral-700"
              }`}
            >
              {f}
            </button>
          ))}
        </div>
        <Note>{"Gain: projected points added to this week's best lineup, using the same slot rules as the optimizer."}</Note>

        {!ctx.projectionsPosted ? (
          <Note tone="warn">Projections not posted yet for week {ctx.week}.</Note>
        ) : rows.length === 0 ? (
          <Note>No free agents {filter === "All" ? "" : `at ${filter} `}with a projection this week.</Note>
        ) : (
          <ol className="flex flex-col divide-y divide-neutral-100">
            {rows.map((r, i) => (
              <li key={r.player.playerId} className="flex items-center gap-2 py-2 text-sm">
                <span className="w-6 shrink-0 text-xs text-neutral-400">{i + 1}</span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="flex flex-wrap items-center gap-1.5">
                    <span className="truncate font-medium">{r.player.name}</span>
                    <InjuryChip status={r.player.injuryStatus} />
                    <LockChip locked={r.player.locked} />
                  </span>
                  <span className="text-xs text-neutral-500">
                    {r.player.position} {r.player.team ?? "FA"}
                    {r.replaces ? `, would replace ${r.replaces.name}` : r.player.isBye ? ", bye" : ""}
                  </span>
                </span>
                <span className="flex shrink-0 flex-col items-end">
                  <span className={`tabular-nums font-semibold ${r.gain > 0 ? "text-green-700" : "text-neutral-400"}`}>
                    +{fmtPoints(r.gain)}
                  </span>
                  <span className="text-xs tabular-nums text-neutral-500">{fmtPoints(r.player.projectedPoints)} proj</span>
                </span>
              </li>
            ))}
          </ol>
        )}
      </Section>
    </div>
  );
}
