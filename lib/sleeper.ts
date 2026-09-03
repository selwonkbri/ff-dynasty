// Thin fetch wrappers for the Sleeper endpoints this app uses (architecture.md
// 4.1). Read-only: this app never writes to Sleeper. No auth needed.
import type { ScoringSettings, LeagueSettings, RosterSlot, StatLine } from "@db/types";

const V1 = "https://api.sleeper.app/v1";

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Sleeper request failed: ${url} -> ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export interface SleeperLeague {
  league_id: string;
  name: string;
  season: string;
  settings: LeagueSettings;
  scoring_settings: ScoringSettings;
  roster_positions: RosterSlot[];
}

export function fetchLeague(leagueId: string) {
  return getJson<SleeperLeague>(`${V1}/league/${leagueId}`);
}

export interface SleeperRoster {
  roster_id: number;
  owner_id: string;
  players: string[] | null;
  starters: string[] | null;
  reserve: string[] | null;
  taxi: string[] | null;
  settings: { wins?: number; losses?: number; fpts?: number; waiver_budget_used?: number };
}

export function fetchRosters(leagueId: string) {
  return getJson<SleeperRoster[]>(`${V1}/league/${leagueId}/rosters`);
}

export interface SleeperUser {
  user_id: string;
  display_name: string;
  metadata: { team_name?: string } | null;
}

export function fetchUsers(leagueId: string) {
  return getJson<SleeperUser[]>(`${V1}/league/${leagueId}/users`);
}

export interface SleeperMatchup {
  roster_id: number;
  matchup_id: number | null;
  points: number | null;
  starters: string[];
  players: string[];
  players_points: Record<string, number> | null;
}

export function fetchMatchups(leagueId: string, week: number) {
  return getJson<SleeperMatchup[]>(`${V1}/league/${leagueId}/matchups/${week}`);
}

export interface SleeperTransaction {
  transaction_id: string;
  type: string;
  status: string;
  leg: number;
  roster_ids: number[];
  adds: Record<string, number> | null;
  drops: Record<string, number> | null;
  draft_picks: Array<{
    season: string;
    round: number;
    roster_id: number;
    previous_owner_id: number;
    owner_id: number;
  }>;
  settings: { waiver_bid?: number } | null;
  waiver_budget: Array<{ sender: number; receiver: number; amount: number }>;
  created: number; // epoch ms
}

export function fetchTransactions(leagueId: string, week: number) {
  return getJson<SleeperTransaction[]>(`${V1}/league/${leagueId}/transactions/${week}`);
}

export interface SleeperPlayer {
  player_id: string;
  full_name?: string;
  position?: string;
  team?: string | null;
  age?: number | null;
  years_exp?: number | null;
  status?: string | null;
  injury_status?: string | null;
  practice_participation?: string | null;
  depth_chart_order?: number | null;
  news_updated?: number | null; // epoch ms
  gsis_id?: string | null;
  espn_id?: string | number | null;
  sportradar_id?: string | null;
  yahoo_id?: string | number | null;
  rotowire_id?: string | number | null;
}

// ~5MB, once daily max (CLAUDE.md non-negotiable). Callers must never persist the
// raw return value, only normalized rows (see /api/jobs/sync-players).
export function fetchPlayers() {
  return getJson<Record<string, SleeperPlayer>>(`${V1}/players/nfl`);
}

export interface SleeperState {
  week: number;
  season: string;
  season_type: string;
}

export function fetchState() {
  return getJson<SleeperState>(`${V1}/state/nfl`);
}

export interface SleeperProjection {
  player_id: string;
  stats: StatLine;
}

// Undocumented, confirmed working in Phase 0 (CLAUDE.md).
export function fetchProjections(season: number, week: number) {
  const url = `https://api.sleeper.app/projections/nfl/${season}/${week}?season_type=regular&position[]=QB&position[]=RB&position[]=WR&position[]=TE`;
  return getJson<SleeperProjection[]>(url);
}
