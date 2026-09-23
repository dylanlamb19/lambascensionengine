alter table outreach_settings add column if not exists autonomy jsonb not null default '{}'::jsonb;
