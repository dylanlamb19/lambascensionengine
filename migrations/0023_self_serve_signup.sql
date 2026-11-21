-- Self-serve signup, sessions, and workspace branding.
-- File only. Do not apply this from a workstation, and do not point it at a
-- production database.
-- Better Auth public registration stays disabled. This schema is for the
-- separate SELF_SERVE_SIGNUP path, which is off until that flag is turned on.
-- Verification and password reset mail are dry-run rows. There is no provider
-- key, no payment key, and no charge column.

alter table workspace_memberships drop constraint if exists workspace_memberships_role_check;

alter table workspace_memberships
  add constraint workspace_memberships_role_check
  check (role in ('owner', 'admin', 'member', 'marketer'));

create table if not exists workspace_branding (
  workspace_id text primary key references marketer_workspaces (id),
  logo_url text not null default '',
  brand_primary text not null default '',
  brand_accent text not null default '',
  sender_display_name text not null default '',
  timezone text not null default 'UTC'
);

create table if not exists workspace_logos (
  workspace_id text primary key references marketer_workspaces (id),
  content_type text not null check (content_type in ('image/png', 'image/jpeg', 'image/webp')),
  data_base64 text not null check (char_length(data_base64) <= 48000),
  updated_at timestamptz not null default now()
);

create table if not exists account_sessions (
  id text primary key,
  user_id text not null,
  workspace_id text not null references marketer_workspaces (id),
  csrf_token text not null,
  created_at timestamptz not null default now(),
  rotated_from text
);

-- Pre-tenant rows. The route layer does not return these to a workspace page.
-- The mail log cannot record a live send.

create table if not exists pending_signups (
  id text primary key,
  email text not null unique,
  password_hash text not null,
  workspace_name text not null,
  token_hash text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table if not exists password_resets (
  id text primary key,
  email text not null,
  token_hash text not null,
  expires_at timestamptz not null,
  used_at timestamptz
);

create table if not exists signup_attempts (
  id text primary key,
  bucket text not null,
  created_at timestamptz not null default now()
);

create table if not exists account_mail_log (
  id text primary key,
  kind text not null check (kind in ('verify', 'reset')),
  recipient text not null,
  mode text not null default 'dry_run' check (mode = 'dry_run'),
  created_at timestamptz not null default now()
);

alter table workspace_branding enable row level security;
alter table workspace_branding force row level security;
alter table workspace_logos enable row level security;
alter table workspace_logos force row level security;
alter table account_sessions enable row level security;
alter table account_sessions force row level security;

drop policy if exists workspace_branding_tenant on workspace_branding;
create policy workspace_branding_tenant on workspace_branding
  using (workspace_id = app_tenant_id())
  with check (workspace_id = app_tenant_id());

drop policy if exists workspace_logos_tenant on workspace_logos;
create policy workspace_logos_tenant on workspace_logos
  using (workspace_id = app_tenant_id())
  with check (workspace_id = app_tenant_id());

drop policy if exists account_sessions_tenant on account_sessions;
create policy account_sessions_tenant on account_sessions
  using (workspace_id = app_tenant_id())
  with check (workspace_id = app_tenant_id());
