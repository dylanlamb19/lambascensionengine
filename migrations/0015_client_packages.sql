-- Client-package fulfillment for marketer workspaces.
-- File only. Do not apply this from a workstation, and do not point it at a
-- production database. Deploy applies migrations only after this branch is merged.
-- billing_mode is constrained to 'test'. There is no payment-provider column.

create table if not exists marketer_workspaces (
  id text not null,
  owner_user_id text not null,
  name text not null,
  onboarding text not null default 'workspace_ready',
  created_at timestamptz not null default now(),
  primary key (id),
  unique (owner_user_id)
);

create table if not exists marketer_subscriptions (
  workspace_id text not null primary key references marketer_workspaces (id),
  plan_id text not null,
  status text not null default 'test_inactive',
  billing_mode text not null default 'test' check (billing_mode = 'test'),
  updated_at timestamptz not null default now()
);

create table if not exists service_clients (
  id text not null,
  workspace_id text not null references marketer_workspaces (id),
  name text not null,
  created_at timestamptz not null default now(),
  primary key (workspace_id, id)
);

create table if not exists package_enrollments (
  id text not null,
  workspace_id text not null references marketer_workspaces (id),
  client_id text not null,
  package_id text not null,
  status text not null default 'active' check (status in ('active', 'paused', 'cancelled')),
  kill_switch boolean not null default false,
  setup_fee_cents integer not null default 0,
  monthly_cents integer not null default 0,
  pricing_kind text not null default 'fixed',
  setup_payment text not null default 'unrecorded' check (setup_payment in ('unrecorded', 'recorded', 'waived')),
  monthly_payment text not null default 'unrecorded' check (monthly_payment in ('unrecorded', 'recorded', 'waived')),
  started_on date not null,
  renews_on date not null,
  included_packages jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  primary key (workspace_id, id)
);

create index if not exists package_enrollments_client_idx
  on package_enrollments (workspace_id, client_id);

create table if not exists package_step_runs (
  id text not null,
  workspace_id text not null,
  enrollment_id text not null,
  client_id text not null,
  package_id text not null,
  source_package_id text not null,
  step_id text not null,
  title text not null,
  schedule text not null,
  mode text not null,
  integration text,
  status text not null check (status in ('pending', 'running', 'done', 'failed', 'needs_human')),
  attempts integer not null default 0,
  next_run_at timestamptz,
  output text not null default '',
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (workspace_id, id)
);

create index if not exists package_step_runs_due_idx
  on package_step_runs (workspace_id, status, next_run_at);

create table if not exists package_step_logs (
  id text not null,
  workspace_id text not null,
  step_run_id text not null,
  at timestamptz not null,
  message text not null,
  primary key (workspace_id, id)
);

create index if not exists package_step_logs_step_idx
  on package_step_logs (workspace_id, step_run_id, at);
