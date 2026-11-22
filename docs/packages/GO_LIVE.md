# Go live

Checklist before Lamb Ascension Engine is sold to a marketer who is not you. The fulfillment flag is **off**. Nothing in this list has been turned on by the scaffold. Do the owner actions yourself, in order. Do not load the demo seed in production.

## Already built, still off

- Package catalog, pipelines, and the Client Package Fulfillment tab (`PACKAGE_FULFILLMENT: false`).
- Lead Follow-Up cadence (capture, speed-to-lead draft, day 1/3/7). The sender is dry-run only. `tickPackagePipelines` does nothing while the flag is off. No cron was added.
- Estimate Follow-Ups (day 2, day 5, day 10, close-out) and Google Ads drafts (campaign plan, stored-metric weekly report, change proposal). Both are dry runs. No Google Ads API call and no spend.
- Workspace isolation in the library, plus forced row-level security in `migrations/0017_tenant_rls.sql` (file only).
- Request path that sets `app.tenant_id` from the verified session for one transaction (`scopePackageTenantFn`). It does not run while the flag is off.
- Test plans, $0 checkout, and $0 invoices through `fakeBilling`.
- Connection stubs. They store a status and do not call Google, Meta, or a mailbox.
- Public Better Auth registration is still disabled (`disableSignUp` remains true).
- Marketer self-serve signup, verification, password reset, and workspace branding (`SELF_SERVE_SIGNUP: false`). While it is off, `/signup`, `/workspace`, and `/api/account/*` refuse the request and do not create a user, a session, or a mail row. Verification and reset notes, when the flag is on, are dry-run log rows only. They go through the transactional sender, not the sales outreach sender.
- Transactional mail for verification, password reset, and workspace invites. The default sender writes a dry-run row and sends nothing. It does not import the sales outreach sender, send caps, or suppression list.
- Billing scaffold (`BILLING_SCAFFOLD: false`): Starter, Pro, and Agency, with seat and client caps, a test checkout, a portal stub, and a signed webhook. While it is off, the new billing routes refuse the request. Amounts stay at $0. A live payment id is refused. No payment key is read from the environment.
- Team seats (`TEAM_SEATS: false`): invite by email, accept, admin or member, seat cap, remove (sessions revoked), and transfer ownership. While it is off, the team routes refuse the request. The invite is a dry-run transactional note.
- Workspace export and close (`WORKSPACE_LIFECYCLE: false`). Export is that workspace's rows only. Close signs that workspace out, stops its pipelines, and can be restored for 30 days. While it is off, those routes refuse the request. Owner only, and the form token is required.
- Plan entitlements (`PLAN_ENTITLEMENTS: false`). Starter, Pro, and Agency each have one definition: client workspaces, active package pipelines, team seats, monthly fulfillment runs, and which packages are included. Usage is counted per workspace per billing period. A meter at 80% warns. A meter at 100% stops the next client, package, seat invite, or fulfillment run with an upgrade message. The 14-day trial is recorded on the scaffold subscription only. While the flag is off, the previous test-plan caps stay in force and these routes refuse the request. Nothing is charged.
- First-run wizard (`ONBOARDING_WIZARD: false`). A new marketer can confirm branding, pick a test plan at $0, add a client, queue that client's packages, optionally import a CSV of leads as a dry-run, and see those pipelines listed for the Client Package Fulfillment tab. Steps can be skipped and resumed. Progress is stored on that workspace only. While the flag is off, the wizard refuses the request. It does not send mail.
- Operator console (`OPERATOR_CONSOLE: false`). The Lasengine owner can list workspaces, read plan, trial, usage, and the Sentinel fulfillment-health summary, and suspend or stop pipelines for one workspace. A workspace owner, admin, or member is refused. The console does not sign the operator in as that workspace. Every operator action is written to the operator audit log. While the flag is off, the console refuses the request.

## Owner actions before the first real customer

**Owner action.** Apply the database files on the production database, in order, and only when you mean to: `migrations/0015_client_packages.sql` through `migrations/0025_plan_entitlements.sql`. Confirm row-level security is forced and that a query without `app.tenant_id` returns no fulfillment rows, including `workspace_branding`, `workspace_logos`, `account_sessions`, `scaffold_subscriptions`, `seat_invites`, `transactional_mail`, `workspace_closures`, `usage_meters`, `wizard_progress`, and `lead_import_rows`. A tenant session must not read `operator_audit_log`. Do not apply them from a laptop against production by accident. `0024` and `0025` were not applied from this change.

**Owner action.** Confirm production sets `app.tenant_id` from the verified session inside each fulfillment transaction (`set_config` with the local flag). A tenant id typed by the browser must not be trusted. This stays scoped to the package request, not to sales outreach.

**Owner action.** Leave `BILLING_SCAFFOLD` off until you mean to exercise the local test checkout. It does not call a payment provider. Do not add a live key, a test key, or any `VITE_` payment variable to turn it on. When you are ready for a real test-mode checkout, add the provider's test keys only as server environment variables, outside this repo, and point a new adapter at them. After that, and only when you accept live charges, replace them with live keys in the same server environment. Do not commit keys. Until that adapter exists, checkout stays on the local scaffold and on `fakeBilling`, both at $0. A live-mode id is refused. A failed test payment moves the workspace to past due and leaves a 7 day grace before the existing plan caps block new clients, packages, and pipeline runs.

**Owner action.** Create the OAuth apps and store refresh tokens server-side, per workspace, for the mailbox, Google Ads, Meta, Google Business Profile, CMS, and the booking calendar. Job and estimate feeds need their own credentials. Do not reuse the owner's sales Gmail or sales calendar tokens for a client's mailbox or booking calendar.

**Owner action.** Leave `disableSignUp` true. Do not turn on Better Auth's public registration. Self-serve signup is the separate `SELF_SERVE_SIGNUP` flag, and it ships off. Leave it off for a real customer while verification is still a dry-run log, because the marketer will not receive the code. The transactional sender is in place and its default writes a log row only. Before turning signup on: apply `migrations/0023_self_serve_signup.sql` and `migrations/0024_subscription_team.sql` yourself, confirm a workspace A session cannot read or write workspace B through `/api/account/*`, and replace the dry-run sender with a provider that is not the sales outreach sender. Do not point that provider at the outreach send caps or suppression list. Plan checkout on the signup path is still `fakeBilling` at $0 unless `BILLING_SCAFFOLD` is also on, and that scaffold is still $0. Do not add a live payment key to turn either flag on. The owner membership cannot be removed or demoted through the old member route. Session cookies on this path are `__Host-lae.session` (HttpOnly, Secure, SameSite=Lax, Path=/, no Domain) and rotate on login, when that person's role changes, and when ownership is transferred. State-changing account routes require the CSRF token.

**Owner action.** Leave `TEAM_SEATS` off for a real customer while invites are still dry-run notes. An invited person will not receive the code. Seat caps are Starter 2, Pro 8, and Agency 25, counting accepted people and pending invites. Removing someone revokes their sessions. Transfer makes the other person the owner and the previous owner an admin.

**Owner action.** Leave `WORKSPACE_LIFECYCLE` off until you have tried export and close on an internal workspace. Export returns that workspace's rows only, with no password hashes. Close is a soft delete: sessions for that workspace are revoked, pipeline kill switches are turned on, and the rows stay so the owner can restore them for 30 days. After that window, restore is refused.

**Owner action.** Leave `PLAN_ENTITLEMENTS` off until `0025` is applied and you have watched one internal workspace hit a warning at 80% and a stop at 100%. Turning the flag on does not charge a card and does not add a payment key. The 14-day trial is only the `trial_ends_at` value on the scaffold subscription. Do not treat that date as a paid trial. Outreach send caps, suppression, and the outreach sender stay untouched.

**Owner action.** Leave `ONBOARDING_WIZARD` off until `SELF_SERVE_SIGNUP` is something you mean to exercise. The wizard uses that session. Plan choice is still the $0 test checkout. The CSV import is a dry-run stored on that workspace. It does not create outreach, and it does not send mail. Skip and resume stay on that workspace's wizard row.

**Owner action.** Leave `OPERATOR_CONSOLE` off until you have granted the Lasengine owner with `grantPlatformOperator`. A workspace role is not enough, and the console cannot grant itself. Suspending a workspace blocks new clients, packages, invites, and fulfillment runs for that workspace only. Stopping pipelines uses that workspace's kill switches. Neither action signs the operator in as the marketer. Confirm a tenant session cannot read `operator_audit_log`.

**Owner action.** Turn `PACKAGE_FULFILLMENT` on for one internal workspace first. Watch pipeline health, the $0 billing panel, and that one workspace cannot see another. Then turn it on for real marketers. Leave it off if any owner action above is unfinished.

**Owner action.** Confirm the demo seed cannot run. `loadDemoSeed` refuses `VERCEL_ENV=production` and does not write to the database. Do not call `buildDemoSeed` from a production boot path.

**Owner action.** Leave sales outreach alone. Do not change who is emailed, the email body, send caps, suppression, or the outreach worker schedule while fulfillment goes live. Client mail needs its own caps later.

## Not owner-only, still required

- Per-workspace adapters so a stub "Connected (test)" can actually send, publish, or read ads. Until then, steps stay on "needs human" and name the missing connection. The Lead Follow-Up dry-run already does this for Mailbox.
- A cron for pipeline ticks when the desk is closed. `tickPackagePipelines` already no-ops while the flag is off. Do not revive `.github/workflows/outreach-worker.yml`.
- Sentinel, if you want it to page you. The per-tenant health report is `sentinelPackageHealth`. Sentinel itself is not in this branch.
- Tax, proration, card retry, and dunning. The test lifecycle (trialing, active, past due, canceled) does not collect money. The billing scaffold records those states locally and does not call a payment provider.
- A real transactional provider, custom domains, and a hosted restore for a workspace whose 30 day window has ended. The seat and export scaffolds are in the tree and stay off.

## Stop if

- A fulfillment query runs without the session tenant set.
- Sample workspace names (Harbor Marketing, Prairie Studio) appear in production data.
- A live Stripe key is in the repo, the browser bundle, or a `VITE_` variable.
- `SELF_SERVE_SIGNUP` or `TEAM_SEATS` is on while verification or invite mail is still dry-run, or `disableSignUp` was flipped off.
- `BILLING_SCAFFOLD` is treated as permission to charge a card, or a live payment key was added in order to open signup.
- `PLAN_ENTITLEMENTS` is treated as a bill, or a live payment key was added to enforce a limit.
- `OPERATOR_CONSOLE` is reachable by a workspace owner, admin, or member, or an operator action has no audit row.
- Client follow-ups, verification, password reset, or invites start going out through the sales outreach sender.
- Outreach send caps, suppression, or the outreach worker schedule were changed while this layer went in.
