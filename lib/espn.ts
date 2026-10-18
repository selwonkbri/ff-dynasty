// ESPN's public NFL scoreboard, used only for kickoff times (Sleeper's schedule
// feed has dates but no times). Free, no key, browser-callable (CORS *),
// about 21 KB per week. Added 2026-10-18 with Brian's OK; see
// docs/architecture.md 4.1. Parsing lives in lib/engine/liveContext.ts
// (kickoffsFromEspnScoreboard) so it can be unit-tested.
export interface EspnScoreboard {
  events?: Array<{
    date: string; // ISO, e.g. "2026-10-18T17:00Z"
    competitions?: Array<{
      competitors?: Array<{ team?: { abbreviation?: string } }>;
    }>;
  }>;
}

export async function fetchEspnScoreboard(season: number, week: number): Promise<EspnScoreboard> {
  const url = `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?week=${week}&seasontype=2&dates=${season}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`ESPN request failed: ${url} -> ${res.status}`);
  }
  return res.json() as Promise<EspnScoreboard>;
}
