-- Acquisition OS Part 1/6: contactability auth snapshots + cooldown (Test Mode gated tooling).
-- Does not enable autonomous first contact. Inspect/report only until Autopilot ships.

create table if not exists contact_eligibility_snapshots (
  id text primary key,
  user_id text not null,
  created_at timestamptz not null default now(),
  test_mode boolean not null default true,
  contactable_count integer not null default 0,
  needs_contact_count integer not null default 0,
  needs_research_count integer not null default 0,
  blocked_count integer not null default 0,
  suppressed_count integer not null default 0,
  payload jsonb not null default '{}'::jsonb
);

create index if not exists contact_eligibility_snapshots_user_idx
  on contact_eligibility_snapshots (user_id, created_at desc);

create table if not exists prospect_contact_cooldown (
  user_id text not null,
  prospect_uid text not null,
  cooldown_until timestamptz not null,
  reason text not null default '',
  updated_at timestamptz not null default now(),
  primary key (user_id, prospect_uid)
);
