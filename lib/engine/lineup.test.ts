import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeOptimalLineup,
  computeLateSwapLineup,
  computeSwapList,
  type LineupPlayer,
} from "./lineup";
import type { RosterSlot } from "@db/types";

function p(
  playerId: string,
  position: LineupPlayer["position"],
  projectedPoints: number,
  overrides: Partial<LineupPlayer> = {},
): LineupPlayer {
  return {
    playerId,
    name: playerId,
    position,
    projectedPoints,
    isBye: false,
    injuryStatus: null,
    kickoff: null,
    ...overrides,
  };
}

const SLOTS: RosterSlot[] = ["QB", "RB", "WR", "TE", "FLEX", "SUPER_FLEX"];

test("happy path: fills each slot with the best eligible player, FLEX/SF get the next-best leftovers", () => {
  const roster: LineupPlayer[] = [
    p("qb1", "QB", 30),
    p("qb2", "QB", 15),
    p("rb1", "RB", 20),
    p("rb2", "RB", 9),
    p("wr1", "WR", 18),
    p("wr2", "WR", 12),
    p("te1", "TE", 8),
  ];
  const result = computeOptimalLineup(SLOTS, roster);

  const bySlot = Object.fromEntries(result.starters.map((s) => [s.slot, s.player?.playerId]));
  assert.equal(bySlot.QB, "qb1");
  assert.equal(bySlot.RB, "rb1");
  assert.equal(bySlot.WR, "wr1");
  assert.equal(bySlot.TE, "te1");
  // FLEX (RB/WR/TE only) takes the best leftover among rb2/wr2: wr2 (12) > rb2 (9)
  assert.equal(bySlot.FLEX, "wr2");
  // SUPER_FLEX takes the best leftover overall, including QB: qb2 (15) beats rb2 (9)
  assert.equal(bySlot.SUPER_FLEX, "qb2");
  assert.deepEqual(
    result.bench.map((b) => b.playerId).sort(),
    ["rb2"],
  );
});

test("QB and FLEX eligibility are disjoint: a high-scoring QB never fills FLEX, even outscoring every RB/WR/TE", () => {
  const roster: LineupPlayer[] = [
    p("qb1", "QB", 30),
    p("qb2", "QB", 50), // would win FLEX under a buggy nesting assumption
    p("rb1", "RB", 10),
    p("rb2", "RB", 4),
    p("wr1", "WR", 8),
    p("te1", "TE", 5),
  ];
  const result = computeOptimalLineup(SLOTS, roster);

  const flex = result.starters.find((s) => s.slot === "FLEX");
  assert.ok(flex?.player);
  assert.notEqual(flex.player!.position, "QB");
  assert.equal(flex.player!.playerId, "rb2"); // best remaining RB/WR/TE, not qb1
  const superFlex = result.starters.find((s) => s.slot === "SUPER_FLEX");
  assert.equal(superFlex?.player?.playerId, "qb1"); // qb1 correctly lands in SF instead
});

test("bye-week players are never started even with the highest projection", () => {
  const roster: LineupPlayer[] = [
    p("qb1", "QB", 30),
    p("rb1", "RB", 99, { isBye: true }),
    p("rb2", "RB", 5),
    p("wr1", "WR", 10),
    p("te1", "TE", 6),
  ];
  const result = computeOptimalLineup(SLOTS, roster);
  const starterIds = result.starters.map((s) => s.player?.playerId);
  assert.ok(!starterIds.includes("rb1"));
  assert.ok(result.bench.some((b) => b.playerId === "rb1"));
});

test("Out and Inactive players are never started even with the highest projection", () => {
  const roster: LineupPlayer[] = [
    p("qb1", "QB", 30),
    p("rb1", "RB", 99, { injuryStatus: "Out" }),
    p("rb2", "RB", 40, { injuryStatus: "Inactive" }),
    p("rb3", "RB", 5),
    p("wr1", "WR", 10),
    p("te1", "TE", 6),
  ];
  const result = computeOptimalLineup(SLOTS, roster);
  const starterIds = result.starters.map((s) => s.player?.playerId);
  assert.ok(!starterIds.includes("rb1"));
  assert.ok(!starterIds.includes("rb2"));
  assert.ok(starterIds.includes("rb3"));
});

test("late swap: a locked current starter stays in place even though a higher-scoring, but also-locked, bench player is now available", () => {
  const roster: LineupPlayer[] = [
    p("qb1", "QB", 30, { kickoff: new Date("2026-09-13T17:00:00Z") }),
    p("rb1", "RB", 10, { kickoff: new Date("2026-09-13T17:00:00Z") }), // locked, currently starting
    p("rb2", "RB", 25, { kickoff: new Date("2026-09-13T17:00:00Z") }), // locked, currently benched: can't be added
    p("wr1", "WR", 12, { kickoff: new Date("2026-09-14T17:00:00Z") }),
    p("te1", "TE", 6, { kickoff: new Date("2026-09-14T17:00:00Z") }),
  ];
  const now = new Date("2026-09-13T18:00:00Z"); // after rb1/rb2's kickoff, before wr1/te1's

  // slots: QB, RB, WR, TE, FLEX, SUPER_FLEX — currently starting qb1, rb1, wr1, te1
  const currentStarterIdsBySlotIndex = ["qb1", "rb1", "wr1", "te1", null, null];
  const result = computeLateSwapLineup(SLOTS, roster, currentStarterIdsBySlotIndex, now);

  const bySlot = Object.fromEntries(result.starters.map((s) => [s.slot, s.player?.playerId]));
  assert.equal(bySlot.RB, "rb1"); // locked in place despite rb2 scoring more
  assert.ok(!Object.values(bySlot).includes("rb2")); // locked-benched rb2 cannot be added
  assert.ok(result.bench.some((b) => b.playerId === "rb2"));
});

test("late swap: open (unlocked) slots still optimize normally among unlocked players", () => {
  const roster: LineupPlayer[] = [
    p("qb1", "QB", 30, { kickoff: new Date("2026-09-13T17:00:00Z") }),
    p("rb1", "RB", 10, { kickoff: new Date("2026-09-13T17:00:00Z") }),
    p("wr1", "WR", 12, { kickoff: new Date("2026-09-14T17:00:00Z") }), // unlocked, currently starting
    p("wr2", "WR", 20, { kickoff: new Date("2026-09-14T17:00:00Z") }), // unlocked, higher, currently benched
    p("te1", "TE", 6, { kickoff: new Date("2026-09-14T17:00:00Z") }),
  ];
  const now = new Date("2026-09-13T18:00:00Z");
  const currentStarterIdsBySlotIndex = ["qb1", "rb1", "wr1", "te1", null, null];
  const result = computeLateSwapLineup(SLOTS, roster, currentStarterIdsBySlotIndex, now);

  const bySlot = Object.fromEntries(result.starters.map((s) => [s.slot, s.player?.playerId]));
  assert.equal(bySlot.WR, "wr2"); // unlocked slot re-optimized to the better unlocked option
});

test("computeSwapList flags a bench player who should start and the starter they replace", () => {
  // 5 slots, 6 players, so there's an actual bench spot for the diff to land on.
  const swapSlots: RosterSlot[] = ["QB", "RB", "WR", "FLEX", "SUPER_FLEX"];
  const roster: LineupPlayer[] = [
    p("qb1", "QB", 25),
    p("qb2", "QB", 15),
    p("rb1", "RB", 20),
    p("rb2", "RB", 5),
    p("wr1", "WR", 18),
    p("wr2", "WR", 12),
  ];
  const optimal = computeOptimalLineup(swapSlots, roster);
  // Optimal: QB=qb1, RB=rb1, WR=wr1, FLEX=wr2 (12 > rb2's 5), SUPER_FLEX=qb2 (15 > rb2's 5)
  // Current Sleeper starters instead have rb2 (5 pts) starting at FLEX, wr2 benched.
  const currentStarterIds = new Set(["qb1", "rb1", "wr1", "rb2", "qb2"]);

  const { toStart, toBench } = computeSwapList(swapSlots, optimal, currentStarterIds);

  assert.equal(toStart.length, 1);
  assert.equal(toStart[0].player.playerId, "wr2");
  assert.equal(toStart[0].slot, "FLEX");
  assert.equal(toBench.length, 1);
  assert.equal(toBench[0].playerId, "rb2");
});

test("computeSwapList reports no swaps when current starters already match optimal", () => {
  const roster: LineupPlayer[] = [
    p("qb1", "QB", 30),
    p("rb1", "RB", 10),
    p("wr1", "WR", 12),
    p("te1", "TE", 6),
  ];
  const optimal = computeOptimalLineup(SLOTS, roster);
  const currentStarterIds = new Set(optimal.starters.filter((s) => s.player).map((s) => s.player!.playerId));

  const { toStart, toBench } = computeSwapList(SLOTS, optimal, currentStarterIds);
  assert.deepEqual(toStart, []);
  assert.deepEqual(toBench, []);
});
