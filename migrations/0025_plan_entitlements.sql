-- Plan entitlements, per-period usage meters, the onboarding wizard, and the operator audit.
-- File only. Do not apply this from a workstation, and do not point it at a
-- production database.
-- PLAN_ENTITLEMENTS, ONBOARDING_WIZARD, and OPERATOR_CONSOLE stay off until
-- those flags are turned on. There is no payment key and no charge column
-- that can leave zero. Lead import mode is dry-run only.

alter table scaffold_subscriptions add column if not exists trial_ends_at timestamptz;
alter table marketer_workspaces add column if not exists operator_suspended boolean not null default false;

create table if not exists usage_meters (
  workspace_id text not null references marketer_workspaces (id),
  period_start timestamptz not null,
  period_end timestamptz not null,
  client_workspaces integer not null default 0 check (client_workspaces >= 0),
  active_pipelines integer not null default 0 check (active_pipelines >= 0),
  team_seats integer not null default 0 check (team_seats >= 0),
  monthly_runs integer not null default 0 check (monthly_runs >= 0),
  primary key (workspace_id, period_start)
);

create table if not exists wizard_progress (
  workspace_id text primary key references marketer_workspaces (id),
  step text not null check (step in ('branding', 'plan', 'client', 'packages', 'leads', 'next')),
  completed jsonb not null default '[]'::jsonb,
  skipped jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  finished_at timestamptz
);

create table if not exists lead_import_rows (
  id text not null,
  workspace_id text not null references marketer_workspaces (id),
  client_id text not null,
  contact_name text not null,
  contact_email text not null,
  contact_phone text not null default '',
  source text not null default '',
  mode text not null default 'dry_run' check (mode = 'dry_run'),
  created_at timestamptz not null default now(),
  primary key (workspace_id, id)
);

create table if not exists operator_audit_log (
  id text primary key,
  actor_user_id text not null,
  action text not null check (action in ('list_tenants', 'view_tenant', 'suspend', 'resume', 'kill_pipelines')),
  workspace_id text,
  created_at timestamptz not null default now()
);

alter table usage_meters enable row level security;
alter table usage_meters force row level security;
alter table wizard_progress enable row level security;
alter table wizard_progress force row level security;
alter table lead_import_rows enable row level security;
alter table lead_import_rows force row level security;
alter table operator_audit_log enable row level security;
alter table operator_audit_log force row level security;

drop policy if exists usage_meters_tenant on usage_meters;
create policy usage_meters_tenant on usage_meters
  using (workspace_id = app_tenant_id())
  with check (workspace_id = app_tenant_id());

drop policy if exists wizard_progress_tenant on wizard_progress;
create policy wizard_progress_tenant on wizard_progress
  using (workspace_id = app_tenant_id())
  with check (workspace_id = app_tenant_id());

drop policy if exists lead_import_rows_tenant on lead_import_rows;
create policy lead_import_rows_tenant on lead_import_rows
  using (workspace_id = app_tenant_id())
  with check (workspace_id = app_tenant_id());

-- A tenant session cannot read or write the operator log. The platform
-- setting is separate from app.tenant_id, and a tenant id blocks it.
drop policy if exists operator_audit_log_platform on operator_audit_log;
create policy operator_audit_log_platform on operator_audit_log
  using (
    current_setting('app.platform_operator', true) = 'on'
    and app_tenant_id() is null
  )
  with check (
    current_setting('app.platform_operator', true) = 'on'
    and app_tenant_id() is null
  );
