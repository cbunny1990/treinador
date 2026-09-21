create or replace function public.mcp_connector_create(
  p_team_id uuid,
  p_owner_id uuid,
  p_token_hash text,
  p_token_prefix text,
  p_label text,
  p_scopes text[],
  p_expires_at timestamptz default null
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public, private
as $$
declare
  v_row private.mcp_connector_tokens%rowtype;
begin
  if not exists (
    select 1 from public.teams t
    where t.id=p_team_id and t.owner_id=p_owner_id
  ) then
    raise exception 'connector_owner_required';
  end if;

  insert into private.mcp_connector_tokens(
    team_id,owner_id,token_hash,token_prefix,label,scopes,expires_at
  ) values (
    p_team_id,p_owner_id,p_token_hash,p_token_prefix,trim(p_label),p_scopes,p_expires_at
  )
  returning * into v_row;

  return jsonb_build_object(
    'id',v_row.id,
    'team_id',v_row.team_id,
    'label',v_row.label,
    'scopes',to_jsonb(v_row.scopes),
    'token_prefix',v_row.token_prefix,
    'enabled',v_row.enabled,
    'created_at',v_row.created_at,
    'expires_at',v_row.expires_at
  );
end;
$$;

create or replace function public.mcp_connector_list(
  p_team_id uuid,
  p_owner_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public, private
as $$
begin
  if not exists (
    select 1 from public.teams t
    where t.id=p_team_id and t.owner_id=p_owner_id
  ) then
    raise exception 'connector_owner_required';
  end if;

  return coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'id',c.id,
        'team_id',c.team_id,
        'label',c.label,
        'scopes',to_jsonb(c.scopes),
        'token_prefix',c.token_prefix,
        'enabled',c.enabled,
        'created_at',c.created_at,
        'last_used_at',c.last_used_at,
        'expires_at',c.expires_at,
        'revoked_at',c.revoked_at
      )
      order by c.created_at desc
    )
    from private.mcp_connector_tokens c
    where c.team_id=p_team_id and c.owner_id=p_owner_id
  ), '[]'::jsonb);
end;
$$;

create or replace function public.mcp_connector_revoke(
  p_token_id uuid,
  p_team_id uuid,
  p_owner_id uuid
)
returns boolean
language plpgsql
security invoker
set search_path = pg_catalog, public, private
as $$
declare
  v_count integer;
begin
  if not exists (
    select 1 from public.teams t
    where t.id=p_team_id and t.owner_id=p_owner_id
  ) then
    raise exception 'connector_owner_required';
  end if;

  update private.mcp_connector_tokens
  set enabled=false,
      revoked_at=coalesce(revoked_at,now())
  where id=p_token_id
    and team_id=p_team_id
    and owner_id=p_owner_id
    and revoked_at is null;

  get diagnostics v_count = row_count;
  return v_count > 0;
end;
$$;

create or replace function public.mcp_connector_lookup(
  p_token_hash text
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, private
as $$
declare
  v_row private.mcp_connector_tokens%rowtype;
begin
  update private.mcp_connector_tokens c
  set last_used_at=now()
  where c.token_hash=p_token_hash
    and c.enabled is true
    and c.revoked_at is null
    and (c.expires_at is null or c.expires_at > now())
  returning c.* into v_row;

  if not found then
    return null;
  end if;

  return jsonb_build_object(
    'id',v_row.id,
    'team_id',v_row.team_id,
    'owner_id',v_row.owner_id,
    'label',v_row.label,
    'scopes',to_jsonb(v_row.scopes),
    'token_prefix',v_row.token_prefix,
    'expires_at',v_row.expires_at
  );
end;
$$;

revoke all on function public.mcp_connector_create(uuid,uuid,text,text,text,text[],timestamptz)
  from public, anon, authenticated;
grant execute on function public.mcp_connector_create(uuid,uuid,text,text,text,text[],timestamptz)
  to service_role;

revoke all on function public.mcp_connector_list(uuid,uuid)
  from public, anon, authenticated;
grant execute on function public.mcp_connector_list(uuid,uuid)
  to service_role;

revoke all on function public.mcp_connector_revoke(uuid,uuid,uuid)
  from public, anon, authenticated;
grant execute on function public.mcp_connector_revoke(uuid,uuid,uuid)
  to service_role;

revoke all on function public.mcp_connector_lookup(text)
  from public, anon, authenticated;
grant execute on function public.mcp_connector_lookup(text)
  to service_role;
