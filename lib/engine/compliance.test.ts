import { test } from "node:test";
import assert from "node:assert/strict";
import { checkCompliance } from "./compliance";
import type { LineupPlayer } from "./lineup";
import type { RosterSlot } from "@db/types";

function p(playerId: string, overrides: Partial<LineupPlayer> = {}): LineupPlayer {
  return {
    playerId,
    name: playerId,
    position: "RB",
    projectedPoints: 10,
    isBye: false,
    injuryStatus: null,
    kickoff: null,
    ...overrides,
  };
}

function starter(slot: RosterSlot, player: LineupPlayer | null) {
  return { slot, player };
}

test("a clean lineup within the roster limit has no issues", () => {
  const issues = checkCompliance({
    starters: [starter("QB", p("qb1")), starter("RB", p("rb1"))],
    rosterSize: 26,
  });
  assert.deepEqual(issues, []);
});

test("flags a bye-week starter", () => {
  const issues = checkCompliance({
    starters: [starter("RB", p("rb1", { isBye: true }))],
    rosterSize: 26,
  });
  assert.equal(issues.length, 1);
  assert.equal(issues[0].kind, "bye");
  assert.equal(issues[0].playerId, "rb1");
});

test("flags an Out starter distinctly from Inactive", () => {
  const issues = checkCompliance({
    starters: [
      starter("RB", p("rb1", { injuryStatus: "Out" })),
      starter("WR", p("wr1", { injuryStatus: "Inactive" })),
    ],
    rosterSize: 26,
  });
  assert.equal(issues.length, 2);
  assert.deepEqual(
    issues.map((i) => i.kind).sort(),
    ["inactive", "out"],
  );
});

test("a bye-week starter who is also Out is flagged for both", () => {
  const issues = checkCompliance({
    starters: [starter("RB", p("rb1", { isBye: true, injuryStatus: "Out" }))],
    rosterSize: 26,
  });
  assert.deepEqual(
    issues.map((i) => i.kind).sort(),
    ["bye", "out"],
  );
});

test("roster over the limit flags both the overage and the lineup lock consequence", () => {
  const issues = checkCompliance({
    starters: [starter("QB", p("qb1"))],
    rosterSize: 28,
  });
  assert.deepEqual(
    issues.map((i) => i.kind),
    ["roster_over_limit", "locked_pending_cut"],
  );
});

test("empty slots (no player assigned) are not flagged as issues", () => {
  const issues = checkCompliance({
    starters: [starter("SUPER_FLEX", null)],
    rosterSize: 26,
  });
  assert.deepEqual(issues, []);
});
