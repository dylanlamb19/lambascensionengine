-- Tenant isolation for marketer workspaces.
-- File only. Do not apply this from a workstation, and do not point it at a
-- production database.
-- app.tenant_id is the session tenant. workspace_id (or id on the workspace
-- row) must match it. No credential columns.

create table if not exists workspace_memberships (
  workspace_id text not null references marketer_workspaces (id),
  user_id text not null,
  email text not null,
  role text not null check (role in ('owner', 'marketer')),
  status text not null default 'accepted' check (status = 'accepted'),
  primary key (workspace_id, user_id)
);

create table if not exists workspace_invites (
  id text not null,
  workspace_id text not null references marketer_workspaces (id),
  email text not null,
  status text not null check (status in ('pending', 'accepted', 'revoked')),
  invited_by_user_id text not null,
  created_at timestamptz not null default now(),
  primary key (workspace_id, id)
);

create table if not exists test_invoices (
  id text not null,
  workspace_id text not null references marketer_workspaces (id),
  status text not null check (status in ('open', 'paid', 'void')),
  amount_cents integer not null default 0 check (amount_cents = 0),
  billing_mode text not null default 'test' check (billing_mode = 'test'),
  created_at timestamptz not null default now(),
  primary key (workspace_id, id)
);

alter table marketer_subscriptions add column if not exists lifecycle text not null default 'trial';

create or replace function app_tenant_id() returns text
language sql stable as $$
  select nullif(current_setting('app.tenant_id', true), '')
$$;

-- Policies compare the row tenant to the session tenant. FORCE keeps the
-- table owner inside the same rule.
do $$
declare
  spec record;
begin
  for spec in
    select * from (values
      ('marketer_workspaces', 'id'),
      ('marketer_subscriptions', 'workspace_id'),
      ('service_clients', 'workspace_id'),
      ('package_enrollments', 'workspace_id'),
      ('package_step_runs', 'workspace_id'),
      ('package_step_logs', 'workspace_id'),
      ('workspace_connections', 'workspace_id'),
      ('billing_webhook_events', 'workspace_id'),
      ('workspace_memberships', 'workspace_id'),
      ('workspace_invites', 'workspace_id'),
      ('test_invoices', 'workspace_id')
    ) as t(table_name, tenant_column)
  loop
    execute format('alter table %I enable row level security', spec.table_name);
    execute format('alter table %I force row level security', spec.table_name);
    execute format('drop policy if exists %I on %I', spec.table_name || '_tenant', spec.table_name);
    execute format(
      'create policy %I on %I using (%I = app_tenant_id()) with check (%I = app_tenant_id())',
      spec.table_name || '_tenant',
      spec.table_name,
      spec.tenant_column,
      spec.tenant_column
    );
  end loop;
end $$;
