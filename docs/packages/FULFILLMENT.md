# Package fulfillment

How Lamb Ascension's ten service packages run inside Lamb Ascension Engine, and what is still required before the engine can be sold to other marketers as a multi-tenant subscription.

This scaffold is **off**. `FLAGS.PACKAGE_FULFILLMENT` is `false`. While it is off, the Client Package Fulfillment tab is not rendered, workspaces are not opened, and pipelines do not tick. Nothing here sends mail, changes outreach caps, suppression, or autopilot gates, or charges a card.

The SQL in `migrations/0015_client_packages.sql`, `migrations/0016_workspace_connections.sql`, `migrations/0017_tenant_rls.sql`, `migrations/0018_lead_follow_up.sql`, `migrations/0019_lead_gen_ai_visibility.sql`, `migrations/0020_reviews_appointments.sql`, and `migrations/0021_estimate_google_ads.sql` is a file only. It was not applied to a hosted database from this change.

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
- `readTenant` and `writeTenant` refuse a session that does not own or belong to the workspace. A cross-tenant read returns no rows. A cross-tenant write leaves the state unchanged.
- `migrations/0017_tenant_rls.sql` turns on forced row-level security. Each policy compares the row's workspace id to `app.tenant_id`. The file is not applied to a hosted database. An ephemeral test runs it only inside that test.
- The package request path (`scopePackageTenantFn`) takes the user id from the verified session and runs `set_config('app.tenant_id', tenant, true)` inside one transaction. The `true` makes the setting local to that transaction, so the next request on the same connection does not keep it. A tenant id supplied by the caller is ignored unless it is exactly the id derived from that session. The call is skipped while the flag is off, and auth config is unchanged.
- Browser storage is keyed `la_package_fulfillment_v1:<tenantId>`, then sliced again on load.

The desk passes `user.id` from the session into `startMarketerOnboarding`. That function is the self-serve onboarding hook: idempotent per user id, opens a workspace, and records a test plan. It does **not** create a login. Public signup stays disabled (`disableSignUp` is unchanged, and the desk still has no account-creation form).

## Test plans

`src/lib/packages/plans.ts` is scaffolding only.

| Plan | Clients | Packages | Pipeline runs | Checkout |
| --- | --- | --- | --- | --- |
| Test trial | 3 | 5 | 40 | $0 test checkout |
| Test operator | 25 | 100 | 500 | $0 test checkout |
| Test agency | No cap | No cap | No cap | $0 test checkout |

`fakeBilling` implements `BillingProvider`. `selectPlan`, `assertCanAddClient`, `handleWebhook`, `transitionSubscription`, `issueInvoice`, and `payInvoice` record notices with `amountCents: 0` and `billingMode: "test"`. The lifecycle is `trial`, then `active`, then `past_due`, then `canceled`. Skipping a step is rejected. Moving to past due opens a $0 invoice. Recording that $0 payment returns the subscription to active. Canceling voids an open invoice. A payment for another workspace's invoice is rejected. The provider does not read environment variables or keys.

The Client Package Fulfillment tab shows this status, the $0 invoices, and the allowed next step. Its Pricing page lists the three test plans and checks out through `fakeBilling.checkout` at $0. That records the plan, moves a trial to active, and pays a $0 invoice. It does not read keys.

Usage is counted per workspace. A new package enrollment increments that workspace's package meter, and each pipeline step that advances increments its run meter. The other workspace's meters do not move. A canceled subscription cannot add a package or run a pipeline. Crossing a cap records a zero-cent notice and does not charge.

Choosing a plan sets `planStatus` to `test_trial`. There is no live charge.

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

## Enrollment record

For one workspace, an enrollment stores:

- Package id, including the bundle as one purchase whose steps are the four included packages
- Status: `active`, `paused`, or `cancelled`
- Kill switch
- Setup fee and monthly amount copied from the catalog at purchase time
- Setup and monthly payment state (manual)
- Start date and renewal date (one month later)
- Deliverable status, derived from the step: not started, in progress, fulfilled, or blocked

## Connections

Each workspace has a registry for Mailbox, Google Ads, Meta, Google Business Profile, CMS, Booking calendar, Job feed, Estimate feed, and Tracking. Connect and disconnect are stubs: they store `missing` or `stub_connected` and a timestamp. They do not accept a token or secret.

A blocked external step says which connection is missing, for example `Missing connection: Mailbox`. Marking that connection connected in test mode does not send anything. The step then says the adapter is not wired. One workspace's stub does not satisfy another workspace.

Job feed and Estimate feed are separate rows so a review request and an estimate reminder name the exact feed that is missing.

## Onboarding

While the flag is on, the fulfillment tab opens a five-step setup for the signed-in marketer:

1. Workspace name
2. Test plan
3. First client
4. One package for that client
5. Connections checklist

Public signup stays off (`disableSignUp` is unchanged). The screen does not offer account creation. `beginMarketerSignup` opens a workspace only for a user id that already signed in, and only when the fulfillment flag is on. `inviteMarketer` records an email on that workspace and does not send mail or create a login. Accepting the invite requires the signed-in email to match. After the checklist, the client list and live pipelines are the same desk as before.

## Tracker

The desk tab is named exactly **Client Package Fulfillment**. It is hidden while the flag is off. When the flag is on, and onboarding is finished:

1. The landing view lists that workspace's clients and the packages each one purchased.
2. A client opens their page, with one tab per purchased package under their name.
3. A package tab lists each step with status (`pending`, `running`, `done`, `failed`, `needs human`), attempts, last error, timestamps, log lines, output, and the next scheduled run. A Lead Follow-Up tab also lists each captured lead and that lead's cadence. A Reviews tab lists each completed job and its review request. An Appointment Reminders tab lists each booking and the 24-hour, 2-hour, and no-show steps. An Estimate Follow-Ups tab lists each open estimate and the day 2, day 5, day 10, and close-out drafts. A Google Ads tab lists the campaign plan, the weekly report, and the change proposal.
4. The desk ticks every 2 seconds while it is open and the flag is on. A step moves to `running`, then to `done` or `needs human`, without a separate start button.

There is no production cron. A closed browser does not keep ticking. Registering a cron is leftover work, and it must stay disabled until the flag is on and the send path is a separate, gated client mailbox.

## Pipelines

`tickFulfillment(state, tenantId, now, { enabled })` is the runner.

- `enabled: false` (the flag) returns the same state.
- Jobs are idempotent: the step id is `{enrollment}:{source package}:{step}`, and a finished immediate step is not run again.
- A throw retries up to 3 times, then the step is `failed`.
- A missing integration becomes `needs human`, names the connection (`Missing connection: Mailbox`, and the same for Google Ads, Meta, Google Business Profile, CMS, Booking calendar, Job feed, Estimate feed, and Tracking), and does not call an API.
- A credential port that says "present" still escalates, because no provider adapter is wired.
- Kill switch, pause, and cancel stop that enrollment only.
- Bookkeeping steps can finish. They write a checklist, a draft slot, or a report shell. They do not invent ad metrics.

### 1. Lead Follow-Up — $350/mo + $500 setup

**Trigger.** A purchase is recorded for this workspace. A captured inquiry then opens its own cadence.

**Enrollment steps.** Record the inquiry route (bookkeeping). Acknowledge, then notify the team (client mailbox). Record the unresponsive cadence (bookkeeping; sales sequences are not started). Weekly summary draft (bookkeeping, not emailed).

**Lead cadence.** New lead captured, then a speed-to-lead reply draft, then day 1, day 3, and day 7 follow-up drafts. A reply, or a step that is still failing after retries, escalates the rest to needs human. Retries wait 60 seconds, then 120 seconds. The workspace kill switch stops every lead in that workspace and leaves the other workspace running. Each advance counts toward the workspace pipeline-run cap. Crossing the cap records a zero-cent notice and does not run the step.

**Sender.** Dry-run only. The intended message is written on the step log. The step does not call a mailbox, a text provider, or the sales outreach sender. A missing mailbox, and a mailbox marked Connected (test), both stay needs human and name Mailbox.

**Needs.** A client mailbox that is not the owner's sales Gmail.

**Autonomy.** Needs integration. Orchestration runs; sends do not. `tickPackagePipelines` returns the same state while `PACKAGE_FULFILLMENT` is false. No cron was added, and `.github/workflows/outreach-worker.yml` stays retired.

### 2. AI Visibility Optimization — $600/mo

**Trigger.** Purchase, then the run: profile audit, schema and FAQ draft, AI recommendation check, monthly visibility report.

**Steps.** The profile audit compares the client's stored name, address, phone, and site. It does not read a third-party page. The schema and FAQ draft stays unpublished. The recommendation check is a dry run and needs a person: no live model and no search API. The monthly report is a draft. The older enrollment checklist (site check, two page updates, publish) still runs and still needs the site or CMS before anything is published.

**Needs.** Stored intake. Publishing still needs the CMS.

**Autonomy.** Needs integration. The recommendation check does not call a model.

### 3. Google Advertising — $750/mo

**Trigger.** Purchase. One Google Ads account for this workspace. Ad spend is the client's and is not set here.

**Run.** Campaign plan from the client's stored intake: keywords, one ad group, ad copy drafts, negative keywords, and a budget recommendation that does not set a budget. The weekly performance report reads stored figures for this workspace and client only. A missing figure stays UNKNOWN. The change proposal stays needs human until a person approves it. Approval writes a note on the step. It does not call Google Ads and it does not spend.

**Connection.** The Google Ads row in this workspace's connection registry. Another workspace's stub does not count. A missing stub becomes needs human and names Google Ads. A Connected (test) stub still does not call the API. Live keys are refused and are not stored.

**Older checklist.** Setup checklist and keyword shell still run as bookkeeping. Conversion check and monthly adjustments still need a person because no API adapter is wired. The monthly report shell still says spend is UNKNOWN.

**Autonomy.** Needs a person before any account change. No Google Ads API call is made.

### 4. Meta Advertising — $650/mo

**Trigger.** Purchase. One Facebook and Instagram ad account.

**Steps.** Checklist and copy notes (bookkeeping). Creative variations and monthly adjustments (Meta Marketing API, existing assets only). Report shell with UNKNOWN results.

**Autonomy.** Needs the Meta Marketing API.

### 5. Lead Generation — $500/mo + $500 setup

**Trigger.** Purchase. One landing page. No guaranteed lead count. Ad spend stays separate.

**Steps.** Campaign brief from the client's stored intake, then a landing-page draft, then Google and Meta ad-copy drafts. Launch always needs a person: no live ad account is used and no spend is set. The weekly lead report summarizes captured leads for that workspace and client. It is not emailed. A new captured lead is handed to Lead Follow-Up when that same client, in that same workspace, has an active Lead Follow-Up package. The older enrollment checklist (page slot, form, tracking, test log) still runs and still does not publish.

**Needs.** Stored intake. A host before a page can go live. That host is not connected here.

**Autonomy.** Needs integration. Launch stays needs human.

### 6. Estimate Follow-Ups — $200/mo + $250 setup

**Trigger.** Purchase only when the same client, in the same workspace, already has active Lead Follow-Up. A recorded open estimate for that client's customer then opens the cadence.

**Cadence.** Day 2, day 5, day 10, then a close-out draft. Each one is a dry run. Nothing is sent by email or text, and the sales outreach sender is not used. Won, lost, or replied stops the drafts that have not run. An ambiguous estimate, or an ambiguous outcome, stays needs human and does not draft. A time before 8:00 or after 21:00 America/Chicago waits until 8:00.

**Connection.** This workspace's estimate feed stub. Another workspace's stub does not count. A missing stub becomes needs human and names Estimate feed. The older enrollment checklist (estimate source, mailbox, personal-response alert) still runs and still does not send. Step ids do not overlap Lead Follow-Up.

**Autonomy.** Needs an active Lead Follow-Up enrollment for the same client. The lead cadence is not copied.

### 7. Review Requests and Google Business Profile Care — $150/mo

**Trigger.** Purchase, then a real recorded completed job for that client. A job that is not completed does not open a request. A rating, sentiment, or "only happy customers" field is refused.

**Review request.** One dry-run draft per completed job. The wording is the same for every customer. Nothing is sent by email or text. The sales outreach sender is not used. The older enrollment checklist (job feed, mailbox) still runs and still needs a person before a live send.

**Google Business Profile.** The profile audit, up to two post drafts, and reply drafts read stored intake and stored reviews only. No Google API is called. Reply drafts stay needs human until a person approves them. Nothing is published. The monthly review report is a draft and is not emailed.

**Autonomy.** Orchestration runs. Sends and publishing do not.

### 8. Appointment Reminders — $100/mo + $150 setup

**Trigger.** Purchase. One booking on this workspace's booking calendar connection.

**Steps.** Confirmation, a reminder 24 hours before, a reminder 2 hours before, then a no-show follow-up draft. Confirm and reschedule are dry runs. A time that falls before 8:00 or after 21:00 America/Chicago waits until 8:00. An attended visit does not get a no-show draft.

**Rule.** The calendar value has to be `booking_calendar` for this workspace. The owner sales calendar is not read and is not written. Another workspace's booking-calendar stub does not count. A missing connection becomes needs human and names Booking calendar. A Connected (test) stub still does not call a calendar API.

**Autonomy.** Needs the client's booking calendar connection before reminders run. The older enrollment checklist still says the adapter is not wired.

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

`migrations/0018_lead_follow_up.sql` (file only, not applied):

- `follow_up_leads` — one captured inquiry per workspace
- `follow_up_lead_steps` — status, attempts, last error, next run, and the unsent draft
- `follow_up_lead_step_logs` — append-only notes
- `lead_follow_up_kill_switch` on the workspace

`migrations/0019_lead_gen_ai_visibility.sql` (file only, not applied):

- `client_intakes` — stored name, address, phone, site, offer, and service area
- `package_runs` and `package_run_steps` — Lead Generation and AI Visibility, with the draft on the step
- `package_run_step_logs` — append-only notes
- `generated_leads` — a captured lead and, when handed off, the Lead Follow-Up id
- `lead_generation_kill_switch` and `ai_visibility_kill_switch` on the workspace
- Forced row-level security, same `app.tenant_id` rule, and no secret column

`migrations/0020_reviews_appointments.sql` (file only, not applied):

- `completed_jobs` — status is constrained to `completed`. There is no rating column
- `review_request_steps` and `review_request_step_logs` — the unsent review request
- `stored_reviews` — reviewer name and text only
- `client_appointments` — `calendar` is constrained to `booking_calendar`
- `appointment_steps` and `appointment_step_logs` — confirm, 24h, 2h, and no-show drafts
- `reviews_kill_switch` and `appointment_reminders_kill_switch` on the workspace
- `package_runs.package_id` also allows `reviews-gbp`
- Forced row-level security, same `app.tenant_id` rule, and no secret column

`migrations/0021_estimate_google_ads.sql` (file only, not applied):

- `open_estimates` — outcome is `open`, `won`, `lost`, `replied`, or `ambiguous`
- `estimate_steps` and `estimate_step_logs` — day 2, day 5, day 10, and close-out drafts
- `ads_metric_snapshots` — stored impressions, clicks, conversions, and spend figures. `source` is `stored`. There is no token column
- `ads_change_notes` — the proposal text, whether it is ambiguous, and whether a person approved it
- `estimate_follow_ups_kill_switch` and `google_ads_kill_switch` on the workspace
- `package_runs.package_id` also allows `google-ads`
- Forced row-level security, same `app.tenant_id` rule, and no secret column

`migrations/0016_workspace_connections.sql`:

- `workspace_connections` — `(workspace_id, kind)`, status `missing` or `stub_connected`, no secret column
- `billing_webhook_events` — test notices, `amount_cents` constrained to 0, `billing_mode` constrained to `test`

`migrations/0017_tenant_rls.sql`:

- `workspace_memberships`, `workspace_invites`, and `test_invoices` (`amount_cents` constrained to 0)
- `lifecycle` on `marketer_subscriptions`: `trial`, `active`, `past_due`, `canceled`
- Forced row-level security on every workspace table, using `app.tenant_id`

Every delivery row is keyed by `workspace_id`. There is no payment-provider column and no token column.

The running desk uses the in-memory and browser store above. It does not query these tables, so the feature does not depend on the migration having been applied.

## Demo seed

`buildDemoSeed` makes two local workspaces, Harbor Marketing and Prairie Studio, each with clients, packages, and pipeline steps that have already advanced. `loadDemoSeed` returns that data only when `VERCEL_ENV` is not `production`. It does not write to the database. The fulfillment tab can show it from "Load sample workspaces" while the flag is on. Leave the sample before using a real workspace. The go-live list is `docs/packages/GO_LIVE.md`.

## What is left before this is a sellable multi-tenant SaaS

1. **Marketer accounts.** Public signup is still disabled on purpose. The onboarding hook must be called only after a verified session exists. Turning on self-serve registration, email verification, and password reset is separate work and must not weaken the current owner-desk signup lock by accident.
2. **Server-side isolation in production.** The request path sets `app.tenant_id` from the verified session for a package transaction, and the RLS file exists. Production still needs that migration applied on purpose before the policies are in force.
3. **Apply the migrations on purpose.** These files are not applied here. Production should apply them only when the flag is about to be turned on.
4. **Real subscription billing.** `BillingProvider` and `fakeBilling` record plan choices and webhook notices at zero cents. Invoices, tax, proration, card retry, and dunning are not built. A live provider still must not put keys in the browser or in this flag.
5. **Seats and invites.** A workspace has one owner user id. There is no staff seat, role, or invite.
6. **Live connections.** The registry can mark a stub connected. Reviews and appointment reminders draft from stored jobs, stored reviews, and stored bookings. Estimate follow-ups draft from a recorded open estimate. Google Ads drafts a plan from stored intake and a weekly report from stored figures. OAuth and API adapters for Google Ads, Meta, Business Profile, mailbox, CMS, booking calendar, and the job and estimate feeds are still absent, and they must stay per workspace rather than on the owner's sales OAuth row.
7. **A gated send path.** Client acknowledgements, reminders, and review requests need their own caps and suppression. They must not call `canSend` in a way that changes the sales gates, and they must not send through the sales outreach worker.
8. **Unattended schedule.** The 2-second tick runs only while the signed-in desk is open and the flag is on. A cron must be added later, and it must no-op while the flag is off. Do not revive `.github/workflows/outreach-worker.yml`.
9. **Sentinel.** The health report is ready for one tenant. Sentinel itself is not in this branch, and nothing here disables it.
10. **Client-facing report delivery, landing-page hosting, and structured-data edits.** Lead Generation and AI Visibility now draft the brief, page, ad copy, schema, and reports. Launch and the recommendation check stay needs human. Publishing does not.
11. **Custom domains, audit export, and tenant offboarding.** Not started. Cancelling an enrollment stops its pipeline. It does not export or delete a workspace.
12. **Legal and packaging.** Plan names in the scaffold are test labels, not the public price page. The ten service prices live in the catalog so a future plan can include them without inventing a fee at runtime.

## Blockers

- Connection rows are stubs. There is still no live Google Ads, Meta, Business Profile, mailbox, CMS, or booking-calendar adapter. Google Ads change proposals stay needs human, and no spend is set.
- Job and estimate feeds can be marked connected in test mode. They do not read a real feed.
- No hosted landing pages.
- Sentinel is absent on this branch; only the health report exists.
- Signup for marketers is intentionally not turned on.
- Billing is test-mode recording only.
- The pipeline clock is the open desk, not a worker.
