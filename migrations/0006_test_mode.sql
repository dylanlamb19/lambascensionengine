-- Safe Test Mode: allowlisted recipients only. Default ON until the owner disables it.

alter table outreach_settings add column if not exists test_mode boolean not null default true;
alter table outreach_settings add column if not exists test_allowlist text not null default '';

create table if not exists sales_test_state (
  user_id text primary key,
  recipient text not null default '',
  prospect_uid text,
  message_id text,
  thread_id text,
  sequence_id text,
  followups_before integer not null default 0,
  reply_count integer not null default 0,
  followups_after integer,
  booking_token text,
  event_id text,
  slots_offered integer not null default 0,
  pipeline_stage text,
  step integer not null default 1,
  updated_at timestamptz not null default now()
);
