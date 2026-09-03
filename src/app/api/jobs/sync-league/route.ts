import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@db/client";
import { league } from "@db/schema";
import { isAuthorizedCronRequest } from "@lib/cronAuth";
import { storeRawSnapshot } from "@lib/rawSnapshot";
import { fetchLeague } from "@lib/sleeper";
import { LEAGUE_ID } from "@lib/config";

export async function POST(request: Request) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const data = await fetchLeague(LEAGUE_ID);

  await db
    .insert(league)
    .values({
      leagueId: data.league_id,
      season: Number(data.season),
      settings: data.settings,
      scoringSettings: data.scoring_settings,
      rosterPositions: data.roster_positions,
      playoffTeams: data.settings.playoff_teams ?? 0,
    })
    .onConflictDoUpdate({
      target: league.leagueId,
      set: {
        season: sql`excluded.season`,
        settings: sql`excluded.settings`,
        scoringSettings: sql`excluded.scoring_settings`,
        rosterPositions: sql`excluded.roster_positions`,
        playoffTeams: sql`excluded.playoff_teams`,
        syncedAt: sql`now()`,
      },
    });

  await storeRawSnapshot("sleeper", "league", data);

  return NextResponse.json({ leagueId: data.league_id, playoffTeams: data.settings.playoff_teams });
}
