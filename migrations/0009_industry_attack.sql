-- Industry Attack Mode + owner revenue goals.
-- user_id is always the verified session id. payload is the full brief/ICP JSON.

create table if not exists industry_attacks (
  id text not null,
  user_id text not null,
  industry text not null,
  geography text not null default '',
  status text not null default 'researching',
  payload jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create index if not exists industry_attacks_user_idx on industry_attacks (user_id, updated_at desc);

create table if not exists owner_goals (
  user_id text primary key,
  monthly_mrr_target integer,
  average_retainer_target integer,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
