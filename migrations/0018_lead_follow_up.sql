-- Lead Follow-Up cadence. File only. Do not apply this from a workstation,
-- and do not point it at a production database.
-- Drafts live in the log table. There is no mailbox, text, or outreach column
-- and no secret column. The tick stays off until PACKAGE_FULFILLMENT is on.

create table if not exists follow_up_leads (
  id text not null,
  workspace_id text not null references marketer_workspaces (id),
  client_id text not null,
  enrollment_id text not null,
  contact_name text not null,
  contact_email text not null default '',
  contact_phone text not null default '',
  source text not null default 'inquiry',
  status text not null check (status in ('active', 'needs_human', 'stopped')),
  captured_at timestamptz not null,
  replied_at timestamptz,
  primary key (workspace_id, id)
);

create index if not exists follow_up_leads_enrollment_idx
  on follow_up_leads (workspace_id, enrollment_id);

create table if not exists follow_up_lead_steps (
  id text not null,
  workspace_id text not null references marketer_workspaces (id),
  lead_id text not null,
  enrollment_id text not null,
  step_id text not null check (step_id in ('captured', 'speed-to-lead', 'day-1', 'day-3', 'day-7')),
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

create index if not exists follow_up_lead_steps_due_idx
  on follow_up_lead_steps (workspace_id, status, next_run_at);

create table if not exists follow_up_lead_step_logs (
  id text not null,
  workspace_id text not null,
  step_id text not null,
  at timestamptz not null,
  message text not null,
  primary key (workspace_id, id)
);

alter table marketer_workspaces
  add column if not exists lead_follow_up_kill_switch boolean not null default false;

alter table follow_up_leads enable row level security;
alter table follow_up_leads force row level security;
alter table follow_up_lead_steps enable row level security;
alter table follow_up_lead_steps force row level security;
alter table follow_up_lead_step_logs enable row level security;
alter table follow_up_lead_step_logs force row level security;

drop policy if exists follow_up_leads_tenant on follow_up_leads;
create policy follow_up_leads_tenant on follow_up_leads
  using (workspace_id = app_tenant_id())
  with check (workspace_id = app_tenant_id());

drop policy if exists follow_up_lead_steps_tenant on follow_up_lead_steps;
create policy follow_up_lead_steps_tenant on follow_up_lead_steps
  using (workspace_id = app_tenant_id())
  with check (workspace_id = app_tenant_id());

drop policy if exists follow_up_lead_step_logs_tenant on follow_up_lead_step_logs;
create policy follow_up_lead_step_logs_tenant on follow_up_lead_step_logs
  using (workspace_id = app_tenant_id())
  with check (workspace_id = app_tenant_id());
