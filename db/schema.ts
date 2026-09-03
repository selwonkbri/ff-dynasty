import {
  pgTable,
  text,
  integer,
  smallint,
  real,
  boolean,
  timestamp,
  jsonb,
  serial,
  primaryKey,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import type {
  ScoringSettings,
  LeagueSettings,
  RosterSlot,
  StatLine,
  PlayerPointsMap,
  PlayerRosterMap,
  DraftPickTransfer,
  WaiverBudgetTransfer,
  RawSnapshotBody,
  AlertPayload,
} from "./types";

// Phase 1 tables only (architecture.md section 4.5 / 5). Phase 2/3 tables
// (owner_profiles, faab_years, picks, stats_weekly, values_raw, value_adjustments,
// protected, settings, briefs, sim_results) are deliberately not defined here yet.

export const league = pgTable("league", {
  leagueId: text("league_id").primaryKey(),
  season: smallint("season").notNull(),
  settings: jsonb("settings").$type<LeagueSettings>().notNull(),
  scoringSettings: jsonb("scoring_settings").$type<ScoringSettings>().notNull(),
  rosterPositions: jsonb("roster_positions").$type<RosterSlot[]>().notNull(),
  playoffTeams: smallint("playoff_teams").notNull(),
  syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
});

export const owners = pgTable("owners", {
  rosterId: integer("roster_id").primaryKey(),
  userId: text("user_id").notNull(),
  displayName: text("display_name").notNull(),
  teamName: text("team_name"),
});

export const players = pgTable("players", {
  sleeperId: text("sleeper_id").primaryKey(),
  fullName: text("full_name"),
  position: text("position"),
  team: text("team"),
  age: smallint("age"),
  yearsExp: smallint("years_exp"),
  status: text("status"),
  injuryStatus: text("injury_status"),
  practiceParticipation: text("practice_participation"),
  depthChartOrder: smallint("depth_chart_order"),
  newsUpdated: timestamp("news_updated", { withTimezone: true }),
  gsisId: text("gsis_id"),
  espnId: text("espn_id"),
  sportradarId: text("sportradar_id"),
  yahooId: text("yahoo_id"),
  rotowireId: text("rotowire_id"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// One row per roster per day (architecture.md 4.7 retention: one per day, current
// + prior season). takenDate (not the timestamp) carries the uniqueness so a rerun
// on the same day upserts instead of duplicating.
export const rosterSnapshots = pgTable(
  "roster_snapshots",
  {
    id: serial("id").primaryKey(),
    rosterId: integer("roster_id").notNull(),
    takenAt: timestamp("taken_at", { withTimezone: true }).notNull().defaultNow(),
    takenDate: text("taken_date").notNull(), // YYYY-MM-DD, set by the sync job
    players: text("players").array().notNull(),
    starters: text("starters").array().notNull(),
    reserve: text("reserve").array(),
    taxi: text("taxi").array(),
    faabUsed: integer("faab_used"),
    wins: smallint("wins"),
    losses: smallint("losses"),
    fpts: real("fpts"),
  },
  (t) => [uniqueIndex("roster_snapshots_roster_date_idx").on(t.rosterId, t.takenDate)],
);

export const rosterPlayers = pgTable(
  "roster_players",
  {
    rosterId: integer("roster_id").notNull(),
    playerId: text("player_id").notNull(),
    acquiredVia: text("acquired_via"),
    acquiredAt: timestamp("acquired_at", { withTimezone: true }),
  },
  (t) => [primaryKey({ columns: [t.rosterId, t.playerId] })],
);

export const matchups = pgTable(
  "matchups",
  {
    season: smallint("season").notNull(),
    week: smallint("week").notNull(),
    rosterId: integer("roster_id").notNull(),
    matchupId: integer("matchup_id"),
    points: real("points"),
    starters: text("starters").array().notNull(),
    players: text("players").array().notNull(),
    playersPoints: jsonb("players_points").$type<PlayerPointsMap>(),
  },
  (t) => [primaryKey({ columns: [t.season, t.week, t.rosterId] })],
);

export const transactions = pgTable("transactions", {
  transactionId: text("transaction_id").primaryKey(),
  type: text("type").notNull(),
  season: smallint("season").notNull(),
  week: smallint("week"),
  status: text("status").notNull(),
  rosterIds: integer("roster_ids").array().notNull(),
  adds: jsonb("adds").$type<PlayerRosterMap>(),
  drops: jsonb("drops").$type<PlayerRosterMap>(),
  draftPicks: jsonb("draft_picks").$type<DraftPickTransfer[]>(),
  waiverBid: integer("waiver_bid"),
  waiverBudget: jsonb("waiver_budget").$type<WaiverBudgetTransfer[]>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
});

export const schedule = pgTable(
  "schedule",
  {
    season: smallint("season").notNull(),
    week: smallint("week").notNull(),
    team: text("team").notNull(),
    opponent: text("opponent"),
    kickoffUtc: timestamp("kickoff_utc", { withTimezone: true }),
    isHome: boolean("is_home"),
    isBye: boolean("is_bye").notNull().default(false),
  },
  (t) => [primaryKey({ columns: [t.season, t.week, t.team] })],
);

export const projections = pgTable(
  "projections",
  {
    playerId: text("player_id").notNull(),
    season: smallint("season").notNull(),
    week: smallint("week").notNull(),
    source: text("source").notNull(),
    stats: jsonb("stats").$type<StatLine>().notNull(),
    leaguePts: real("league_pts").notNull(),
    asOf: timestamp("as_of", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.playerId, t.season, t.week, t.source] })],
);

export const injuries = pgTable(
  "injuries",
  {
    id: serial("id").primaryKey(),
    playerId: text("player_id").notNull(),
    season: smallint("season").notNull(),
    week: smallint("week").notNull(),
    reportStatus: text("report_status"),
    practiceStatus: text("practice_status"),
    asOf: timestamp("as_of", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("injuries_player_week_asof_idx").on(t.playerId, t.season, t.week, t.asOf)],
);

// Retention: 7 days for Sleeper league endpoints (architecture.md 4.7). Pruned by
// a scheduled job, not by this schema; fetchedAt is what that job filters on.
export const rawSnapshots = pgTable("raw_snapshots", {
  id: serial("id").primaryKey(),
  source: text("source").notNull(),
  endpoint: text("endpoint").notNull(),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  body: jsonb("body").$type<RawSnapshotBody>().notNull(),
});

export const alertsLog = pgTable("alerts_log", {
  id: serial("id").primaryKey(),
  type: text("type").notNull(),
  payload: jsonb("payload").$type<AlertPayload>().notNull(),
  sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
});
