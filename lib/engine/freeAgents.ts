// Pure, no I/O. Task 6's "simple projection ranking," not the Phase 2
// replacement/VORP + clearing-price waivers module. Ranks a given candidate
// list by weekly projection; the caller is responsible for pre-filtering to
// unrostered QB/RB/WR/TE (a DB-level concern, kept out of this module).
export type FreeAgentPosition = "QB" | "RB" | "WR" | "TE";

export interface FreeAgentCandidate {
  playerId: string;
  name: string;
  position: FreeAgentPosition;
  weeklyProjectedPoints: number;
}

export interface RankedFreeAgent extends FreeAgentCandidate {
  // Placeholder: weekly x games remaining, since Sleeper only has the current
  // week's projections populated this far out (Phase 0 finding). Refined into
  // a real rest-of-season model in Phase 2 (values/replacement).
  restOfSeasonProjectedPoints: number;
}

export function rankFreeAgents(
  candidates: FreeAgentCandidate[],
  gamesRemainingInSeason: number,
): RankedFreeAgent[] {
  return candidates
    .map((c) => ({
      ...c,
      restOfSeasonProjectedPoints: c.weeklyProjectedPoints * gamesRemainingInSeason,
    }))
    .sort((a, b) => b.weeklyProjectedPoints - a.weeklyProjectedPoints);
}
