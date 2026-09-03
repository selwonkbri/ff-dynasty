import { NextResponse } from "next/server";
import { db } from "@db/client";
import { alertsLog } from "@db/schema";
import { isAuthorizedCronRequest } from "@lib/cronAuth";
import { sendPushover } from "@lib/pushover";
import { syncPlayersCore } from "@lib/playerSync";
import { loadRosterContext } from "@lib/rosterData";
import { computeLateSwapLineup } from "@lib/engine/lineup";

// Sunday 11 AM-8 PM ET, every 30 minutes (architecture.md 4.4). Unlike the
// daily sync-players job (any rostered player ruled Out), this one only cares
// about players who are *currently starting*, since the point is catching a
// starter ruled Out shortly before kickoff, when the anti-tanking rule
// requires benching them and the late-swap logic needs to name the pivot.
// CLAUDE.md's player-map-once-daily rule has an explicit Sunday exception for
// this job.
export async function POST(request: Request) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { injuryChanges } = await syncPlayersCore();
  const ctx = await loadRosterContext();
  const currentStarterIds = new Set(ctx.currentStarterIdsBySlot.filter((id) => id && id !== "0"));

  const outStarterChanges = injuryChanges.filter(
    (c) => c.next === "Out" && c.previous !== "Out" && currentStarterIds.has(c.playerId),
  );

  if (outStarterChanges.length === 0) {
    return NextResponse.json({ outStarterChanges: 0 });
  }

  const now = new Date();
  const lateSwap = computeLateSwapLineup(ctx.slots, ctx.roster, ctx.currentStarterIdsBySlot, now);
  const startingSlots = ctx.slots.filter((s) => s !== "BN");

  const pivotByPlayerId = new Map<string, { slot: string; player_name: string } | null>();
  startingSlots.forEach((slot, i) => {
    const currentId = ctx.currentStarterIdsBySlot[i];
    if (!currentId || !outStarterChanges.some((c) => c.playerId === currentId)) return;
    const replacement = lateSwap.starters[i]?.player;
    pivotByPlayerId.set(
      currentId,
      replacement && replacement.playerId !== currentId ? { slot, player_name: replacement.name } : null,
    );
  });

  for (const c of outStarterChanges) {
    const player = ctx.roster.find((p) => p.playerId === c.playerId);
    const name = player?.name ?? c.playerId;
    const pivot = pivotByPlayerId.get(c.playerId) ?? null;
    const message = pivot
      ? `Ruled Out (starting): ${name}. Pivot: start ${pivot.player_name} at ${pivot.slot}.`
      : `Ruled Out (starting): ${name}. No eligible bench replacement found.`;
    await sendPushover(message, "Starter ruled Out");
    await db.insert(alertsLog).values({
      type: "status_change",
      payload: {
        type: "status_change",
        player_id: c.playerId,
        player_name: name,
        previous_status: c.previous,
        new_status: c.next,
        recommended_pivot: pivot,
      },
    });
  }

  return NextResponse.json({ outStarterChanges: outStarterChanges.length });
}
