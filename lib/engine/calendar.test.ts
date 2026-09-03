import { test } from "node:test";
import assert from "node:assert/strict";
import { nextEvents } from "./calendar";

// Tuesday 2026-09-08 08:00 ET (12:00 UTC), after that day's own weekly-brief
// time has already passed, so it should roll to next Tuesday.
const NOW = new Date("2026-09-08T12:00:00Z");

test("returns the weekly recurring events in chronological order", () => {
  const events = nextEvents(NOW, 4);
  assert.deepEqual(
    events.map((e) => e.name),
    ["Waiver blind bid deadline", "Weekly compliance check", "FCFS waiver close", "Weekly brief"],
  );
  assert.deepEqual(
    events.map((e) => e.at.toISOString()),
    [
      "2026-09-10T00:00:00.000Z",
      "2026-09-13T15:00:00.000Z",
      "2026-09-13T17:00:00.000Z",
      "2026-09-15T10:00:00.000Z",
    ],
  );
});

test("n limits the number of events returned, keeping the soonest", () => {
  const events = nextEvents(NOW, 2);
  assert.equal(events.length, 2);
  assert.equal(events[0].name, "Waiver blind bid deadline");
  assert.equal(events[1].name, "Weekly compliance check");
});

test("a future trade deadline from weekKickoffs is included and sorted correctly", () => {
  const events = nextEvents(NOW, 10, { 12: new Date("2026-09-09T00:00:00Z") });
  assert.ok(events.some((e) => e.name.startsWith("Trade deadline")));
  // Sooner than the Wednesday blind-bid deadline (Sep 10), so it should sort first.
  assert.equal(events[0].name, "Trade deadline (week 12 kickoff)");
});

test("a past trade deadline from weekKickoffs is excluded, not surfaced as upcoming", () => {
  const events = nextEvents(NOW, 10, { 12: new Date("2026-08-01T00:00:00Z") });
  assert.ok(!events.some((e) => e.name.startsWith("Trade deadline")));
});
