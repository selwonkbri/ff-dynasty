import { test } from "node:test";
import assert from "node:assert/strict";
import { detectScoringMismatches } from "./mismatches";

test("flags an inert kicker/DST scoring block when no K/DEF slot exists", () => {
  const issues = detectScoringMismatches({ fgm_0_19: 3, xpm: 1, pass_td: 4 }, ["QB", "RB", "WR", "FLEX"]);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].kind, "inert_scoring_block");
});

test("does not flag when a K or DEF slot actually exists", () => {
  const issues = detectScoringMismatches({ fgm_0_19: 3 }, ["QB", "RB", "WR", "K", "DEF"]);
  assert.deepEqual(issues, []);
});

test("does not flag when scoring_settings has no kicker/DST keys at all", () => {
  const issues = detectScoringMismatches({ pass_td: 4, rec: 0.5 }, ["QB", "RB", "WR", "FLEX"]);
  assert.deepEqual(issues, []);
});
