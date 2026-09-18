# Data architecture: safe migration plan (Sales OS localStorage → one server-side data model)

## What's actually true right now

There are two separate applications sharing one repo, not one app with a legacy folder:

1. **OwnerDesk** (`src/components/owner-desk.tsx`) — the currently-published app. All prospects,
   pipeline stage, outreach drafts, and enrichment usage live in the BROWSER, in `localStorage`
   (`la_companies_v5`, `la_enrich_usage_v1`). There is no server-side prospect table. Nothing here
   persists across devices or survives clearing browser storage.
2. **`artifacts/lead-engine`** — a separate FastAPI/SQLAlchemy/SQLite app with its own auth, its
   own `Company`/`Contact`/`Score` tables, and the only code that actually calls Google Places for
   live prospect discovery. It is not deployed as part of OwnerDesk and OwnerDesk does not call it.

Confirmed: Google Places live search is NOT connected to the published OwnerDesk. The "Find
Clients" voice/button path in OwnerDesk opens the manual Add Client form and says so directly —
"Live bulk find still needs a Places key." Only the FastAPI artifact has a working Places
integration.

Real, server-side Postgres (Neon-backed in production, PGLite-backed locally with no extra setup)
already exists and is already used by Better Auth — it's just not used for prospect/pipeline data
yet.

## Why not a rewrite

OwnerDesk's data shape (`Prospect`, outreach packs, voice state) is actively developed and tested
(`review-brief.test.ts`, `orchestrate.test.ts`, `outreach.test.ts`, `voice.test.ts` all assume it).
The FastAPI artifact's schema is older and simpler. Porting OwnerDesk's richer shape onto the
FastAPI schema, or vice versa, in one pass risks breaking a UI and a test suite that both work
today. The lower-risk path is: keep OwnerDesk's TypeScript data shape as the canonical one (it's
the one being actively built on), and move where it's STORED — browser to Postgres — without
changing what it looks like.

## The plan, in stages (each stage independently shippable and safe to stop after)

**Stage 1 — schema, no behavior change.**
Add `migrations/0003_companies.sql` etc. mirroring the `Prospect` type in `review-brief.ts`
almost field-for-field, plus `outreach_usage`/`enrichment_usage` (already added this pass). Every
table gets a `user_id text not null` column (per the auth skill's own convention). Ship this with
nothing reading from it yet — pure additive migration, zero risk.

**Stage 2 — dual-write.**
`loadCompanies()`/`saveCompanies()` in owner-desk.tsx start writing to BOTH localStorage (still
authoritative for reads) and a new `syncCompaniesFn` server function (fire-and-forget, failures
logged not surfaced). This is the stage that proves the server round-trip actually works, with
localStorage as a safety net the whole time — if the server write is broken, nothing the owner
sees changes.

**Stage 3 — server becomes the read source.**
Flip `loadCompanies()` to read from the server (via a server function scoped by
`context.userId`) on mount, falling back to the existing localStorage cache only when the network
call fails (so the desk still works offline/mid-deploy). Keep writing to localStorage as a cache
for that fallback, not as the source of truth anymore.

**Stage 4 — retire localStorage as a data store.**
## Paid enrichment (Hunter) — reservation before spend

Implemented: server-side `tryReserveEnrichment` in a SQL transaction (per-user
cap **and** `__global__` app-wide daily cap). `deepResearchFn` qualifies for
free, then reserves, **then** calls Hunter. A failed Hunter call still consumes
the reservation (no refund) so retries cannot multiply provider spend.


**Separately, whenever it's prioritized — connect Places.**
Either port `app/services/providers/places.py`'s logic into a `createServerFn` in this app (real
work, but self-contained — it's a single provider adapter), or explicitly decide OwnerDesk's
"Find Clients" stays manual-only and remove the "still needs a Places key" wording so it stops
implying a connection that was never made. Either is fine; leaving the current wording as-is,
implying it "almost works," is the one option I'd avoid.

## Status (this pass)

Implemented:

- `migrations/0003_prospects.sql` — prospects, discovery_usage, search_cache, activity_log
- Server-side list/import/upsert scoped by authenticated `userId`
- One-time localStorage → server import with dedupe (uid / Place ID / website+city)
- Server is the source of truth after a successful load; localStorage is cache/fallback
- Plain error if save fails: local copy stays
- Google Places Text Search ported into this app (`src/lib/discovery`). FastAPI is not used.
- Voice “Find me 25 SaaS companies in Dallas” uses the same `findClientsFn` as the button

