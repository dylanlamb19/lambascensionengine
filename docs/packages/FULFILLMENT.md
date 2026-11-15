# Package fulfillment

How Lamb Ascension's ten service packages run inside Lamb Ascension Engine, and what is still required before the engine can be sold to other marketers as a multi-tenant subscription.

This scaffold is **off**. `FLAGS.PACKAGE_FULFILLMENT` is `false`. While it is off, the Client Package Fulfillment tab is not rendered, workspaces are not opened, and pipelines do not tick. Nothing here sends mail, changes outreach caps, suppression, or autopilot gates, or charges a card.

The SQL in `migrations/0015_client_packages.sql` is a file only. It was not applied to a hosted database from this change.

## Two products, one engine

The engine today is a **sales desk for one owner**: prospects, research, outreach, and the owner's calendar. The ten packages are a **delivery product** a marketer runs for their own clients (roofers, HVAC, and similar). Those clients are not prospects.

| | Sales desk (live) | Package fulfillment (this scaffold, off) |
| --- | --- | --- |
| Who | The Lamb Ascension owner | A marketer workspace |
| People in the pipeline | Prospects | That marketer's paying clients |
| Mail | Owner Gmail, `canSend`, daily caps, suppression | Not called. Missing mailbox escalates to needs human |
| Money | Owner-entered retainer on a Won prospect | Test-mode plan plus manually recorded setup and monthly state |

## Tenant model

A **workspace** is the tenant. Its id is derived from the signed-in marketer's user id (`workspaceIdForUser`). It is not typed into a form.

Every client, enrollment, and step carries `tenantId`. Reads, ticks, kill switches, payment marks, and the fulfillment tab all take that id.

- Marketer A cannot list, open, tick, or stop Marketer B's clients.
- Estimate Follow-Ups on A's client does not satisfy the add-on rule for B, even if the client name matches.
- `replaceTenant` drops any row in a write that claims a different tenant.
- Browser storage is keyed `la_package_fulfillment_v1:<tenantId>`, then sliced again on load.

The desk passes `user.id` from the session into `startMarketerOnboarding`. That function is the self-serve onboarding hook: idempotent per user id, opens a workspace, and records a test plan. It does **not** create a login. Public signup stays disabled (`disableSignUp` is unchanged, and the desk still has no account-creation form).

## Test plans

`src/lib/packages/plans.ts` is scaffolding only.

| Plan | Client cap in the scaffold | Billing |
| --- | --- | --- |
| Test trial | 3 | `billingMode: "test"`. No card. |
| Test operator | 25 | Same |
| Test agency | No scaffold cap | Same |

Choosing a plan sets `planStatus` to `test_trial` and `onboarding` to `test_plan_selected`. There is no Stripe id, no secret, and no charge function. The subscription table in the migration file has `billing_mode` constrained to `'test'`.

Client setup fees and monthly payments are **recorded or waived by hand** (`unrecorded`, `recorded`, `waived`). Recording them does not collect money.

## What already exists, and what this scaffold refuses to reuse

| Capability | Where it lives | Use for delivery |
| --- | --- | --- |
| Lead capture | Prospect add form, research findings for forms and CTAs | Pattern only. A client's inquiry form is not a prospect row. |
| Outreach worker | `src/lib/mail/worker.ts`, `/api/jobs/outreach` | Do not call. The production scheduler for this repo is retired. |
| Follow-up sequences | `buildSequence` (3, 7, and 12 days), `outreach_sequences` | Do not enroll a client's leads. The package only records a cadence. |
| Send gates | `canSend`: DNC, unsubscribe, bounce, hours, caps, test allowlist, approval | Untouched. Package code does not import them. |
| Suppression | `prospects.suppressed`, Do Not Contact | Untouched. |
| Autopilot | No module with this name. Automation is the outreach worker plus `canSend`. | Untouched. |
| Prospect detail | Owner desk, `review-brief.ts` | Sales only. |
| Daily brief | `get_daily_tasks`, attack briefing | Sales tasks. The weekly package summary is a draft and is not emailed. |
| Ara | Voice tools, computer guard | No new send or book tool. |
| Sentinel | Not in this recovery branch | `sentinelPackageHealth` is the per-tenant report a future Sentinel should read. Calling it does not start or stop pipelines. |
| Landing pages | Design Director edits the owner's home chrome. `/book/$token` books a sales call. | Not a client landing page. |
| Tracking checks | `review-brief` findings (`gtag`, `gtm`, pixel, ads conversion) | The idea of a check. This scaffold does not fetch client sites. |
| Reporting | `verifiedMrr` from owner-entered fees | Package report steps say spend and conversions are UNKNOWN. |
| Calendar | Owner Google Calendar | Appointment reminders must not write it. |

## Tracker

For one workspace, an enrollment stores:

- Package id, including the bundle as one purchase whose steps are the four included packages
- Status: `active`, `paused`, or `cancelled`
- Kill switch
- Setup fee and monthly amount copied from the catalog at purchase time
- Setup and monthly payment state (manual)
- Start date and renewal date (one month later)
- Deliverable status, derived from the step: not started, in progress, fulfilled, or blocked

The desk tab is named exactly **Client Package Fulfillment**. It is hidden while the flag is off. When the flag is on:

1. The landing view lists that workspace's clients and the packages each one purchased.
2. A client opens their page, with one tab per purchased package under their name.
3. A package tab lists each step with status (`pending`, `running`, `done`, `failed`, `needs human`), timestamps, log lines, output, and the next scheduled run.
4. The desk ticks every 2 seconds while it is open and the flag is on. A step moves to `running`, then to `done` or `needs human`, without a separate start button.

There is no production cron. A closed browser does not keep ticking. Registering a cron is leftover work, and it must stay disabled until the flag is on and the send path is a separate, gated client mailbox.

## Pipelines

`tickFulfillment(state, tenantId, now, { enabled })` is the runner.

- `enabled: false` (the flag) returns the same state.
- Jobs are idempotent: the step id is `{enrollment}:{source package}:{step}`, and a finished immediate step is not run again.
- A throw retries up to 3 times, then the step is `failed`.
- A missing integration becomes `needs human` and does not call an API.
- A credential port that says "present" still escalates, because no provider adapter is wired.
- Kill switch, pause, and cancel stop that enrollment only.
- Bookkeeping steps can finish. They write a checklist, a draft slot, or a report shell. They do not invent ad metrics.

### 1. Lead Follow-Up — $350/mo + $500 setup

**Trigger.** A purchase is recorded for this workspace.

**Steps.** Record the inquiry route (bookkeeping). Acknowledge, then notify the team (client mailbox). Record the unresponsive cadence (bookkeeping; sales sequences are not started). Weekly summary draft (bookkeeping, not emailed).

**Needs.** A client mailbox that is not the owner's sales Gmail.

**Autonomy.** Needs integration. Orchestration runs; sends do not.

### 2. AI Visibility Optimization — $600/mo

**Trigger.** Purchase, then a monthly cycle.

**Steps.** Monthly check of service info, FAQs, and structured data (needs the client's site; nothing is fetched today). Draft budget of 2 page updates (bookkeeping, unpublished). Publish (needs CMS).

**Autonomy.** Needs integration.

### 3. Google Advertising — $750/mo

**Trigger.** Purchase. One Google Ads account. Ad spend is the client's and is not set here.

**Steps.** Setup checklist and keyword shell (bookkeeping). Conversion check and monthly adjustments (Google Ads API). Monthly report shell with UNKNOWN spend until the API returns numbers.

**Autonomy.** Needs the Google Ads API.

### 4. Meta Advertising — $650/mo

**Trigger.** Purchase. One Facebook and Instagram ad account.

**Steps.** Checklist and copy notes (bookkeeping). Creative variations and monthly adjustments (Meta Marketing API, existing assets only). Report shell with UNKNOWN results.

**Autonomy.** Needs the Meta Marketing API.

### 5. Lead Generation — $500/mo + $500 setup

**Trigger.** Purchase. One landing page. No guaranteed lead count. Ad spend stays separate.

**Steps.** Draft slot (bookkeeping, unpublished). Form and routing (needs a host). Tracking check (needs access; no tag is installed). Monthly test log.

**Autonomy.** Needs a page host and tracking access.

### 6. Estimate Follow-Ups — $200/mo + $250 setup

**Trigger.** Purchase only when the same client, in the same workspace, already has active Lead Follow-Up.

**Steps.** List outstanding estimates (needs an estimate source). Reminder (client mailbox). Personal-response alert (bookkeeping). Step ids do not overlap Lead Follow-Up.

**Autonomy.** Needs an estimate source and a mailbox.

### 7. Review Requests and Google Business Profile Care — $150/mo

**Trigger.** Purchase, then a completed job. Cap of 2 profile updates in a month.

**Steps.** Wait for a job feed. Request a review. Check profile info. Publish up to 2 updates.

**Rules in the step text.** Reviews are not purchased and are not filtered. Nothing is published without the Google Business Profile API.

**Autonomy.** Needs a job feed, a mailbox, and the Google Business Profile API.

### 8. Appointment Reminders — $100/mo + $150 setup

**Trigger.** Purchase. One booking calendar.

**Steps.** Bind that calendar, then confirmations and reminders.

**Rule.** The owner sales calendar is not changed.

**Autonomy.** Needs the client's booking calendar.

### 9. Office Automation — from $400/mo + $500 setup

**Trigger.** Purchase of one workflow slot.

**Steps.** Agree the workflow (document collection, or handing a sold job to the office, are examples). Run it.

**Autonomy.** Needs a person to name the one workflow. The slot opens by itself.

### 10. Google, Meta and AI Package — $2,500/mo, no setup

**Trigger.** One purchase. It includes packages 2, 3, 4, and 5. The monthly total matches the sum of those four. Their $500 lead-generation setup fee is waived.

**UI.** One package tab. Steps are grouped under the four included names.

**Autonomy.** Same integrations as the four parts.

## Reporting a client would see

Not sent today. When a report step finishes, the output is a shell: platform numbers stay UNKNOWN until an API snapshot exists. That matches the sales-desk rule that missing data is not invented. A later client email would be its own draft, not the owner's outreach template.

## Proposed tables

`migrations/0015_client_packages.sql`:

- `marketer_workspaces` — one row per marketer, unique `owner_user_id`
- `marketer_subscriptions` — plan id, status, `billing_mode` forced to `test`
- `service_clients` — primary key `(workspace_id, id)`
- `package_enrollments` — status, kill switch, fees, manual payment state, dates, included package ids
- `package_step_runs` — status, attempts, next run, output
- `package_step_logs` — append-only notes

Every delivery row is keyed by `workspace_id`. There is no payment-provider column.

The running desk uses the in-memory and browser store above. It does not query these tables, so the feature does not depend on the migration having been applied.

## What is left before this is a sellable multi-tenant SaaS

1. **Marketer accounts.** Public signup is still disabled on purpose. The onboarding hook must be called only after a verified session exists. Turning on self-serve registration, email verification, and password reset is separate work and must not weaken the current owner-desk signup lock by accident.
2. **Server-side isolation.** Today isolation is in the library and the browser key. The hosted app still needs repositories that take `workspace_id` from the verified session, reject a client-supplied tenant id, and use Postgres row security or equivalent so one marketer cannot read another workspace by calling SQL.
3. **Apply the migration on purpose.** This file is not applied here. Production should apply it only when the flag is about to be turned on.
4. **Real subscription billing.** Test plans do not invoice, tax, prorate, retry a card, or dunning. A provider, keys, and webhooks stay out of this repo until that project exists. Secrets must stay server-side.
5. **Seats and invites.** A workspace has one owner user id. There is no staff seat, role, or invite.
6. **Per-tenant connections.** Google Ads, Meta, Google Business Profile, a client mailbox, CMS, booking calendar, estimate source, and job feed are all missing. They must be stored per workspace, not in the owner's sales OAuth row.
7. **A gated send path.** Client acknowledgements, reminders, and review requests need their own caps and suppression. They must not call `canSend` in a way that changes the sales gates, and they must not send through the sales outreach worker.
8. **Unattended schedule.** The 2-second tick runs only while the signed-in desk is open and the flag is on. A cron must be added later, and it must no-op while the flag is off. Do not revive `.github/workflows/outreach-worker.yml`.
9. **Sentinel.** The health report is ready for one tenant. Sentinel itself is not in this branch, and nothing here disables it.
10. **Client-facing report delivery, landing-page hosting, and structured-data edits.** Draft slots exist. Publishing does not.
11. **Custom domains, audit export, and tenant offboarding.** Not started. Cancelling an enrollment stops its pipeline. It does not export or delete a workspace.
12. **Legal and packaging.** Plan names in the scaffold are test labels, not the public price page. The ten service prices live in the catalog so a future plan can include them without inventing a fee at runtime.

## Blockers

- No per-client Google Ads, Meta, Business Profile, mailbox, CMS, or booking-calendar connection.
- No job feed and no estimate source.
- No hosted landing pages.
- Sentinel is absent on this branch; only the health report exists.
- Signup for marketers is intentionally not turned on.
- Billing is test-mode recording only.
- The pipeline clock is the open desk, not a worker.
