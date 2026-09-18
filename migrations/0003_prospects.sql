-- Owner Mode prospects: one authenticated owner, one row per company.
-- user_id is always the verified session id from Better Auth — never a
-- client-supplied user_id. payload is the full Prospect JSON (research,
-- contacts, outreach drafts, history) so nothing is dropped in the move
-- off localStorage.
create table if not exists prospects (
  uid text not null,
  user_id text not null,
  client_id integer not null,
  provider text not null default 'manual',
  provider_place_id text,
  website_domain text,
  name text not null,
  vertical text not null default '',
  city text not null default '',
  stage text not null default 'New',
  research_status text not null default 'none',
  suppressed boolean not null default false,
  payload jsonb not null,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  primary key (user_id, uid)
);

create index if not exists prospects_user_stage_idx on prospects (user_id, stage);
create index if not exists prospects_user_place_idx on prospects (user_id, provider_place_id);
create index if not exists prospects_user_domain_idx on prospects (user_id, website_domain, city);
create index if not exists prospects_user_client_idx on prospects (user_id, client_id);

-- Daily Places Text Search accounting. user_id = '__global__' is the app-wide
-- cap so extra accounts cannot multiply spend. Reserve BEFORE the API call.
create table if not exists discovery_usage (
  user_id text not null,
  day date not null,
  count integer not null default 0,
  cents integer not null default 0,
  primary key (user_id, day)
);

create table if not exists search_cache (
  cache_key text primary key,
  payload jsonb not null,
  expires_at timestamptz not null
);

create table if not exists activity_log (
  id text not null primary key,
  user_id text not null,
  prospect_uid text,
  action text not null,
  detail text not null default '',
  input_method text not null default 'MANUAL',
  created_at timestamptz not null default now()
);

create index if not exists activity_log_user_idx on activity_log (user_id, created_at);
