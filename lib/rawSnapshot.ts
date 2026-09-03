import { db } from "@db/client";
import { rawSnapshots } from "@db/schema";
import type { RawSnapshotBody } from "@db/types";

// Every sync stores a compact raw snapshot before normalizing (CLAUDE.md
// non-negotiable). "Compact" is the operative word for the players endpoint:
// sync-players passes a summary object here, never the raw 5MB body.
export async function storeRawSnapshot(source: string, endpoint: string, body: RawSnapshotBody) {
  await db.insert(rawSnapshots).values({ source, endpoint, body });
}
