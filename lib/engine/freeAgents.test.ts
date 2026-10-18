import { test } from "node:test";
import assert from "node:assert/strict";
import { rankByLineupGain, rankFreeAgents, type FreeAgentCandidate } from "./freeAgents";
import type { LineupPlayer } from "./lineup";
import type { RosterSlot } from "@db/types";

test("ranks candidates by weekly projected points, descending", () => {
  const candidates: FreeAgentCandidate[] = [
    { playerId: "a", name: "A", position: "RB", weeklyProjectedPoints: 5 },
    { playerId: "b", name: "B", position: "WR", weeklyProjectedPoints: 12 },
    { playerId: "c", name: "C", position: "TE", weeklyProjectedPoints: 8 },
  ];
  const ranked = rankFreeAgents(candidates, 10);
  assert.deepEqual(
    ranked.map((r) => r.playerId),
    ["b", "c", "a"],
  );
});

test("rest-of-season is the weekly-projection x games-remaining placeholder", () => {
  const ranked = rankFreeAgents(
    [{ playerId: "a", name: "A", position: "QB", weeklyProjectedPoints: 15 }],
    6,
  );
  assert.equal(ranked[0].restOfSeasonProjectedPoints, 90);
});

function lp(playerId: string, position: LineupPlayer["position"], projectedPoints: number, overrides: Partial<LineupPlayer> = {}): LineupPlayer {
  return { playerId, name: playerId, position, projectedPoints, isBye: false, injuryStatus: null, kickoff: null, ...overrides };
}

const GAIN_SLOTS: RosterSlot[] = ["QB", "RB", "WR", "FLEX", "SUPER_FLEX", "BN"];
// Optimal today: QB qb1 25, RB rb1 20, WR wr1 18, FLEX wr2 12, SUPER_FLEX wr3 10.
const GAIN_ROSTER = [lp("qb1", "QB", 25), lp("rb1", "RB", 20), lp("wr1", "WR", 18), lp("wr2", "WR", 12), lp("wr3", "WR", 10)];

test("lineup gain: a QB free agent takes SUPER_FLEX and replaces the weakest starter there", () => {
  const [r] = rankByLineupGain(GAIN_SLOTS, GAIN_ROSTER, [lp("faQB", "QB", 15)]);
  assert.equal(r.gain, 5); // 15 replaces wr3's 10
  assert.equal(r.replaces?.playerId, "wr3");
});

test("lineup gain follows the FLEX/SUPER_FLEX chain: the player who drops out is the one replaced", () => {
  // faRB (14) takes FLEX, wr2 (12) slides up to SUPER_FLEX, wr3 (10) drops out.
  const [r] = rankByLineupGain(GAIN_SLOTS, GAIN_ROSTER, [lp("faRB", "RB", 14)]);
  assert.equal(r.gain, 4);
  assert.equal(r.replaces?.playerId, "wr3");
});

test("lineup gain is zero, with nobody replaced, for a player who wouldn't start or can't play", () => {
  const ranked = rankByLineupGain(GAIN_SLOTS, GAIN_ROSTER, [
    lp("faLow", "WR", 9),
    lp("faBye", "WR", 30, { isBye: true }),
    lp("faOut", "RB", 30, { injuryStatus: "Out" }),
  ]);
  for (const r of ranked) {
    assert.equal(r.gain, 0);
    assert.equal(r.replaces, null);
  }
  assert.equal(ranked[0].player.playerId, "faBye"); // ties at zero gain sort by projection
});

test("lineup gain ranks by gain, not raw projection", () => {
  // A 13-point TE and an 11-point WR each start over wr3 (10); a 16-point QB adds the most.
  const ranked = rankByLineupGain(GAIN_SLOTS, GAIN_ROSTER, [lp("faTE", "TE", 13), lp("faQB", "QB", 16), lp("faWR", "WR", 11)]);
  assert.deepEqual(ranked.map((r) => [r.player.playerId, r.gain]), [["faQB", 6], ["faTE", 3], ["faWR", 1]]);
});
