create table if not exists private.mcp_connector_tokens (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  token_hash text not null unique,
  token_prefix text not null,
  label text not null,
  scopes text[] not null default array['read']::text[],
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  expires_at timestamptz,
  revoked_at timestamptz,
  constraint mcp_connector_label_check
    check (char_length(trim(label)) between 1 and 80),
  constraint mcp_connector_scopes_check
    check (
      cardinality(scopes) > 0
      and scopes <@ array['read','write','media']::text[]
    ),
  constraint mcp_connector_prefix_check
    check (token_prefix ~ '^vcmcp_[A-Za-z0-9_-]{6,24}$')
);

create index if not exists mcp_connector_tokens_team_idx
  on private.mcp_connector_tokens(team_id, created_at desc);
create index if not exists mcp_connector_tokens_owner_idx
  on private.mcp_connector_tokens(owner_id, created_at desc);
create index if not exists mcp_connector_tokens_active_hash_idx
  on private.mcp_connector_tokens(token_hash)
  where enabled is true and revoked_at is null;

revoke all on private.mcp_connector_tokens from public, anon, authenticated;
grant usage on schema private to service_role;
grant select, insert, update, delete on private.mcp_connector_tokens to service_role;
