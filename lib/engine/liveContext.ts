// Pure, no I/O. Turns raw Sleeper responses (plus ESPN's scoreboard for kickoff
// times) into what the Netlify page feeds the engine. The fetching happens in
// the browser through lib/sleeper.ts and lib/espn.ts; nothing here touches the
// network, so every rule below is unit-tested in liveContext.test.ts.
import type { RosterSlot, ScoringSettings } from "@db/types";
import type {
  SleeperGame,
  SleeperLeague,
  SleeperMatchup,
  SleeperProjection,
  SleeperRoster,
  SleeperUser,
} from "@lib/sleeper";
import type { EspnScoreboard } from "@lib/espn";
import { scorePlayer, type ScoringPosition } from "./scoring";
import type { LineupPlayer } from "./lineup";

const SCORING_POSITIONS = new Set<string>(["QB", "RB", "WR", "TE"]);

// The projections feed was rotowire-only on 2026-10-18 (3,117 entries, one per
// player). If Sleeper ever adds a second company, keep this one so numbers
// don't silently change source.
export const PREFERRED_PROJECTION_SOURCE = "rotowire";

// ESPN and Sleeper use the same team codes except Washington.
const ESPN_TO_SLEEPER_TEAM: Record<string, string> = { WSH: "WAS" };

export interface LivePlayer extends LineupPlayer {
  team: string | null;
  // YYYY-MM-DD from Sleeper's schedule; null on a bye or with no NFL team.
  gameDate: string | null;
  // From Sleeper's live game status (anything but pre_game), not the clock.
  locked: boolean;
}

export interface LiveInputs {
  week: number;
  myRosterId: number;
  league: SleeperLeague;
  rosters: SleeperRoster[];
  users: SleeperUser[];
  matchups: SleeperMatchup[] | null;
  projections: SleeperProjection[];
  schedule: SleeperGame[];
  // Sleeper team code -> kickoff, from kickoffsFromEspnScoreboard. Null when
  // ESPN couldn't be reached.
  kickoffs: Record<string, Date> | null;
}

export interface MatchupStarter {
  slot: RosterSlot;
  playerId: string | null;
  name: string;
  position: string | null;
  projected: number;
  live: number | null;
}

export interface MatchupSide {
  rosterId: number;
  teamName: string;
  starters: MatchupStarter[];
  projectedTotal: number;
  livePoints: number | null;
}

export interface ByeWeek {
  week: number;
  starters: Array<{ playerId: string; name: string; team: string }>;
}

export interface LiveContext {
  week: number;
  slots: RosterSlot[];
  scoringSettings: ScoringSettings;
  // Active roster only: IR (reserve) and taxi players can't start and don't
  // count toward the 26 (Sleeper has 7 IR slots, confirmed 2026-10-18).
  roster: LivePlayer[];
  currentStarterIdsBySlot: string[];
  activeRosterSize: number;
  irCount: number;
  // Active roster players with no entry in the projections feed, so they're
  // left out of the lineup rather than guessed at.
  missingProjectionIds: string[];
  freeAgents: LivePlayer[];
  matchup: { mine: MatchupSide; opponent: MatchupSide } | null;
  faab: { budget: number; used: number; remaining: number } | null;
  byePlan: ByeWeek[];
  projectionsPosted: boolean;
  kickoffSource: "espn" | "date-only";
}

export function kickoffsFromEspnScoreboard(scoreboard: EspnScoreboard): Record<string, Date> {
  const kickoffs: Record<string, Date> = {};
  for (const event of scoreboard.events ?? []) {
    const kickoff = new Date(event.date);
    if (Number.isNaN(kickoff.getTime())) continue;
    for (const competitor of event.competitions?.[0]?.competitors ?? []) {
      const abbr = competitor.team?.abbreviation;
      if (!abbr) continue;
      kickoffs[ESPN_TO_SLEEPER_TEAM[abbr] ?? abbr] = kickoff;
    }
  }
  return kickoffs;
}

export function dedupeProjections(projections: SleeperProjection[]): Map<string, SleeperProjection> {
  const byId = new Map<string, SleeperProjection>();
  for (const p of projections) {
    const existing = byId.get(p.player_id);
    if (!existing || (existing.company !== PREFERRED_PROJECTION_SOURCE && p.company === PREFERRED_PROJECTION_SOURCE)) {
      byId.set(p.player_id, p);
    }
  }
  return byId;
}

export function playerName(projection: SleeperProjection | undefined, playerId: string): string {
  const name = `${projection?.player?.first_name ?? ""} ${projection?.player?.last_name ?? ""}`.trim();
  return name || `Player ${playerId}`;
}

function teamOf(projection: SleeperProjection | undefined): string | null {
  return projection?.player?.team ?? projection?.team ?? null;
}

function gamesByTeam(schedule: SleeperGame[], week: number): Map<string, SleeperGame> {
  const byTeam = new Map<string, SleeperGame>();
  for (const game of schedule) {
    if (game.week !== week) continue;
    byTeam.set(game.home, game);
    byTeam.set(game.away, game);
  }
  return byTeam;
}

function buildPlayer(
  playerId: string,
  projection: SleeperProjection | undefined,
  weekGames: Map<string, SleeperGame>,
  kickoffs: Record<string, Date> | null,
  scoring: ScoringSettings,
): LivePlayer | null {
  const position = projection?.player?.position;
  if (!projection || !position || !SCORING_POSITIONS.has(position)) return null;

  const team = teamOf(projection);
  const game = team ? weekGames.get(team) : undefined;
  return {
    playerId,
    name: playerName(projection, playerId),
    position: position as ScoringPosition,
    projectedPoints: scorePlayer(projection.stats, position as ScoringPosition, scoring),
    // A team with no game in a week that has games is on bye. A player with no
    // NFL team isn't "on bye", he just projects to nothing.
    isBye: team !== null && weekGames.size > 0 && !game,
    injuryStatus: projection.player?.injury_status ?? null,
    kickoff: team && kickoffs ? (kickoffs[team] ?? null) : null,
    team,
    gameDate: game?.date ?? null,
    locked: game ? game.status !== "pre_game" : false,
  };
}

function teamNameFor(rosterId: number, rosters: SleeperRoster[], users: SleeperUser[]): string {
  const ownerId = rosters.find((r) => r.roster_id === rosterId)?.owner_id;
  const user = users.find((u) => u.user_id === ownerId);
  return user?.metadata?.team_name || user?.display_name || `Team ${rosterId}`;
}

function matchupSide(
  m: SleeperMatchup,
  inputs: LiveInputs,
  projections: Map<string, SleeperProjection>,
  startingSlots: RosterSlot[],
): MatchupSide {
  const scoring = inputs.league.scoring_settings;
  const starters = startingSlots.map((slot, i): MatchupStarter => {
    const id = m.starters?.[i];
    if (!id || id === "0") {
      return { slot, playerId: null, name: "Empty", position: null, projected: 0, live: null };
    }
    const projection = projections.get(id);
    const position = projection?.player?.position ?? null;
    const projected =
      projection && position && SCORING_POSITIONS.has(position)
        ? scorePlayer(projection.stats, position as ScoringPosition, scoring)
        : 0;
    return {
      slot,
      playerId: id,
      name: playerName(projection, id),
      position,
      projected,
      live: m.starters_points?.[i] ?? m.players_points?.[id] ?? null,
    };
  });
  return {
    rosterId: m.roster_id,
    teamName: teamNameFor(m.roster_id, inputs.rosters, inputs.users),
    starters,
    projectedTotal: starters.reduce((sum, s) => sum + s.projected, 0),
    livePoints: m.points ?? null,
  };
}

export function firstGameDate(schedule: SleeperGame[], week: number): string | null {
  const dates = schedule.filter((g) => g.week === week).map((g) => g.date).sort();
  return dates[0] ?? null;
}

export function buildLiveContext(inputs: LiveInputs): LiveContext {
  const { week, league, rosters, myRosterId } = inputs;
  const scoring = league.scoring_settings;
  const slots = league.roster_positions;
  const startingSlots = slots.filter((s) => s !== "BN");
  const projections = dedupeProjections(inputs.projections);
  const weekGames = gamesByTeam(inputs.schedule, week);

  const mine = rosters.find((r) => r.roster_id === myRosterId);
  if (!mine) {
    throw new Error(`Roster ${myRosterId} not found in this league.`);
  }
  const reserve = new Set(mine.reserve ?? []);
  const taxi = new Set(mine.taxi ?? []);
  const activeIds = (mine.players ?? []).filter((id) => !reserve.has(id) && !taxi.has(id));

  const roster: LivePlayer[] = [];
  const missingProjectionIds: string[] = [];
  for (const id of activeIds) {
    const player = buildPlayer(id, projections.get(id), weekGames, inputs.kickoffs, scoring);
    if (player) roster.push(player);
    else if (!projections.has(id)) missingProjectionIds.push(id);
  }

  const rostered = new Set(rosters.flatMap((r) => [...(r.players ?? []), ...(r.reserve ?? []), ...(r.taxi ?? [])]));
  const freeAgents: LivePlayer[] = [];
  for (const [id, projection] of projections) {
    if (rostered.has(id)) continue;
    const player = buildPlayer(id, projection, weekGames, inputs.kickoffs, scoring);
    if (player) freeAgents.push(player);
  }

  let matchup: LiveContext["matchup"] = null;
  const myMatchup = inputs.matchups?.find((m) => m.roster_id === myRosterId);
  if (myMatchup && myMatchup.matchup_id !== null) {
    const oppMatchup = inputs.matchups?.find(
      (m) => m.matchup_id === myMatchup.matchup_id && m.roster_id !== myRosterId,
    );
    if (oppMatchup) {
      matchup = {
        mine: matchupSide(myMatchup, inputs, projections, startingSlots),
        opponent: matchupSide(oppMatchup, inputs, projections, startingSlots),
      };
    }
  }

  const budget = league.settings.waiver_budget;
  const used = mine.settings?.waiver_budget_used;
  const faab =
    typeof budget === "number" && typeof used === "number" ? { budget, used, remaining: budget - used } : null;

  const currentStarterIdsBySlot = mine.starters ?? [];
  const byePlan: ByeWeek[] = [];
  for (let w = week + 1; w <= week + 3; w++) {
    const games = gamesByTeam(inputs.schedule, w);
    if (games.size === 0) continue; // past the end of the schedule
    const starters = currentStarterIdsBySlot
      .filter((id) => id && id !== "0")
      .map((id) => ({ playerId: id, name: playerName(projections.get(id), id), team: teamOf(projections.get(id)) }))
      .filter((s): s is ByeWeek["starters"][number] => s.team !== null && !games.has(s.team));
    byePlan.push({ week: w, starters });
  }

  return {
    week,
    slots,
    scoringSettings: scoring,
    roster,
    currentStarterIdsBySlot,
    activeRosterSize: activeIds.length,
    irCount: reserve.size,
    missingProjectionIds,
    freeAgents,
    matchup,
    faab,
    byePlan,
    projectionsPosted: inputs.projections.length > 0,
    kickoffSource: inputs.kickoffs && Object.keys(inputs.kickoffs).length > 0 ? "espn" : "date-only",
  };
}
