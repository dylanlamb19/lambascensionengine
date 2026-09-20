-- Real AI image generation metadata, usage caps, and durable bytes.
-- Secrets never live on these rows.

alter table visual_assets add column if not exists provider text;
alter table visual_assets add column if not exists model text;
alter table visual_assets add column if not exists intended_use text not null default 'general';
alter table visual_assets add column if not exists width integer;
alter table visual_assets add column if not exists height integer;
alter table visual_assets add column if not exists safety_status text not null default 'owner_private';
alter table visual_assets add column if not exists aspect_ratio text;
alter table visual_assets add column if not exists prompt_hash text;
alter table visual_assets add column if not exists data_b64 text;

create index if not exists visual_assets_prompt_hash_idx on visual_assets (user_id, prompt_hash, created_at desc);

create table if not exists image_generation_usage (
  user_id text not null,
  day text not null,
  count integer not null default 0,
  last_prompt_hash text,
  last_asset_id text,
  last_at timestamptz,
  primary key (user_id, day)
);

create table if not exists image_generation_settings (
  user_id text primary key,
  daily_cap integer not null default 12,
  updated_at timestamptz not null default now()
);
