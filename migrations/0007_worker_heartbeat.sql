-- Durable proof that the outreach worker actually ran.

create table if not exists outreach_worker_heartbeat (
  id text primary key,
  last_started_at timestamptz,
  last_completed_at timestamptz,
  last_result text not null default '',
  run_id text,
  last_error text not null default '',
  source text not null default '',
  updated_at timestamptz not null default now()
);

insert into outreach_worker_heartbeat (id, last_result)
values ('global', '')
on conflict (id) do nothing;

alter table sales_test_state add column if not exists worker_run_id text;
alter table sales_test_state add column if not exists worker_seen_at timestamptz;
