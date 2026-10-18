// Pure, no I/O. Task 6's "simple projection ranking," not the Phase 2
// replacement/VORP + clearing-price waivers module. Ranks a given candidate
// list by weekly projection; the caller is responsible for pre-filtering to
// unrostered QB/RB/WR/TE (a DB-level concern, kept out of this module).
import type { RosterSlot } from "@db/types";
import { computeOptimalLineup, type LineupPlayer } from "./lineup";

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

// Brian's v1 ranking for the Netlify page: how many projected points a free
// agent would add to this week's optimal lineup. Computed by re-running
// computeOptimalLineup with the player added, so it uses exactly the
// optimizer's slot rules, including chains (a QB taking SUPER_FLEX pushes a WR
// down to FLEX and drops the weakest FLEX). `replaces` is the starter who
// falls out of the lineup, or null when the player fills an empty slot or
// wouldn't start.
export interface LineupGain<T extends LineupPlayer> {
  player: T;
  gain: number;
  replaces: LineupPlayer | null;
}

export function rankByLineupGain<T extends LineupPlayer>(
  slots: RosterSlot[],
  roster: LineupPlayer[],
  candidates: T[],
): LineupGain<T>[] {
  const base = computeOptimalLineup(slots, roster);
  const baseStarters = base.starters.flatMap((s) => (s.player ? [s.player] : []));

  return candidates
    .map((player): LineupGain<T> => {
      if (player.projectedPoints <= 0) return { player, gain: 0, replaces: null };
      const withPlayer = computeOptimalLineup(slots, [...roster, player]);
      // Float noise from summing decimals: anything under a hundredth is zero.
      const rawGain = withPlayer.totalProjectedPoints - base.totalProjectedPoints;
      const gain = rawGain < 0.005 ? 0 : rawGain;
      const newIds = new Set(withPlayer.starters.flatMap((s) => (s.player ? [s.player.playerId] : [])));
      const replaces = gain > 0 ? (baseStarters.find((p) => !newIds.has(p.playerId)) ?? null) : null;
      return { player, gain, replaces };
    })
    .sort((a, b) => b.gain - a.gain || b.player.projectedPoints - a.player.projectedPoints);
}
