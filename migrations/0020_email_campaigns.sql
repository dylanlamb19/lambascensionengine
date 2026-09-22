-- Email Campaigns OS: campaign-level authorization for first contacts + follow-ups.
-- Test Mode default ON (test_mode_only=true, live_enabled=false). Fail closed.
-- Does not invent emails/metrics. Reply sync remains outrank of discovery/first contact.

create table if not exists email_campaigns (
  id text primary key,
  user_id text not null,
  name text not null default '',
  status text not null default 'draft'
    check (status in ('draft','armed','running','paused','completed','cancelled')),
  verticals jsonb not null default '[]'::jsonb,
  locations jsonb not null default '[]'::jsonb,
  require_usable_email boolean not null default true,
  min_fit text not null default 'possible',
  max_first_contacts_per_day integer not null default 15,
  test_mode_only boolean not null default true,
  live_enabled boolean not null default false,
  subject_template text not null default '',
  body_template text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists email_campaigns_user_status_idx
  on email_campaigns (user_id, status, updated_at desc);

create table if not exists email_campaign_members (
  campaign_id text not null references email_campaigns(id) on delete cascade,
  prospect_uid text not null,
  status text not null default 'queued'
    check (status in ('queued','eligible','skipped','authorized','sent','replied','suppressed','failed')),
  skip_reason text not null default '',
  message_subject text not null default '',
  message_body text not null default '',
  message_hash text not null default '',
  eligibility_snapshot jsonb not null default '{}'::jsonb,
  authorized_at timestamptz,
  send_key text not null default '',
  recipient text not null default '',
  sent_at timestamptz,
  last_error text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (campaign_id, prospect_uid)
);

create index if not exists email_campaign_members_status_idx
  on email_campaign_members (campaign_id, status);

create index if not exists email_campaign_members_send_key_idx
  on email_campaign_members (send_key) where send_key <> '';

create unique index if not exists email_campaign_members_user_send_key_uidx
  on email_campaign_members (campaign_id, send_key) where send_key <> '';
