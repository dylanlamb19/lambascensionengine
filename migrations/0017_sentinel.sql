-- Lascengine Sentinel: inspect-only reliability ledger.
-- Never stores OAuth secrets. Never sends mail. Never mutates sales state.

create table if not exists sentinel_runs (
  id text primary key,
  user_id text not null default '',
  mode text not null,
  environment text not null default 'production',
  production_sha text not null default '',
  previous_sha text not null default '',
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  overall text not null default 'unknown',
  summary text not null default '',
  check_count integer not null default 0,
  finding_count integer not null default 0,
  payload jsonb not null default '{}'::jsonb
);

create index if not exists sentinel_runs_started_idx on sentinel_runs (started_at desc);

create table if not exists sentinel_bugs (
  bug_id text primary key,
  signature text not null unique,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  status text not null default 'open',
  severity text not null,
  feature text not null,
  environment text not null default 'production',
  production_sha text not null default '',
  error_code text not null,
  summary text not null,
  evidence jsonb not null default '{}'::jsonb,
  reproduction_steps text not null default '',
  affected_records jsonb not null default '[]'::jsonb,
  suspected_commit text not null default '',
  regression_test text not null default '',
  fix_branch text not null default '',
  fix_commit text not null default '',
  verification_status text not null default 'unverified',
  occurrence_count integer not null default 1,
  resolved_at timestamptz
);

create index if not exists sentinel_bugs_open_idx on sentinel_bugs (status, severity, last_seen_at desc);

create table if not exists sentinel_heartbeats (
  name text primary key,
  last_ok_at timestamptz,
  last_check_at timestamptz,
  last_code text not null default '',
  last_detail text not null default '',
  observed_ok boolean not null default false
);

insert into sentinel_heartbeats (name, last_detail)
values
  ('worker', ''),
  ('gmail', ''),
  ('calendar', ''),
  ('places', ''),
  ('db', ''),
  ('sentinel', '')
on conflict (name) do nothing;

create table if not exists sentinel_deployments (
  id text primary key,
  previous_sha text not null default '',
  new_sha text not null,
  recorded_at timestamptz not null default now(),
  test_result text not null default '',
  smoke_result text not null default '',
  new_errors jsonb not null default '[]'::jsonb,
  resolved_errors jsonb not null default '[]'::jsonb,
  rollback_recommended boolean not null default false,
  rollback_reason text not null default '',
  known_good_sha text not null default ''
);

create index if not exists sentinel_deployments_recorded_idx on sentinel_deployments (recorded_at desc);
