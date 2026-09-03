import { NextResponse } from "next/server";
import { db } from "@db/client";
import { alertsLog } from "@db/schema";
import { isAuthorizedCronRequest } from "@lib/cronAuth";
import { loadRosterContext } from "@lib/rosterData";
import { checkCompliance } from "@lib/engine/compliance";
import { sendPushover } from "@lib/pushover";

// Sunday 11:00 AM ET final compliance check (architecture.md 4.4). Pushover
// only if a problem exists.
export async function POST(request: Request) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const ctx = await loadRosterContext();
  const currentStarters = ctx.slots
    .filter((slot) => slot !== "BN")
    .map((slot, i) => ({
      slot,
      player: ctx.roster.find((p) => p.playerId === ctx.currentStarterIdsBySlot[i]) ?? null,
    }));

  const issues = checkCompliance({ starters: currentStarters, rosterSize: ctx.rosterSize });

  if (issues.length > 0) {
    const message = issues.map((i) => i.detail).join("\n");
    await sendPushover(message, "Lineup compliance issue");
    await db.insert(alertsLog).values({
      type: "compliance",
      payload: { type: "compliance", issues },
    });
  }

  return NextResponse.json({ week: ctx.week, issues: issues.length });
}
