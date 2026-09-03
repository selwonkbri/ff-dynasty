// Verifies the swap detector actually flags swaps, not just that it can report an
// empty list. Phase 0's live run against real data produced an empty swap list,
// which is exactly what a broken comparison would also produce, so this test feeds
// a deliberately suboptimal `currentStarters` set and asserts the expected diff.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildOptimalLineup, computeSwapList } from './optimal-lineup.mjs';

const SLOTS = ['QB', 'RB', 'WR', 'FLEX', 'SUPER_FLEX'];

const players = {
  qb1: { player_id: 'qb1', full_name: 'Best QB', position: 'QB', points: 25 },
  qb2: { player_id: 'qb2', full_name: 'Backup QB', position: 'QB', points: 15 },
  rb1: { player_id: 'rb1', full_name: 'Best RB', position: 'RB', points: 20 },
  rb2: { player_id: 'rb2', full_name: 'Bench RB', position: 'RB', points: 5 },
  wr1: { player_id: 'wr1', full_name: 'Best WR', position: 'WR', points: 18 },
  wr2: { player_id: 'wr2', full_name: 'Flex WR', position: 'WR', points: 12 },
};

const byPosition = {
  QB: [players.qb1, players.qb2],
  RB: [players.rb1, players.rb2],
  WR: [players.wr1, players.wr2],
  TE: [],
};

test('computeSwapList reports no swaps when current starters already match optimal', () => {
  const lineup = buildOptimalLineup(SLOTS, byPosition);
  // Optimal: QB=qb1, RB=rb1, WR=wr1, FLEX=wr2, SUPER_FLEX=qb2
  const currentStarters = new Set(lineup.map((p) => p.player_id));

  const { toStart, toBench } = computeSwapList(SLOTS, lineup, currentStarters, players);

  assert.deepEqual(toStart, []);
  assert.deepEqual(toBench, []);
});

test('computeSwapList flags a bench player who should be starting and the starter they replace', () => {
  const lineup = buildOptimalLineup(SLOTS, byPosition);
  // Deliberately suboptimal: bench rb2 (5 pts) is starting at FLEX instead of
  // wr2 (12 pts), which the optimizer picked. Everything else matches.
  const currentStarters = new Set(['qb1', 'rb1', 'wr1', 'rb2', 'qb2']);

  const { toStart, toBench } = computeSwapList(SLOTS, lineup, currentStarters, players);

  assert.equal(toStart.length, 1);
  assert.equal(toStart[0].p.player_id, 'wr2');
  assert.equal(toStart[0].slot, 'FLEX');

  assert.equal(toBench.length, 1);
  assert.equal(toBench[0].full_name, 'Bench RB');
});

test('computeSwapList flags a SUPER_FLEX swap between two QBs, not a false positive', () => {
  const lineup = buildOptimalLineup(SLOTS, byPosition);
  // Current starters have the same 5 players but qb2 sitting where the optimizer
  // instead expects the *set* to match already (qb1+qb2 both start regardless of
  // which named slot); this must report no swap since it's a same-player-set case.
  const currentStarters = new Set(['qb1', 'rb1', 'wr1', 'wr2', 'qb2']);

  const { toStart, toBench } = computeSwapList(SLOTS, lineup, currentStarters, players);

  assert.deepEqual(toStart, []);
  assert.deepEqual(toBench, []);
});
