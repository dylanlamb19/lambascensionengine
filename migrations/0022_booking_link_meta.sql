alter table booking_links add column if not exists contact_email text not null default '';
alter table booking_links add column if not exists thread_id text not null default '';
