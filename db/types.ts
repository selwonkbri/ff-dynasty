// Explicit shapes for every jsonb column in db/schema.ts. Sleeper's own JSON blobs
// (settings, scoring_settings) carry many more keys than this app reads, including
// the inert kicker/DST scoring block confirmed in Phase 0 (see CLAUDE.md), so those
// two types keep an index signature for the rest. Everything this app itself
// produces (alerts_log payloads) is a closed union instead, since we control the
// shape end to end.

/** Sleeper `league.scoring_settings`. Only offense keys this league can ever use
 * are named; kicker/DST keys exist in the live payload but no roster slot can
 * start one, so they're read through the index signature and never special-cased. */
export interface ScoringSettings {
  pass_yd?: number;
  pass_td?: number;
  pass_int?: number;
  pass_2pt?: number;
  rush_yd?: number;
  rush_td?: number;
  rush_2pt?: number;
  rec?: number;
  rec_yd?: number;
  rec_td?: number;
  rec_2pt?: number;
  bonus_rec_wr?: number;
  bonus_rec_te?: number;
  bonus_rec_rb?: number;
  fum_lost?: number;
  fum_rec_td?: number;
  [key: string]: number | undefined;
}

/** Sleeper `league.settings`. Named fields are the ones the calendar/compliance
 * modules read; the rest of Sleeper's settings blob passes through untyped. */
export interface LeagueSettings {
  playoff_teams?: number;
  playoff_week_start?: number;
  trade_deadline?: number;
  waiver_budget?: number;
  reserve_slots?: number;
  taxi_slots?: number;
  [key: string]: unknown;
}

export type RosterSlot = "QB" | "RB" | "WR" | "TE" | "FLEX" | "SUPER_FLEX" | "BN";

/** A raw Sleeper stat line (projections or actuals), keyed by Sleeper's stat
 * abbreviations. Same open-ended shape as ScoringSettings for the same reason:
 * Sleeper returns many stat keys (kicking, defense) this league never scores. */
export interface StatLine {
  pass_yd?: number;
  pass_td?: number;
  pass_int?: number;
  pass_2pt?: number;
  rush_yd?: number;
  rush_td?: number;
  rush_2pt?: number;
  rec?: number;
  rec_yd?: number;
  rec_td?: number;
  rec_2pt?: number;
  fum_lost?: number;
  fum_rec_td?: number;
  [key: string]: number | undefined;
}

/** Player points keyed by Sleeper player_id, from matchups[].players_points. */
export type PlayerPointsMap = Record<string, number>;

/** Sleeper transactions[].adds / .drops: player_id -> roster_id. */
export type PlayerRosterMap = Record<string, number>;

export interface DraftPickTransfer {
  season: string;
  round: number;
  roster_id: number;
  previous_owner_id: number;
  owner_id: number;
}

export interface WaiverBudgetTransfer {
  sender: number;
  receiver: number;
  amount: number;
}

/** raw_snapshots.body: the raw API response for a given source/endpoint pair.
 * Deliberately `unknown`, not a modeled type: this column's whole purpose is to
 * hold whatever a given external endpoint returned before normalizing, so its
 * shape is defined by `source`/`endpoint`, not by a schema this app owns. */
export type RawSnapshotBody = unknown;

export type AlertPayload =
  | {
      type: "compliance";
      issues: Array<{
        kind: "bye" | "out" | "inactive" | "roster_over_limit" | "locked_pending_cut";
        player_id?: string;
        detail: string;
      }>;
    }
  | {
      type: "status_change";
      player_id: string;
      player_name: string;
      previous_status: string | null;
      new_status: string;
    };
