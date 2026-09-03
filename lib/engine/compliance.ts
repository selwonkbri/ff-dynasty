// Pure, no I/O. Anti-tanking checks (rules.md XII / architecture.md 3.3): bye
// starter, Out starter, Inactive starter, roster over the 26-player limit, and
// the lineup-locked-pending-cut consequence of being over.
import type { RosterSlot } from "@db/types";
import { OUT_STATUSES, type LineupPlayer } from "./lineup";

export type ComplianceIssueKind =
  | "bye"
  | "out"
  | "inactive"
  | "roster_over_limit"
  | "locked_pending_cut";

export interface ComplianceIssue {
  kind: ComplianceIssueKind;
  playerId?: string;
  detail: string;
}

export const MAX_ROSTER_SIZE = 26;

export function checkCompliance(params: {
  starters: Array<{ slot: RosterSlot; player: LineupPlayer | null }>;
  rosterSize: number;
  maxRosterSize?: number;
}): ComplianceIssue[] {
  const issues: ComplianceIssue[] = [];
  const maxSize = params.maxRosterSize ?? MAX_ROSTER_SIZE;

  for (const { player } of params.starters) {
    if (!player) continue;
    if (player.isBye) {
      issues.push({
        kind: "bye",
        playerId: player.playerId,
        detail: `${player.name} is on a bye week and cannot start.`,
      });
    }
    if (player.injuryStatus && OUT_STATUSES.has(player.injuryStatus)) {
      issues.push({
        kind: player.injuryStatus === "Out" ? "out" : "inactive",
        playerId: player.playerId,
        detail: `${player.name} is ${player.injuryStatus} and must be removed from the lineup.`,
      });
    }
  }

  if (params.rosterSize > maxSize) {
    issues.push({
      kind: "roster_over_limit",
      detail: `Roster has ${params.rosterSize} players, over the ${maxSize}-player limit.`,
    });
    issues.push({
      kind: "locked_pending_cut",
      detail: "Lineup submission is locked until the roster is cut back to the limit.",
    });
  }

  return issues;
}
