import { test } from "node:test";
import assert from "node:assert/strict";
import { injuryFlag, orderChanges, questionablePivots } from "./lineupNotes";
import { computeOptimalLineup, type LineupResult } from "./lineup";
import type { LivePlayer } from "./liveContext";
import type { RosterSlot } from "@db/types";

function lp(
  playerId: string,
  position: LivePlayer["position"],
  projectedPoints: number,
  overrides: Partial<LivePlayer> = {},
): LivePlayer {
  return {
    playerId,
    name: playerId,
    position,
    projectedPoints,
    isBye: false,
    injuryStatus: null,
    kickoff: null,
    team: "KC",
    gameDate: "2026-10-18",
    locked: false,
    ...overrides,
  };
}

const ONE_PM = new Date("2026-10-18T17:00:00Z");
const FOUR_PM = new Date("2026-10-18T20:25:00Z");
const SNF = new Date("2026-10-19T00:20:00Z");

test("injury flags: Out, Doubtful, IR, Inactive and Sus are red; Questionable is its own flag", () => {
  for (const s of ["Out", "Doubtful", "IR", "Inactive", "Sus"]) assert.equal(injuryFlag(s), "red");
  assert.equal(injuryFlag("Questionable"), "questionable");
  assert.equal(injuryFlag(null), null);
  assert.equal(injuryFlag("NA"), null);
});

test("changes are ordered by kickoff, earliest first, with unknown times last", () => {
  const players = [
    lp("late", "WR", 10, { kickoff: SNF }),
    lp("early", "WR", 10, { kickoff: ONE_PM }),
    lp("mid", "RB", 10, { kickoff: FOUR_PM }),
    lp("none", "TE", 10, { team: null, gameDate: null }),
  ];
  const byId = new Map(players.map((p) => [p.playerId, p]));
  const changes = orderChanges(
    {
      toStart: [
        { slot: "FLEX", player: byId.get("late")! },
        { slot: "WR", player: byId.get("early")! },
      ],
      toBench: [byId.get("none")!, byId.get("mid")!],
    },
    byId,
  );
  assert.deepEqual(
    changes.map((c) => `${c.action}:${c.player.playerId}`),
    ["start:early", "bench:mid", "start:late", "bench:none"],
  );
});

test("changes fall back to game date order when there are no kickoff times", () => {
  const players = [lp("mon", "WR", 10, { gameDate: "2026-10-19" }), lp("thu", "WR", 10, { gameDate: "2026-10-15" })];
  const byId = new Map(players.map((p) => [p.playerId, p]));
  const changes = orderChanges({ toStart: [{ slot: "WR", player: byId.get("mon")! }], toBench: [byId.get("thu")!] }, byId);
  assert.deepEqual(changes.map((c) => c.player.playerId), ["thu", "mon"]);
});

const SLOTS: RosterSlot[] = ["QB", "WR", "FLEX", "BN", "BN", "BN"];

function lineupFor(players: LivePlayer[]): { lineup: LineupResult; byId: Map<string, LivePlayer> } {
  return { lineup: computeOptimalLineup(SLOTS, players), byId: new Map(players.map((p) => [p.playerId, p])) };
}

test("a Questionable starter gets the best same-or-later bench pivot that fits the slot", () => {
  const { lineup, byId } = lineupFor([
    lp("qb", "QB", 20, { kickoff: ONE_PM }),
    lp("wrQ", "WR", 15, { kickoff: ONE_PM, injuryStatus: "Questionable" }),
    lp("flex", "RB", 14, { kickoff: ONE_PM }),
    lp("earlyWR", "WR", 13, { kickoff: new Date("2026-10-18T13:30:00Z") }), // London: earlier, not a pivot
    lp("lateWR", "WR", 9, { kickoff: FOUR_PM }),
    lp("sameRB", "RB", 11, { kickoff: ONE_PM }), // RB can't fill the WR slot
  ]);
  const notes = questionablePivots(lineup, byId);
  assert.equal(notes.length, 1);
  assert.equal(notes[0].starter.playerId, "wrQ");
  assert.equal(notes[0].slot, "WR");
  assert.equal(notes[0].pivot.playerId, "lateWR");
  assert.equal(notes[0].timing, "later");
});

test("a same-kickoff bench player counts as a pivot and is labeled same", () => {
  const { lineup, byId } = lineupFor([
    lp("qb", "QB", 20, { kickoff: ONE_PM }),
    lp("wrQ", "WR", 15, { kickoff: FOUR_PM, injuryStatus: "Questionable" }),
    lp("flex", "RB", 14, { kickoff: ONE_PM }),
    lp("sameWR", "WR", 8, { kickoff: FOUR_PM }),
  ]);
  const notes = questionablePivots(lineup, byId);
  assert.equal(notes[0].pivot.playerId, "sameWR");
  assert.equal(notes[0].timing, "same");
});

test("no pivot note for a locked Questionable starter or when every bench option is unusable", () => {
  const locked = lineupFor([
    lp("qb", "QB", 20),
    lp("wrQ", "WR", 15, { kickoff: ONE_PM, injuryStatus: "Questionable", locked: true }),
    lp("flex", "RB", 14),
    lp("lateWR", "WR", 9, { kickoff: FOUR_PM }),
  ]);
  assert.deepEqual(questionablePivots(locked.lineup, locked.byId), []);

  const unusable = lineupFor([
    lp("qb", "QB", 20),
    lp("wrQ", "WR", 15, { kickoff: ONE_PM, injuryStatus: "Questionable" }),
    lp("flex", "RB", 14),
    lp("outWR", "WR", 9, { kickoff: FOUR_PM, injuryStatus: "Doubtful" }),
    lp("byeWR", "WR", 9, { isBye: true, gameDate: null }),
    lp("lockedWR", "WR", 9, { kickoff: FOUR_PM, locked: true }),
  ]);
  assert.deepEqual(questionablePivots(unusable.lineup, unusable.byId), []);
});

test("date-only fallback: only a strictly later game date counts as a later game", () => {
  const { lineup, byId } = lineupFor([
    lp("qb", "QB", 20),
    lp("wrQ", "WR", 15, { injuryStatus: "Questionable", gameDate: "2026-10-18" }),
    lp("flex", "RB", 14),
    lp("sameDayWR", "WR", 12, { gameDate: "2026-10-18" }), // could be earlier that day: not safe
    lp("mondayWR", "WR", 7, { gameDate: "2026-10-19" }),
  ]);
  const notes = questionablePivots(lineup, byId);
  assert.equal(notes[0].pivot.playerId, "mondayWR");
  assert.equal(notes[0].timing, "later");
});
