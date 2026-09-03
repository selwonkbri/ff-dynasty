import { NextResponse } from "next/server";
import Papa from "papaparse";
import { sql } from "drizzle-orm";
import { db } from "@db/client";
import { schedule } from "@db/schema";
import { isAuthorizedCronRequest } from "@lib/cronAuth";
import { storeRawSnapshot } from "@lib/rawSnapshot";
import { SEASON } from "@lib/config";

// Schedules are not an nflverse-data release asset (Phase 0 finding, see
// docs/architecture.md 4.1): the real file lives in the separate nfldata repo.
const GAMES_CSV_URL = "https://github.com/nflverse/nfldata/raw/master/data/games.csv";

interface GamesCsvRow {
  season: string;
  game_type: string;
  week: string;
  gameday: string;
  gametime: string;
  away_team: string;
  home_team: string;
}

// gametime in games.csv is a wall-clock time in US Eastern, DST-dependent, so a
// fixed UTC offset would be wrong across the season. Resolve it per-date instead.
function etWallTimeToUtc(dateStr: string, timeStr: string): Date {
  const naive = new Date(`${dateStr}T${timeStr}:00Z`);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    timeZoneName: "shortOffset",
  }).formatToParts(naive);
  const offsetName = parts.find((p) => p.type === "timeZoneName")?.value ?? "GMT-5";
  const offsetHours = Number(offsetName.replace("GMT", "")) || -5;
  return new Date(naive.getTime() - offsetHours * 60 * 60 * 1000);
}

export async function POST(request: Request) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const res = await fetch(GAMES_CSV_URL);
  if (!res.ok) {
    return NextResponse.json({ error: `games.csv fetch failed: ${res.status}` }, { status: 502 });
  }
  const csvText = await res.text();

  const parsed = Papa.parse<GamesCsvRow>(csvText, { header: true, skipEmptyLines: true });
  const seasonGames = parsed.data.filter(
    (row) => Number(row.season) === SEASON && row.game_type === "REG",
  );

  type ScheduleRow = typeof schedule.$inferInsert;
  const rows: ScheduleRow[] = [];
  const teams = new Set<string>();
  const weeksByTeam = new Map<string, Set<number>>();

  for (const game of seasonGames) {
    const week = Number(game.week);
    const kickoff = game.gametime ? etWallTimeToUtc(game.gameday, game.gametime) : null;

    for (const [team, opponent, isHome] of [
      [game.home_team, game.away_team, true],
      [game.away_team, game.home_team, false],
    ] as const) {
      teams.add(team);
      rows.push({ season: SEASON, week, team, opponent, kickoffUtc: kickoff, isHome, isBye: false });
      if (!weeksByTeam.has(team)) weeksByTeam.set(team, new Set());
      weeksByTeam.get(team)!.add(week);
    }
  }

  const allWeeks = new Set(rows.map((r) => r.week));
  for (const team of teams) {
    const played = weeksByTeam.get(team) ?? new Set();
    for (const week of allWeeks) {
      if (!played.has(week)) {
        rows.push({ season: SEASON, week, team, opponent: null, kickoffUtc: null, isHome: null, isBye: true });
      }
    }
  }

  if (rows.length > 0) {
    await db
      .insert(schedule)
      .values(rows)
      .onConflictDoUpdate({
        target: [schedule.season, schedule.week, schedule.team],
        set: {
          opponent: sql`excluded.opponent`,
          kickoffUtc: sql`excluded.kickoff_utc`,
          isHome: sql`excluded.is_home`,
          isBye: sql`excluded.is_bye`,
        },
      });
  }

  await storeRawSnapshot("nflverse", "games.csv", {
    season: SEASON,
    game_rows: seasonGames.length,
    schedule_rows: rows.length,
  });

  return NextResponse.json({ games: seasonGames.length, scheduleRows: rows.length });
}
