// Phase 0 exit criterion (docs/architecture.md section 5): print the optimal week 1
// lineup for my roster under this league's real scoring_settings, computed from real
// Sleeper projections, plus the swap list against my current Sleeper starters.
//
// Run scratch/fetch-sleeper.mjs first to populate scratch/data/sleeper/.

import { readFile } from 'node:fs/promises';
import path from 'node:path';

const DATA_DIR = path.join(import.meta.dirname, 'data', 'sleeper');
const MY_USERNAME = 'guyel';
const WEEK = 1;

async function loadJson(name) {
  const raw = await readFile(path.join(DATA_DIR, `${name}.json`), 'utf8');
  return JSON.parse(raw).body;
}

// Reads the live scoring_settings JSON. No scoring values are hardcoded here except
// the offense-only stat keys this league actually uses (no K/DEF slots exist, see
// CLAUDE.md Phase 0 findings for the kicker/DST scoring mismatch).
function scoreProjection(stats, position, scoring) {
  if (!stats) return 0;
  const recBonusKey = `bonus_rec_${position.toLowerCase()}`;
  const recBonus = scoring[recBonusKey] || 0;
  const s = (key) => stats[key] || 0;
  return (
    s('pass_yd') * (scoring.pass_yd || 0) +
    s('pass_td') * (scoring.pass_td || 0) +
    s('pass_int') * (scoring.pass_int || 0) +
    s('pass_2pt') * (scoring.pass_2pt || 0) +
    s('rush_yd') * (scoring.rush_yd || 0) +
    s('rush_td') * (scoring.rush_td || 0) +
    s('rush_2pt') * (scoring.rush_2pt || 0) +
    s('rec') * ((scoring.rec || 0) + recBonus) +
    s('rec_yd') * (scoring.rec_yd || 0) +
    s('rec_td') * (scoring.rec_td || 0) +
    s('rec_2pt') * (scoring.rec_2pt || 0) +
    s('fum_lost') * (scoring.fum_lost || 0) +
    s('fum_rec_td') * (scoring.fum_rec_td || 0)
  );
}

// Nested-slot greedy: correct here because slot eligibility nests
// (QB slot subset of SUPER_FLEX; RB/WR/TE slots subset of FLEX subset of SUPER_FLEX).
function buildOptimalLineup(slots, playersByPosition) {
  const used = new Set();
  const lineup = new Array(slots.length).fill(null);
  const pools = {
    QB: [...playersByPosition.QB],
    RB: [...playersByPosition.RB],
    WR: [...playersByPosition.WR],
    TE: [...playersByPosition.TE],
  };

  const takeBest = (candidates) => {
    const pick = candidates.find((p) => !used.has(p.player_id));
    if (pick) used.add(pick.player_id);
    return pick || null;
  };

  slots.forEach((slot, i) => {
    if (slot === 'QB') lineup[i] = takeBest(pools.QB);
    else if (slot === 'RB') lineup[i] = takeBest(pools.RB);
    else if (slot === 'WR') lineup[i] = takeBest(pools.WR);
    else if (slot === 'TE') lineup[i] = takeBest(pools.TE);
  });

  const flexPool = [...pools.RB, ...pools.WR, ...pools.TE]
    .filter((p) => !used.has(p.player_id))
    .sort((a, b) => b.points - a.points);
  slots.forEach((slot, i) => {
    if (slot === 'FLEX') lineup[i] = takeBest(flexPool);
  });

  const sfPool = [...pools.QB, ...pools.RB, ...pools.WR, ...pools.TE]
    .filter((p) => !used.has(p.player_id))
    .sort((a, b) => b.points - a.points);
  slots.forEach((slot, i) => {
    if (slot === 'SUPER_FLEX') lineup[i] = takeBest(sfPool);
  });

  return lineup;
}

async function main() {
  const league = await loadJson('league');
  const rosters = await loadJson('rosters');
  const users = await loadJson('users');
  const players = await loadJson('players-nfl');
  const projections = await loadJson('undocumented/projections-week1');

  const me = users.find((u) => u.display_name === MY_USERNAME);
  const myRoster = rosters.find((r) => r.owner_id === me.user_id);
  const scoring = league.scoring_settings;
  const startingSlots = league.roster_positions.filter((p) => p !== 'BN');

  const projByPlayer = new Map(projections.map((p) => [p.player_id, p.stats]));

  const rosterPlayers = myRoster.players.map((pid) => {
    const meta = players[pid] || {};
    const position = meta.position;
    const stats = projByPlayer.get(pid);
    const points = ['QB', 'RB', 'WR', 'TE'].includes(position)
      ? scoreProjection(stats, position, scoring)
      : 0;
    return {
      player_id: pid,
      name: meta.full_name || pid,
      position,
      points: Math.round(points * 100) / 100,
      hasProjection: Boolean(stats),
    };
  });

  const byPosition = { QB: [], RB: [], WR: [], TE: [] };
  for (const p of rosterPlayers) {
    if (byPosition[p.position]) byPosition[p.position].push(p);
  }
  for (const pos of Object.keys(byPosition)) {
    byPosition[pos].sort((a, b) => b.points - a.points);
  }

  const lineup = buildOptimalLineup(startingSlots, byPosition);

  console.log(`Optimal week ${WEEK} lineup for ${me.metadata.team_name} (roster_id ${myRoster.roster_id})`);
  console.log(`League: ${league.name} (${league.league_id})\n`);

  let total = 0;
  startingSlots.forEach((slot, i) => {
    const p = lineup[i];
    if (!p) {
      console.log(`  ${slot.padEnd(11)}  EMPTY (no eligible player left)`);
      return;
    }
    total += p.points;
    const flag = p.hasProjection ? '' : '  [no week 1 projection found]';
    console.log(`  ${slot.padEnd(11)}  ${p.name.padEnd(24)} ${p.position}  ${p.points.toFixed(2)} pts${flag}`);
  });
  console.log(`\n  Projected total: ${total.toFixed(2)} pts`);

  // Set difference, not index-by-index: two players both already starting who land
  // in different same-type slots (e.g. WR1 vs WR2) is not a real swap.
  console.log('\nSwap list vs current Sleeper starters:');
  const currentStarters = new Set(myRoster.starters.filter((id) => id && id !== '0'));
  const optimalIds = new Set(lineup.filter(Boolean).map((p) => p.player_id));

  const startingSlotBySlotIndex = lineup.map((p, i) => ({ p, slot: startingSlots[i] }));
  const toStart = startingSlotBySlotIndex.filter(({ p }) => p && !currentStarters.has(p.player_id));
  const toBench = [...currentStarters]
    .filter((id) => !optimalIds.has(id))
    .map((id) => players[id] || { full_name: id });

  if (toStart.length === 0 && toBench.length === 0) {
    console.log('  None. Current Sleeper starters already match the optimal lineup.');
  } else {
    toStart.forEach(({ p, slot }) => {
      console.log(`  start ${p.name} (${p.position}) at ${slot}`);
    });
    toBench.forEach((meta) => {
      console.log(`  bench ${meta.full_name || meta}`);
    });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
