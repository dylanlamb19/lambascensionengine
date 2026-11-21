-- Lead Generation and AI Visibility runs. File only. Do not apply this from a
-- workstation, and do not point it at a production database.
-- Drafts live on the step. There is no ad-account token, model key, or secret
-- column. The tick stays off until PACKAGE_FULFILLMENT is on.

create table if not exists client_intakes (
  workspace_id text not null references marketer_workspaces (id),
  client_id text not null,
  business_name text not null default '',
  phone text not null default '',
  address text not null default '',
  website text not null default '',
  offer text not null default '',
  service_area text not null default '',
  updated_at timestamptz not null,
  primary key (workspace_id, client_id)
);

create table if not exists package_runs (
  id text not null,
  workspace_id text not null references marketer_workspaces (id),
  client_id text not null,
  enrollment_id text not null,
  package_id text not null check (package_id in ('lead-generation', 'ai-visibility')),
  status text not null check (status in ('active', 'needs_human', 'stopped')),
  opened_at timestamptz not null,
  primary key (workspace_id, id)
);

create index if not exists package_runs_enrollment_idx
  on package_runs (workspace_id, enrollment_id);

create table if not exists package_run_steps (
  id text not null,
  workspace_id text not null references marketer_workspaces (id),
  run_id text not null,
  enrollment_id text not null,
  step_id text not null,
  title text not null,
  status text not null check (status in ('pending', 'running', 'done', 'failed', 'needs_human')),
  attempts integer not null default 0,
  last_error text,
  next_run_at timestamptz,
  output text not null default '',
  draft text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (workspace_id, id)
);

create index if not exists package_run_steps_due_idx
  on package_run_steps (workspace_id, status, next_run_at);

create table if not exists package_run_step_logs (
  id text not null,
  workspace_id text not null,
  step_id text not null,
  at timestamptz not null,
  message text not null,
  primary key (workspace_id, id)
);

create table if not exists generated_leads (
  id text not null,
  workspace_id text not null references marketer_workspaces (id),
  client_id text not null,
  enrollment_id text not null,
  contact_name text not null,
  contact_email text not null default '',
  contact_phone text not null default '',
  source text not null default 'landing page',
  captured_at timestamptz not null,
  follow_up_lead_id text,
  handoff_note text not null default '',
  primary key (workspace_id, id)
);

create index if not exists generated_leads_client_idx
  on generated_leads (workspace_id, client_id);

alter table marketer_workspaces
  add column if not exists lead_generation_kill_switch boolean not null default false;

alter table marketer_workspaces
  add column if not exists ai_visibility_kill_switch boolean not null default false;

alter table client_intakes enable row level security;
alter table client_intakes force row level security;
alter table package_runs enable row level security;
alter table package_runs force row level security;
alter table package_run_steps enable row level security;
alter table package_run_steps force row level security;
alter table package_run_step_logs enable row level security;
alter table package_run_step_logs force row level security;
alter table generated_leads enable row level security;
alter table generated_leads force row level security;

drop policy if exists client_intakes_tenant on client_intakes;
create policy client_intakes_tenant on client_intakes
  using (workspace_id = app_tenant_id())
  with check (workspace_id = app_tenant_id());

drop policy if exists package_runs_tenant on package_runs;
create policy package_runs_tenant on package_runs
  using (workspace_id = app_tenant_id())
  with check (workspace_id = app_tenant_id());

drop policy if exists package_run_steps_tenant on package_run_steps;
create policy package_run_steps_tenant on package_run_steps
  using (workspace_id = app_tenant_id())
  with check (workspace_id = app_tenant_id());

drop policy if exists package_run_step_logs_tenant on package_run_step_logs;
create policy package_run_step_logs_tenant on package_run_step_logs
  using (workspace_id = app_tenant_id())
  with check (workspace_id = app_tenant_id());

drop policy if exists generated_leads_tenant on generated_leads;
create policy generated_leads_tenant on generated_leads
  using (workspace_id = app_tenant_id())
  with check (workspace_id = app_tenant_id());
