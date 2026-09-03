import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@db/client";
import { rosterPlayers, alertsLog } from "@db/schema";
import { isAuthorizedCronRequest } from "@lib/cronAuth";
import { storeRawSnapshot } from "@lib/rawSnapshot";
import { sendPushover } from "@lib/pushover";
import { MY_ROSTER_ID } from "@lib/config";
import { syncPlayersCore } from "@lib/playerSync";

export async function POST(request: Request) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { fetchedCount, normalized, changed, injuryChanges } = await syncPlayersCore();

  // Rostered-player-status-to-Out alert (architecture.md 4.4, task 7). Scoped to
  // my own roster: this is a single-team tool (architecture.md section 1).
  const myPlayerIds = new Set(
    (
      await db
        .select({ playerId: rosterPlayers.playerId })
        .from(rosterPlayers)
        .where(sql`${rosterPlayers.rosterId} = ${MY_ROSTER_ID}`)
    ).map((r) => r.playerId),
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
    fetched_count: fetchedCount,
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
