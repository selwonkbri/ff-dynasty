// Phase 0 spike: hit every documented and undocumented Sleeper endpoint listed in
// docs/architecture.md section 4.1, save raw JSON to scratch/data/sleeper/, print a
// summary. Throwaway data, this script is the kept artifact.

import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const USERNAME = 'guyel';
const SEASON = '2026';
const V1 = 'https://api.sleeper.app/v1';
const DATA_DIR = path.join(import.meta.dirname, 'data', 'sleeper');

async function fetchJson(url) {
  const res = await fetch(url);
  const status = res.status;
  let body = null;
  const text = await res.text();
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status, body };
}

async function save(name, data) {
  const file = path.join(DATA_DIR, `${name}.json`);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(data, null, 2));
  return file;
}

async function hit(name, url) {
  const result = await fetchJson(url);
  const file = await save(name, result);
  const summary = Array.isArray(result.body)
    ? `array[${result.body.length}]`
    : result.body && typeof result.body === 'object'
      ? `object{${Object.keys(result.body).length} keys}`
      : String(result.body).slice(0, 80);
  console.log(`${name.padEnd(28)} status=${result.status}  ${summary}  -> ${file}`);
  return result.body;
}

async function main() {
  console.log(`--- Sleeper documented endpoints (${V1}) ---`);

  const user = await hit('user', `${V1}/user/${USERNAME}`);
  const userId = user?.user_id;
  if (!userId) throw new Error('No user_id returned for username ' + USERNAME);
  console.log(`user_id = ${userId}`);

  const leagues = await hit('user-leagues', `${V1}/user/${userId}/leagues/nfl/${SEASON}`);
  const league = Array.isArray(leagues)
    ? leagues.find((l) => /legacy league/i.test(l.name)) || leagues[0]
    : null;
  const leagueId = league?.league_id;
  if (!leagueId) throw new Error('No league found for user in season ' + SEASON);
  console.log(`league_id = ${leagueId} (name: ${league.name})`);

  await hit('league', `${V1}/league/${leagueId}`);
  const rosters = await hit('rosters', `${V1}/league/${leagueId}/rosters`);
  await hit('users', `${V1}/league/${leagueId}/users`);
  await hit('matchups-week1', `${V1}/league/${leagueId}/matchups/1`);
  await hit('transactions-week1', `${V1}/league/${leagueId}/transactions/1`);
  await hit('traded-picks', `${V1}/league/${leagueId}/traded_picks`);
  await hit('winners-bracket', `${V1}/league/${leagueId}/winners_bracket`);
  await hit('losers-bracket', `${V1}/league/${leagueId}/losers_bracket`);

  const drafts = await hit('drafts', `${V1}/league/${leagueId}/drafts`);
  if (Array.isArray(drafts)) {
    for (const d of drafts) {
      await hit(`draft-picks-${d.draft_id}`, `${V1}/draft/${d.draft_id}/picks`);
    }
  }

  await hit('state-nfl', `${V1}/state/nfl`);
  await hit('trending-add', `${V1}/players/nfl/trending/add`);
  await hit('trending-drop', `${V1}/players/nfl/trending/drop`);

  console.log('\nFetching full player map (~5 MB, scratch only, never committed)...');
  await hit('players-nfl', `${V1}/players/nfl`);

  console.log('\n--- Sleeper undocumented endpoints ---');
  const projUrl = `https://api.sleeper.app/projections/nfl/${SEASON}/1?season_type=regular&position[]=QB&position[]=RB&position[]=WR&position[]=TE`;
  const statsUrl = `https://api.sleeper.app/stats/nfl/${SEASON}/1?season_type=regular`;
  await hit('undocumented/projections-week1', projUrl);
  await hit('undocumented/stats-week1', statsUrl);

  // Identify my roster_id for convenience in later scripts
  if (Array.isArray(rosters)) {
    const mine = rosters.find((r) => r.owner_id === userId);
    console.log(`\nmy roster_id = ${mine ? mine.roster_id : 'NOT FOUND'}`);
  }

  console.log('\nDone. Raw JSON under scratch/data/sleeper/');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
