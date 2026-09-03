import { test } from "node:test";
import assert from "node:assert/strict";
import { scorePlayer } from "./scoring";
import type { ScoringSettings } from "@db/types";

// The league's real live scoring_settings (confirmed against Sleeper in Phase 0,
// scratch/data/sleeper/league.json), matching docs/rules.md section II and
// architecture.md 3.1 exactly for every offense stat. Asserting against this
// exact fixture, not a hand-simplified one, is the point: it catches drift if
// Sleeper's settings ever diverge from the documented rules.
const SCORING: ScoringSettings = {
  pass_yd: 0.04,
  pass_td: 4,
  pass_int: -2,
  pass_2pt: 2,
  rush_yd: 0.1,
  rush_td: 6,
  rush_2pt: 2,
  rec: 0.5,
  rec_yd: 0.1,
  rec_td: 6,
  rec_2pt: 2,
  bonus_rec_wr: 0.5,
  bonus_rec_te: 0.75,
  fum_lost: -2,
  fum_rec_td: 6,
  // Inert kicker/DST keys present on the live payload (Phase 0 finding): no
  // roster slot can ever start one, and scorePlayer never reads them since it
  // only looks up the offense keys above plus the position's rec bonus key.
  fgm_0_19: 3,
  xpm: 1,
};

test("QB stat line scores per the documented table", () => {
  const stats = { pass_yd: 300, pass_td: 3, pass_int: 1, rush_yd: 20, fum_lost: 1 };
  const points = scorePlayer(stats, "QB", SCORING);
  // 300*0.04 + 3*4 + 1*(-2) + 20*0.1 + 1*(-2) = 12 + 12 - 2 + 2 - 2 = 22
  assert.equal(points, 22);
});

test("RB reception is worth 0.5, not the WR/TE bonus rate", () => {
  const stats = { rush_yd: 80, rush_td: 1, rec: 4, rec_yd: 30 };
  const points = scorePlayer(stats, "RB", SCORING);
  // 80*0.1 + 1*6 + 4*0.5 + 30*0.1 = 8 + 6 + 2 + 3 = 19
  assert.equal(points, 19);
});

test("WR reception is worth 1.0 (0.5 base + 0.5 bonus)", () => {
  const stats = { rec: 6, rec_yd: 90, rec_td: 1 };
  const points = scorePlayer(stats, "WR", SCORING);
  // 6*(0.5+0.5) + 90*0.1 + 1*6 = 6 + 9 + 6 = 21
  assert.equal(points, 21);
});

test("TE reception is worth 1.25 (0.5 base + 0.75 bonus), the modest premium", () => {
  const stats = { rec: 5, rec_yd: 60 };
  const points = scorePlayer(stats, "TE", SCORING);
  // 5*(0.5+0.75) + 60*0.1 = 6.25 + 6 = 12.25
  assert.equal(points, 12.25);
});

test("missing stat line scores zero rather than throwing", () => {
  assert.equal(scorePlayer(null, "QB", SCORING), 0);
  assert.equal(scorePlayer(undefined, "WR", SCORING), 0);
});

test("unscored stat keys (kicker/DST block) never contribute, even though present in live settings", () => {
  const stats = { rec: 2, rec_yd: 10 };
  const points = scorePlayer(stats, "WR", SCORING);
  // Only rec/rec_yd should count; fgm_0_19/xpm in SCORING must never be reached
  // since this league has no K/DEF roster slots (CLAUDE.md Phase 0 finding).
  assert.equal(points, 2 * 1.0 + 10 * 0.1);
});
