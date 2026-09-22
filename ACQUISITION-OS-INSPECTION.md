# Acquisition OS — CURRENT-STATE INSPECTION

**Repo:** dylanlamb19/lamb-ascension-engine (private)  
**Inspected:** 2026-09-22 ~12:25 CDT  
**Branch tip used:** `main` @ `1a2d39382354e4634ffb9e58ec03656167a4c15a`  
**Open PR #2:** `linkedin-agent-in-app` (do not clobber)  
**This milestone branch:** `acquisition-os-milestone` from main tip above  

## 1. Current production SHA

| Source | Value |
|--------|--------|
| Main tip | `1a2d393` — fix(ux): Find Clients vertical uses native select on mobile (2026-09-22 12:18 CDT) |
| Prior tip | `86d7b57` Ara voice / booking invariant; `03beb67` owner-provided prospect info; `533f7dcf` Sentinel |
| Vercel deploy | hearth12 team scope returned **403** from Vercel MCP — could not read `VERCEL_GIT_COMMIT_SHA` / production deployment. Prod host remains `lamb-ascension-engine.vercel.app` (hearth12). Treat main tip as intended prod source until deploy API is re-authed. |
| Migrations on main | `0001`…`0017_sentinel.sql` — **no 0018 on main** (0018 LinkedIn lives only on PR #2 branch) |

## 2. Prospect schema

- **DB** (`migrations/0003_prospects.sql`): `prospects(uid,user_id,client_id,provider,provider_place_id,website_domain,name,vertical,city,stage,research_status,suppressed,payload jsonb,…)`
- **App type** (`src/lib/review-brief.ts` `Prospect`): full JSON payload — contacts, findings, facts, socials, outreach, history, owner_notes, phone/website/contact_page sources, readiness, is_demo, suppressed, stages via `pipeline-copy.ts` STAGE map.
- Place uniqueness: `0016_place_id_unique.sql`.

## 3. Qualification states

- `src/lib/prospects/qualify.ts`: FIT headlines `GOOD FIT` | `POSSIBLE FIT` | `NEED MORE INFORMATION` from `readiness` / `fit` + research.
- Does **not** invent revenue/ad spend/ROAS. Unknown list explicitly includes revenue/profit/ad budget/retainer capacity.
- Website research: `done` | `unavailable` | `not_started`.

## 4. Reach / contact states (pre-milestone)

- `src/lib/prospects/reach.ts` `ReachKind`: `READY_TO_CONTACT` | `NEEDS_CONTACT_INFO` | `NEEDS_RESEARCH` | `BLOCKED`
- **Gap vs Acquisition OS:** `READY_TO_CONTACT` currently fires on **usable email OR named person + listing/DM phone**. Phone/LinkedIn/form alone should **not** count as autonomous contactability.
- Suppressed / DNC → `BLOCKED` only (no separate `SUPPRESSED` owner label).
- Owner-provided email already: provenance `OWNER PROVIDED`, `email_status: unverified` (not falsely VERIFIED) — see `owner-edit.ts` + reach tests.

## 5. Contact / evidence structure

- `contactFields()` / `ContactField`: label, value, `Provenance` (`VERIFIED` | `FOUND PUBLICLY` | `ENRICHED` | `OWNER PROVIDED` | `UNKNOWN`), source.
- Learn More UI: `prospect-reach.tsx` + owner edit Save/Cancel; history `PROSPECT_INFORMATION_UPDATED`.
- Evidence findings on payload; Sentinel inspect-only ledger.

## 6. Pipeline filters / queues

- `view-filter.ts`: validated VIEW filter only (no SQL). Supports fit/research/reach/stage/hasEmail/excludeTest/excludeDemo/lastDiscovery/sort.
- Default owner Pipeline filter today: **empty** (`useState<ProspectViewFilter>({})`) → shows **all** prospects including TEST/DEMO/Needs Contact/Needs Research backlog.
- **Gap:** no derived queues (`ACTIVE_PIPELINE`, `NEEDS_CONTACT_INFORMATION`, …).

## 7. First-contact approval

- Guard (`mail/guard.ts`): DNC / UNSUBSCRIBED / BOUNCED / NOT_ALLOWLISTED / NOT_APPROVED / rate / hours.
- First email needs owner approval (`firstApproved`) unless MANUAL/VOICE path with confirm.
- Test Mode **default ON** (`0006_test_mode.sql`); allowlist required for any send.
- Confirm-send phrases in voice intents; outreach desk Confirm send UX.

## 8. Worker behavior

- Jobs: `src/routes/api/jobs/outreach.ts`, `sentinel.ts`
- `live.server.ts`: `sendLive`, `runDueFollowups`, `syncRepliesForUser`, `tickOutreachWorker` — reply cancels sequences; UNSUBSCRIBE → suppressed + DNC.
- Heartbeats: `0007_worker_heartbeat.sql`.

## 9. Suppression / DNC / unsubscribe / bounce

- Prospect `suppressed` + stage `Do Not Contact`.
- Guard codes: DNC, SUPPRESSED, UNSUBSCRIBED, BOUNCED.
- Sentinel: `DNC_SEQUENCE_ACTIVE`, `BOUNCE_FUTURE_SEND_SCHEDULED`, `FOLLOWUP_NOT_CANCELLED_AFTER_REPLY`.
- **Gap:** no first-class cooldown table; bounce/unsub mostly via reply classification + guard flags at send time.

## 10. Google Places discovery

- `src/lib/discovery/*` — Places Text Search, usage caps (`discovery_usage`), `hitToProspect`, Find Clients UI + `FindVerticalField` mobile select on main.
- Accounting reserved before API call. No invented emails on discover.

## 11. Owner-provided prospect editing / provenance

- `owner-edit.ts` / `owner-edit-actions.ts` / Ara `UPDATE_PROSPECT_INFORMATION`
- Allowlisted fields; syntax validate email/phone/URL; provenance always OWNER PROVIDED; **does not auto-send**; recomputes `reachKind` after save.

## 12. Sentinel invariants / codes

- Inspect-only (`0017_sentinel.sql`, `codes.ts`, `invariants.ts`). Auto-Fix OFF.
- Codes include calendar/gmail/places/worker/ara_voice/pipeline/test_mode/DNC/bounce/duplicates.
- **Gap:** no contactability-mismatch or pipeline-queue invariant codes yet.

## 13. Autopilot / acquisition / batch / cooldown tables

- Searched migrations + lib naming: **no** `autopilot`, `acquisition_os`, `cooldown`, or batch auth snapshot tables on main.
- Closest: `outreach_sequences`, `scheduled_followups`, `outreach_usage`, test flow tables, LinkedIn agent tables **only on PR #2** (`0018_linkedin_agent.sql` — must not collide; this milestone uses **`0018_acquisition_contactability.sql`** only if LinkedIn not merged; if PR #2 merges first, renumber).

## 14. What’s already implemented vs Acquisition OS plan

| Plan part | Already on main | Still missing |
|-----------|-----------------|---------------|
| Part 1 Contactability (EMAIL-authoritative) | Partial reach + owner email provenance + guard | EMAIL-only CONTACTABLE; SUPPRESSED label; cooldown/active-outreach in evaluator; server snapshot |
| Part 2 Clean Pipeline | Filter engine + chips | Default ACTIVE queue; hide TEST/DEMO/backlog; secondary queues UI |
| Part 3 Auto-route qualified no-email | Reach often → NEEDS_CONTACT_INFO | Explicit queue routing + post-qualify route helper |
| Part 4–5 Autopilot / worker first-contact | Test Mode + approved first send + worker followups | Autopilot batching, Home/brief acquisition surfaces |
| Part 6 CONTACT_ELIGIBLE_PROSPECTS | — | Allowlisted tool + snapshot tables + Test Mode gate |

## Constraints carried into implementation

- TEST MODE STAYS ON; no real autonomous first contact for acceptance.
- Never invent emails/revenue/ad spend/ROAS/lead counts.
- LinkedIn (in-app or soft-cap) does **not** count as autonomous contactability.
- Prefer surgical patches; do not redesign Owner Desk; do not clobber PR #2 LinkedIn dock.
