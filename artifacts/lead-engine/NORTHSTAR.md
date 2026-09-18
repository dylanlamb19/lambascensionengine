# Lamb Ascension — North-Star Product Architecture

**Status:** Design constitution. Not an implementation ticket.  
**Lead Engine (Sales OS) Phases 1–3 are live and must not be rebuilt.**  
**Client Delivery OS is not started.**

Economic target (planning only, not a forecast): supervise ~10 clients × ~$10k/mo retainer without a linear headcount increase. Ad spend is client-paid and separate.

Operating law:

1. Automate normal operations.
2. Escalate exceptions.
3. Human approval for high-risk actions.
4. Never invent metrics, companies, or revenue.
5. Never let an LLM spend money unrestricted.
6. Official APIs only. Credentials server-side. Modular providers.
7. Deterministic software for facts and math. AI for drafts and interpretation.
8. **Owner Mode is the default UI.** Show what happened, why it matters, what is recommended, and what to press. Technical detail lives behind See more / Advanced. If a non-technical owner cannot know what to do in 10 seconds, the screen is not done.

End state: **an AI-operated customer-acquisition platform that you supervise** — sales + strategy approval + relationships + exceptions.

---

## 1. Proposed architecture

One product, two operating systems, one identity graph.

```
┌─────────────────────────────────────────────────────────────┐
│                     CONTROL ROOM (you)                       │
│  health · MRR · pipeline · approvals · exceptions · calls    │
└───────────────┬─────────────────────────────┬───────────────┘
                │                             │
        SALES OS (now)                 CLIENT DELIVERY OS (later)
        Lead Engine                    fulfillment + monitoring
                │                             │
                └──────── companies ──────────┘
                          clients
                          knowledge base
                          approval_items
                          audit_log
```

**Layers (keep for both OS):**

| Layer | Job | Rule |
| --- | --- | --- |
| Presentation | Dark/gold Control Room + Sales + Client desks | Dense, not a generic admin |
| Application | FastAPI (existing) + job workers later | Sync jobs OK until volume needs a queue |
| Domain | Companies, contacts, scores, audits, opportunities, clients, campaigns, creatives, reports, approvals | Shared IDs |
| Providers | Places, PageSpeed, Google Ads, Meta, GA4, HubSpot, Gmail… | Adapter protocol already started |
| Policy | Autonomy level, spend caps, kill switch, idempotency | Evaluated **before** any write API |
| Evidence | Every number has `source` + `checked_at` | `CLIENT_PROVIDED` / `PLATFORM_VERIFIED` / `CALCULATED` / `UNKNOWN` |

**Runtime later (not now):** Postgres when SQLite hurts; Redis/queue for monitors; object storage for creatives; one worker process for scheduled monitors. Stay on the current FastAPI app until Delivery OS Phase D1.

AI is a **function with structured I/O**, not a swarm of chatbots. Prompt sees verified JSON only. Output is a typed proposal (`ProposedAction`) that cannot execute itself.

---

## 2. Relationship between Sales OS and Client Delivery OS

Shared root: `companies`.

| Sales OS | Handoff | Delivery OS |
| --- | --- | --- |
| Prospect → research → score → outreach → call → proposal | Stage `Won` | `clients` row created from same `company_id` |
| Website audit, ICP, opener drafts | copied as **historical evidence**, not live ads truth | Re-audit with **connected accounts** |
| Opportunity retainer / package | becomes `engagement` (Acquire/Convert/System) | Billing + scope live here |
| Do-not-contact, suppression | remains in force | Never re-enroll as prospect |

Handoff is explicit: **Promote to client** (human). No auto-convert. Sales data is frozen snapshots. Delivery data comes from OAuth’d platforms.

Control Room reads **both** OS. Approval Inbox is **one queue** (`approval_items`) for outreach *and* budget/creative/launch.

---

## 3. Database additions (future — do not migrate yet)

Keep existing tables. Add, don’t replace.

**Identity / tenancy**

- `users`, `roles`, `permissions` (owner vs operator vs read-only)
- `companies` (exists)
- `clients` (`company_id`, status, start_date, package, retainer, kill_switch)
- `engagements` (package, monthly_retainer, ad_budget_ceiling)

**Knowledge**

- `client_profiles` (services, areas, offers, voice, legal restrictions)
- `client_metrics` (`key`, `value`, `source`, `as_of`) — never AI-written
- `assets` (logos, creatives, testimonials) + `source`
- `experiments` (hypothesis, result, winner/loser)
- `knowledge_entries` (approved claims / prohibited claims)

**Delivery**

- `ad_accounts` (network, external_id, oauth_token_ref, status)
- `campaigns`, `ad_groups`, `ads`, `ad_sets`, `creatives` (external IDs + last_sync)
- `performance_snapshots` (grain: campaign/ad/day; **platform verified**)
- `lead_events` (source, quality, CRM id)
- `revenue_events` (CRM/client provided only)
- `landing_pages`, `page_experiments`
- `tracking_checks` (pixel/gtag/GTM health)

**Operations**

- `proposed_actions` (type, autonomy_level, payload, evidence_refs, before, after)
- `approval_items` (status: pending/approved/rejected/modified)
- `executed_actions` (who/what, result, reversible, rollback_ref)
- `audit_log` (immutable append)
- `alerts` (severity, rule_id, client_id)
- `reports` (weekly/monthly, numbers_json, narrative_draft)

**Sales OS already has:** companies, contacts, research_snapshots, website_audits, scores, outreach_messages, activities, follow_ups, opportunities, settings, search_cache, api_usage.

**Invariant:** `is_demo` must remain visible. Production dashboards never look “real” with synthetic numbers.

---

## 4. Google Ads API integration architecture

**Not now.** When built:

1. Google Cloud project + Ads API developer token + OAuth (user or manager MCC).
2. Store refresh tokens encrypted server-side (`ad_accounts.oauth_token_ref`), never in JS.
3. Adapter: `providers/google_ads.py` implementing `AdsNetwork`:
   - `read_account`, `list_campaigns`, `search_terms`, `performance(date_range)`
   - `mutate(ops)` **only** after Policy Gate
4. Read path (Level 0–1) ships first: snapshots into `performance_snapshots`.
5. Write path: mutate types allowlisted (pause ad, add negative exact, +/− budget **within cap**).
6. Idempotency key per proposed action. Retry safely.
7. Sandbox/test accounts before any client MCC.
8. Never scrape the Ads UI.

Policy examples: max +15% budget per 7 days unless approved; cannot create new campaigns at Level 2; cannot change geo at Level 2.

---

## 5. Meta Marketing API integration architecture

Same adapter shape: `providers/meta_ads.py`.

1. Meta Business login / system user later for agencies.
2. Scopes least-privilege (ads_read first, ads_management only when writes exist).
3. Read: campaigns, ad sets, ads, insights, creative IDs, frequency, spend, results.
4. Writes allowlisted: pause ad, duplicate creative into existing ad set, budget within cap.
5. Creative generation is **draft assets in our DB**, not auto-publish.
6. Advantage+ / restricted verticals (housing, credit, employment, health) force Level 3.
7. Ad Library remains a **public research** source for Sales OS, not proof of spend.

---

## 6. CRM / attribution architecture

Funnel stored as events, not a vibe:

`AD → CLICK → LEAD → QUALIFIED → APPOINTMENT → OPPORTUNITY → CUSTOMER → REVENUE`

| Stage | Typical source | Label |
| --- | --- | --- |
| Click / impression / spend | Google/Meta insights | PLATFORM_VERIFIED |
| Lead | Form, call tracking, CRM | PLATFORM_VERIFIED or CLIENT_PROVIDED |
| Qualified / appointment | CRM (HubSpot later) | PLATFORM_VERIFIED if synced |
| Customer / revenue | CRM deal won / invoice | CLIENT_PROVIDED or PLATFORM_VERIFIED |
| Close rate, job value | Onboarding form | CLIENT_PROVIDED until proven |

**Rule:** Optimization objective is `cost_per_qualified` / `cost_per_customer` / `ROAS` **only if those events exist**. Else show CPL and **UNKNOWN downstream**. Never invent revenue to make Campaign B “win.”

Attribution model v1: last-click + CRM timestamp join by phone/email/gclid/fbp when present. Conflicts stay `UNKNOWN`, not guessed.

Call tracking + HubSpot are adapters, same as ads.

---

## 7. Agent architecture

Not a fleet of unsupervised LLMs. **Services + one model caller.**

| Name | Kind | Input | Output |
| --- | --- | --- | --- |
| Prospect Research | Deterministic (+ AI later for copy) | Places + audit | facts, score |
| Outreach | AI draft, human approve | verified fields | messages `draft` |
| Sales Prep | AI on verified audit | company + audit | call notes, not fake ROAS |
| Onboarding | Forms + parsers | client uploads | profile + metrics with sources |
| Google Ads Analyst | Deterministic stats + AI narrative | snapshots | alerts + `ProposedAction` |
| Meta Ads Analyst | same | snapshots | same |
| Creative Strategist | AI generation | KB + winners | briefs/copy **draft** |
| Landing Page Analyst | Deterministic + AI copy | URL + offer | page draft |
| Lead Quality Analyst | Rules on CRM fields | lead_events | quality flags |
| Attribution Analyst | SQL joins | events | tables, UNKNOWN gaps |
| Reporting | Numbers from DB + AI prose | snapshots | report draft |
| Client Communication | AI draft | report + KB | email draft |
| Anomaly Monitor | **Statistical rules first** | time series | alerts (LLM optional explain) |

Shared bus: database rows, not chat logs. Each agent writes `activities` / `proposed_actions`. No agent holds the Ads write token except the **Execution Service** after Policy Gate + Approval.

---

## 8. Approval / permission architecture

**One inbox.** Object: `approval_items`.

```
APPROVAL REQUIRED
Client: ABC Roofing
Action: Increase Search budget 15%
Level: 3
Reason: qualified CPA below target 14 days (PLATFORM_VERIFIED)
Before: $200/day  After: $230/day
Evidence: [snapshot ids]
[Approve] [Reject] [Modify]
```

Roles:

- **Owner (you):** all approvals, kill switch, billing
- **Operator (future):** Level 1 only if granted
- **System:** Level 2 only if policy allows and kill switch off

Outreach already has REVIEW / EDIT / APPROVE — reuse that state machine (`draft → approved → sent`). Delivery actions: `proposed → approved → executed → verified`.

Configurable per client: which action types auto-Level-2 vs always-Level-3.

---

## 9. Safety / guardrail architecture

Policy Gate runs **before** every mutate:

1. Client `kill_switch`?
2. Action type allowlisted for this autonomy level?
3. Budget delta ≤ `max_pct_change` and ≤ `max_abs_change` and within `daily_spend_ceiling`?
4. Duplicate / idempotency key seen?
5. Rate limit / API error budget OK?
6. Regulated vertical or new claim? → force Level 3
7. Human token present for Level 1/3?

Hard rules:

- LLM **cannot** call Ads APIs. It emits JSON. Execution Service validates schema + policy.
- Hallucinated budget is dropped (schema: numbers must match snapshot IDs).
- Rollback stored when API supports it; otherwise compensating pause.
- Full `audit_log`: what, why, who/what, data refs, before, after, time, result.
- Secrets only in env / secret manager. `.env.example` already the pattern.
- SSRF rules from Phase 3 apply to any future crawler.

A model output must never be sufficient to spend thousands.

---

## 10. Estimated infrastructure / API / AI cost per client / month

Order-of-magnitude USD, 2026, **operating one active Ads+Meta client** (not Sales OS prospecting):

| Item | Low | Typical | Notes |
| --- | --- | --- | --- |
| Hosting (app + DB + worker) | $5 | $15 | Amortized across clients |
| Google Ads API | $0 | $0 | Standard access; your time/token, not per-call $ |
| Meta Marketing API | $0 | $0 | Same; app review cost is time |
| GA4 / GSC | $0 | $0 | |
| PageSpeed / fetch | $0 | $1 | |
| LLM (reports, creative drafts, explanations) | $8 | $25 | Cap tokens; weekly report + 2 creative batches |
| Call tracking / LP hosting (if used) | $0 | $20–80 | Vendor, optional |
| **Total software/AI (not ad spend)** | **~$15** | **~$40–120** | Ad spend is client-paid |

Sales OS Places costs remain as Phase 2: ~$0.11 per 50-company search after free tier; enrichment later and gated.

Cap LLM: no model call on every anomaly tick — rules first, AI on demand / daily digest.

---

## 11. Safe to fully automatic (Level 2) — eventually, after soak

Only with caps, logs, and kill switch:

- Pause an ad/ad group that is **disapproved** or **landing page 5xx** (after verified check)
- Add **exact** negative keywords already on an approved waste list
- Rotate in a **pre-approved** creative that already ran for this client
- Re-fetch performance snapshots
- Re-run website / tracking health pings
- Draft (not send) weekly internal summaries
- Cache/research refresh inside Sales OS

Still automatic only after a burn-in period at Level 1.

---

## 12. Remain approval-based (Level 1 or 3)

- Any budget increase
- New campaigns / major restructure / new geos
- New offers or claims
- Publishing landing pages
- Sending first-touch or client-facing email
- Launching new Meta creatives (until a whitelist exists)
- Bidding strategy changes
- Billing, contract, refund
- Regulated verticals (legal, health, finance, housing)
- Changing conversion actions
- Anything the API cannot roll back easily
- Outreach from Sales OS (already designed this way)

---

## 13. Development phases (correct order)

**Do not skip. Test each. No fake APIs.**

### Sales OS (continue existing roadmap)

| Phase | Status | Outcome |
| --- | --- | --- |
| 1 Full-stack + DB + UI | Done | Auth, pipeline, scores |
| 2 Places Lead Finder | Done | Real companies or empty |
| 3 Website auditor + Stage B score | Done | Deterministic audits |
| 4 AI analysis + outreach drafts | Next | Labelled AI, approve-to-send |
| 5 Gmail/Calendar/HubSpot + follow-ups | Later | Real OAuth |
| 6 Call prep + proposal + analytics | Later | No invented ROAS |

### Delivery OS (after Sales OS can close a real client)

| Phase | Outcome |
| --- | --- |
| D0 Schema + Control Room shells + approval table | Empty clients OK; no fake KPI |
| D1 Onboarding portal + knowledge base + metric sources | Client-provided data only |
| D2 Google Ads **read** + snapshots + anomaly **rules** | Observe/recommend |
| D3 Meta **read** + creative performance | Observe/recommend |
| D4 Attribution events + CRM read | UNKNOWN until connected |
| D5 Reporting drafts + comms drafts | Numbers from DB |
| D6 Allowlisted Level-2 pauses/negatives | Kill switch live first |
| D7 Creative engine + LP drafts | Publish still approved |
| D8 Budget recommendations (never auto-raise first) | Level 3 |
| D9 Revenue-aware optimization | Only with CRM revenue events |

**Immediate next code phase remains Sales OS Phase 4** when you say go. Delivery OS stays paper until then.

---

## Non-negotiables for every future PR

- Preserve Lead Engine Phases 1–3 behavior.
- Provider adapters, not scrapers.
- No client-side secrets.
- No synthetic dashboards that look like production performance.
- DEMO rows labeled DEMO.
- LLM output is a proposal, never an executor.
- Missing data = UNKNOWN.
