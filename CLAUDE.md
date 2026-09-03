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
- Sleeper user_id:
- League id:
- My roster_id:
- Season: 2026
- Playoff teams per Sleeper settings:
- Toilet Bowl bracket size per Sleeper losers_bracket:

## Working rhythm
- One vertical slice per session. Commit before starting.
- Plan mode for anything structural. Show the plan before editing.
- Run tests before declaring a slice done.
- Brian pushes from his local clone. Stage and summarize, do not assume the push happened.
