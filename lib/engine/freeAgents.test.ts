import { test } from "node:test";
import assert from "node:assert/strict";
import { rankFreeAgents, type FreeAgentCandidate } from "./freeAgents";

test("ranks candidates by weekly projected points, descending", () => {
  const candidates: FreeAgentCandidate[] = [
    { playerId: "a", name: "A", position: "RB", weeklyProjectedPoints: 5 },
    { playerId: "b", name: "B", position: "WR", weeklyProjectedPoints: 12 },
    { playerId: "c", name: "C", position: "TE", weeklyProjectedPoints: 8 },
  ];
  const ranked = rankFreeAgents(candidates, 10);
  assert.deepEqual(
    ranked.map((r) => r.playerId),
    ["b", "c", "a"],
  );
});

test("rest-of-season is the weekly-projection x games-remaining placeholder", () => {
  const ranked = rankFreeAgents(
    [{ playerId: "a", name: "A", position: "QB", weeklyProjectedPoints: 15 }],
    6,
  );
  assert.equal(ranked[0].restOfSeasonProjectedPoints, 90);
});
