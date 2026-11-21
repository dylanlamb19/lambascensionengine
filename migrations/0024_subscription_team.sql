-- Subscription scaffold, team seats, transactional mail, and workspace close.
-- File only. Do not apply this from a workstation, and do not point it at a
-- production database.
-- BILLING_SCAFFOLD, TEAM_SEATS, and WORKSPACE_LIFECYCLE stay off until those
-- flags are turned on. There is no payment key, no charge column that can
-- leave zero, and no live-mode value. Mail mode is dry-run only.

alter table marketer_workspaces drop constraint if exists marketer_workspaces_owner_user_id_key;

create table if not exists transactional_mail (
  id text primary key,
  workspace_id text references marketer_workspaces (id),
  kind text not null check (kind in ('verify', 'reset', 'invite')),
  recipient text not null,
  mode text not null default 'dry_run' check (mode = 'dry_run'),
  created_at timestamptz not null default now()
);

create table if not exists scaffold_subscriptions (
  workspace_id text primary key references marketer_workspaces (id),
  plan_id text not null check (plan_id in ('starter', 'pro', 'agency')),
  status text not null check (status in ('trialing', 'active', 'past_due', 'canceled')),
  customer_id text not null,
  subscription_id text not null,
  grace_until timestamptz,
  billing_mode text not null default 'test' check (billing_mode = 'test'),
  updated_at timestamptz not null default now()
);

create table if not exists scaffold_checkout_sessions (
  id text not null,
  workspace_id text not null references marketer_workspaces (id),
  plan_id text not null check (plan_id in ('starter', 'pro', 'agency')),
  amount_cents integer not null default 0 check (amount_cents = 0),
  billing_mode text not null default 'test' check (billing_mode = 'test'),
  status text not null check (status in ('open', 'complete')),
  created_at timestamptz not null default now(),
  primary key (workspace_id, id)
);

create table if not exists scaffold_portal_sessions (
  id text not null,
  workspace_id text not null references marketer_workspaces (id),
  billing_mode text not null default 'test' check (billing_mode = 'test'),
  created_at timestamptz not null default now(),
  primary key (workspace_id, id)
);

create table if not exists scaffold_webhook_receipts (
  id text not null,
  workspace_id text not null references marketer_workspaces (id),
  type text not null,
  received_at timestamptz not null default now(),
  primary key (workspace_id, id)
);

create table if not exists seat_invites (
  id text not null,
  workspace_id text not null references marketer_workspaces (id),
  email text not null,
  role text not null check (role in ('admin', 'member')),
  token_hash text not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  invited_by_user_id text not null,
  created_at timestamptz not null default now(),
  primary key (workspace_id, id)
);

create table if not exists workspace_closures (
  id text not null,
  workspace_id text not null references marketer_workspaces (id),
  closed_at timestamptz not null,
  restore_until timestamptz not null,
  restored_at timestamptz,
  primary key (workspace_id, id)
);

alter table transactional_mail enable row level security;
alter table transactional_mail force row level security;
alter table scaffold_subscriptions enable row level security;
alter table scaffold_subscriptions force row level security;
alter table scaffold_checkout_sessions enable row level security;
alter table scaffold_checkout_sessions force row level security;
alter table scaffold_portal_sessions enable row level security;
alter table scaffold_portal_sessions force row level security;
alter table scaffold_webhook_receipts enable row level security;
alter table scaffold_webhook_receipts force row level security;
alter table seat_invites enable row level security;
alter table seat_invites force row level security;
alter table workspace_closures enable row level security;
alter table workspace_closures force row level security;

drop policy if exists transactional_mail_tenant on transactional_mail;
create policy transactional_mail_tenant on transactional_mail
  using (workspace_id = app_tenant_id())
  with check (workspace_id = app_tenant_id());

drop policy if exists scaffold_subscriptions_tenant on scaffold_subscriptions;
create policy scaffold_subscriptions_tenant on scaffold_subscriptions
  using (workspace_id = app_tenant_id())
  with check (workspace_id = app_tenant_id());

drop policy if exists scaffold_checkout_sessions_tenant on scaffold_checkout_sessions;
create policy scaffold_checkout_sessions_tenant on scaffold_checkout_sessions
  using (workspace_id = app_tenant_id())
  with check (workspace_id = app_tenant_id());

drop policy if exists scaffold_portal_sessions_tenant on scaffold_portal_sessions;
create policy scaffold_portal_sessions_tenant on scaffold_portal_sessions
  using (workspace_id = app_tenant_id())
  with check (workspace_id = app_tenant_id());

drop policy if exists scaffold_webhook_receipts_tenant on scaffold_webhook_receipts;
create policy scaffold_webhook_receipts_tenant on scaffold_webhook_receipts
  using (workspace_id = app_tenant_id())
  with check (workspace_id = app_tenant_id());

drop policy if exists seat_invites_tenant on seat_invites;
create policy seat_invites_tenant on seat_invites
  using (workspace_id = app_tenant_id())
  with check (workspace_id = app_tenant_id());

drop policy if exists workspace_closures_tenant on workspace_closures;
create policy workspace_closures_tenant on workspace_closures
  using (workspace_id = app_tenant_id())
  with check (workspace_id = app_tenant_id());
