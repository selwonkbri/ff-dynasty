// Display helpers. All times are shown in US Eastern, the league's clock.
const ET = "America/New_York";

export function fmtPoints(n: number): string {
  return n.toFixed(1);
}

export function fmtClock(d: Date): string {
  return d.toLocaleTimeString("en-US", { timeZone: ET, hour: "numeric", minute: "2-digit" });
}

export function fmtDateTime(d: Date): string {
  return d.toLocaleString("en-US", { timeZone: ET, weekday: "short", hour: "numeric", minute: "2-digit" });
}

// A Sleeper schedule date (YYYY-MM-DD). Noon UTC keeps it on the same calendar
// day in Eastern time.
export function fmtGameDate(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", {
    timeZone: ET,
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

export function fmtKickoff(p: { kickoff: Date | null; gameDate: string | null; isBye: boolean }): string {
  if (p.isBye) return "Bye";
  if (p.kickoff) return fmtDateTime(p.kickoff);
  if (p.gameDate) return fmtGameDate(p.gameDate);
  return "";
}
