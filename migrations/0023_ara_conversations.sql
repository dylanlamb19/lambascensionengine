create table if not exists ara_conversations (
  user_id text primary key,
  log jsonb not null default '{"activeId":null,"threads":[]}'::jsonb,
  updated_at timestamptz not null default now()
);
