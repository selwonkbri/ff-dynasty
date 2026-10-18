import type { LivePlayer } from "@lib/engine/liveContext";
import type { PageModel } from "../model";
import { fmtKickoff, fmtPoints } from "../format";
import { InjuryChip, LockChip, Note, Section, slotLabel } from "../ui";

function PlayerMeta({ p }: { p: LivePlayer }) {
  return (
    <span className="text-xs text-neutral-500">
      {p.position} {p.team ?? "FA"}
      {fmtKickoff(p) ? `, ${fmtKickoff(p)}` : ""}
    </span>
  );
}

export default function Lineup({ model }: { model: PageModel }) {
  const { ctx, lineup, changes, pivots } = model;

  if (!ctx.projectionsPosted) {
    return (
      <Section title={`Week ${ctx.week}`}>
        <Note tone="warn">Projections not posted yet for week {ctx.week}. Check back later in the week.</Note>
      </Section>
    );
  }

  const pivotByStarter = new Map(pivots.map((n) => [n.starter.playerId, n]));

  return (
    <div className="flex flex-col gap-6">
      <Section title="Changes to make">
        {changes.length === 0 ? (
          <Note tone="good">No changes: your Sleeper starters match the recommended lineup.</Note>
        ) : (
          <ol data-testid="changes" className="flex flex-col divide-y divide-neutral-100 rounded-md border border-neutral-200">
            {changes.map((c) => (
              <li
                key={`${c.action}-${c.player.playerId}`}
                data-kickoff={c.player.kickoff?.toISOString() ?? c.player.gameDate ?? ""}
                className="flex items-center justify-between gap-2 px-3 py-2 text-sm"
              >
                <span>
                  {c.action === "start" ? (
                    <>
                      Start <span className="font-semibold">{c.player.name}</span> at {slotLabel(c.slot!)}
                    </>
                  ) : (
                    <>
                      Bench <span className="font-semibold">{c.player.name}</span>
                    </>
                  )}{" "}
                  <InjuryChip status={c.player.injuryStatus} />
                </span>
                <span className="shrink-0 text-xs text-neutral-500">{fmtKickoff(c.player)}</span>
              </li>
            ))}
          </ol>
        )}
        {ctx.kickoffSource === "date-only" && (
          <Note>Kickoff times unavailable, so changes are ordered by game day only.</Note>
        )}
      </Section>

      <Section title={`Week ${ctx.week} recommended lineup`}>
        <ul className="flex flex-col divide-y divide-neutral-100">
          {lineup.starters.map((s, i) => {
            const p = s.player ? model.byId.get(s.player.playerId) : undefined;
            const pivot = p ? pivotByStarter.get(p.playerId) : undefined;
            return (
              <li key={i} className="flex flex-col gap-0.5 py-2">
                <div className="flex items-center gap-2 text-sm">
                  <span className="w-10 shrink-0 text-xs font-semibold text-neutral-500">{slotLabel(s.slot)}</span>
                  {p ? (
                    <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
                      <span className="truncate font-medium">{p.name}</span>
                      <InjuryChip status={p.injuryStatus} />
                      <LockChip locked={p.locked} />
                    </span>
                  ) : (
                    <span className="flex-1 text-neutral-400 italic">No eligible player</span>
                  )}
                  <span className="tabular-nums text-neutral-700">{p ? fmtPoints(p.projectedPoints) : ""}</span>
                </div>
                {p && (
                  <div className="pl-12">
                    <PlayerMeta p={p} />
                  </div>
                )}
                {pivot && (
                  <p data-testid="pivot" className="pl-12 text-xs text-amber-900">
                    If ruled out: start {pivot.pivot.name} ({fmtPoints(pivot.pivot.projectedPoints)}),{" "}
                    {pivot.timing === "same" ? "same kickoff" : "later kickoff"}, {fmtKickoff(pivot.pivot)}.
                  </p>
                )}
              </li>
            );
          })}
        </ul>
        <p className="text-sm font-medium">Projected total: {fmtPoints(lineup.totalProjectedPoints)}</p>
      </Section>

      <Section title="Bench">
        {lineup.bench.length === 0 ? (
          <Note>No bench players.</Note>
        ) : (
          <ul className="flex flex-col divide-y divide-neutral-100">
            {lineup.bench.map((b) => {
              const p = model.byId.get(b.playerId)!;
              return (
                <li key={p.playerId} className="flex items-center gap-2 py-2 text-sm">
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="flex flex-wrap items-center gap-1.5">
                      <span className="truncate">{p.name}</span>
                      <InjuryChip status={p.injuryStatus} />
                      <LockChip locked={p.locked} />
                    </span>
                    <PlayerMeta p={p} />
                  </span>
                  <span className="tabular-nums text-neutral-600">{fmtPoints(p.projectedPoints)}</span>
                </li>
              );
            })}
          </ul>
        )}
        <Note>
          {`${ctx.activeRosterSize} active players, ${ctx.irCount} on IR (IR doesn't count toward the 26 and can't start).`}
        </Note>
        {ctx.missingProjectionIds.length > 0 && (
          <Note tone="warn">
            {ctx.missingProjectionIds.length} rostered player(s) have no projection this week and are left out.
          </Note>
        )}
      </Section>
    </div>
  );
}
