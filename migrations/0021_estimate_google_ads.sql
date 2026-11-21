-- Estimate follow-ups and Google Ads drafts.
-- File only. Do not apply this from a workstation, and do not point it at a
-- production database.
-- Estimate rows are open, won, lost, replied, or ambiguous. There is no send
-- column. Ad figures are stored numbers only. There is no token, key, or
-- customer id column, and spend_cents is not a charge.
-- The tick stays off until PACKAGE_FULFILLMENT is on.

alter table marketer_workspaces
  add column if not exists estimate_follow_ups_kill_switch boolean not null default false;

alter table marketer_workspaces
  add column if not exists google_ads_kill_switch boolean not null default false;

do $$
declare
  spec record;
begin
  for spec in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public'
      and rel.relname = 'package_runs'
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%package_id%'
  loop
    execute format('alter table package_runs drop constraint %I', spec.conname);
  end loop;
end $$;

alter table package_runs
  drop constraint if exists package_runs_package_id_check;

alter table package_runs
  add constraint package_runs_package_id_check
  check (package_id in ('lead-generation', 'ai-visibility', 'reviews-gbp', 'google-ads'));

create table if not exists open_estimates (
  id text not null,
  workspace_id text not null references marketer_workspaces (id),
  client_id text not null,
  enrollment_id text not null,
  customer_name text not null,
  customer_email text not null default '',
  customer_phone text not null default '',
  label text not null,
  opened_at timestamptz not null,
  recorded_at timestamptz not null,
  outcome text not null check (outcome in ('open', 'won', 'lost', 'replied', 'ambiguous')),
  status text not null check (status in ('active', 'needs_human', 'stopped')),
  last_note text not null default '',
  primary key (workspace_id, id)
);

create index if not exists open_estimates_client_idx
  on open_estimates (workspace_id, client_id);

create table if not exists estimate_steps (
  id text not null,
  workspace_id text not null references marketer_workspaces (id),
  estimate_id text not null,
  enrollment_id text not null,
  step_id text not null check (step_id in ('day-2', 'day-5', 'day-10', 'close-out')),
  title text not null,
  status text not null check (status in ('pending', 'running', 'done', 'failed', 'needs_human')),
  attempts integer not null default 0,
  last_error text,
  next_run_at timestamptz,
  output text not null default '',
  drafted_message text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (workspace_id, id)
);

create index if not exists estimate_steps_due_idx
  on estimate_steps (workspace_id, status, next_run_at);

create table if not exists estimate_step_logs (
  id text not null,
  workspace_id text not null,
  step_id text not null,
  at timestamptz not null,
  message text not null,
  primary key (workspace_id, id)
);

create table if not exists ads_metric_snapshots (
  id text not null,
  workspace_id text not null references marketer_workspaces (id),
  client_id text not null,
  enrollment_id text not null,
  period_label text not null,
  impressions integer check (impressions is null or impressions >= 0),
  clicks integer check (clicks is null or clicks >= 0),
  conversions integer check (conversions is null or conversions >= 0),
  spend_cents integer check (spend_cents is null or spend_cents >= 0),
  recorded_at timestamptz not null,
  source text not null check (source = 'stored'),
  primary key (workspace_id, id)
);

create index if not exists ads_metric_snapshots_client_idx
  on ads_metric_snapshots (workspace_id, client_id);

create table if not exists ads_change_notes (
  workspace_id text not null references marketer_workspaces (id),
  enrollment_id text not null,
  client_id text not null,
  summary text not null default '',
  ambiguous boolean not null default false,
  status text not null check (status in ('open', 'approved')),
  updated_at timestamptz not null,
  primary key (workspace_id, enrollment_id)
);

alter table open_estimates enable row level security;
alter table open_estimates force row level security;
alter table estimate_steps enable row level security;
alter table estimate_steps force row level security;
alter table estimate_step_logs enable row level security;
alter table estimate_step_logs force row level security;
alter table ads_metric_snapshots enable row level security;
alter table ads_metric_snapshots force row level security;
alter table ads_change_notes enable row level security;
alter table ads_change_notes force row level security;

drop policy if exists open_estimates_tenant on open_estimates;
create policy open_estimates_tenant on open_estimates
  using (workspace_id = app_tenant_id())
  with check (workspace_id = app_tenant_id());

drop policy if exists estimate_steps_tenant on estimate_steps;
create policy estimate_steps_tenant on estimate_steps
  using (workspace_id = app_tenant_id())
  with check (workspace_id = app_tenant_id());

drop policy if exists estimate_step_logs_tenant on estimate_step_logs;
create policy estimate_step_logs_tenant on estimate_step_logs
  using (workspace_id = app_tenant_id())
  with check (workspace_id = app_tenant_id());

drop policy if exists ads_metric_snapshots_tenant on ads_metric_snapshots;
create policy ads_metric_snapshots_tenant on ads_metric_snapshots
  using (workspace_id = app_tenant_id())
  with check (workspace_id = app_tenant_id());

drop policy if exists ads_change_notes_tenant on ads_change_notes;
create policy ads_change_notes_tenant on ads_change_notes
  using (workspace_id = app_tenant_id())
  with check (workspace_id = app_tenant_id());
