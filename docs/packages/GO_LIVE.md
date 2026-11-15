# Go live

Checklist before Lamb Ascension Engine is sold to a marketer who is not you. The fulfillment flag is **off**. Nothing in this list has been turned on by the scaffold. Do the owner actions yourself, in order. Do not load the demo seed in production.

## Already built, still off

- Package catalog, pipelines, and the Client Package Fulfillment tab (`PACKAGE_FULFILLMENT: false`).
- Lead Follow-Up cadence (capture, speed-to-lead draft, day 1/3/7). The sender is dry-run only. `tickPackagePipelines` does nothing while the flag is off. No cron was added.
- Workspace isolation in the library, plus forced row-level security in `migrations/0017_tenant_rls.sql` (file only).
- Request path that sets `app.tenant_id` from the verified session for one transaction (`scopePackageTenantFn`). It does not run while the flag is off.
- Test plans, $0 checkout, and $0 invoices through `fakeBilling`.
- Connection stubs. They store a status and do not call Google, Meta, or a mailbox.
- Public signup is still disabled (`disableSignUp` remains true).

## Owner actions before the first real customer

**Owner action.** Apply the database files on the production database, in order, and only when you mean to: `migrations/0015_client_packages.sql`, `migrations/0016_workspace_connections.sql`, `migrations/0017_tenant_rls.sql`, `migrations/0018_lead_follow_up.sql`. Confirm row-level security is forced and that a query without `app.tenant_id` returns no fulfillment rows. Do not apply them from a laptop against production by accident.

**Owner action.** Confirm production sets `app.tenant_id` from the verified session inside each fulfillment transaction (`set_config` with the local flag). A tenant id typed by the browser must not be trusted. This stays scoped to the package request, not to sales outreach.

**Owner action.** Add Stripe test keys only as server environment variables, then run a $0 or test-mode checkout against Stripe's test mode. After that, and only when you accept live charges, replace them with live keys in the same server environment. Do not commit keys, do not put them in `VITE_` variables, and do not paste them into the repo. `fakeBilling` stays the code path until that provider is deliberately wired.

**Owner action.** Create the OAuth apps and store refresh tokens server-side, per workspace, for the mailbox, Google Ads, Meta, Google Business Profile, CMS, and the booking calendar. Job and estimate feeds need their own credentials. Do not reuse the owner's sales Gmail or sales calendar tokens for a client's mailbox or booking calendar.

**Owner action.** Decide when public marketer signup should exist. It is off. Turning it on means changing `disableSignUp` in the auth config on purpose, with email verification and password reset. Invites today only attach an already signed-in user. Do not flip signup as part of a fulfillment tweak.

**Owner action.** Turn `PACKAGE_FULFILLMENT` on for one internal workspace first. Watch pipeline health, the $0 billing panel, and that one workspace cannot see another. Then turn it on for real marketers. Leave it off if any owner action above is unfinished.

**Owner action.** Confirm the demo seed cannot run. `loadDemoSeed` refuses `VERCEL_ENV=production` and does not write to the database. Do not call `buildDemoSeed` from a production boot path.

**Owner action.** Leave sales outreach alone. Do not change who is emailed, the email body, send caps, suppression, or the outreach worker schedule while fulfillment goes live. Client mail needs its own caps later.

## Not owner-only, still required

- Per-workspace adapters so a stub "Connected (test)" can actually send, publish, or read ads. Until then, steps stay on "needs human" and name the missing connection. The Lead Follow-Up dry-run already does this for Mailbox.
- A cron for pipeline ticks when the desk is closed. `tickPackagePipelines` already no-ops while the flag is off. Do not revive `.github/workflows/outreach-worker.yml`.
- Sentinel, if you want it to page you. The per-tenant health report is `sentinelPackageHealth`. Sentinel itself is not in this branch.
- Tax, proration, card retry, and dunning. The test lifecycle (trial, active, past due, canceled) does not collect money.
- Seats beyond a single owner, custom domains, and exporting a workspace when a marketer leaves.

## Stop if

- A fulfillment query runs without the session tenant set.
- Sample workspace names (Harbor Marketing, Prairie Studio) appear in production data.
- A live Stripe key is in the repo, the browser bundle, or a `VITE_` variable.
- Public signup is on before you have verified email and a way to close a workspace.
- Client follow-ups start going out through the sales outreach sender.
