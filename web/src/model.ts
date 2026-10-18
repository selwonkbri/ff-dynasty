// Runs the engine over one load's inputs and returns everything the three tabs
// render. All the decisions live in lib/engine; this file only wires them up.
import type { RosterSlot } from "@db/types";
import { buildLiveContext, firstGameDate, type LiveContext, type LiveInputs, type LivePlayer } from "@lib/engine/liveContext";
import { computeLateSwapLineup, computeSwapList, type LineupResult } from "@lib/engine/lineup";
import { orderChanges, questionablePivots, type ChangeItem, type PivotNote } from "@lib/engine/lineupNotes";
import { checkCompliance, type ComplianceIssue } from "@lib/engine/compliance";
import {
  detectScoringMismatches,
  detectTradeDeadlineMismatch,
  RULES_TRADE_DEADLINE_WEEK,
  type MismatchIssue,
} from "@lib/engine/mismatches";
import { nextEvents, type CalendarEvent } from "@lib/engine/calendar";
import { rankByLineupGain, type LineupGain } from "@lib/engine/freeAgents";

export interface PageModel {
  ctx: LiveContext;
  byId: Map<string, LivePlayer>;
  lineup: LineupResult;
  changes: ChangeItem[];
  pivots: PivotNote[];
  compliance: ComplianceIssue[];
  mismatches: MismatchIssue[];
  events: CalendarEvent[];
  tradeDeadlineLabel: string | null;
  playoffsLabel: { week: number; date: string | null } | null;
  freeAgents: LineupGain<LivePlayer>[];
}

// Sleeper's starters array lists only the non-bench slots, in roster_positions
// order; the late-swap optimizer indexes by the full roster_positions array.
function startersBySlotIndex(slots: RosterSlot[], starters: string[]): (string | null)[] {
  let k = 0;
  return slots.map((slot) => {
    if (slot === "BN") return null;
    const id = starters[k++];
    return id && id !== "0" ? id : null;
  });
}

// Calendar entries that were scheduled jobs in the old stack. The Netlify page
// runs no jobs, so only real league deadlines are listed.
const OLD_STACK_JOB_EVENTS = new Set(["Weekly compliance check", "Weekly brief"]);

export function buildPageModel(inputs: LiveInputs, now: Date): PageModel {
  const ctx = buildLiveContext(inputs);
  const byId = new Map(ctx.roster.map((p) => [p.playerId, p]));
  const bySlotIndex = startersBySlotIndex(ctx.slots, ctx.currentStarterIdsBySlot);

  // With nothing locked this is exactly computeOptimalLineup; once games start
  // it keeps locked players where they are and only moves the rest.
  const lineup = computeLateSwapLineup(ctx.slots, ctx.roster, bySlotIndex, now);
  const currentIds = new Set(bySlotIndex.filter((id): id is string => id !== null));
  const changes = orderChanges(computeSwapList(ctx.slots, lineup, currentIds), byId);
  const pivots = questionablePivots(lineup, byId);

  const currentStarters = ctx.slots
    .map((slot, i) => ({ slot, id: bySlotIndex[i] }))
    .filter(({ slot }) => slot !== "BN")
    .map(({ slot, id }) => ({ slot, player: (id && byId.get(id)) || null }));
  const compliance = checkCompliance({ starters: currentStarters, rosterSize: ctx.activeRosterSize });

  const sleeperDeadline = inputs.league.settings.trade_deadline;
  const deadlineIssues = detectTradeDeadlineMismatch(sleeperDeadline);
  const mismatches = [...detectScoringMismatches(ctx.scoringSettings, ctx.slots), ...deadlineIssues];
  const lastDeadlineWeek = Math.max(RULES_TRADE_DEADLINE_WEEK, sleeperDeadline ?? 0);
  const tradeDeadlineLabel =
    ctx.week > lastDeadlineWeek
      ? null
      : (deadlineIssues[0]?.detail ?? `Trade deadline: Week ${RULES_TRADE_DEADLINE_WEEK}.`);

  const playoffWeek = inputs.league.settings.playoff_week_start ?? 15;
  const playoffsLabel = ctx.week < playoffWeek ? { week: playoffWeek, date: firstGameDate(inputs.schedule, playoffWeek) } : null;

  return {
    ctx,
    byId,
    lineup,
    changes,
    pivots,
    compliance,
    mismatches,
    events: nextEvents(now, 10).filter((e) => !OLD_STACK_JOB_EVENTS.has(e.name)).slice(0, 3),
    tradeDeadlineLabel,
    playoffsLabel,
    freeAgents: rankByLineupGain(ctx.slots, ctx.roster, ctx.freeAgents),
  };
}
