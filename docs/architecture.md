# Legacy League Dynasty Tool: Architecture Spec

Status: v2, decisions resolved. This is the contract for the Claude Code (Opus 5) build. One open item remains (Toilet Bowl bracket size, see 3.4); it does not block Phase 0 or Phase 1.

Owner: Brian (Sleeper username `guyel`)
League: Legacy League Dynasty, 12 teams, founded 2026, hosted on Sleeper
Posture: three-year contention window (2026 through 2028), weighted 40/35/25, with a manual "not making the playoffs" switch that re-weights toward 2027 and 2028
Budget: $0 per month target, $10 hard cap
Isolation rule: this project must not touch, share quotas with, or change configuration on the Camp Compass Supabase project or the travel calendar sync Supabase project in any way.

---

## 1. What this tool is

A private, numbers-only decision-support system for one dynasty team. Three jobs every week in season, a fourth across the offseason:

1. **Lineup**: the optimal 10-man lineup under this league's exact scoring and slot rules, a swap list against your current Sleeper starters, decisions ordered by kickoff with late-swap pivots, a compliance check against the anti-tanking rules, and a read-back after you make the swaps in Sleeper.
2. **Waivers**: the free agent pool ranked by this-week, rest-of-season, and dynasty value; a clearing-price model built from the other 11 owners' bid history and remaining FAAB; a recommended bid range and drop; reminders before the Wednesday 8 PM ET blind run and the Sunday 1 PM ET FCFS close.
3. **Trades**: any proposal evaluated on four axes (dynasty value, starting lineup impact, roster-count consequences, veto risk), weighted by the contention window; a partner scan across the league for complementary surplus and need.
4. **Season and offseason management**: playoff odds and the points-for race, Toilet Bowl positioning for the 1.13 pick, projected rookie draft slots and pick values, FAAB fiscal-year tracking, roster expansion and June 1 cutdown planning, rookie board.

Everything is deterministic code. No LLM calls, no narrative. Briefs are templated text rendered from engine output. Sleeper's API is read-only: the tool never sets a lineup or submits a bid. It tells you what to do, you do it in Sleeper, it reads back to confirm.

---

## 2. Deployment pattern

Matches how BRAM and Camp Compass are run, with lessons from both applied, and with the isolation rule as the first constraint.

| Layer | Choice | Why |
|---|---|---|
| Repo | GitHub, private, `selwonkbri/legacy-league` (name TBD) | Same push-from-local-clone workflow as BRAM. Claude Code works in the clone. |
| Frontend + API | Next.js (App Router) on Vercel Hobby | Vercel is already in use. API routes and frontend in one repo. Not Lovable: the Lovable-managed Supabase split on Camp Compass cost real time, and Claude Code owns this codebase end to end. Hobby is free for personal, non-commercial use, which this is. |
| Database | **Neon Postgres, free tier, provisioned through the Vercel Marketplace** | Supabase free tier is at its two-project cap and those projects cannot be touched. Co-locating this tool in Camp Compass under a separate schema would share its database size, egress, and compute quotas, so a heavy sync here could break the live app. A separate free Postgres is the only zero-risk option. Neon via Vercel Marketplace is one click from the Vercel project, injects `DATABASE_URL` automatically, and is plain Postgres so nothing about the Claude Code workflow changes. Verify current Neon free limits in Phase 0 (storage is the one that matters; see 4.7). |
| Fallback database | An `ffl` schema inside the Camp Compass Supabase project, accessed **only** via direct Postgres connection with the pooler, never via PostgREST | Use only if Neon is unavailable. No changes to exposed schemas, RLS on public tables, or any API setting. Still shares quotas, which is why it is the fallback and not the plan. |
| Scheduled jobs | GitHub Actions scheduled workflows calling authenticated API routes (`x-cron-secret` header) | Vercel Hobby limits cron frequency (verify in Phase 0, but assume it cannot do 30-minute polls). GitHub Actions cron is free within the private-repo minutes allowance; the job plan in 4.4 uses a small fraction of it. Schedules can run a few minutes late, which is acceptable for every job here. |
| Alerts | Pushover | Already wired for the Camp Compass booking notifier. No recurring cost. |
| Auth | Single shared secret (`APP_SECRET`) checked in Next.js middleware, set as an httpOnly cookie on login | Private, single-user tool. Do not over-build. |
| Cost | $0/month expected | Vercel Hobby free, Neon free, GitHub Actions free, Pushover already paid. If Neon storage becomes a problem, trim retention (4.7) before considering anything paid. |

Client is mobile-first. Primary use is a phone, sometimes on marginal cell service from a trailer. Pages must be light and tolerate slow loads. The critical weekly outputs also arrive as Pushover messages so the phone does not need to open the site at all.

---

## 3. League rules encoded as constraints

Every rule below is a first-class constraint or feature in the engine. Sleeper's league settings JSON is the source of truth for scoring, roster slots, playoff structure, and brackets; the rules document is the source of truth for policy (deadlines, windows, penalties, pick rights). The app stores both and flags any mismatch on every sync.

### 3.1 Scoring (position-weighted PPR)

| Stat | Points |
|---|---|
| Passing TD | 4 |
| Passing yard | 0.04 |
| Interception thrown | -2 |
| Passing 2-pt | 2 |
| Rushing TD | 6 |
| Rushing yard | 0.1 |
| Rushing 2-pt | 2 |
| Receiving TD | 6 |
| Receiving yard | 0.1 |
| Reception, RB | 0.5 |
| Reception, WR | 1.0 |
| Reception, TE | 1.25 |
| Receiving 2-pt | 2 |
| Fumble | -2 |
| Offensive fumble recovery TD | 6 |

No kickers, no team defense.

Implications the engine must handle:
- Reception points depend on position, so scoring is a function of (stat line, position). Sleeper expresses this with position-specific keys in `scoring_settings` (e.g. `bonus_rec_te`, `bonus_rec_wr`, `bonus_rec_rb`) layered on a base `rec` value. The scoring module reads the live JSON and maps keys; nothing is hardcoded except as a test fixture.
- 4-point passing TDs and 0.04 per yard depress QB scoring relative to 6-point leagues. Combined with the SF slot, QB2 has real value but not the runaway value it has in 6-point superflex. All positional scarcity math is computed from projections run through **this** scoring, never from generic rankings.
- TE premium is modest (1.25 vs 1.0). Elite TEs gain a few points a week over WRs; mid TEs do not. The engine should not overpay for TE2.
- Fumbles at -2 and INTs at -2 make turnover-prone players worth slightly less than yardage suggests. Minor, but included.

### 3.2 Lineup and roster

- 10 starters: 1 QB, 2 RB, 2 WR, 1 TE, 3 FLEX (RB/WR/TE), 1 SF (QB/RB/WR/TE).
- SF is a flexible skill slot, not a mandatory QB2 slot. The optimizer compares the best remaining QB against the best remaining RB/WR/TE for that slot every week.
- 26-man roster in season. 12 x 26 = 312 rostered. 120 start each week. The free agent pool is thin; replacement level is computed from the **actual** unrostered pool in this league.
- **No IR slot, no taxi squad.** Confirmed. The bench is sized to compensate. Every injured stash occupies a full roster spot, so the drop model prices roster spots explicitly and the trade module counts a long-term injured player as a roster cost, not a free hold. The sync stores Sleeper's `reserve` and `taxi` arrays anyway (expected empty) and flags if they ever populate.
- Offseason: roster expands to 30 after the first free agency run (mid-March). Must be back to 26 by June 1. The tool tracks a "June 1 cutdown" view from mid-March onward.
- After a trade, rosters may exceed 26 but lineup submission locks until you cut back. Every trade evaluation reports the post-trade roster count and, if over 26, names the recommended cut and its value loss.
- Players lock at their own game's kickoff. Unlocked players can still be moved. This drives the late-swap logic in 4.2.
- Lineup cannot include bye-week players or skill players listed Out or Inactive on the final injury report before game day.

### 3.3 Anti-tanking rules (compliance features)

- Best lineup must be submitted every week. Sitting a good player in a bad matchup is allowed but the commissioner may ask for a reasonable explanation.
- No bye-week starters.
- A player ruled Out 24 or more hours before his game must be removed from the lineup.
- Penalties: warning, then loss of a 1st round pick, then expulsion.

The tool never recommends a non-compliant lineup, alerts when a starter's status changes to Out, and logs the projected-points reasoning for any start that differs from the optimizer's pick so an explanation exists if asked.

### 3.4 Season structure

- Regular season: NFL weeks 1 through 14.
- Playoffs: weeks 15 through 17. Rules document: six teams, seeds 1 and 2 bye, week 15 is 3 vs 6 and 4 vs 5, week 16 is 1 vs lowest remaining and 2 vs the other.
- Sixth playoff spot decided by total points scored. Two-way ties broken by head-to-head. Points-for is a tracked race, not a footnote.
- Toilet Bowl: non-playoff teams seeded by total points with the **worst** total as the 1 seed. Winner receives compensatory pick 1.13 (between rounds 1 and 2), tradable, **entered into Sleeper's rookie draft** so it will appear in the drafts and traded picks endpoints.
- **Open item:** Brian states the Toilet Bowl is 8 teams. With 12 teams and 6 playoff spots that leaves 6, not 8; 8 only reconciles with a 4-team playoff. The engine treats Sleeper's `settings.playoff_teams`, `winners_bracket`, and `losers_bracket` as truth, and flags the discrepancy on the dashboard until the settings and the rules document agree. This matters for the pick-slot inversion in 3.7 (which finish gets 1.06 vs 1.07) and for how many teams are in the 1.13 race. Brian to confirm the playoff team count in Sleeper's league settings.
- Waivers run through the playoffs for all teams. A non-playoff team should be adding for weeks 15 through 17 to win 1.13. Toilet Bowl mode in the waiver module is tied to the posture switch (3.9).

### 3.5 Trades

- Execute on acceptance.
- Deadline: kickoff of week 12 NFL games. Reopens the Tuesday after week 17 concludes.
- Two owners objecting within 48 hours triggers commissioner review. The trade module computes a **veto risk** score from the gap between public dynasty value sent and received.
- FAAB can be included in trades (Sleeper exposes `waiver_budget` transfers in the transactions endpoint).

### 3.6 Waivers and FAAB

- $1,000 FAAB per owner. Blind bids process Wednesday 8 PM ET. FCFS from then until Sunday 1 PM ET.
- Waivers run through the playoffs for all teams.
- Offseason: blind bidding only, no FCFS. One run before the NFL draft (late March or early April). Closed during the NFL draft and rookie draft (drops still allowed). Reopens blind-bid only two weeks after the rookie draft until preseason, then weekly blind bid plus FCFS resumes.
- **FAAB resets annually at the rookie draft.** Confirmed. The rookie draft date varies year to year. So the FAAB fiscal year runs rookie draft to rookie draft, which means:
  - In-season spending, the post-season, and the pre-NFL-draft waiver run all draw from the **same** $1,000.
  - Whatever is left going into the pre-NFL-draft run is use-it-or-lose-it. The waiver module flags this and recommends spending down aggressively at that run.
  - Post-rookie-draft offseason spending (two weeks after the draft through preseason) draws from the **new** season's $1,000, which then has to last the whole in-season. The module warns when offseason spending eats into in-season capacity.
  - The fiscal-year boundary is detected from the rookie draft's completion in the drafts endpoint, with a manual override date in Settings.
- Accidental drop: one hour to contact the commissioner.

Engine behaviors:
- Track every owner's `waiver_budget_used` from the rosters endpoint and every winning bid from `transactions[].settings.waiver_bid`. Build a clearing-price model per value tier.
- Distinguish blind-bid targets (contested) from FCFS targets (Saturday and Sunday morning injury news, handcuffs, Wednesday-night drops).
- Calendar-aware: the module knows which mode the league is in from the date and the rules.

### 3.7 Drafts and picks

- Rookie draft: 4 rounds, **linear** (not snake), second Monday after the NFL draft, 4-hour clock paused midnight to 8 AM ET. Only rookies eligible.
- Order: non-playoff teams by regular season finish (worst first), then playoff teams in reverse order of final standings (last playoff seed first, champion last). Plus the Toilet Bowl 1.13.
- Because the draft is linear, the 1.01 owner also holds 2.01, 3.01, 4.01. Pick value in rounds 2 through 4 compounds for bad teams.
- Pick trading allowed only for paid years. The 2026 buy-in covers 2026, 2027, 2028. The pick inventory marks each pick tradable or not by year, with a Settings field to extend the paid horizon when the next buy-in is made.
- Startup draft was 3RR snake (confirmed). Startup picks are historical data for owner profiling.

Engine behaviors:
- **Projected pick slot**: simulate the rest of the season, estimate each team's finish, convert to expected 2027 draft slot, price picks accordingly. The team that just misses the playoffs gets a better pick than the last playoff seed. Generic pick values miss that inversion at the playoff line. (Which slots those are depends on the open item in 3.4.)
- **Toilet Bowl 1.13** is a real asset. Track who is positioned to win it.
- Rookie board with league-scoring-adjusted values (WR and TE reception weights shift rookie rankings vs. standard PPR).

### 3.8 Calendar (the tool's clock)

The app maintains a rules-derived calendar and surfaces the next three events on the dashboard:

- Tuesday: prior week closes, weekly brief generated.
- Wednesday 8 PM ET: blind bid deadline.
- Sunday 1 PM ET: FCFS closes.
- Each game kickoff: player lock.
- Week 12 kickoff: trade deadline.
- Week 14 end: regular season ends, seeding locks.
- Weeks 15 through 17: playoffs and Toilet Bowl.
- Tuesday after week 17: trading reopens.
- Post-season through Feb 1: rule change polls.
- Mid-March: first offseason FA run, roster expands to 30.
- Late March or early April: pre-NFL-draft waiver run (FAAB use-it-or-lose-it).
- NFL draft: waivers closed.
- Second Monday after NFL draft: rookie draft, FAAB resets.
- Two weeks after rookie draft: blind-bid waivers reopen on the new FAAB year.
- June 1: roster must be at 26.
- Preseason start: weekly waiver cadence resumes.

### 3.9 Posture and window weights

- Default window weights: **2026 40%, 2027 35%, 2028 25%.** Applied wherever a value blends across seasons (trade evaluation, waiver blended score, drop ranking).
- **"Not making the playoffs" switch** (manual, in Settings). When on:
  - Window weights shift to a configurable rebuild profile, default **2026 15%, 2027 45%, 2028 40%.**
  - Waiver module enters Toilet Bowl mode: targets weighted toward weeks 15 through 17 production and dynasty value, current-week production de-emphasized.
  - Trade module flags 2026-only value on the roster as sell candidates ahead of the week 12 deadline, and re-prices incoming picks assuming a worse own finish.
  - Season sim reports Toilet Bowl odds and seeding prominently.
- The tool **suggests** flipping the switch when playoff odds fall below a threshold (default 15% after week 8) but never flips it automatically. Brian decides.

### 3.10 Value model

- Sources: FantasyCalc (trade-derived, superflex, 12-team, PPR variant) and DynastyProcess (KTC-derived, SF and TEP variants). Both free.
- Blend: normalized to a common scale, default 50/50, weights configurable in Settings.
- **Brian's adjustment layer** sits on top: a `value_adjustments` table of (player or pick, percent or absolute delta, reason, optional expiry). Applied after the blend everywhere values are used. Settings page exposes add, edit, expire. Adjustments are logged with timestamps so the trail exists.
- Picks are valued by projected slot (3.7), not by static round value, then adjusted the same way.

---

## 4. System architecture

```
                 +-------------------+      +--------------------+
                 |  Sleeper API      |      |  Free external     |
                 |  (read-only)      |      |  nflverse,         |
                 |                   |      |  FantasyCalc,      |
                 |                   |      |  DynastyProcess    |
                 +---------+---------+      +---------+----------+
                           |                          |
                           v                          v
                 +-----------------------------------------------+
                 |  Sync jobs (GitHub Actions -> API routes)     |
                 |  idempotent, raw snapshot then normalize      |
                 +----------------------+------------------------+
                                        |
                                        v
                 +-----------------------------------------------+
                 |  Neon Postgres (free tier, isolated)          |
                 +----------------------+------------------------+
                                        |
            +---------------------------+---------------------------+
            v                                                       v
 +-----------------------------------+                +-------------------+
 |  Engine (pure TS, unit-tested)    |                |  Alerts (Pushover)|
 |  scoring, lineup, replacement,    |                |  Tue brief, Wed   |
 |  waivers, trades, season sim,     |                |  FAAB, Sun locks, |
 |  compliance, calendar, profiles,  |                |  status changes   |
 |  posture, values                  |                |                   |
 +----------------+------------------+                +-------------------+
                  |
                  v
 +-----------------------------------------------+
 |  Next.js UI (mobile-first, shared secret)     |
 |  Dashboard / Lineup / Waivers / Trades /      |
 |  League / Picks / Settings / Offseason        |
 +-----------------------------------------------+
```

### 4.1 Data sources

**Sleeper (documented, api.sleeper.app/v1):**
- `user/<username>` to get `user_id`, then `user/<user_id>/leagues/nfl/<season>` to find the Legacy League `league_id`. Store `user_id`, not username.
- `league/<id>`: settings (including `playoff_teams`, `trade_deadline`, `waiver_budget`, `reserve_slots`, `taxi_slots`), `scoring_settings`, `roster_positions`, status.
- `league/<id>/rosters`: `players`, `starters`, `reserve`, `taxi`, `settings.waiver_budget_used`, wins, losses, fpts.
- `league/<id>/users`: owner display names and team names.
- `league/<id>/matchups/<week>`: starters, players, points. Real responses typically include `players_points` and `starters_points` maps (not in the docs; verify in Phase 0 and use if present).
- `league/<id>/transactions/<week>`: adds, drops, trades, `settings.waiver_bid`, `draft_picks`, `waiver_budget`. Offseason transactions generally appear under week 1 (verify).
- `league/<id>/traded_picks`: full pick ownership map including future seasons.
- `league/<id>/winners_bracket` and `losers_bracket`.
- `league/<id>/drafts` and `draft/<id>/picks`: startup draft history, rookie drafts (including the 1.13 once entered), and the rookie draft completion timestamp that resets FAAB.
- `state/nfl`: current week, season type. Drives the calendar.
- `players/nfl`: ~5 MB player map, once daily max. Includes `injury_status`, `practice_participation`, `depth_chart_order`, `age`, `years_exp`, and cross-reference IDs (`gsis_id`, `espn_id`, `sportradar_id`, `yahoo_id`, `rotowire_id`) for joining external data. **Do not store the raw 5 MB body** (see 4.7); normalize and diff against the previous day.
- `players/nfl/trending/add` and `/drop`: league-wide add/drop momentum.
- Rate guidance: stay well under 1,000 calls per minute. Full sync is a few dozen calls. No auth needed.

**Sleeper (undocumented, verify in Phase 0 before depending on it):**
- Weekly projections: `https://api.sleeper.app/projections/nfl/<season>/<week>?season_type=regular&position[]=QB&position[]=RB&position[]=WR&position[]=TE`
- Weekly stats: `https://api.sleeper.app/stats/nfl/<season>/<week>?season_type=regular`
- These return raw stat lines that we run through our own scoring. If they work, they are the simplest projection source because player IDs match with no joins. One source among several, not the only one.

**Free external sources (the only kind used):**
- **nflverse** (github.com/nflverse): weekly player stats, injuries, depth charts, rosters with `gsis_id` for joining to Sleeper. CSV and parquet on GitHub releases. Canonical stats backbone. Schedules are not an `nflverse-data` release asset: the real file is `games.csv` in the separate `nflverse/nfldata` repo (`github.com/nflverse/nfldata/raw/master/data/games.csv`), with kickoff times and byes derivable from it (confirmed Phase 0).
- **FantasyCalc** public API (`api.fantasycalc.com/values/current` with dynasty, superflex, 12-team, PPR parameters): trade-derived dynasty values including picks.
- **DynastyProcess** (github.com/dynastyprocess/data): `values-players.csv` and `values-picks.csv`, KTC-derived, SF and TEP variants. `values-players.csv` carries no Sleeper ID, only player name and an `fp_id` (FantasyPros ID); joining to Sleeper requires `db_playerids.csv` (the ID crosswalk, has `sleeper_id` directly) via `fp_id`/`fantasypros_id`, not the values file alone (confirmed Phase 0).
- **KeepTradeCut** has no official API. Do not scrape it. DynastyProcess carries the KTC signal.
- No paid sources. If the free projection sources prove thin in Phase 0, blend more of them rather than buying one.

### 4.2 Engine modules (pure TypeScript, unit-tested, no I/O)

**`scoring`**
Input: stat line, position, league `scoring_settings`. Output: points. Reads Sleeper's key names from the live settings JSON. Fixture test asserts the table in 3.1 for a QB, RB, WR, TE stat line so any drift is caught.

**`lineup`**
Input: my roster with per-player projections (mean and spread), kickoff times, injury statuses, bye flags, slot definitions. Output:
- Optimal 10-man lineup maximizing projected points subject to eligibility and compliance.
- **Swap list**: diff against my current Sleeper `starters`, expressed as "move X to SF, move Y to bench" so it can be entered directly. After I make the swaps, a read-back sync compares again and reports match or mismatch.
- Decision list ordered by kickoff: for each Questionable or Doubtful starter, the deadline, the best bench pivot whose game kicks off at the same time or later, and the point cost of pivoting now vs. waiting.
- Floor/ceiling mode: heavy favorite prefers floor, heavy underdog prefers ceiling, using the opponent's projected lineup from the matchups endpoint.

**`replacement`**
Positional replacement level for this league every week and for rest-of-season from the actual unrostered pool. VORP for every rostered and unrostered player. All scarcity math uses this.

**`waivers`**
Input: free agent pool with weekly, rest-of-season, and dynasty values; my roster; every owner's FAAB remaining in the current fiscal year; bid history; calendar state; posture. Output:
- Ranked targets in three lenses with a blended score weighted by posture.
- Recommended bid range from the clearing-price model, adjusted for how many owners have the positional need and their remaining FAAB.
- Drop candidates ranked by lowest blended value, honoring `protected` flags, pricing the roster spot explicitly since there is no IR.
- Mode: in-season blind, FCFS, offseason blind-only, closed, Toilet Bowl, pre-NFL-draft spend-down.

**`trades`**
Input: proposal (players, picks, FAAB each way), both rosters, values with adjustments, projections, season sim, posture. Output:
- Dynasty value delta per source and blended, with Brian's adjustments applied.
- Starting lineup delta for both teams over the rest of the season with optimal lineups before and after.
- Window-weighted delta using the active posture weights.
- Roster-count consequence and recommended cut if over 26.
- Pick valuation by projected slot.
- Veto risk score.
- Partner scan: rank the 11 other rosters by complementary surplus and need for a given asset, using their projected lineup gaps and owner profile.

**`season`**
Monte Carlo over the remaining schedule using team-level projected points with variance. Output: playoff odds, bye odds, points-for rank and the last-seed race, Toilet Bowl odds and seeding, expected finish, expected 2027 pick slot for every team. Reads playoff team count and bracket shape from Sleeper settings. Feeds `trades`, `waivers`, and the posture suggestion.

**`compliance`**
Given current Sleeper `starters` and latest statuses: bye starter, Out starter, Inactive starter, roster over 26, lineup locked pending cut. Produces alerts and a reasoning log entry for any start the optimizer did not pick.

**`calendar`**
Rules-derived event list from 3.8, computed from `state/nfl`, the current date, and the FAAB fiscal-year boundary. Exposes `mode()` and `nextEvents(n)`.

**`profiles`**
Per-owner tendencies derived purely from data (no manual seeding): trade frequency and partners, FAAB aggression, positional hoarding, startup draft age profile, roster churn. A manual notes field exists but starts empty.

**`posture`**
Holds window weights and the playoff switch (3.9). Every other module takes posture as an input rather than reading Settings directly, so it is testable.

**`values`**
Normalizes and blends FantasyCalc and DynastyProcess, applies `value_adjustments`, prices picks by projected slot. Single entry point so every module sees the same number for the same asset.

### 4.3 Briefs (templated, no LLM)

Three deterministic text templates rendered from engine output, stored in `briefs`, and sent through Pushover with a link to the page:
1. **Weekly brief** (Tuesday): last week's result and points, standings and points-for position, playoff and Toilet Bowl odds, this week's optimal lineup and swap list, top five waiver targets with bid ranges, calendar items, posture suggestion if triggered.
2. **Waiver brief** (Wednesday noon): final bid recommendations and drops, FAAB remaining vs. league, FCFS watch list.
3. **Waiver results** (Wednesday 9 PM): who won what for how much, updated FAAB table, FCFS opportunities.

### 4.4 Scheduled jobs and alerts

All jobs are GitHub Actions workflows on cron that call authenticated API routes. All idempotent. Every sync stores a compact raw snapshot before normalizing (retention rules in 4.7).

| When (ET) | Job | Alert |
|---|---|---|
| Daily 5:00 AM | Player map diff, injuries, depth charts, values, projections refresh | Only if a rostered player's status changed to Out |
| Tuesday 6:00 AM | Prior week matchups and stats, transactions, standings, season sim, weekly brief | Pushover: weekly brief |
| Wednesday 12:00 PM | Waiver brief | Pushover: bids due 8 PM, targets and drops |
| Wednesday 9:00 PM | Post-run transaction sync, FAAB table, FCFS watch list | Pushover: results and FCFS opportunities |
| Thu through Mon, every 30 min during game windows | Status poll for rostered players and key free agents | Pushover: starter status changed, recommended pivot |
| Sunday 11:00 AM | Final compliance check against Sleeper `starters` | Pushover only if a problem exists |
| Sunday 12:30 PM | FCFS closing reminder if the watch list is non-empty | Pushover |
| On demand | Read-back sync after I make swaps (button on Lineup page) | In-app only |

Quiet hours: none requested. Game-window polling is the only job that runs late evening.

### 4.5 Data model (Neon Postgres, summary)

Exact DDL is the builder's job; this is the shape.

- `league` (league_id, season, settings jsonb, scoring_settings jsonb, roster_positions jsonb, playoff_teams, synced_at)
- `rules_digest` (version, text, effective_from) kept for reference and mismatch checks
- `owners` (roster_id, user_id, display_name, team_name)
- `owner_profiles` (roster_id, derived jsonb, manual_notes, updated_at)
- `players` (sleeper_id PK, names, position, team, age, years_exp, status, injury_status, practice_participation, depth_chart_order, news_updated, gsis_id, espn_id, sportradar_id, yahoo_id, rotowire_id, updated_at)
- `roster_snapshots` (roster_id, taken_at, players[], starters[], reserve[], taxi[], faab_used, wins, losses, fpts)
- `roster_players` (roster_id, player_id, acquired_via, acquired_at)
- `matchups` (season, week, roster_id, matchup_id, points, starters[], players[], players_points jsonb)
- `transactions` (transaction_id PK, type, season, week, status, roster_ids[], adds jsonb, drops jsonb, draft_picks jsonb, waiver_bid, waiver_budget jsonb, created_at)
- `faab_years` (id, starts_at, ends_at, source: detected or manual)
- `picks` (season, round, original_roster_id, current_owner_id, slot_estimate, is_comp, tradable)
- `schedule` (season, week, team, opponent, kickoff_utc, is_home, is_bye)
- `projections` (player_id, season, week, source, stats jsonb, league_pts, as_of)
- `stats_weekly` (player_id, season, week, stats jsonb, league_pts)
- `values_raw` (asset_key, source, as_of, value, variant)
- `value_adjustments` (id, asset_key, kind: pct or abs, amount, reason, created_at, expires_at)
- `injuries` (player_id, season, week, report_status, practice_status, as_of)
- `protected` (player_id, kind: no_drop or no_trade)
- `settings` (key, value jsonb): window weights, playoff switch, blend weights, paid-through season, FAAB manual override
- `briefs` (id, type, week, payload jsonb, text, created_at)
- `alerts_log` (id, type, payload, sent_at)
- `sim_results` (run_at, roster_id, playoff_odds, bye_odds, tb_odds, exp_finish, exp_pick_slot)
- `raw_snapshots` (source, endpoint, fetched_at, body jsonb) with the retention policy in 4.7

### 4.6 UI pages (mobile-first, behind the shared secret)

1. **Dashboard**: next three calendar events, current matchup with win probability, compliance status, latest brief, playoff and points-for position, settings-vs-rules mismatch banner if any.
2. **Lineup**: optimal vs. current, swap list, read-back button and result, decision list by kickoff with pivots, floor/ceiling toggle, reasoning log.
3. **Waivers**: targets in three lenses, bid range, drop candidates, FAAB table for all 12 teams (current fiscal year), bid history, mode indicator.
4. **Trades**: proposal builder (players, picks, FAAB both ways), four-axis evaluation, partner scan, saved proposals.
5. **League**: standings, points-for race, sim odds, every roster and profile, transaction feed, trending adds and drops.
6. **Picks**: full inventory with projected slots and values, tradable flags, 1.13 tracker.
7. **Settings**: window weights, playoff switch, blend weights, value adjustments, protected players, paid-through season, FAAB year override.
8. **Offseason** (appears when the calendar says so): expansion and June 1 cutdown planner, rookie board, offseason waiver windows and FAAB spend-down.

Formatting rule for all copy, code comments, commit messages, and generated text: no em dashes anywhere. Use commas, colons, parentheses, or separate sentences.

### 4.7 Storage budget and retention

Neon free tier storage is the binding constraint. Target: under 150 MB total.

- Never store the raw 5 MB player map. Normalize into `players` and keep a daily diff row set only for changed players.
- `raw_snapshots`: keep 7 days for Sleeper league endpoints (rosters, matchups, transactions), then delete. Projections and values raw bodies are not stored at all; only normalized rows.
- `projections`: keep current season only, all weeks, all sources. Roughly a few thousand rows per week; fine.
- `roster_snapshots`: one per day, current season plus prior season.
- A nightly retention job enforces these and reports table sizes on the Dashboard settings panel so growth is visible before it becomes a problem.

---

## 5. Build sequence

Week 1 is next week and the first in-season blind bid run is Wednesday September 9 at 8 PM ET. Phase 1 must be usable by then. One vertical slice per Claude Code session, commit before each, plan mode for anything structural.

**Phase 0: Spike (one session, half a day)**
- Create private repo, Vercel project, Neon database via Vercel Marketplace, GitHub Actions secrets (`CRON_SECRET`, Pushover keys). Confirm Neon free-tier storage and compute limits and record them in `CLAUDE.md`.
- Confirm Vercel Hobby cron limits; proceed with GitHub Actions regardless.
- Hit every Sleeper endpoint for the Legacy League and store snapshots. Confirm `league_id`, my `roster_id`, `scoring_settings`, `roster_positions`, `playoff_teams`, and bracket shape. Resolve the Toilet Bowl open item from what Sleeper reports.
- Test the undocumented projections and stats endpoints, FantasyCalc, DynastyProcess, and nflverse downloads. Record what works.
- Exit criteria: a script that prints my optimal week 1 lineup and swap list from real data under real scoring.

**Phase 1: Week 1 survival (two sessions)**
- Sync jobs for players (diffed), rosters, matchups, transactions, schedule, injuries.
- `scoring`, `lineup`, `compliance`, `calendar`, `posture` (defaults only).
- Shared-secret middleware. Dashboard and Lineup pages with swap list and read-back.
- Pushover: Sunday compliance check, status change alerts.
- Free agent pool ranked by weekly and rest-of-season projection so the September 9 bids are informed even before the FAAB model exists.
- Exit criteria: lineup, swap list, read-back, and waiver targets for week 1 from the deployed site on a phone.

**Phase 2: Waivers and values (one to two sessions)**
- `values` with blend and adjustment layer, `replacement`, `waivers` with clearing-price model and FAAB fiscal years, Wednesday jobs and briefs, Waivers and Settings pages.

**Phase 3: Trades and season (two sessions)**
- `season` sim, `trades`, `profiles`, pick inventory with projected slots, playoff switch behavior, Trades, Picks, and League pages, Tuesday weekly brief.

**Phase 4: Hardening and offseason (ongoing)**
- Retention job and storage reporting, protected flags, error alerting on failed syncs.
- Offseason page built after week 17, before mid-March.

---

## 6. Non-goals

- Multi-league or multi-user support.
- Writing to Sleeper.
- Building our own projection model. We blend free sources and score them under league rules.
- LLM narrative, drafted messages, or chat. Numbers only.
- Owner profile seeding by hand. Profiles are data-derived.
- Player thesis tracking or hit-rate scoring.
- Paid data sources or any recurring spend.
- Any read or write against the Camp Compass or travel calendar Supabase projects.

---

## 7. Decisions log

| # | Question | Decision |
|---|---|---|
| 1 | Stack | Next.js on Vercel Hobby, Neon Postgres via Vercel Marketplace (isolated from Supabase), GitHub Actions cron, Pushover |
| 2 | Data budget | Free sources only |
| 3 | Value anchor | Blend of FantasyCalc and DynastyProcess with Brian's adjustment layer on top |
| 4 | Window weights | 40/35/25 default; manual "not making the playoffs" switch re-weights to 15/45/40 (configurable) and enables Toilet Bowl mode; tool suggests, never auto-flips |
| 5 | Alerts | Job plan in 4.4 as written, no quiet hours |
| 6 | LLM scope | None. Numbers-only, templated briefs |
| 7 | League confirmations | 1.13 entered in Sleeper draft; FAAB resets at the rookie draft (date varies); no IR or taxi; Toilet Bowl stated as 8 teams, does not reconcile with 6 playoff teams, Sleeper settings are truth and the mismatch is flagged until resolved |
| 8 | Owner intel | No seeding; data-derived profiles only |
| 9 | Notes and theses | Not in scope |
| 10 | Access | Single shared secret |
| 11 | Sunday workflow | Swap list entered manually in Sleeper, read-back check confirms |
| 12 | Budget | $0 expected, $10 hard cap |
| 13 | Isolation | Nothing in this project touches either existing Supabase project. Neon is primary; an `ffl` schema in Camp Compass via direct Postgres connection only is the fallback and still shares quotas, so avoid it |

---

## Appendix A: CLAUDE.md starter

Drop this into the repo root after `/init` and edit. Claude Code reads it at the start of every session.

```
# Legacy League Dynasty Tool

Single-user, numbers-only dynasty fantasy football decision tool for the Legacy League (Sleeper, 12 teams, superflex, position-weighted PPR). Read docs/architecture.md before doing anything.

## Non-negotiables
- No em dashes anywhere: code comments, UI copy, generated text, commit messages. Use commas, colons, parentheses, or separate sentences.
- Database is Neon Postgres via DATABASE_URL. Never connect to, reference, or configure any Supabase project. Brian's two Supabase projects (Camp Compass, travel calendar sync) are off limits entirely.
- Sleeper league settings JSON is the source of truth for scoring, slots, playoff structure, and brackets. docs/rules.md is the source of truth for policy. Flag mismatches, never silently pick one.
- Never hardcode scoring values outside test fixtures.
- Every league sync stores a compact raw snapshot before normalizing. Never store the raw 5 MB player map. Follow the retention policy in docs/architecture.md section 4.7.
- All engine modules in lib/engine are pure functions with unit tests. No I/O there.
- Sleeper API is read-only. This tool never attempts to write to Sleeper.
- No LLM calls. Briefs are templated text from engine output.
- No paid services. Free tiers only. Target $0/month.
- Mobile-first UI. Assume a phone on marginal cell service.
- Stay far under 1,000 Sleeper calls per minute. Player map fetched at most once per day.

## Stack
- Next.js (App Router) on Vercel Hobby
- Neon Postgres (free tier), DATABASE_URL injected by Vercel Marketplace integration
- GitHub Actions scheduled workflows calling /api/jobs/* with x-cron-secret header
- Pushover for alerts
- Single shared secret auth via middleware, APP_SECRET env var

## Identifiers (fill in Phase 0)
- Sleeper user_id:
- League id:
- My roster_id:
- Season: 2026
- Playoff teams per Sleeper settings:
- Neon free-tier storage limit:

## Working rhythm
- One vertical slice per session. Commit before starting.
- Plan mode for anything structural. Show the plan before editing.
- Run tests before declaring a slice done.
- Brian pushes from his local clone; stage and summarize, do not assume the push happened.
```

## Appendix B: Key facts from the May startup draft

For seeding roster context. Verify against the live rosters endpoint in Phase 0; trades and waivers since May may have changed things.

- Brian drafted from slot 8 in a 3RR snake startup.
- Early picks: Joe Burrow (QB), Malik Nabers (WR), Colston Loveland (TE), Chase Brown (RB), Zay Flowers (WR). Makai Lemon (WR) was identified at 6.08.
- Startup draft id: 1314333838171725824.
- Brian's stated posture: 2026 through 2028 window, SF treated as a flexible skill slot, TE premium treated as modest.
