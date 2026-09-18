-- Owner visual assets (uploads + generated). Bytes stay server-side; the API serves them only to the owner.

create table if not exists visual_assets (
  id text not null,
  user_id text not null,
  nsfw boolean not null default false,
  label text not null,
  mime text not null default 'image/jpeg',
  source text not null default 'upload',
  license text,
  prompt text,
  path text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, id)
);

create index if not exists visual_assets_user_idx on visual_assets (user_id, created_at desc);
