import { NextResponse } from "next/server";
import { and, eq, notInArray, sql } from "drizzle-orm";
import { db } from "@db/client";
import { owners, rosterSnapshots, rosterPlayers } from "@db/schema";
import { isAuthorizedCronRequest } from "@lib/cronAuth";
import { storeRawSnapshot } from "@lib/rawSnapshot";
import { fetchRosters, fetchUsers } from "@lib/sleeper";
import { LEAGUE_ID } from "@lib/config";

export async function POST(request: Request) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const [rosters, users] = await Promise.all([fetchRosters(LEAGUE_ID), fetchUsers(LEAGUE_ID)]);
  const usersById = new Map(users.map((u) => [u.user_id, u]));
  const today = new Date().toISOString().slice(0, 10);

  for (const roster of rosters) {
    const user = usersById.get(roster.owner_id);
    await db
      .insert(owners)
      .values({
        rosterId: roster.roster_id,
        userId: roster.owner_id,
        displayName: user?.display_name ?? roster.owner_id,
        teamName: user?.metadata?.team_name ?? null,
      })
      .onConflictDoUpdate({
        target: owners.rosterId,
        set: {
          userId: sql`excluded.user_id`,
          displayName: sql`excluded.display_name`,
          teamName: sql`excluded.team_name`,
        },
      });

    const rosterPlayerIds = roster.players ?? [];

    await db
      .insert(rosterSnapshots)
      .values({
        rosterId: roster.roster_id,
        takenDate: today,
        players: rosterPlayerIds,
        starters: roster.starters ?? [],
        reserve: roster.reserve ?? [],
        taxi: roster.taxi ?? [],
        faabUsed: roster.settings.waiver_budget_used ?? null,
        wins: roster.settings.wins ?? null,
        losses: roster.settings.losses ?? null,
        fpts: roster.settings.fpts ?? null,
      })
      .onConflictDoUpdate({
        target: [rosterSnapshots.rosterId, rosterSnapshots.takenDate],
        set: {
          takenAt: sql`now()`,
          players: sql`excluded.players`,
          starters: sql`excluded.starters`,
          reserve: sql`excluded.reserve`,
          taxi: sql`excluded.taxi`,
          faabUsed: sql`excluded.faab_used`,
          wins: sql`excluded.wins`,
          losses: sql`excluded.losses`,
          fpts: sql`excluded.fpts`,
        },
      });

    // Keep roster_players in sync with current membership. Acquisition context
    // (acquired_via/acquired_at) is filled in properly once transaction history
    // accumulates (Phase 2); Phase 1 just needs an accurate "who's rostered" set
    // for the free-agent pool and the status-change alert.
    if (rosterPlayerIds.length > 0) {
      await db
        .delete(rosterPlayers)
        .where(
          and(
            eq(rosterPlayers.rosterId, roster.roster_id),
            notInArray(rosterPlayers.playerId, rosterPlayerIds),
          ),
        );
      await db
        .insert(rosterPlayers)
        .values(rosterPlayerIds.map((playerId) => ({ rosterId: roster.roster_id, playerId })))
        .onConflictDoNothing();
    } else {
      await db.delete(rosterPlayers).where(eq(rosterPlayers.rosterId, roster.roster_id));
    }
  }

  await storeRawSnapshot("sleeper", "rosters", { rosters, users });

  return NextResponse.json({ rosters: rosters.length });
}
