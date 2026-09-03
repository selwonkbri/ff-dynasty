// Pure US-Eastern wall-clock <-> UTC conversion, DST-aware via Intl (no fixed
// offset, since the season crosses the fall-back transition). Shared by the
// nflverse schedule sync and lib/engine/calendar.ts.
const ET_TZ = "America/New_York";
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function etWallTimeToUtc(dateStr: string, timeStr: string): Date {
  const naive = new Date(`${dateStr}T${timeStr}:00Z`);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: ET_TZ,
    timeZoneName: "shortOffset",
  }).formatToParts(naive);
  const offsetName = parts.find((p) => p.type === "timeZoneName")?.value ?? "GMT-5";
  const offsetHours = Number(offsetName.replace("GMT", "")) || -5;
  return new Date(naive.getTime() - offsetHours * 60 * 60 * 1000);
}

export function etDateStr(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: ET_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function etWeekday(date: Date): number {
  const short = new Intl.DateTimeFormat("en-US", { timeZone: ET_TZ, weekday: "short" }).format(
    date,
  );
  return WEEKDAYS.indexOf(short);
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

// Next occurrence, at or after `now`, of a given weekday/hour/minute in ET.
// targetWeekday: 0=Sun..6=Sat.
export function nextWeeklyEtTime(now: Date, targetWeekday: number, hour: number, minute: number): Date {
  const nowWeekday = etWeekday(now);
  let dayOffset = (targetWeekday - nowWeekday + 7) % 7;
  let candidate = etWallTimeToUtc(etDateStr(new Date(now.getTime() + dayOffset * 86400000)), `${pad(hour)}:${pad(minute)}`);
  if (candidate.getTime() < now.getTime()) {
    dayOffset += 7;
    candidate = etWallTimeToUtc(etDateStr(new Date(now.getTime() + dayOffset * 86400000)), `${pad(hour)}:${pad(minute)}`);
  }
  return candidate;
}
