-- Immutable approved follow-up snapshots, booking expiry, last-send delay.

alter table scheduled_followups add column if not exists recipient text not null default '';
alter table scheduled_followups add column if not exists subject text not null default '';
alter table scheduled_followups add column if not exists body text not null default '';
alter table scheduled_followups add column if not exists approved_at timestamptz not null default now();
alter table scheduled_followups add column if not exists content_hash text not null default '';

alter table booking_links add column if not exists expires_at timestamptz;
update booking_links set expires_at = coalesce(expires_at, created_at + interval '14 days') where expires_at is null;

alter table outreach_usage add column if not exists last_sent_at timestamptz;

create unique index if not exists outreach_sequences_one_active
  on outreach_sequences (user_id, prospect_uid) where status = 'active';
