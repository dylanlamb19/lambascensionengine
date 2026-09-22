-- In-app LinkedIn Grok Bot agent: chat thread + work orders.
-- Orders are polled/acted on externally. No LinkedIn scraping in-app.

create table if not exists linkedin_agent_messages (
  id text primary key,
  user_id text not null,
  role text not null check (role in ('user', 'linkedin', 'ara', 'system')),
  body text not null default '',
  created_at timestamptz not null default now(),
  meta jsonb not null default '{}'::jsonb
);

create index if not exists linkedin_agent_messages_user_created_idx
  on linkedin_agent_messages (user_id, created_at asc);

create table if not exists linkedin_agent_orders (
  id text primary key,
  user_id text not null,
  status text not null default 'queued'
    check (status in ('queued', 'claimed', 'done', 'failed', 'cancelled')),
  kind text not null
    check (kind in ('fill_leads', 'enrich', 'outreach', 'chat_reply', 'custom')),
  payload jsonb not null default '{}'::jsonb,
  result jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  claimed_at timestamptz
);

create index if not exists linkedin_agent_orders_user_status_idx
  on linkedin_agent_orders (user_id, status, created_at asc);

create index if not exists linkedin_agent_orders_queued_idx
  on linkedin_agent_orders (status, created_at asc)
  where status = 'queued';
