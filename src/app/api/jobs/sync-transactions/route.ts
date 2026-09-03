import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@db/client";
import { transactions } from "@db/schema";
import { isAuthorizedCronRequest } from "@lib/cronAuth";
import { storeRawSnapshot } from "@lib/rawSnapshot";
import { fetchTransactions, fetchState } from "@lib/sleeper";
import { LEAGUE_ID, SEASON } from "@lib/config";

export async function POST(request: Request) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const weekParam = url.searchParams.get("week");
  const week = weekParam ? Number(weekParam) : (await fetchState()).week;

  const data = await fetchTransactions(LEAGUE_ID, week);

  if (data.length > 0) {
    await db
      .insert(transactions)
      .values(
        data.map((t) => ({
          transactionId: t.transaction_id,
          type: t.type,
          season: SEASON,
          week,
          status: t.status,
          rosterIds: t.roster_ids,
          adds: t.adds,
          drops: t.drops,
          draftPicks: t.draft_picks,
          waiverBid: t.settings?.waiver_bid ?? null,
          waiverBudget: t.waiver_budget,
          createdAt: new Date(t.created),
        })),
      )
      .onConflictDoUpdate({
        target: transactions.transactionId,
        set: {
          status: sql`excluded.status`,
          adds: sql`excluded.adds`,
          drops: sql`excluded.drops`,
          draftPicks: sql`excluded.draft_picks`,
          waiverBid: sql`excluded.waiver_bid`,
          waiverBudget: sql`excluded.waiver_budget`,
        },
      });
  }

  await storeRawSnapshot("sleeper", `transactions/${week}`, data);

  return NextResponse.json({ week, transactions: data.length });
}
