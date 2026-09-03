import { NextResponse } from "next/server";
import { sql, inArray } from "drizzle-orm";
import { db } from "@db/client";
import { projections, players, league as leagueTable } from "@db/schema";
import { isAuthorizedCronRequest } from "@lib/cronAuth";
import { storeRawSnapshot } from "@lib/rawSnapshot";
import { fetchProjections, fetchState } from "@lib/sleeper";
import { SEASON } from "@lib/config";
import { scorePlayer, type ScoringPosition } from "@lib/engine/scoring";

const SCORING_POSITIONS = new Set<ScoringPosition>(["QB", "RB", "WR", "TE"]);

export async function POST(request: Request) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const weekParam = url.searchParams.get("week");
  const week = weekParam ? Number(weekParam) : (await fetchState()).week;

  const [leagueRow] = await db.select().from(leagueTable).limit(1);
  if (!leagueRow) {
    return NextResponse.json({ error: "league not synced yet" }, { status: 409 });
  }

  const data = await fetchProjections(SEASON, week);
  const playerIds = data.map((p) => p.player_id);
  const positionRows =
    playerIds.length > 0
      ? await db
          .select({ sleeperId: players.sleeperId, position: players.position })
          .from(players)
          .where(inArray(players.sleeperId, playerIds))
      : [];
  const positionById = new Map(positionRows.map((r) => [r.sleeperId, r.position]));

  const rows = data
    .map((p) => {
      const position = positionById.get(p.player_id);
      if (!position || !SCORING_POSITIONS.has(position as ScoringPosition)) return null;
      return {
        playerId: p.player_id,
        season: SEASON,
        week,
        source: "sleeper",
        stats: p.stats,
        leaguePts: scorePlayer(p.stats, position as ScoringPosition, leagueRow.scoringSettings),
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  if (rows.length > 0) {
    await db
      .insert(projections)
      .values(rows)
      .onConflictDoUpdate({
        target: [projections.playerId, projections.season, projections.week, projections.source],
        set: {
          stats: sql`excluded.stats`,
          leaguePts: sql`excluded.league_pts`,
          asOf: sql`now()`,
        },
      });
  }

  await storeRawSnapshot("sleeper", `projections/${SEASON}/${week}`, {
    fetched_count: data.length,
    stored_count: rows.length,
  });

  return NextResponse.json({ week, fetched: data.length, stored: rows.length });
}
