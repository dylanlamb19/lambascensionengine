-- Gmail + Calendar + follow-up automation. Tokens never live in prospect JSON.
-- Every row is scoped to the authenticated owner (user_id).

create table if not exists google_accounts (
  id text primary key,
  user_id text not null,
  kind text not null,
  google_sub text not null default '',
  email text not null default '',
  scopes text not null default '',
  token_ciphertext text not null,
  token_iv text not null,
  token_tag text not null,
  status text not null default 'connected',
  last_error text not null default '',
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, kind)
);

create table if not exists oauth_states (
  state text primary key,
  user_id text not null,
  kind text not null,
  nonce text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz
);

create table if not exists email_threads (
  id text primary key,
  user_id text not null,
  prospect_uid text not null,
  gmail_thread_id text,
  subject text not null default '',
  status text not null default 'open',
  created_at timestamptz not null default now()
);

create unique index if not exists email_threads_user_gmail_idx
  on email_threads (user_id, gmail_thread_id) where gmail_thread_id is not null;

create table if not exists email_messages (
  id text primary key,
  user_id text not null,
  prospect_uid text not null,
  thread_id text,
  gmail_message_id text,
  gmail_thread_id text,
  direction text not null,
  recipient text not null default '',
  subject text not null default '',
  body text not null default '',
  status text not null,
  kind text not null default 'email',
  idempotency_key text not null,
  input_method text not null default 'MANUAL',
  sequence_id text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, idempotency_key)
);

create table if not exists outreach_sequences (
  id text primary key,
  user_id text not null,
  prospect_uid text not null,
  status text not null default 'active',
  approved_at timestamptz not null default now(),
  approved_method text not null default 'MANUAL',
  created_at timestamptz not null default now()
);

create table if not exists scheduled_followups (
  id text primary key,
  user_id text not null,
  prospect_uid text not null,
  sequence_id text not null,
  step text not null,
  due_at timestamptz not null,
  status text not null default 'scheduled',
  attempt_count integer not null default 0,
  idempotency_key text not null,
  gmail_thread_id text,
  claimed_at timestamptz,
  unique (user_id, idempotency_key)
);

create index if not exists scheduled_followups_due_idx
  on scheduled_followups (status, due_at);

create table if not exists reply_events (
  id text primary key,
  user_id text not null,
  prospect_uid text not null,
  gmail_message_id text,
  classification text not null,
  body text not null default '',
  created_at timestamptz not null default now()
);

create unique index if not exists reply_events_gmail_idx
  on reply_events (user_id, gmail_message_id) where gmail_message_id is not null;

create table if not exists calendar_events (
  id text primary key,
  user_id text not null,
  prospect_uid text not null,
  google_event_id text,
  title text not null default '',
  start_at timestamptz not null,
  end_at timestamptz not null,
  status text not null default 'booked',
  booking_token text,
  created_at timestamptz not null default now()
);

create unique index if not exists calendar_events_token_idx
  on calendar_events (booking_token) where booking_token is not null;

create table if not exists booking_links (
  token text primary key,
  user_id text not null,
  prospect_uid text not null,
  status text not null default 'open',
  created_at timestamptz not null default now()
);

create table if not exists outreach_settings (
  user_id text primary key,
  max_first_per_day integer not null default 15,
  max_followups_per_day integer not null default 30,
  min_delay_minutes integer not null default 20,
  work_start integer not null default 8,
  work_end integer not null default 17,
  work_days text not null default '1,2,3,4,5',
  timezone text not null default 'America/Chicago'
);

create table if not exists outreach_usage (
  user_id text not null,
  day date not null,
  first_sends integer not null default 0,
  followup_sends integer not null default 0,
  primary key (user_id, day)
);

create table if not exists outreach_audit (
  id text primary key,
  user_id text not null,
  prospect_uid text,
  action text not null,
  detail text not null default '',
  input_method text not null default 'MANUAL',
  sequence_id text,
  provider_ids text not null default '',
  created_at timestamptz not null default now()
);
