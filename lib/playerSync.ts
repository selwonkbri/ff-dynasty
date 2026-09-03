// Shared core of the player-map diff, used by both the daily sync
// (/api/jobs/sync-players) and the Sunday game-window status poll
// (/api/jobs/game-window-poll). Not in lib/engine: this has I/O (DB writes,
// one Sleeper fetch).
import { sql } from "drizzle-orm";
import { db } from "@db/client";
import { players, injuries } from "@db/schema";
import { fetchPlayers, fetchState, type SleeperPlayer } from "@lib/sleeper";

// Fantasy-relevant only: this league has no K/DEF/IDP slots (CLAUDE.md Phase 0
// finding), and a player with no current NFL team can't be started, so neither
// is worth a row here. Keeps the ~11,000-entry Sleeper map down to a few hundred
// normalized rows, well inside the storage budget (architecture.md 4.7).
const RELEVANT_POSITIONS = new Set(["QB", "RB", "WR", "TE"]);

function toEpochDate(ms: number | null | undefined) {
  return ms ? new Date(ms) : null;
}

function normalize(p: SleeperPlayer) {
  return {
    sleeperId: p.player_id,
    fullName: p.full_name ?? null,
    position: p.position ?? null,
    team: p.team ?? null,
    age: p.age ?? null,
    yearsExp: p.years_exp ?? null,
    status: p.status ?? null,
    injuryStatus: p.injury_status ?? null,
    practiceParticipation: p.practice_participation ?? null,
    depthChartOrder: p.depth_chart_order ?? null,
    newsUpdated: toEpochDate(p.news_updated),
    gsisId: p.gsis_id ?? null,
    espnId: p.espn_id != null ? String(p.espn_id) : null,
    sportradarId: p.sportradar_id ?? null,
    yahooId: p.yahoo_id != null ? String(p.yahoo_id) : null,
    rotowireId: p.rotowire_id != null ? String(p.rotowire_id) : null,
  };
}

export type NormalizedPlayer = ReturnType<typeof normalize>;

function isSame(a: NormalizedPlayer, existing: NormalizedPlayer) {
  return (
    a.fullName === existing.fullName &&
    a.position === existing.position &&
    a.team === existing.team &&
    a.age === existing.age &&
    a.yearsExp === existing.yearsExp &&
    a.status === existing.status &&
    a.injuryStatus === existing.injuryStatus &&
    a.practiceParticipation === existing.practiceParticipation &&
    a.depthChartOrder === existing.depthChartOrder &&
    a.gsisId === existing.gsisId
  );
}

export interface InjuryChange {
  playerId: string;
  previous: string | null;
  next: string;
}

export interface PlayerSyncResult {
  fetchedCount: number;
  normalized: NormalizedPlayer[];
  changed: NormalizedPlayer[];
  injuryChanges: InjuryChange[];
}

// Fetches the full player map (~5MB, never persisted directly), diffs it
// against what's stored, and writes the changes: normalized players.* rows
// plus one injuries.* history row per status change. Callers handle their own
// alerting/raw-snapshot policy on top of this.
export async function syncPlayersCore(): Promise<PlayerSyncResult> {
  const state = await fetchState();
  const season = Number(state.season);
  const week = state.week;

  const rawMap = await fetchPlayers();
  const relevant = Object.values(rawMap).filter(
    (p) => p.position && RELEVANT_POSITIONS.has(p.position) && p.team,
  );
  const normalized = relevant.map(normalize);

  const existingRows = await db
    .select({
      sleeperId: players.sleeperId,
      fullName: players.fullName,
      position: players.position,
      team: players.team,
      age: players.age,
      yearsExp: players.yearsExp,
      status: players.status,
      injuryStatus: players.injuryStatus,
      practiceParticipation: players.practiceParticipation,
      depthChartOrder: players.depthChartOrder,
      gsisId: players.gsisId,
    })
    .from(players);
  const existingById = new Map(existingRows.map((r) => [r.sleeperId, r]));

  const changed: NormalizedPlayer[] = [];
  const injuryChanges: InjuryChange[] = [];

  for (const p of normalized) {
    const existing = existingById.get(p.sleeperId);
    if (!existing || !isSame(p, existing as NormalizedPlayer)) {
      changed.push(p);
    }
    const previousInjury = existing?.injuryStatus ?? null;
    if (p.injuryStatus && p.injuryStatus !== previousInjury) {
      injuryChanges.push({ playerId: p.sleeperId, previous: previousInjury, next: p.injuryStatus });
    }
  }

  if (changed.length > 0) {
    await db
      .insert(players)
      .values(changed)
      .onConflictDoUpdate({
        target: players.sleeperId,
        set: {
          fullName: sql`excluded.full_name`,
          position: sql`excluded.position`,
          team: sql`excluded.team`,
          age: sql`excluded.age`,
          yearsExp: sql`excluded.years_exp`,
          status: sql`excluded.status`,
          injuryStatus: sql`excluded.injury_status`,
          practiceParticipation: sql`excluded.practice_participation`,
          depthChartOrder: sql`excluded.depth_chart_order`,
          newsUpdated: sql`excluded.news_updated`,
          gsisId: sql`excluded.gsis_id`,
          espnId: sql`excluded.espn_id`,
          sportradarId: sql`excluded.sportradar_id`,
          yahooId: sql`excluded.yahoo_id`,
          rotowireId: sql`excluded.rotowire_id`,
          updatedAt: sql`now()`,
        },
      });
  }

  if (injuryChanges.length > 0) {
    await db.insert(injuries).values(
      injuryChanges.map((c) => ({
        playerId: c.playerId,
        season,
        week,
        reportStatus: c.next,
        practiceStatus: null,
      })),
    );
  }

  return { fetchedCount: Object.keys(rawMap).length, normalized, changed, injuryChanges };
}
