// Live DB + Sleeper state on every request, never prerendered/cached at build time.
export const dynamic = "force-dynamic";

import { loadRosterContext } from "@lib/rosterData";
import { computeOptimalLineup, computeSwapList } from "@lib/engine/lineup";
import ReadBackButton from "./ReadBackButton";

export default async function LineupPage() {
  const ctx = await loadRosterContext();
  const optimal = computeOptimalLineup(ctx.slots, ctx.roster);
  const currentStarterIds = new Set(ctx.currentStarterIdsBySlot.filter((id) => id && id !== "0"));
  const { toStart, toBench } = computeSwapList(ctx.slots, optimal, currentStarterIds);

  return (
    <div className="flex flex-col gap-6">
      <section>
        <h1 className="text-lg font-semibold">Week {ctx.week} optimal lineup</h1>
        <ul className="mt-2 flex flex-col divide-y divide-neutral-100">
          {optimal.starters.map((s, i) => (
            <li key={i} className="flex items-center justify-between gap-2 py-2 text-sm">
              <span className="w-28 shrink-0 font-medium text-neutral-500">{s.slot}</span>
              <span className="flex-1">{s.player?.name ?? <em className="text-neutral-400">empty</em>}</span>
              <span className="tabular-nums text-neutral-600">
                {s.player ? s.player.projectedPoints.toFixed(1) : ""}
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-sm font-medium">
          Projected total: {optimal.totalProjectedPoints.toFixed(1)}
        </p>
      </section>

      <section>
        <h2 className="text-sm font-semibold text-neutral-500 uppercase">Swap list vs. current Sleeper starters</h2>
        {toStart.length === 0 && toBench.length === 0 ? (
          <p className="mt-1 text-sm text-green-700">None. Current starters already match the optimal lineup.</p>
        ) : (
          <ul className="mt-1 flex flex-col gap-1 text-sm">
            {toStart.map((s, i) => (
              <li key={`start-${i}`}>
                start <span className="font-medium">{s.player.name}</span> at {s.slot}
              </li>
            ))}
            {toBench.map((p, i) => (
              <li key={`bench-${i}`}>
                bench <span className="font-medium">{p.name}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="text-sm font-semibold text-neutral-500 uppercase">Bench</h2>
        <ul className="mt-1 flex flex-col divide-y divide-neutral-100">
          {optimal.bench.map((p) => (
            <li key={p.playerId} className="flex items-center justify-between py-2 text-sm">
              <span className="flex-1">{p.name}</span>
              <span className="tabular-nums text-neutral-600">{p.projectedPoints.toFixed(1)}</span>
            </li>
          ))}
        </ul>
      </section>

      <ReadBackButton />
    </div>
  );
}
