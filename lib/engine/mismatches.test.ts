import { test } from "node:test";
import assert from "node:assert/strict";
import { detectScoringMismatches, detectTradeDeadlineMismatch, RULES_TRADE_DEADLINE_WEEK } from "./mismatches";

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

test("flags the trade deadline when rules and Sleeper disagree, naming both weeks", () => {
  const issues = detectTradeDeadlineMismatch(14);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].kind, "trade_deadline");
  assert.equal(issues[0].detail, "Trade deadline: Week 12 (rules) / Week 14 (Sleeper), unconfirmed.");
});

test("does not flag the trade deadline when Sleeper matches the rules", () => {
  assert.deepEqual(detectTradeDeadlineMismatch(RULES_TRADE_DEADLINE_WEEK), []);
});

test("does not flag the trade deadline when Sleeper has no value", () => {
  assert.deepEqual(detectTradeDeadlineMismatch(undefined), []);
});
