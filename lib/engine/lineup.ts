// Pure, no I/O. Optimal starting lineup, swap list vs. current Sleeper starters,
// and a locked-slot variant for late-swap decisions after some players' games
// have already kicked off.
import type { RosterSlot } from "@db/types";

export interface LineupPlayer {
  playerId: string;
  name: string;
  position: "QB" | "RB" | "WR" | "TE";
  projectedPoints: number;
  isBye: boolean;
  injuryStatus: string | null;
  kickoff: Date | null;
}

export interface LineupSlotResult {
  slot: RosterSlot;
  player: LineupPlayer | null;
}

export interface LineupResult {
  starters: LineupSlotResult[];
  bench: LineupPlayer[];
  totalProjectedPoints: number;
}

// Compliance rule (rules.md XII / architecture.md 3.2): bye-week players and
// skill players listed Out or Inactive can never be in the lineup. Exported so
// compliance.ts checks the same statuses this module excludes, not a copy.
export const OUT_STATUSES = new Set(["Out", "Inactive"]);

function isEligible(p: LineupPlayer): boolean {
  return !p.isBye && !(p.injuryStatus && OUT_STATUSES.has(p.injuryStatus));
}

// FLEX (RB/WR/TE) and QB eligibility are disjoint siblings under SUPER_FLEX
// (QB/RB/WR/TE), not nested inside one another — this league's FLEX never
// admits a QB. Slots are filled narrowest-eligibility-first (QB/RB/WR/TE, then
// FLEX, then SUPER_FLEX), which is optimal for this laminar eligibility
// structure: every eligibility set here is either disjoint from or a superset
// of every other, so greedy-by-specificity never forecloses a better global
// assignment (verified in scratch/optimal-lineup.test.mjs before this module
// was written).
const SLOT_ELIGIBILITY: Partial<Record<RosterSlot, ReadonlySet<string>>> = {
  QB: new Set(["QB"]),
  RB: new Set(["RB"]),
  WR: new Set(["WR"]),
  TE: new Set(["TE"]),
  FLEX: new Set(["RB", "WR", "TE"]),
  SUPER_FLEX: new Set(["QB", "RB", "WR", "TE"]),
};

function fillSlots(
  slots: RosterSlot[],
  pool: LineupPlayer[],
): { assignments: (LineupPlayer | null)[]; used: Set<string> } {
  const used = new Set<string>();
  const assignments: (LineupPlayer | null)[] = new Array(slots.length).fill(null);

  const order = slots
    .map((slot, index) => ({ slot, index }))
    .filter(({ slot }) => slot !== "BN")
    .sort((a, b) => (SLOT_ELIGIBILITY[a.slot]?.size ?? 0) - (SLOT_ELIGIBILITY[b.slot]?.size ?? 0));

  for (const { slot, index } of order) {
    const eligiblePositions = SLOT_ELIGIBILITY[slot];
    if (!eligiblePositions) continue;
    const candidate = pool
      .filter((p) => !used.has(p.playerId) && eligiblePositions.has(p.position))
      .sort((a, b) => b.projectedPoints - a.projectedPoints)[0];
    if (candidate) {
      assignments[index] = candidate;
      used.add(candidate.playerId);
    }
  }

  return { assignments, used };
}

function toResult(slots: RosterSlot[], assignments: (LineupPlayer | null)[], roster: LineupPlayer[]): LineupResult {
  const starterIds = new Set(assignments.filter((p): p is LineupPlayer => p !== null).map((p) => p.playerId));
  const starters = slots
    .map((slot, index) => ({ slot, player: assignments[index] }))
    .filter((s) => s.slot !== "BN");
  const bench = roster.filter((p) => !starterIds.has(p.playerId));
  const totalProjectedPoints = starters.reduce((sum, s) => sum + (s.player?.projectedPoints ?? 0), 0);
  return { starters, bench, totalProjectedPoints };
}

export function computeOptimalLineup(slots: RosterSlot[], roster: LineupPlayer[]): LineupResult {
  const eligible = roster.filter(isEligible);
  const { assignments } = fillSlots(slots, eligible);
  return toResult(slots, assignments, roster);
}

// Late-swap variant: players whose game has already kicked off keep whatever
// slot they currently occupy (starting or benched) per rules.md ("players lock
// at the kickoff of their own game; unlocked players can still be moved").
// Only unlocked players and open slots get re-optimized.
export function computeLateSwapLineup(
  slots: RosterSlot[],
  roster: LineupPlayer[],
  currentStarterIdsBySlotIndex: (string | null)[],
  now: Date,
): LineupResult {
  const isLocked = (p: LineupPlayer) => p.kickoff !== null && p.kickoff.getTime() <= now.getTime();
  const byId = new Map(roster.map((p) => [p.playerId, p]));

  const assignments: (LineupPlayer | null)[] = new Array(slots.length).fill(null);

  // Fix locked players into whatever slot they currently occupy.
  slots.forEach((slot, index) => {
    if (slot === "BN") return;
    const currentId = currentStarterIdsBySlotIndex[index];
    const current = currentId ? byId.get(currentId) : null;
    if (current && isLocked(current)) {
      assignments[index] = current;
    }
  });

  // Locked bench players stay benched: any locked player (whether they were
  // currently starting, already fixed above via lockedIds, or currently
  // benched) is excluded from the optimizable pool for the remaining open slots.
  const openIndices = slots.map((_, i) => i).filter((i) => assignments[i] === null && slots[i] !== "BN");
  const optimizablePool = roster.filter((p) => isEligible(p) && !isLocked(p));

  const { assignments: openAssignments } = fillSlots(
    openIndices.map((i) => slots[i]),
    optimizablePool,
  );
  openIndices.forEach((slotIndex, i) => {
    assignments[slotIndex] = openAssignments[i];
  });

  return toResult(slots, assignments, roster);
}

export interface SwapEntry {
  slot: RosterSlot;
  player: LineupPlayer;
}

export interface SwapList {
  toStart: SwapEntry[];
  toBench: LineupPlayer[];
}

// Set difference, not index-by-index: two players both already starting who land
// in different same-type slots (e.g. WR1 vs WR2) is not a real swap. Verified
// against a deliberately-wrong fixture in scratch/optimal-lineup.test.mjs before
// this logic was ported here.
export function computeSwapList(
  slots: RosterSlot[],
  optimal: LineupResult,
  currentStarterIds: Set<string>,
): SwapList {
  const optimalIds = new Set(optimal.starters.filter((s) => s.player).map((s) => s.player!.playerId));
  const byId = new Map(optimal.starters.filter((s) => s.player).map((s) => [s.player!.playerId, s.player!]));
  for (const p of optimal.bench) byId.set(p.playerId, p);

  const toStart = optimal.starters.filter(
    (s): s is SwapEntry => s.player !== null && !currentStarterIds.has(s.player.playerId),
  );
  const toBench = [...currentStarterIds]
    .filter((id) => !optimalIds.has(id))
    .map((id) => byId.get(id))
    .filter((p): p is LineupPlayer => p !== undefined);

  return { toStart, toBench };
}
