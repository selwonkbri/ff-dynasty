// Pure, no I/O (CLAUDE.md non-negotiable). Reads Sleeper's live scoring_settings
// key names; nothing is hardcoded here except the offense stat keys this league
// actually uses (see StatLine/ScoringSettings in db/types.ts and the Phase 0
// finding in CLAUDE.md about the inert kicker/DST block in the live settings).
import type { StatLine, ScoringSettings } from "@db/types";

export type ScoringPosition = "QB" | "RB" | "WR" | "TE";

export function scorePlayer(
  stats: StatLine | null | undefined,
  position: ScoringPosition,
  scoring: ScoringSettings,
): number {
  if (!stats) return 0;

  const recBonusKey = `bonus_rec_${position.toLowerCase()}`;
  const recBonus = scoring[recBonusKey] ?? 0;
  const s = (key: string) => stats[key] ?? 0;

  return (
    s("pass_yd") * (scoring.pass_yd ?? 0) +
    s("pass_td") * (scoring.pass_td ?? 0) +
    s("pass_int") * (scoring.pass_int ?? 0) +
    s("pass_2pt") * (scoring.pass_2pt ?? 0) +
    s("rush_yd") * (scoring.rush_yd ?? 0) +
    s("rush_td") * (scoring.rush_td ?? 0) +
    s("rush_2pt") * (scoring.rush_2pt ?? 0) +
    s("rec") * ((scoring.rec ?? 0) + recBonus) +
    s("rec_yd") * (scoring.rec_yd ?? 0) +
    s("rec_td") * (scoring.rec_td ?? 0) +
    s("rec_2pt") * (scoring.rec_2pt ?? 0) +
    s("fum_lost") * (scoring.fum_lost ?? 0) +
    s("fum_rec_td") * (scoring.fum_rec_td ?? 0)
  );
}
