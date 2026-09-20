-- Owner visual theme. user_id is the verified session id. payload is the full theme JSON.

create table if not exists visual_theme (
  user_id text primary key,
  payload jsonb not null,
  updated_at timestamptz not null default now()
);
