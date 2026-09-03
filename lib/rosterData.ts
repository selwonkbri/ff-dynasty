// Server-only data loader (has I/O: DB queries + one live Sleeper call for the
// current week), shared by the Dashboard and Lineup pages. Not in lib/engine:
// that directory is pure-only per CLAUDE.md's non-negotiable.
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@db/client";
import {
  league as leagueTable,
  players as playersTable,
  rosterSnapshots,
  schedule as scheduleTable,
  projections as projectionsTable,
} from "@db/schema";
import { fetchState } from "@lib/sleeper";
import { SEASON, MY_ROSTER_ID } from "@lib/config";
import type { LineupPlayer } from "@lib/engine/lineup";
import type { RosterSlot, ScoringSettings } from "@db/types";

export interface RosterContext {
  week: number;
  slots: RosterSlot[];
  scoringSettings: ScoringSettings;
  roster: LineupPlayer[];
  // Sleeper's raw starters array: one entry per non-BN roster_positions slot, in
  // the same order, "0" marking an empty slot. Kept unfiltered/positional so
  // callers can index it against `slots` directly; convert to a Set for
  // order-independent membership checks (e.g. computeSwapList).
  currentStarterIdsBySlot: string[];
  rosterSize: number;
}

export async function loadRosterContext(): Promise<RosterContext> {
  const state = await fetchState();
  const week = state.week;

  const [leagueRow] = await db.select().from(leagueTable).limit(1);
  if (!leagueRow) {
    throw new Error("League not synced yet. Run POST /api/jobs/sync-league first.");
  }

  const [snapshot] = await db
    .select()
    .from(rosterSnapshots)
    .where(eq(rosterSnapshots.rosterId, MY_ROSTER_ID))
    .orderBy(desc(rosterSnapshots.takenDate))
    .limit(1);
  if (!snapshot) {
    throw new Error("Roster not synced yet. Run POST /api/jobs/sync-rosters first.");
  }

  const playerIds = snapshot.players;
  const [playerRows, projRows] = await Promise.all([
    playerIds.length
      ? db.select().from(playersTable).where(inArray(playersTable.sleeperId, playerIds))
      : Promise.resolve([]),
    playerIds.length
      ? db
          .select()
          .from(projectionsTable)
          .where(
            and(
              inArray(projectionsTable.playerId, playerIds),
              eq(projectionsTable.season, SEASON),
              eq(projectionsTable.week, week),
            ),
          )
      : Promise.resolve([]),
  ]);
  const projByPlayer = new Map(projRows.map((r) => [r.playerId, r.leaguePts]));
  const playerById = new Map(playerRows.map((r) => [r.sleeperId, r]));

  const teams = [...new Set(playerRows.map((r) => r.team).filter((t): t is string => Boolean(t)))];
  const scheduleRows = teams.length
    ? await db
        .select()
        .from(scheduleTable)
        .where(
          and(eq(scheduleTable.season, SEASON), eq(scheduleTable.week, week), inArray(scheduleTable.team, teams)),
        )
    : [];
  const scheduleByTeam = new Map(scheduleRows.map((r) => [r.team, r]));

  const roster: LineupPlayer[] = playerIds
    .map((pid): LineupPlayer | null => {
      const meta = playerById.get(pid);
      if (!meta || !meta.position) return null; // not a QB/RB/WR/TE we track (see sync-players)
      const sched = meta.team ? scheduleByTeam.get(meta.team) : undefined;
      return {
        playerId: pid,
        name: meta.fullName ?? pid,
        position: meta.position as LineupPlayer["position"],
        projectedPoints: projByPlayer.get(pid) ?? 0,
        isBye: sched?.isBye ?? false,
        injuryStatus: meta.injuryStatus ?? null,
        kickoff: sched?.kickoffUtc ?? null,
      };
    })
    .filter((p): p is LineupPlayer => p !== null);

  return {
    week,
    slots: leagueRow.rosterPositions,
    scoringSettings: leagueRow.scoringSettings,
    roster,
    currentStarterIdsBySlot: snapshot.starters ?? [],
    rosterSize: snapshot.players.length,
  };
}
