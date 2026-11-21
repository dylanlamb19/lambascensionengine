-- Meta Ads drafts, Office Automation drafts, and bundle kill cascade.
-- File only. Do not apply this from a workstation, and do not point it at a
-- production database.
-- Budget figures are a recorded ceiling check. There is no token, key, or
-- spend column, and invoice reminders do not charge.
-- The tick stays off until PACKAGE_FULFILLMENT is on.

alter table marketer_workspaces
  add column if not exists meta_ads_kill_switch boolean not null default false;

alter table marketer_workspaces
  add column if not exists office_automation_kill_switch boolean not null default false;

alter table package_enrollments
  add column if not exists cascade_from_enrollment_id text;

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
  check (package_id in (
    'lead-generation',
    'ai-visibility',
    'reviews-gbp',
    'google-ads',
    'meta-ads',
    'office-automation'
  ));

create table if not exists meta_budget_notes (
  workspace_id text not null references marketer_workspaces (id),
  enrollment_id text not null,
  client_id text not null,
  proposed_cents integer check (proposed_cents is null or proposed_cents >= 0),
  ambiguous boolean not null default false,
  status text not null check (status in ('open', 'approved')),
  updated_at timestamptz not null,
  primary key (workspace_id, enrollment_id)
);

create table if not exists office_workflows (
  workspace_id text not null references marketer_workspaces (id),
  enrollment_id text not null,
  client_id text not null,
  kind text not null default '' check (kind in ('', 'document-collection', 'sold-job-handoff', 'invoice-reminders')),
  ambiguous boolean not null default false,
  schedule_note text not null default '',
  updated_at timestamptz not null,
  primary key (workspace_id, enrollment_id)
);

alter table meta_budget_notes enable row level security;
alter table meta_budget_notes force row level security;
alter table office_workflows enable row level security;
alter table office_workflows force row level security;

drop policy if exists meta_budget_notes_tenant on meta_budget_notes;
create policy meta_budget_notes_tenant on meta_budget_notes
  using (workspace_id = app_tenant_id())
  with check (workspace_id = app_tenant_id());

drop policy if exists office_workflows_tenant on office_workflows;
create policy office_workflows_tenant on office_workflows
  using (workspace_id = app_tenant_id())
  with check (workspace_id = app_tenant_id());
