-- Daily usage accounting for Ara live web research (xAI web_search / Responses API).
-- Reservations happen SERVER-SIDE before the provider call. Failed calls still
-- consume a slot (no refund) so a retry storm cannot multiply spend.
-- user_id = '__global__' is the app-wide cap.
create table if not exists ara_research_usage (
  user_id text not null,
  day date not null,
  kind text not null,
  count integer not null default 0,
  primary key (user_id, day, kind)
);

create table if not exists ara_research_cache (
  user_id text not null,
  query_hash text not null,
  mode text not null,
  payload text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, query_hash, mode)
);
