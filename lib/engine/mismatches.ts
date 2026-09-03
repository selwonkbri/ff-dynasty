// Pure, no I/O. Sleeper league settings are the source of truth for scoring,
// slots, and structure (CLAUDE.md non-negotiable): flag mismatches, never
// silently pick one. Phase 0 found the live scoring_settings carries a full
// kicker/team-defense block even though this league has no K/DEF slot (rules.md
// II: "no team defenses or kickers"); that's the one mismatch worth re-checking
// on every sync, since a future league-settings edit could reintroduce it for
// real. The Toilet Bowl team-count discrepancy (rules.md VIII) was a one-time
// Phase 0 finding already resolved and recorded in CLAUDE.md, not a live check.
export interface MismatchIssue {
  kind: string;
  detail: string;
}

const KICKER_OR_DST_KEY = /^(fgm|fgmiss|xpm|xpmiss|def_|st_|blk_kick|safe$|sack$|pts_allow)/;

export function detectScoringMismatches(
  scoringSettings: Record<string, number | undefined>,
  rosterPositions: string[],
): MismatchIssue[] {
  const hasKOrDefSlot = rosterPositions.includes("K") || rosterPositions.includes("DEF");
  const hasKickerOrDstKeys = Object.entries(scoringSettings).some(
    ([key, value]) => Boolean(value) && KICKER_OR_DST_KEY.test(key),
  );

  if (hasKickerOrDstKeys && !hasKOrDefSlot) {
    return [
      {
        kind: "inert_scoring_block",
        detail:
          "League scoring_settings includes kicker/team-defense values, but no K or DEF roster slot exists, so they can never be scored. Flagged per policy (docs/rules.md: no kickers, no team defense), not auto-hidden.",
      },
    ];
  }

  return [];
}
