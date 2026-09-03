import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@db/client";
import { matchups } from "@db/schema";
import { isAuthorizedCronRequest } from "@lib/cronAuth";
import { storeRawSnapshot } from "@lib/rawSnapshot";
import { fetchMatchups, fetchState } from "@lib/sleeper";
import { LEAGUE_ID, SEASON } from "@lib/config";

export async function POST(request: Request) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const weekParam = url.searchParams.get("week");
  const week = weekParam ? Number(weekParam) : (await fetchState()).week;

  const data = await fetchMatchups(LEAGUE_ID, week);

  if (data.length > 0) {
    await db
      .insert(matchups)
      .values(
        data.map((m) => ({
          season: SEASON,
          week,
          rosterId: m.roster_id,
          matchupId: m.matchup_id,
          points: m.points,
          starters: m.starters,
          players: m.players,
          playersPoints: m.players_points,
        })),
      )
      .onConflictDoUpdate({
        target: [matchups.season, matchups.week, matchups.rosterId],
        set: {
          matchupId: sql`excluded.matchup_id`,
          points: sql`excluded.points`,
          starters: sql`excluded.starters`,
          players: sql`excluded.players`,
          playersPoints: sql`excluded.players_points`,
        },
      });
  }

  await storeRawSnapshot("sleeper", `matchups/${week}`, data);

  return NextResponse.json({ week, rosters: data.length });
}
