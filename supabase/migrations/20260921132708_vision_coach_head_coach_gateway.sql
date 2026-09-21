
create table if not exists private.agent_request_log (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  agent_subject text not null,
  idempotency_key text not null,
  operation text not null,
  result_type text,
  result_ref uuid,
  response jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (team_id, agent_subject, idempotency_key)
);

revoke all on private.agent_request_log from public, anon, authenticated;
grant usage on schema private to service_role;
grant select, insert, update on private.agent_request_log to service_role;

create or replace function private.agent_has_scope(
  p_team_id uuid,
  p_agent_subject text,
  p_scope text
)
returns boolean
language sql
stable
security invoker
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.agent_authorizations a
    where a.team_id = p_team_id
      and a.agent_subject = p_agent_subject
      and a.enabled is true
      and p_scope = any(a.scopes)
  );
$$;

revoke all on function private.agent_has_scope(uuid,text,text) from public, anon, authenticated;
grant execute on function private.agent_has_scope(uuid,text,text) to service_role;

create or replace function private.agent_display_label(p_agent_subject text)
returns text
language sql
immutable
security invoker
set search_path = pg_catalog
as $$
  select case
    when p_agent_subject = 'head-coach' then 'Head Coach'
    else p_agent_subject
  end;
$$;

revoke all on function private.agent_display_label(text) from public, anon, authenticated;
grant execute on function private.agent_display_label(text) to service_role;

alter table public.agent_authorizations
  drop constraint if exists agent_authorizations_scopes_allowed;
alter table public.agent_authorizations
  add constraint agent_authorizations_scopes_allowed
  check (
    cardinality(scopes) > 0
    and scopes <@ array['read','write','media']::text[]
  );

create unique index if not exists workspace_records_external_key_unique
  on public.workspace_records (team_id, kind, lower(payload->>'external_key'))
  where deleted_at is null
    and nullif(payload->>'external_key','') is not null;

create unique index if not exists media_assets_storage_path_unique
  on public.media_assets (team_id, storage_path)
  where deleted_at is null
    and storage_path is not null;

create or replace function public.head_coach_capabilities(
  p_team_id uuid,
  p_agent_subject text default 'head-coach'
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public, private
as $$
declare
  v_scopes text[];
begin
  select a.scopes into v_scopes
  from public.agent_authorizations a
  where a.team_id = p_team_id
    and a.agent_subject = p_agent_subject
    and a.enabled is true;

  if v_scopes is null then
    raise exception 'agent_not_authorized';
  end if;

  return jsonb_build_object(
    'schema','vision-coach-head-coach@1',
    'team_id',p_team_id,
    'agent_subject',p_agent_subject,
    'scopes',to_jsonb(v_scopes),
    'operations',jsonb_build_array(
      'capabilities',
      'snapshot',
      'changes_since',
      'get_record',
      'put_record',
      'soft_delete_record',
      'restore_record',
      'register_media',
      'soft_delete_media'
    ),
    'record_kinds',jsonb_build_array(
      'player','match','training','memory','document','game_model'
    ),
    'actor','agent',
    'provenance_label',private.agent_display_label(p_agent_subject)
  );
end;
$$;

create or replace function public.head_coach_snapshot(
  p_team_id uuid,
  p_agent_subject text default 'head-coach',
  p_include_deleted boolean default false,
  p_activity_limit integer default 100
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public, private
as $$
declare
  v_result jsonb;
begin
  if not private.agent_has_scope(p_team_id,p_agent_subject,'read') then
    raise exception 'agent_read_not_authorized';
  end if;

  p_activity_limit := greatest(0, least(coalesce(p_activity_limit,100),500));

  select jsonb_build_object(
    'schema','vision-coach-workspace@1',
    'generated_at',now(),
    'team',(
      select jsonb_build_object(
        'id',t.id,
        'name',t.name,
        'metadata',t.metadata,
        'created_at',t.created_at,
        'updated_at',t.updated_at
      )
      from public.teams t
      where t.id = p_team_id
    ),
    'records',coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id',r.id,
          'kind',r.kind,
          'payload',r.payload,
          'actor_type',r.actor_type,
          'actor_label',r.actor_label,
          'created_at',r.created_at,
          'updated_at',r.updated_at,
          'deleted_at',r.deleted_at
        )
        order by r.updated_at, r.id
      )
      from public.workspace_records r
      where r.team_id = p_team_id
        and (p_include_deleted or r.deleted_at is null)
    ),'[]'::jsonb),
    'media',coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id',m.id,
          'subject_type',m.subject_type,
          'subject_ref',m.subject_ref,
          'media_type',m.media_type,
          'title',m.title,
          'note',m.note,
          'external_url',m.external_url,
          'storage_path',m.storage_path,
          'file_name',m.file_name,
          'mime_type',m.mime_type,
          'size_bytes',m.size_bytes,
          'actor_type',m.actor_type,
          'actor_label',m.actor_label,
          'created_at',m.created_at,
          'updated_at',m.updated_at,
          'deleted_at',m.deleted_at
        )
        order by m.updated_at, m.id
      )
      from public.media_assets m
      where m.team_id = p_team_id
        and (p_include_deleted or m.deleted_at is null)
    ),'[]'::jsonb),
    'activity',coalesce((
      select jsonb_agg(x.item order by x.created_at desc)
      from (
        select
          a.created_at,
          jsonb_build_object(
            'id',a.id,
            'actor_type',a.actor_type,
            'actor_label',a.actor_label,
            'action',a.action,
            'summary',a.summary,
            'entity_type',a.entity_type,
            'entity_ref',a.entity_ref,
            'metadata',a.metadata,
            'created_at',a.created_at
          ) as item
        from public.activity_log a
        where a.team_id = p_team_id
        order by a.created_at desc
        limit p_activity_limit
      ) x
    ),'[]'::jsonb)
  ) into v_result;

  if v_result->'team' = 'null'::jsonb then
    raise exception 'team_not_found';
  end if;

  return v_result;
end;
$$;

create or replace function public.head_coach_changes_since(
  p_team_id uuid,
  p_since timestamptz,
  p_agent_subject text default 'head-coach'
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public, private
as $$
begin
  if not private.agent_has_scope(p_team_id,p_agent_subject,'read') then
    raise exception 'agent_read_not_authorized';
  end if;

  return jsonb_build_object(
    'schema','vision-coach-changes@1',
    'since',p_since,
    'generated_at',now(),
    'records',coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id',r.id,
          'kind',r.kind,
          'payload',r.payload,
          'actor_type',r.actor_type,
          'actor_label',r.actor_label,
          'created_at',r.created_at,
          'updated_at',r.updated_at,
          'deleted_at',r.deleted_at
        )
        order by r.updated_at, r.id
      )
      from public.workspace_records r
      where r.team_id = p_team_id
        and r.updated_at >= p_since
    ),'[]'::jsonb),
    'media',coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id',m.id,
          'subject_type',m.subject_type,
          'subject_ref',m.subject_ref,
          'media_type',m.media_type,
          'title',m.title,
          'note',m.note,
          'external_url',m.external_url,
          'storage_path',m.storage_path,
          'file_name',m.file_name,
          'mime_type',m.mime_type,
          'size_bytes',m.size_bytes,
          'actor_type',m.actor_type,
          'actor_label',m.actor_label,
          'created_at',m.created_at,
          'updated_at',m.updated_at,
          'deleted_at',m.deleted_at
        )
        order by m.updated_at, m.id
      )
      from public.media_assets m
      where m.team_id = p_team_id
        and m.updated_at >= p_since
    ),'[]'::jsonb),
    'activity',coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id',a.id,
          'actor_type',a.actor_type,
          'actor_label',a.actor_label,
          'action',a.action,
          'summary',a.summary,
          'entity_type',a.entity_type,
          'entity_ref',a.entity_ref,
          'metadata',a.metadata,
          'created_at',a.created_at
        )
        order by a.created_at, a.id
      )
      from public.activity_log a
      where a.team_id = p_team_id
        and a.created_at >= p_since
    ),'[]'::jsonb)
  );
end;
$$;

create or replace function public.head_coach_get_record(
  p_team_id uuid,
  p_record_id uuid,
  p_agent_subject text default 'head-coach'
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public, private
as $$
declare
  v_result jsonb;
begin
  if not private.agent_has_scope(p_team_id,p_agent_subject,'read') then
    raise exception 'agent_read_not_authorized';
  end if;

  select jsonb_build_object(
    'id',r.id,
    'kind',r.kind,
    'payload',r.payload,
    'actor_type',r.actor_type,
    'actor_label',r.actor_label,
    'created_at',r.created_at,
    'updated_at',r.updated_at,
    'deleted_at',r.deleted_at
  )
  into v_result
  from public.workspace_records r
  where r.team_id = p_team_id and r.id = p_record_id;

  if v_result is null then
    raise exception 'record_not_found';
  end if;

  return v_result;
end;
$$;

create or replace function public.head_coach_put_record(
  p_team_id uuid,
  p_kind text,
  p_payload jsonb,
  p_record_id uuid default null,
  p_expected_updated_at timestamptz default null,
  p_idempotency_key text default null,
  p_agent_subject text default 'head-coach'
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public, private
as $$
declare
  v_id uuid;
  v_now timestamptz := now();
  v_existing public.workspace_records%rowtype;
  v_result jsonb;
  v_label text := private.agent_display_label(p_agent_subject);
begin
  if not private.agent_has_scope(p_team_id,p_agent_subject,'write') then
    raise exception 'agent_write_not_authorized';
  end if;

  if p_kind not in ('player','match','training','memory','document','game_model') then
    raise exception 'invalid_record_kind';
  end if;

  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'payload_must_be_object';
  end if;

  if p_idempotency_key is not null and length(p_idempotency_key) > 200 then
    raise exception 'idempotency_key_too_long';
  end if;

  if nullif(p_idempotency_key,'') is not null then
    select l.response into v_result
    from private.agent_request_log l
    where l.team_id = p_team_id
      and l.agent_subject = p_agent_subject
      and l.idempotency_key = p_idempotency_key;
    if v_result is not null then
      return v_result;
    end if;
  end if;

  if p_record_id is null then
    v_id := gen_random_uuid();
    insert into public.workspace_records(
      id,team_id,kind,payload,actor_type,actor_label,created_by,created_at,updated_at,deleted_at
    ) values (
      v_id,p_team_id,p_kind,p_payload,'agent',v_label,null,v_now,v_now,null
    );
  else
    select * into v_existing
    from public.workspace_records
    where id = p_record_id and team_id = p_team_id
    for update;

    if not found then
      raise exception 'record_not_found';
    end if;

    if v_existing.deleted_at is not null then
      raise exception 'record_is_deleted';
    end if;

    if p_expected_updated_at is not null and v_existing.updated_at <> p_expected_updated_at then
      raise exception 'record_conflict';
    end if;

    if v_existing.kind <> p_kind then
      raise exception 'record_kind_mismatch';
    end if;

    v_id := p_record_id;
    update public.workspace_records
    set payload = p_payload,
        updated_at = v_now
    where id = v_id;
  end if;

  select jsonb_build_object(
    'id',r.id,
    'kind',r.kind,
    'payload',r.payload,
    'actor_type',r.actor_type,
    'actor_label',r.actor_label,
    'created_at',r.created_at,
    'updated_at',r.updated_at,
    'deleted_at',r.deleted_at
  )
  into v_result
  from public.workspace_records r
  where r.id = v_id;

  insert into public.activity_log(
    id,team_id,actor_type,actor_label,action,summary,entity_type,entity_ref,metadata,created_by,created_at
  ) values (
    gen_random_uuid(),p_team_id,'agent',v_label,
    case when p_record_id is null then 'agent_created_record' else 'agent_updated_record' end,
    case when p_record_id is null then 'Head Coach criou ' else 'Head Coach atualizou ' end || p_kind,
    p_kind,v_id::text,
    jsonb_build_object('idempotency_key',p_idempotency_key),
    null,v_now
  );

  if nullif(p_idempotency_key,'') is not null then
    insert into private.agent_request_log(
      team_id,agent_subject,idempotency_key,operation,result_type,result_ref,response
    ) values (
      p_team_id,p_agent_subject,p_idempotency_key,
      case when p_record_id is null then 'put_record:create' else 'put_record:update' end,
      p_kind,v_id,v_result
    );
  end if;

  return v_result;
end;
$$;

create or replace function public.head_coach_soft_delete_record(
  p_team_id uuid,
  p_record_id uuid,
  p_expected_updated_at timestamptz default null,
  p_idempotency_key text default null,
  p_agent_subject text default 'head-coach'
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public, private
as $$
declare
  v_existing public.workspace_records%rowtype;
  v_result jsonb;
  v_now timestamptz := now();
  v_label text := private.agent_display_label(p_agent_subject);
begin
  if not private.agent_has_scope(p_team_id,p_agent_subject,'write') then
    raise exception 'agent_write_not_authorized';
  end if;

  if nullif(p_idempotency_key,'') is not null then
    select l.response into v_result
    from private.agent_request_log l
    where l.team_id=p_team_id
      and l.agent_subject=p_agent_subject
      and l.idempotency_key=p_idempotency_key;
    if v_result is not null then
      return v_result;
    end if;
  end if;

  select * into v_existing
  from public.workspace_records
  where id=p_record_id and team_id=p_team_id
  for update;

  if not found then
    raise exception 'record_not_found';
  end if;

  if p_expected_updated_at is not null and v_existing.updated_at <> p_expected_updated_at then
    raise exception 'record_conflict';
  end if;

  if v_existing.deleted_at is null then
    update public.workspace_records
    set deleted_at=v_now, updated_at=v_now
    where id=p_record_id;
  end if;

  select jsonb_build_object(
    'id',r.id,'kind',r.kind,'payload',r.payload,
    'actor_type',r.actor_type,'actor_label',r.actor_label,
    'created_at',r.created_at,'updated_at',r.updated_at,'deleted_at',r.deleted_at
  ) into v_result
  from public.workspace_records r
  where r.id=p_record_id;

  insert into public.activity_log(
    id,team_id,actor_type,actor_label,action,summary,entity_type,entity_ref,metadata,created_at
  ) values (
    gen_random_uuid(),p_team_id,'agent',v_label,
    'agent_deleted_record','Head Coach arquivou '||v_existing.kind,
    v_existing.kind,p_record_id::text,
    jsonb_build_object('idempotency_key',p_idempotency_key),v_now
  );

  if nullif(p_idempotency_key,'') is not null then
    insert into private.agent_request_log(
      team_id,agent_subject,idempotency_key,operation,result_type,result_ref,response
    ) values (
      p_team_id,p_agent_subject,p_idempotency_key,
      'soft_delete_record',v_existing.kind,p_record_id,v_result
    );
  end if;

  return v_result;
end;
$$;

create or replace function public.head_coach_restore_record(
  p_team_id uuid,
  p_record_id uuid,
  p_expected_updated_at timestamptz default null,
  p_idempotency_key text default null,
  p_agent_subject text default 'head-coach'
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public, private
as $$
declare
  v_existing public.workspace_records%rowtype;
  v_result jsonb;
  v_now timestamptz := now();
  v_label text := private.agent_display_label(p_agent_subject);
begin
  if not private.agent_has_scope(p_team_id,p_agent_subject,'write') then
    raise exception 'agent_write_not_authorized';
  end if;

  if nullif(p_idempotency_key,'') is not null then
    select l.response into v_result
    from private.agent_request_log l
    where l.team_id=p_team_id
      and l.agent_subject=p_agent_subject
      and l.idempotency_key=p_idempotency_key;
    if v_result is not null then return v_result; end if;
  end if;

  select * into v_existing
  from public.workspace_records
  where id=p_record_id and team_id=p_team_id
  for update;

  if not found then raise exception 'record_not_found'; end if;

  if p_expected_updated_at is not null and v_existing.updated_at <> p_expected_updated_at then
    raise exception 'record_conflict';
  end if;

  if v_existing.deleted_at is not null then
    update public.workspace_records
    set deleted_at=null, updated_at=v_now
    where id=p_record_id;
  end if;

  select jsonb_build_object(
    'id',r.id,'kind',r.kind,'payload',r.payload,
    'actor_type',r.actor_type,'actor_label',r.actor_label,
    'created_at',r.created_at,'updated_at',r.updated_at,'deleted_at',r.deleted_at
  ) into v_result
  from public.workspace_records r
  where r.id=p_record_id;

  insert into public.activity_log(
    id,team_id,actor_type,actor_label,action,summary,entity_type,entity_ref,metadata,created_at
  ) values (
    gen_random_uuid(),p_team_id,'agent',v_label,
    'agent_restored_record','Head Coach restaurou '||v_existing.kind,
    v_existing.kind,p_record_id::text,
    jsonb_build_object('idempotency_key',p_idempotency_key),v_now
  );

  if nullif(p_idempotency_key,'') is not null then
    insert into private.agent_request_log(
      team_id,agent_subject,idempotency_key,operation,result_type,result_ref,response
    ) values (
      p_team_id,p_agent_subject,p_idempotency_key,
      'restore_record',v_existing.kind,p_record_id,v_result
    );
  end if;

  return v_result;
end;
$$;

create or replace function public.head_coach_register_media(
  p_team_id uuid,
  p_subject_type text,
  p_subject_ref text,
  p_media_type text,
  p_title text,
  p_note text default null,
  p_external_url text default null,
  p_storage_path text default null,
  p_file_name text default null,
  p_mime_type text default null,
  p_size_bytes bigint default null,
  p_media_id uuid default null,
  p_expected_updated_at timestamptz default null,
  p_idempotency_key text default null,
  p_agent_subject text default 'head-coach'
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public, private
as $$
declare
  v_id uuid;
  v_existing public.media_assets%rowtype;
  v_result jsonb;
  v_now timestamptz := now();
  v_label text := private.agent_display_label(p_agent_subject);
begin
  if not private.agent_has_scope(p_team_id,p_agent_subject,'media') then
    raise exception 'agent_media_not_authorized';
  end if;

  if p_media_type not in ('photo','video','file') then
    raise exception 'invalid_media_type';
  end if;

  if nullif(trim(coalesce(p_title,'')),'') is null then
    raise exception 'media_title_required';
  end if;

  if p_external_url is null and p_storage_path is null then
    raise exception 'media_location_required';
  end if;

  if nullif(p_idempotency_key,'') is not null then
    select l.response into v_result
    from private.agent_request_log l
    where l.team_id=p_team_id
      and l.agent_subject=p_agent_subject
      and l.idempotency_key=p_idempotency_key;
    if v_result is not null then return v_result; end if;
  end if;

  if p_media_id is null then
    v_id := gen_random_uuid();
    insert into public.media_assets(
      id,team_id,subject_type,subject_ref,media_type,title,note,
      external_url,storage_path,file_name,mime_type,size_bytes,
      actor_type,actor_label,created_by,created_at,updated_at,deleted_at
    ) values (
      v_id,p_team_id,p_subject_type,p_subject_ref,p_media_type,p_title,p_note,
      p_external_url,p_storage_path,p_file_name,p_mime_type,p_size_bytes,
      'agent',v_label,null,v_now,v_now,null
    );
  else
    select * into v_existing
    from public.media_assets
    where id=p_media_id and team_id=p_team_id
    for update;

    if not found then raise exception 'media_not_found'; end if;
    if v_existing.deleted_at is not null then raise exception 'media_is_deleted'; end if;
    if p_expected_updated_at is not null and v_existing.updated_at <> p_expected_updated_at then
      raise exception 'media_conflict';
    end if;

    v_id := p_media_id;
    update public.media_assets
    set subject_type=p_subject_type,
        subject_ref=p_subject_ref,
        media_type=p_media_type,
        title=p_title,
        note=p_note,
        external_url=p_external_url,
        storage_path=p_storage_path,
        file_name=p_file_name,
        mime_type=p_mime_type,
        size_bytes=p_size_bytes,
        updated_at=v_now
    where id=v_id;
  end if;

  select jsonb_build_object(
    'id',m.id,'subject_type',m.subject_type,'subject_ref',m.subject_ref,
    'media_type',m.media_type,'title',m.title,'note',m.note,
    'external_url',m.external_url,'storage_path',m.storage_path,
    'file_name',m.file_name,'mime_type',m.mime_type,'size_bytes',m.size_bytes,
    'actor_type',m.actor_type,'actor_label',m.actor_label,
    'created_at',m.created_at,'updated_at',m.updated_at,'deleted_at',m.deleted_at
  ) into v_result
  from public.media_assets m
  where m.id=v_id;

  insert into public.activity_log(
    id,team_id,actor_type,actor_label,action,summary,entity_type,entity_ref,metadata,created_at
  ) values (
    gen_random_uuid(),p_team_id,'agent',v_label,
    case when p_media_id is null then 'agent_created_media' else 'agent_updated_media' end,
    case when p_media_id is null then 'Head Coach adicionou media' else 'Head Coach atualizou media' end,
    'media',v_id::text,
    jsonb_build_object('subject_type',p_subject_type,'subject_ref',p_subject_ref,'idempotency_key',p_idempotency_key),
    v_now
  );

  if nullif(p_idempotency_key,'') is not null then
    insert into private.agent_request_log(
      team_id,agent_subject,idempotency_key,operation,result_type,result_ref,response
    ) values (
      p_team_id,p_agent_subject,p_idempotency_key,
      case when p_media_id is null then 'register_media:create' else 'register_media:update' end,
      'media',v_id,v_result
    );
  end if;

  return v_result;
end;
$$;

create or replace function public.head_coach_soft_delete_media(
  p_team_id uuid,
  p_media_id uuid,
  p_expected_updated_at timestamptz default null,
  p_idempotency_key text default null,
  p_agent_subject text default 'head-coach'
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public, private
as $$
declare
  v_existing public.media_assets%rowtype;
  v_result jsonb;
  v_now timestamptz := now();
  v_label text := private.agent_display_label(p_agent_subject);
begin
  if not private.agent_has_scope(p_team_id,p_agent_subject,'media') then
    raise exception 'agent_media_not_authorized';
  end if;

  if nullif(p_idempotency_key,'') is not null then
    select l.response into v_result
    from private.agent_request_log l
    where l.team_id=p_team_id
      and l.agent_subject=p_agent_subject
      and l.idempotency_key=p_idempotency_key;
    if v_result is not null then return v_result; end if;
  end if;

  select * into v_existing
  from public.media_assets
  where id=p_media_id and team_id=p_team_id
  for update;

  if not found then raise exception 'media_not_found'; end if;
  if p_expected_updated_at is not null and v_existing.updated_at <> p_expected_updated_at then
    raise exception 'media_conflict';
  end if;

  if v_existing.deleted_at is null then
    update public.media_assets
    set deleted_at=v_now, updated_at=v_now
    where id=p_media_id;
  end if;

  select jsonb_build_object(
    'id',m.id,'subject_type',m.subject_type,'subject_ref',m.subject_ref,
    'media_type',m.media_type,'title',m.title,'note',m.note,
    'external_url',m.external_url,'storage_path',m.storage_path,
    'file_name',m.file_name,'mime_type',m.mime_type,'size_bytes',m.size_bytes,
    'actor_type',m.actor_type,'actor_label',m.actor_label,
    'created_at',m.created_at,'updated_at',m.updated_at,'deleted_at',m.deleted_at
  ) into v_result
  from public.media_assets m
  where m.id=p_media_id;

  insert into public.activity_log(
    id,team_id,actor_type,actor_label,action,summary,entity_type,entity_ref,metadata,created_at
  ) values (
    gen_random_uuid(),p_team_id,'agent',v_label,
    'agent_deleted_media','Head Coach arquivou media',
    'media',p_media_id::text,
    jsonb_build_object('idempotency_key',p_idempotency_key),v_now
  );

  if nullif(p_idempotency_key,'') is not null then
    insert into private.agent_request_log(
      team_id,agent_subject,idempotency_key,operation,result_type,result_ref,response
    ) values (
      p_team_id,p_agent_subject,p_idempotency_key,
      'soft_delete_media','media',p_media_id,v_result
    );
  end if;

  return v_result;
end;
$$;

do $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and p.proname like 'head_coach_%'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
  end loop;
end $$;
;
