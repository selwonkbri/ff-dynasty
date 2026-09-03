import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@db/client";
import { players, injuries, rosterPlayers, alertsLog } from "@db/schema";
import { isAuthorizedCronRequest } from "@lib/cronAuth";
import { storeRawSnapshot } from "@lib/rawSnapshot";
import { fetchPlayers, fetchState, type SleeperPlayer } from "@lib/sleeper";
import { sendPushover } from "@lib/pushover";
import { MY_ROSTER_ID } from "@lib/config";

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

type NormalizedPlayer = ReturnType<typeof normalize>;

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

export async function POST(request: Request) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const state = await fetchState();
  const season = Number(state.season);
  const week = state.week;

  const rawMap = await fetchPlayers(); // ~5MB, never persisted directly
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
  const injuryChanges: Array<{ playerId: string; previous: string | null; next: string }> = [];

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

  // Rostered-player-status-to-Out alert (architecture.md 4.4, task 7). Scoped to
  // my own roster: this is a single-team tool (architecture.md section 1).
  const myPlayerIds = new Set(
    (await db.select({ playerId: rosterPlayers.playerId }).from(rosterPlayers).where(
      sql`${rosterPlayers.rosterId} = ${MY_ROSTER_ID}`,
    )).map((r) => r.playerId),
  );
  const outChanges = injuryChanges.filter(
    (c) => myPlayerIds.has(c.playerId) && c.next === "Out" && c.previous !== "Out",
  );
  if (outChanges.length > 0) {
    for (const c of outChanges) {
      const name = normalized.find((p) => p.sleeperId === c.playerId)?.fullName ?? c.playerId;
      await sendPushover(`Ruled Out: ${name}`, "Status change");
      await db.insert(alertsLog).values({
        type: "status_change",
        payload: {
          type: "status_change",
          player_id: c.playerId,
          player_name: name,
          previous_status: c.previous,
          new_status: c.next,
        },
      });
    }
  }

  await storeRawSnapshot("sleeper", "players/nfl", {
    fetched_count: Object.keys(rawMap).length,
    relevant_count: normalized.length,
    changed_count: changed.length,
    injury_changes: injuryChanges.length,
    out_alerts: outChanges.length,
  });

  return NextResponse.json({
    relevant: normalized.length,
    changed: changed.length,
    injuryChanges: injuryChanges.length,
    outAlerts: outChanges.length,
  });
}
