import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildLiveContext,
  dedupeProjections,
  firstGameDate,
  kickoffsFromEspnScoreboard,
  type LiveInputs,
} from "./liveContext";
import type { RosterSlot, ScoringSettings } from "@db/types";
import type { SleeperGame, SleeperProjection, SleeperRoster } from "@lib/sleeper";

const SCORING: ScoringSettings = { rec: 0.5, bonus_rec_wr: 0.5, bonus_rec_te: 0.75, rec_yd: 0.1, pass_td: 4 };
const SLOTS: RosterSlot[] = ["QB", "RB", "WR", "FLEX", "BN", "BN"];

function proj(id: string, position: string, team: string | null, stats: Record<string, number>, injury: string | null = null): SleeperProjection {
  return {
    player_id: id,
    company: "rotowire",
    stats,
    player: { first_name: id.toUpperCase(), last_name: "Test", position, team, injury_status: injury },
  };
}

function game(week: number, away: string, home: string, status = "pre_game", date = "2026-10-18"): SleeperGame {
  return { game_id: `${week}${home}`, week, date, home, away, status };
}

function roster(id: number, players: string[], extra: Partial<SleeperRoster> = {}): SleeperRoster {
  return { roster_id: id, owner_id: `owner${id}`, players, starters: [], reserve: [], taxi: [], settings: {}, ...extra };
}

function inputs(overrides: Partial<LiveInputs> = {}): LiveInputs {
  return {
    week: 6,
    myRosterId: 9,
    league: {
      league_id: "L",
      name: "Legacy",
      season: "2026",
      settings: { waiver_budget: 1000, trade_deadline: 14 },
      scoring_settings: SCORING,
      roster_positions: SLOTS,
    },
    rosters: [
      roster(9, ["qb1", "rb1", "wr1", "wr2", "ir1"], {
        starters: ["qb1", "rb1", "wr1", "wr2"],
        reserve: ["ir1"],
        settings: { waiver_budget_used: 38 },
      }),
      roster(4, ["opp1"], { starters: ["opp1", "0", "0", "0"] }),
    ],
    users: [
      { user_id: "owner9", display_name: "guyel", metadata: { team_name: "Mac's Mates" } },
      { user_id: "owner4", display_name: "rival", metadata: null },
    ],
    matchups: null,
    projections: [
      proj("qb1", "QB", "KC", { pass_td: 2 }),
      proj("rb1", "RB", "CIN", { rec: 2 }), // CIN has no week 6 game below: bye
      proj("wr1", "WR", "WAS", { rec: 4 }, "Questionable"),
      proj("wr2", "WR", "JAX", { rec: 3 }),
      proj("ir1", "WR", "KC", { rec: 9 }, "IR"),
      proj("opp1", "QB", "KC", { pass_td: 3 }),
      proj("fa1", "TE", "JAX", { rec: 4 }),
      proj("fa2", "WR", "KC", { rec: 1 }),
      proj("k1", "K", "KC", { fgm: 2 }), // not a scoring position: never a free agent
    ],
    schedule: [
      game(6, "LAC", "KC"),
      game(6, "HOU", "JAX", "in_game"),
      game(6, "SF", "WAS", "pre_game", "2026-10-19"),
      game(7, "KC", "JAX"), // WAS bye in week 7, CIN plays
      game(7, "CIN", "LAC"),
      game(8, "KC", "WAS"),
      game(8, "CIN", "JAX"),
    ],
    kickoffs: null,
    ...overrides,
  };
}

test("IR players are excluded from the lineup pool and from the active roster count", () => {
  const ctx = buildLiveContext(inputs());
  assert.ok(!ctx.roster.some((p) => p.playerId === "ir1"));
  assert.equal(ctx.activeRosterSize, 4);
  assert.equal(ctx.irCount, 1);
});

test("a team with no game this week is on bye; a team with a game is not", () => {
  const ctx = buildLiveContext(inputs());
  const byId = new Map(ctx.roster.map((p) => [p.playerId, p]));
  assert.equal(byId.get("rb1")!.isBye, true);
  assert.equal(byId.get("qb1")!.isBye, false);
  assert.equal(byId.get("rb1")!.gameDate, null);
  assert.equal(byId.get("wr1")!.gameDate, "2026-10-19");
});

test("locked comes from Sleeper's live game status, not the clock", () => {
  const ctx = buildLiveContext(inputs());
  const byId = new Map(ctx.roster.map((p) => [p.playerId, p]));
  assert.equal(byId.get("wr2")!.locked, true); // HOU@JAX in_game
  assert.equal(byId.get("qb1")!.locked, false); // LAC@KC pre_game
  assert.equal(byId.get("rb1")!.locked, false); // bye: nothing to lock
});

test("points are scored under the live scoring_settings by position", () => {
  const ctx = buildLiveContext(inputs());
  const byId = new Map(ctx.roster.map((p) => [p.playerId, p]));
  assert.equal(byId.get("wr1")!.projectedPoints, 4); // 4 rec x 1.0
  assert.equal(byId.get("rb1")!.projectedPoints, 1); // 2 rec x 0.5
  assert.equal(byId.get("wr1")!.injuryStatus, "Questionable");
});

test("ESPN kickoffs map WSH to Sleeper's WAS and attach to players", () => {
  const kickoffs = kickoffsFromEspnScoreboard({
    events: [
      {
        date: "2026-10-20T00:20Z",
        competitions: [{ competitors: [{ team: { abbreviation: "WSH" } }, { team: { abbreviation: "SF" } }] }],
      },
      { date: "not a date", competitions: [{ competitors: [{ team: { abbreviation: "KC" } }] }] },
    ],
  });
  assert.equal(kickoffs.WAS.toISOString(), "2026-10-20T00:20:00.000Z");
  assert.equal(kickoffs.SF.toISOString(), "2026-10-20T00:20:00.000Z");
  assert.equal(kickoffs.WSH, undefined);
  assert.equal(kickoffs.KC, undefined); // unparseable dates are skipped

  const ctx = buildLiveContext(inputs({ kickoffs }));
  assert.equal(ctx.kickoffSource, "espn");
  assert.equal(ctx.roster.find((p) => p.playerId === "wr1")!.kickoff!.toISOString(), "2026-10-20T00:20:00.000Z");
  assert.equal(buildLiveContext(inputs()).kickoffSource, "date-only");
});

test("free agents exclude every rostered, IR, and taxi player and non-scoring positions", () => {
  const base = inputs();
  base.rosters[1] = roster(4, ["opp1"], { taxi: ["fa2"] });
  const ctx = buildLiveContext(base);
  assert.deepEqual(ctx.freeAgents.map((p) => p.playerId).sort(), ["fa1"]);
});

test("FAAB remaining is the league budget minus waiver_budget_used, null when the field is missing", () => {
  assert.deepEqual(buildLiveContext(inputs()).faab, { budget: 1000, used: 38, remaining: 962 });
  const noField = inputs();
  noField.rosters[0] = { ...noField.rosters[0], settings: {} };
  assert.equal(buildLiveContext(noField).faab, null);
});

test("bye planner lists current starters on bye for the next three weeks that have games", () => {
  const ctx = buildLiveContext(inputs());
  // Week 9 has no games in the fixture, so only weeks 7 and 8 appear.
  assert.deepEqual(
    ctx.byePlan.map((w) => ({ week: w.week, ids: w.starters.map((s) => s.playerId) })),
    [
      { week: 7, ids: ["wr1"] }, // WAS has no week 7 game
      { week: 8, ids: [] },
    ],
  );
});

test("projectionsPosted is false when the feed is empty, and nothing is invented", () => {
  const ctx = buildLiveContext(inputs({ projections: [] }));
  assert.equal(ctx.projectionsPosted, false);
  assert.deepEqual(ctx.roster, []);
  assert.deepEqual(ctx.missingProjectionIds.sort(), ["qb1", "rb1", "wr1", "wr2"]);
});

test("duplicate projections keep the rotowire entry", () => {
  const other: SleeperProjection = { ...proj("qb1", "QB", "KC", { pass_td: 9 }), company: "someone_else" };
  const rotowire = proj("qb1", "QB", "KC", { pass_td: 2 });
  assert.equal(dedupeProjections([other, rotowire]).get("qb1"), rotowire);
  assert.equal(dedupeProjections([rotowire, other]).get("qb1"), rotowire);
});

test("matchup sides use starters_points for live points and team names from users", () => {
  const ctx = buildLiveContext(
    inputs({
      matchups: [
        { roster_id: 9, matchup_id: 3, points: 41.5, starters: ["qb1", "rb1", "wr1", "wr2"], players: [], players_points: null, starters_points: [20, 1, 0, 20.5] },
        { roster_id: 4, matchup_id: 3, points: 12, starters: ["opp1", "0", "0", "0"], players: [], players_points: { opp1: 12 } },
        { roster_id: 1, matchup_id: 2, points: 0, starters: [], players: [], players_points: null },
      ],
    }),
  );
  assert.ok(ctx.matchup);
  assert.equal(ctx.matchup.mine.teamName, "Mac's Mates");
  assert.equal(ctx.matchup.opponent.teamName, "rival");
  assert.equal(ctx.matchup.mine.livePoints, 41.5);
  assert.equal(ctx.matchup.mine.starters[0].live, 20);
  assert.equal(ctx.matchup.opponent.starters[0].live, 12); // falls back to players_points
  assert.equal(ctx.matchup.opponent.starters[1].name, "Empty");
  assert.equal(ctx.matchup.opponent.projectedTotal, 12); // 3 pass TD x 4
});

test("firstGameDate returns the earliest date in a week, null for a week with no games", () => {
  const schedule = [game(15, "A", "B", "pre_game", "2026-12-20"), game(15, "C", "D", "pre_game", "2026-12-17")];
  assert.equal(firstGameDate(schedule, 15), "2026-12-17");
  assert.equal(firstGameDate(schedule, 16), null);
});
