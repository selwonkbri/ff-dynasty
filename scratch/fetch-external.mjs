// Phase 0 spike: test the free external sources named in docs/architecture.md
// section 4.1 (FantasyCalc, DynastyProcess, nflverse). Save raw bodies, print
// enough of the shape to judge whether/how each joins to Sleeper player IDs.

import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const DATA_DIR = path.join(import.meta.dirname, 'data', 'external');

async function fetchText(url) {
  const res = await fetch(url);
  const text = await res.text();
  return { status: res.status, text };
}

async function save(name, text) {
  const file = path.join(DATA_DIR, name);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, text);
  return file;
}

async function hit(name, url, { asJson = false } = {}) {
  const { status, text } = await fetchText(url);
  const file = await save(name, text);
  let note = `len=${text.length}`;
  if (asJson) {
    try {
      const body = JSON.parse(text);
      note = Array.isArray(body) ? `array[${body.length}]` : `object{${Object.keys(body).length} keys}`;
    } catch {
      note = 'NOT VALID JSON: ' + text.slice(0, 200);
    }
  }
  console.log(`${name.padEnd(32)} status=${status}  ${note}  -> ${file}`);
  return { status, text };
}

async function main() {
  console.log('--- FantasyCalc ---');
  await hit(
    'fantasycalc-current.json',
    'https://api.fantasycalc.com/values/current?isDynasty=true&numQbs=2&numTeams=12&ppr=1',
    { asJson: true },
  );

  console.log('\n--- DynastyProcess (github.com/dynastyprocess/data) ---');
  await hit(
    'dynastyprocess-values-players.csv',
    'https://raw.githubusercontent.com/dynastyprocess/data/master/files/values-players.csv',
  );
  await hit(
    'dynastyprocess-values-picks.csv',
    'https://raw.githubusercontent.com/dynastyprocess/data/master/files/values-picks.csv',
  );
  // values-players.csv has no sleeper_id column; this crosswalk file does.
  await hit(
    'dynastyprocess-db-playerids.csv',
    'https://raw.githubusercontent.com/dynastyprocess/data/master/files/db_playerids.csv',
  );

  console.log('\n--- nflverse (github.com/nflverse releases) ---');
  await hit(
    'nflverse-players.csv',
    'https://github.com/nflverse/nflverse-data/releases/download/players/players.csv',
  );
  // Schedules live in the separate nfldata repo, not an nflverse-data release asset.
  await hit(
    'nflverse-schedules.csv',
    'https://github.com/nflverse/nfldata/raw/master/data/games.csv',
  );

  console.log('\nDone. Raw bodies under scratch/data/external/');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
