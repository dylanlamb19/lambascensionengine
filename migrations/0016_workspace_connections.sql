-- Workspace connections and test-mode billing notices.
-- File only. Do not apply this from a workstation, and do not point it at a
-- production database. There is no token, key, or secret column.

create table if not exists workspace_connections (
  workspace_id text not null references marketer_workspaces (id),
  kind text not null,
  label text not null,
  status text not null default 'missing' check (status in ('missing', 'stub_connected')),
  connected_at timestamptz,
  primary key (workspace_id, kind)
);

create table if not exists billing_webhook_events (
  id text not null,
  workspace_id text not null references marketer_workspaces (id),
  type text not null,
  plan_id text,
  amount_cents integer not null default 0 check (amount_cents = 0),
  billing_mode text not null default 'test' check (billing_mode = 'test'),
  received_at timestamptz not null default now(),
  primary key (workspace_id, id)
);
