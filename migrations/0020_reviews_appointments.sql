-- Reviews, Google Business Profile drafts, and appointment reminders.
-- File only. Do not apply this from a workstation, and do not point it at a
-- production database.
-- Review requests require a completed job. There is no rating column and no
-- secret column. Appointment rows name the workspace booking calendar only.
-- The tick stays off until PACKAGE_FULFILLMENT is on.

alter table marketer_workspaces
  add column if not exists reviews_kill_switch boolean not null default false;

alter table marketer_workspaces
  add column if not exists appointment_reminders_kill_switch boolean not null default false;

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
  check (package_id in ('lead-generation', 'ai-visibility', 'reviews-gbp'));

create table if not exists completed_jobs (
  id text not null,
  workspace_id text not null references marketer_workspaces (id),
  client_id text not null,
  enrollment_id text not null,
  customer_name text not null,
  customer_email text not null default '',
  customer_phone text not null default '',
  job_label text not null,
  completed_at timestamptz not null,
  recorded_at timestamptz not null,
  status text not null check (status = 'completed'),
  primary key (workspace_id, id)
);

create index if not exists completed_jobs_client_idx
  on completed_jobs (workspace_id, client_id);

create table if not exists review_request_steps (
  id text not null,
  workspace_id text not null references marketer_workspaces (id),
  job_id text not null,
  enrollment_id text not null,
  step_id text not null check (step_id = 'review-request'),
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

create index if not exists review_request_steps_due_idx
  on review_request_steps (workspace_id, status, next_run_at);

create table if not exists review_request_step_logs (
  id text not null,
  workspace_id text not null,
  step_id text not null,
  at timestamptz not null,
  message text not null,
  primary key (workspace_id, id)
);

create table if not exists stored_reviews (
  id text not null,
  workspace_id text not null references marketer_workspaces (id),
  client_id text not null,
  enrollment_id text not null,
  reviewer_name text not null,
  body text not null,
  recorded_at timestamptz not null,
  primary key (workspace_id, id)
);

create table if not exists client_appointments (
  id text not null,
  workspace_id text not null references marketer_workspaces (id),
  client_id text not null,
  enrollment_id text not null,
  customer_name text not null,
  customer_email text not null default '',
  customer_phone text not null default '',
  starts_at timestamptz not null,
  calendar text not null check (calendar = 'booking_calendar'),
  status text not null check (status in ('active', 'needs_human', 'stopped')),
  response text not null check (response in ('none', 'confirmed', 'rescheduled')),
  outcome text not null check (outcome in ('unset', 'attended', 'no_show')),
  last_note text not null default '',
  recorded_at timestamptz not null,
  primary key (workspace_id, id)
);

create index if not exists client_appointments_client_idx
  on client_appointments (workspace_id, client_id);

create table if not exists appointment_steps (
  id text not null,
  workspace_id text not null references marketer_workspaces (id),
  appointment_id text not null,
  enrollment_id text not null,
  step_id text not null check (step_id in ('confirm', 'reminder-24h', 'reminder-2h', 'no-show')),
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

create index if not exists appointment_steps_due_idx
  on appointment_steps (workspace_id, status, next_run_at);

create table if not exists appointment_step_logs (
  id text not null,
  workspace_id text not null,
  step_id text not null,
  at timestamptz not null,
  message text not null,
  primary key (workspace_id, id)
);

alter table completed_jobs enable row level security;
alter table completed_jobs force row level security;
alter table review_request_steps enable row level security;
alter table review_request_steps force row level security;
alter table review_request_step_logs enable row level security;
alter table review_request_step_logs force row level security;
alter table stored_reviews enable row level security;
alter table stored_reviews force row level security;
alter table client_appointments enable row level security;
alter table client_appointments force row level security;
alter table appointment_steps enable row level security;
alter table appointment_steps force row level security;
alter table appointment_step_logs enable row level security;
alter table appointment_step_logs force row level security;

drop policy if exists completed_jobs_tenant on completed_jobs;
create policy completed_jobs_tenant on completed_jobs
  using (workspace_id = app_tenant_id())
  with check (workspace_id = app_tenant_id());

drop policy if exists review_request_steps_tenant on review_request_steps;
create policy review_request_steps_tenant on review_request_steps
  using (workspace_id = app_tenant_id())
  with check (workspace_id = app_tenant_id());

drop policy if exists review_request_step_logs_tenant on review_request_step_logs;
create policy review_request_step_logs_tenant on review_request_step_logs
  using (workspace_id = app_tenant_id())
  with check (workspace_id = app_tenant_id());

drop policy if exists stored_reviews_tenant on stored_reviews;
create policy stored_reviews_tenant on stored_reviews
  using (workspace_id = app_tenant_id())
  with check (workspace_id = app_tenant_id());

drop policy if exists client_appointments_tenant on client_appointments;
create policy client_appointments_tenant on client_appointments
  using (workspace_id = app_tenant_id())
  with check (workspace_id = app_tenant_id());

drop policy if exists appointment_steps_tenant on appointment_steps;
create policy appointment_steps_tenant on appointment_steps
  using (workspace_id = app_tenant_id())
  with check (workspace_id = app_tenant_id());

drop policy if exists appointment_step_logs_tenant on appointment_step_logs;
create policy appointment_step_logs_tenant on appointment_step_logs
  using (workspace_id = app_tenant_id())
  with check (workspace_id = app_tenant_id());
