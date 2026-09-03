// On-demand read-back after Brian makes swaps in Sleeper (architecture.md 4.4:
// "in-app only"). Session-cookie authenticated like the rest of the UI (this
// route lives outside /api/jobs/*, so src/proxy.ts's normal auth check applies),
// not cron-secret gated. Fetches fresh starters live rather than going through
// the scheduled sync-rosters job, so a click right after making swaps in Sleeper
// doesn't have to wait for the next cron tick.
import { NextResponse } from "next/server";
import { loadRosterContext } from "@lib/rosterData";
import { computeOptimalLineup, computeSwapList } from "@lib/engine/lineup";
import { fetchRosters } from "@lib/sleeper";
import { LEAGUE_ID, MY_ROSTER_ID } from "@lib/config";

export async function POST() {
  const ctx = await loadRosterContext();
  const optimal = computeOptimalLineup(ctx.slots, ctx.roster);

  const rosters = await fetchRosters(LEAGUE_ID);
  const mine = rosters.find((r) => r.roster_id === MY_ROSTER_ID);
  if (!mine) {
    return NextResponse.json({ error: "roster not found" }, { status: 404 });
  }

  const currentStarterIds = new Set((mine.starters ?? []).filter((id) => id && id !== "0"));
  const { toStart, toBench } = computeSwapList(ctx.slots, optimal, currentStarterIds);

  return NextResponse.json({
    matched: toStart.length === 0 && toBench.length === 0,
    toStart: toStart.map((s) => ({ slot: s.slot, name: s.player.name })),
    toBench: toBench.map((p) => ({ name: p.name })),
  });
}
