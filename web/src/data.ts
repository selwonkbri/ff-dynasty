// Browser-side loading: Sleeper (read-only) plus ESPN for kickoff times, then
// the last good result saved in localStorage so a weak signal still shows
// something. No server, no database, no secrets.
import { LEAGUE_ID, MY_ROSTER_ID, SEASON } from "@lib/config";
import {
  fetchLeague,
  fetchMatchups,
  fetchProjections,
  fetchRosters,
  fetchSchedule,
  fetchState,
  fetchUsers,
  type SleeperProjection,
} from "@lib/sleeper";
import { fetchEspnScoreboard } from "@lib/espn";
import { kickoffsFromEspnScoreboard, type LiveInputs } from "@lib/engine/liveContext";

export interface LoadResult {
  inputs: LiveInputs;
  fetchedAt: Date;
  // Optional sources that failed; the page still works without them.
  warnings: string[];
}

// Required sources that failed, by name, so the page can say which.
export class LoadError extends Error {
  constructor(public failed: string[]) {
    super(`Couldn't load ${failed.join(", ")}.`);
  }
}

function settledValue<T>(result: PromiseSettledResult<T>): T | undefined {
  return result.status === "fulfilled" ? result.value : undefined;
}

export async function loadLive(): Promise<LoadResult> {
  // Week-independent calls start alongside state/nfl; the rest wait for the week.
  const statePromise = fetchState();
  const independent = Promise.allSettled([
    fetchLeague(LEAGUE_ID),
    fetchRosters(LEAGUE_ID),
    fetchUsers(LEAGUE_ID),
    fetchSchedule(SEASON),
  ]);

  let week: number;
  try {
    week = (await statePromise).week;
  } catch {
    await independent;
    throw new LoadError(["Sleeper current week"]);
  }

  const [weekly, [leagueR, rostersR, usersR, scheduleR]] = await Promise.all([
    Promise.allSettled([fetchMatchups(LEAGUE_ID, week), fetchProjections(SEASON, week), fetchEspnScoreboard(SEASON, week)]),
    independent,
  ]);
  const [matchupsR, projectionsR, espnR] = weekly;

  const league = settledValue(leagueR);
  const rosters = settledValue(rostersR);
  const users = settledValue(usersR);
  const schedule = settledValue(scheduleR);
  const projections = settledValue(projectionsR);

  const failed: string[] = [];
  if (!league) failed.push("Sleeper league settings");
  if (!rosters) failed.push("Sleeper rosters");
  if (!users) failed.push("Sleeper teams");
  if (!schedule) failed.push("Sleeper schedule");
  if (!projections) failed.push("Sleeper projections");
  if (!league || !rosters || !users || !schedule || !projections) throw new LoadError(failed);

  const warnings: string[] = [];
  const matchups = settledValue(matchupsR) ?? null;
  if (!matchups) warnings.push("Couldn't load Sleeper matchups, so live score and the opponent card are missing.");
  const espn = settledValue(espnR);
  const kickoffs = espn ? kickoffsFromEspnScoreboard(espn) : null;
  if (!kickoffs || Object.keys(kickoffs).length === 0) {
    warnings.push("Couldn't load kickoff times from ESPN, so games are ordered by day only.");
  }

  return {
    inputs: { week, myRosterId: MY_ROSTER_ID, league, rosters, users, matchups, projections, schedule, kickoffs },
    fetchedAt: new Date(),
    warnings,
  };
}

// localStorage: last good result only, a per-device convenience. Every access is
// wrapped because storage can be missing or full (private mode, quota).
const CACHE_KEY = "legacy-league:last-good:v1";

interface CachedResult {
  fetchedAt: string;
  warnings: string[];
  inputs: Omit<LiveInputs, "kickoffs"> & { kickoffs: Record<string, string> | null };
}

// The raw projections feed carries ~100 stat keys per player; only the ones
// the league scores, plus the player fields the page reads, are kept.
function trimProjection(p: SleeperProjection, scoredKeys: Set<string>): SleeperProjection {
  const stats: SleeperProjection["stats"] = {};
  for (const [key, value] of Object.entries(p.stats ?? {})) {
    if (scoredKeys.has(key) && value) stats[key] = value;
  }
  const { first_name, last_name, position, team, injury_status } = p.player ?? {};
  return { player_id: p.player_id, company: p.company, team: p.team, stats, player: { first_name, last_name, position, team, injury_status } };
}

export function saveCache(result: LoadResult): void {
  try {
    const scoredKeys = new Set(Object.keys(result.inputs.league.scoring_settings));
    const kickoffs = result.inputs.kickoffs
      ? Object.fromEntries(Object.entries(result.inputs.kickoffs).map(([team, d]) => [team, d.toISOString()]))
      : null;
    const cached: CachedResult = {
      fetchedAt: result.fetchedAt.toISOString(),
      warnings: result.warnings,
      inputs: {
        ...result.inputs,
        projections: result.inputs.projections.map((p) => trimProjection(p, scoredKeys)),
        kickoffs,
      },
    };
    localStorage.setItem(CACHE_KEY, JSON.stringify(cached));
  } catch {
    // Storage unavailable or full: the page still works, just without a fallback.
  }
}

export function readCache(): LoadResult | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const cached = JSON.parse(raw) as CachedResult;
    const kickoffs = cached.inputs.kickoffs
      ? Object.fromEntries(Object.entries(cached.inputs.kickoffs).map(([team, iso]) => [team, new Date(iso)]))
      : null;
    return { inputs: { ...cached.inputs, kickoffs }, fetchedAt: new Date(cached.fetchedAt), warnings: cached.warnings };
  } catch {
    return null;
  }
}
