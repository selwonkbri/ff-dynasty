# Legacy League Dynasty Tool

Single-user, numbers-only dynasty fantasy football decision tool for the Legacy League (Sleeper, 12 teams, superflex, position-weighted PPR). Read docs/architecture.md and docs/rules.md in full before doing anything.

## Non-negotiables
- No em dashes anywhere: code comments, UI copy, generated text, commit messages. Use commas, colons, parentheses, or separate sentences.
- Database is Neon Postgres via DATABASE_URL. Never connect to, reference, or configure any Supabase project. Brian's two Supabase projects (Camp Compass, travel calendar sync) are off limits entirely.
- Sleeper league settings JSON is the source of truth for scoring, slots, playoff structure, and brackets. docs/rules.md is the source of truth for policy. Flag mismatches, never silently pick one.
- Never hardcode scoring values outside test fixtures.
- Every league sync stores a compact raw snapshot before normalizing. Never store the raw 5 MB player map. Follow the retention policy in docs/architecture.md section 4.7.
- All engine modules in lib/engine are pure functions with unit tests. No I/O there.
- Sleeper API is read-only. This tool never attempts to write to Sleeper.
- No LLM calls. Briefs are templated text from engine output.
- No paid services. Free tiers only. Target $0/month, $10 hard cap.
- Mobile-first UI. Assume a phone on marginal cell service.
- Stay far under 1,000 Sleeper calls per minute. Player map fetched at most once per day.

## Stack
- Next.js (App Router) on Vercel Hobby
- Neon Postgres (free tier), DATABASE_URL injected by the Vercel Neon integration
- Scheduled jobs: GitHub Actions workflows calling /api/jobs/* with an x-cron-secret header. Vercel Cron is an acceptable alternative if Phase 0 shows it fits within Hobby function limits. Decide with real numbers, do not assume.
- Pushover for alerts
- Single shared secret auth via middleware, APP_SECRET env var

## Infrastructure
- GitHub: selwonkbri/ff-dynasty
- Vercel project: prj_6S0t3kNG6LRcRkDmHuyOK6Otvdu4, team bls2 (hobby)
- Neon project: lucky-bonus-28374332 (neon-cyan-cushion)
- Neon org: org-lucky-frog-64769584
- Neon free tier: 0.5 GB storage, 100 CU-hrs per month, 5 GB transfer, 6 hour history retention
- Postgres 18, AWS us-east-1, 0.25 CU default compute
- Env vars already injected: DATABASE_URL, POSTGRES_URL, POSTGRES_URL_NON_POOLING, PGHOST, PGUSER, PGDATABASE, NEON_AUTH_URL

Storage is the binding constraint at 0.5 GB. Build the retention job early rather than deferring it. Unbounded snapshot accumulation over a full season is the thing that would blow past the limit.

## Identifiers (fill in during Phase 0)
- Sleeper username: guyel
- Sleeper user_id: 1316597412378198016
- League id: 1314333835533520896
- My roster_id: 9 (team name "Mac's Mates")
- Season: 2026
- Playoff teams per Sleeper settings: 6
- Toilet Bowl bracket size per Sleeper losers_bracket: 6

## Phase 0 findings (2026-09-03)

Confirmed via `scratch/fetch-sleeper.mjs` and `scratch/fetch-external.mjs` against the live league. Raw responses saved under `scratch/data/` (gitignored).

**Scoring settings mismatch (flagged, not silently resolved):** Sleeper's live `scoring_settings` matches docs/architecture.md section 3.1 exactly for every offense stat, including the position-weighted reception math (`rec: 0.5` base, `bonus_rec_wr: 0.5` making WR 1.0, `bonus_rec_te: 0.75` making TE 1.25, no `bonus_rec_rb` key needed since RB stays at the 0.5 base). However, `scoring_settings` also carries a full, non-zero kicker scoring block (`fgm_0_19` through `fgm_50p`, `fgmiss`, `xpm`, `xpmiss`) and a full team defense/special-teams/IDP block (`def_td`, `def_st_*`, `pts_allow_*` tiers, `sack`, `safe`, `blk_kick`, `st_*`, `int`, `fum_rec`). Both contradict docs/rules.md and architecture.md section 3.1 ("No kickers, no team defense"). In practice these are inert: `roster_positions` has no `K`, `DEF`, or IDP slot, so no roster can ever start one and these values never get used. This is Sleeper's default scoring template left in place around the custom offense scoring, not an active rule. Flagged per policy; does not need code to special-case it, but the `scoring` engine module should only read the offense keys it needs rather than iterating every key in `scoring_settings`.

**Toilet Bowl (open item from architecture.md 3.4): resolved, 6 teams, not 8.** `settings.playoff_teams` is 6. `winners_bracket` has 6 distinct roster_ids (1, 2, 3, 5, 7, 12). `losers_bracket` has the other 6 (4, 6, 8, 9, 10, 11), structured as two byes plus a 4-team first round, all funneling to a placement final. 6 + 6 = 12, the full league. docs/rules.md section VIII's "eight teams" does not match its own section VII (6 playoff teams) or Sleeper's actual bracket. Per the project's own source-of-truth rule (Sleeper settings and brackets are truth for playoff structure), the correct reading is **6 teams in the Toilet Bowl**; rules.md section VIII should be corrected from "eight" to "six" the next time the rules document is revised.

**`matchups/<week>` undocumented fields: confirmed present.** Both `players_points` (map of player_id to points) and `starters_points` (array aligned to `starters`) are real fields in the week 1 response, exactly as architecture.md section 4.1 anticipated. All values are currently 0 since week 1 hasn't kicked off yet (season starts 2026-09-09 per the projections data).

**Data sources tested:**

| Source | Works | Returns | Joins to Sleeper IDs via |
|---|---|---|---|
| Sleeper documented endpoints (4.1) | Yes, all of them | Exactly as documented | Native (Sleeper's own IDs) |
| Sleeper undocumented `projections/nfl/<season>/<week>` | Yes | Raw stat-line projections per player (`rush_yd`, `rec`, `rec_yd`, `pass_td`, etc.), keyed by `player_id`, populated for week 1 2026 already | `player_id` is the Sleeper player ID directly, no join needed |
| Sleeper undocumented `stats/nfl/<season>/<week>` | Yes (200), but empty array for week 1 right now | Same shape as projections once games are played | Same, `player_id` is native |
| FantasyCalc `values/current` (`isDynasty=true&numQbs=2&numTeams=12&ppr=1`) | Yes | Dynasty trade values, superflex-aware, 473 players | `player.sleeperId` field is present directly on every entry, plus `espnId`, `mflId`, `fleaflickerId`, `ffpcId` |
| DynastyProcess `values-players.csv` | Yes | KTC-derived dynasty values (1QB and 2QB variants) | No Sleeper ID on this file, only player name and an `fp_id` (FantasyPros ID). Must join by name (or via the crosswalk below) |
| DynastyProcess `values-picks.csv` | Yes | Pick values by slot (e.g. "2026 Pick 1.01") | N/A, picks aren't players |
| DynastyProcess `db_playerids.csv` (crosswalk, not in architecture.md's list but needed) | Yes | ID crosswalk table: `mfl_id, sportradar_id, fantasypros_id, gsis_id, pff_id, sleeper_id, nfl_id, espn_id, yahoo_id, fleaflicker_id` | Has `sleeper_id` directly. This is the real join path for DynastyProcess values, not the values file itself: join `values-players.csv` to `db_playerids.csv` on `fp_id`/`fantasypros_id`, then read `sleeper_id` |
| nflverse `players.csv` (`nflverse-data` release `players`) | Yes | Full player biographical/ID table, one row per player, ~7 MB | `gsis_id` column matches Sleeper's own `gsis_id` field on player objects (confirmed both use the `00-00xxxxx` format) |
| nflverse schedules | Yes, but **not** at the URL architecture.md implies. `nflverse-data` has no `schedules` release asset; the real file is `games.csv` in the separate `nflverse/nfldata` repo (`github.com/nflverse/nfldata/raw/master/data/games.csv`) | Full schedule with `gameday`, `gametime`, `week`, `home_team`/`away_team`, bye info derivable from absence | Team abbreviations, not player IDs; join `schedule` to `players` on team + position for bye/kickoff lookups |

**Exit criterion met:** `scratch/optimal-lineup.mjs` computes the optimal 10-man week 1 lineup for roster 9 from real Sleeper projections scored under the league's live `scoring_settings`, and diffs it against the current Sleeper `starters`. Result: my current Sleeper starters already match the computed optimum for week 1, so the swap list is empty. Run it after `scratch/fetch-sleeper.mjs`.

## Working rhythm
- One vertical slice per session. Commit before starting.
- Plan mode for anything structural. Show the plan before editing.
- Run tests before declaring a slice done.
- Brian pushes from his local clone. Stage and summarize, do not assume the push happened.
