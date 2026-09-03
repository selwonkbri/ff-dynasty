// Pure, no I/O. Rules-derived event list (architecture.md 3.8), scoped to what
// the Phase 1 Dashboard needs: the next few upcoming deadlines. Season-boundary
// events (trade deadline, playoffs) need per-week kickoff times, which this
// module doesn't own, so they're only included when the caller supplies
// weekKickoffs (from the schedule table) rather than fetched here. Posture/FAAB
// fiscal-year mode is out of scope for Phase 1 (see the plan's context note).
import { nextWeeklyEtTime } from "@lib/et";

export interface CalendarEvent {
  name: string;
  at: Date;
}

const WEEKLY_EVENTS: Array<{ name: string; weekday: number; hour: number; minute: number }> = [
  { name: "Weekly compliance check", weekday: 0, hour: 11, minute: 0 }, // Sunday 11:00 ET
  { name: "FCFS waiver close", weekday: 0, hour: 13, minute: 0 }, // Sunday 13:00 ET
  { name: "Weekly brief", weekday: 2, hour: 6, minute: 0 }, // Tuesday 06:00 ET
  { name: "Waiver blind bid deadline", weekday: 3, hour: 20, minute: 0 }, // Wednesday 20:00 ET
];

export function nextEvents(
  now: Date,
  n: number,
  weekKickoffs?: Partial<Record<number, Date>>,
): CalendarEvent[] {
  const events: CalendarEvent[] = WEEKLY_EVENTS.map((e) => ({
    name: e.name,
    at: nextWeeklyEtTime(now, e.weekday, e.hour, e.minute),
  }));

  const tradeDeadline = weekKickoffs?.[12];
  if (tradeDeadline && tradeDeadline.getTime() >= now.getTime()) {
    events.push({ name: "Trade deadline (week 12 kickoff)", at: tradeDeadline });
  }
  const playoffsStart = weekKickoffs?.[15];
  if (playoffsStart && playoffsStart.getTime() >= now.getTime()) {
    events.push({ name: "Playoffs begin (week 15 kickoff)", at: playoffsStart });
  }

  return events.sort((a, b) => a.at.getTime() - b.at.getTime()).slice(0, n);
}
