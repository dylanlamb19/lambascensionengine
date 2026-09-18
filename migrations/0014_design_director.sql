-- ChatGPT Design Director + shared design document. user_id is the verified session id.
-- Design history and optional owner-stored OpenAI key (encrypted). No secrets in plaintext.

create table if not exists design_document (
  user_id text primary key,
  payload jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists design_session (
  user_id text primary key,
  status text not null default 'disconnected',
  paused boolean not null default false,
  viewport text not null default 'mobile',
  selected_component text,
  openai_previous_response_id text,
  preview jsonb,
  baseline jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists design_history (
  id text primary key,
  user_id text not null,
  at timestamptz not null default now(),
  actor text not null,
  ops jsonb not null,
  previous jsonb not null,
  resulting jsonb not null,
  spoken text
);

create index if not exists design_history_user_at on design_history (user_id, at desc);

create table if not exists owner_secrets (
  user_id text not null,
  kind text not null,
  ciphertext text not null,
  iv text not null,
  tag text not null,
  last4 text,
  updated_at timestamptz not null default now(),
  primary key (user_id, kind)
);
