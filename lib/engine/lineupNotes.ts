// Pure, no I/O. The Lineup tab's decision aids (architecture.md 4.2's decision
// list, scoped to what live Sleeper + ESPN data supports): the order to make
// changes in, injury flags, and Questionable pivots.
import type { RosterSlot } from "@db/types";
import { canFill, OUT_STATUSES, type LineupResult, type SwapList } from "./lineup";
import type { LivePlayer } from "./liveContext";

// Statuses that mean the player won't play. Brian asked for Out, Doubtful and
// IR; Inactive and Sus (suspended) are added because they mean the same thing.
export const RED_FLAG_STATUSES = new Set(["Out", "Doubtful", "IR", "Inactive", "Sus"]);

export type InjuryFlag = "red" | "questionable" | null;

export function injuryFlag(status: string | null): InjuryFlag {
  if (!status) return null;
  if (RED_FLAG_STATUSES.has(status)) return "red";
  if (status === "Questionable") return "questionable";
  return null;
}

// Exact kickoff when ESPN supplied one, otherwise the start of the game's date
// (Sleeper's schedule has no times), otherwise last.
function kickoffSortKey(p: LivePlayer): number {
  if (p.kickoff) return p.kickoff.getTime();
  if (p.gameDate) return Date.parse(`${p.gameDate}T00:00:00Z`);
  return Number.POSITIVE_INFINITY;
}

export interface ChangeItem {
  action: "start" | "bench";
  slot: RosterSlot | null; // the slot to start into; null for a bench move
  player: LivePlayer;
}

// One entry per player move from computeSwapList, earliest kickoff first, so
// the moves that lock soonest are made first. The late-swap lineup never moves
// a locked player, so everything listed here can still be changed.
export function orderChanges(swaps: SwapList, byId: Map<string, LivePlayer>): ChangeItem[] {
  const items: ChangeItem[] = [];
  for (const s of swaps.toStart) {
    const player = byId.get(s.player.playerId);
    if (player) items.push({ action: "start", slot: s.slot, player });
  }
  for (const b of swaps.toBench) {
    const player = byId.get(b.playerId);
    if (player) items.push({ action: "bench", slot: null, player });
  }
  return items.sort(
    (a, b) =>
      kickoffSortKey(a.player) - kickoffSortKey(b.player) ||
      (a.action === b.action ? 0 : a.action === "start" ? -1 : 1) ||
      a.player.name.localeCompare(b.player.name),
  );
}

export interface PivotNote {
  starter: LivePlayer;
  slot: RosterSlot;
  pivot: LivePlayer;
  // "same": kicks off at the same time, so both games' inactives come out
  // together (about 90 minutes before kickoff). "later": a later kickoff.
  timing: "same" | "later";
}

function pivotTiming(starter: LivePlayer, candidate: LivePlayer): PivotNote["timing"] | null {
  if (starter.kickoff && candidate.kickoff) {
    const diff = candidate.kickoff.getTime() - starter.kickoff.getTime();
    if (diff === 0) return "same";
    return diff > 0 ? "later" : null;
  }
  // Date-only fallback: same-day order is unknown, so only a strictly later
  // date is safe to call a later game.
  if (starter.gameDate && candidate.gameDate && candidate.gameDate > starter.gameDate) return "later";
  return null;
}

// For each Questionable starter whose game hasn't started: the highest-projected
// bench player who can fill the same slot, isn't locked, out, or on bye, and
// plays at the same time or later, so waiting for the inactives list is safe.
export function questionablePivots(lineup: LineupResult, byId: Map<string, LivePlayer>): PivotNote[] {
  const bench = lineup.bench.map((b) => byId.get(b.playerId)).filter((p): p is LivePlayer => p !== undefined);
  const notes: PivotNote[] = [];

  for (const { slot, player } of lineup.starters) {
    const starter = player ? byId.get(player.playerId) : undefined;
    if (!starter || starter.locked || starter.injuryStatus !== "Questionable") continue;

    let best: { pivot: LivePlayer; timing: PivotNote["timing"] } | null = null;
    for (const candidate of bench) {
      if (
        !canFill(slot, candidate.position) ||
        candidate.locked ||
        candidate.isBye ||
        candidate.projectedPoints <= 0 ||
        (candidate.injuryStatus !== null &&
          (OUT_STATUSES.has(candidate.injuryStatus) || RED_FLAG_STATUSES.has(candidate.injuryStatus)))
      ) {
        continue;
      }
      const timing = pivotTiming(starter, candidate);
      if (timing && (!best || candidate.projectedPoints > best.pivot.projectedPoints)) {
        best = { pivot: candidate, timing };
      }
    }
    if (best) notes.push({ starter, slot, ...best });
  }
  return notes;
}
