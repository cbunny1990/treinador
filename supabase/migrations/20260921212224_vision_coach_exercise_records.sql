
alter table public.workspace_records
  drop constraint if exists workspace_records_kind_check;
alter table public.workspace_records
  add constraint workspace_records_kind_check
  check (kind = any (array[
    'player'::text,'match'::text,'training'::text,'memory'::text,
    'document'::text,'game_model'::text,'exercise'::text
  ]));

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
      'capabilities','snapshot','changes_since','get_record','put_record',
      'soft_delete_record','restore_record','register_media','soft_delete_media'
    ),
    'record_kinds',jsonb_build_array(
      'player','match','training','memory','document','game_model','exercise'
    ),
    'actor','agent',
    'provenance_label',private.agent_display_label(p_agent_subject)
  );
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

  if p_kind not in ('player','match','training','memory','document','game_model','exercise') then
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
    if v_result is not null then return v_result; end if;
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

    if not found then raise exception 'record_not_found'; end if;
    if v_existing.deleted_at is not null then raise exception 'record_is_deleted'; end if;
    if p_expected_updated_at is not null and v_existing.updated_at <> p_expected_updated_at then
      raise exception 'record_conflict';
    end if;
    if v_existing.kind <> p_kind then raise exception 'record_kind_mismatch'; end if;

    v_id := p_record_id;
    update public.workspace_records
    set payload = p_payload, updated_at = v_now
    where id = v_id;
  end if;

  select jsonb_build_object(
    'id',r.id,'kind',r.kind,'payload',r.payload,
    'actor_type',r.actor_type,'actor_label',r.actor_label,
    'created_at',r.created_at,'updated_at',r.updated_at,'deleted_at',r.deleted_at
  ) into v_result
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
  if p_media_type not in ('photo','video','file') then raise exception 'invalid_media_type'; end if;
  if nullif(trim(coalesce(p_title,'')),'') is null then raise exception 'media_title_required'; end if;
  if p_external_url is null and p_storage_path is null then raise exception 'media_location_required'; end if;
  if p_storage_path is not null and p_storage_path not like p_team_id::text || '/%' then
    raise exception 'invalid_storage_path';
  end if;
  if p_size_bytes is not null and p_size_bytes < 0 then raise exception 'invalid_media_size'; end if;
  if nullif(trim(coalesce(p_subject_type,'')),'') is null
     or nullif(trim(coalesce(p_subject_ref,'')),'') is null then
    raise exception 'media_subject_required';
  end if;

  if p_subject_type = 'team' then
    if p_subject_ref <> p_team_id::text then raise exception 'media_subject_not_in_team'; end if;
  elsif p_subject_type in ('player','match','training','memory','document','game_model','exercise') then
    if p_subject_ref !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       or not exists (
         select 1 from public.workspace_records r
         where r.team_id=p_team_id
           and r.id=p_subject_ref::uuid
           and r.kind=p_subject_type
           and r.deleted_at is null
       ) then
      raise exception 'media_subject_not_found';
    end if;
  end if;

  if nullif(p_idempotency_key,'') is not null then
    select l.response into v_result
    from private.agent_request_log l
    where l.team_id=p_team_id and l.agent_subject=p_agent_subject
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
    set subject_type=p_subject_type, subject_ref=p_subject_ref, media_type=p_media_type,
        title=p_title, note=p_note, external_url=p_external_url, storage_path=p_storage_path,
        file_name=p_file_name, mime_type=p_mime_type, size_bytes=p_size_bytes, updated_at=v_now
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
  from public.media_assets m where m.id=v_id;

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

revoke all on function public.head_coach_capabilities(uuid,text) from public, anon, authenticated;
grant execute on function public.head_coach_capabilities(uuid,text) to service_role;
revoke all on function public.head_coach_put_record(uuid,text,jsonb,uuid,timestamptz,text,text) from public, anon, authenticated;
grant execute on function public.head_coach_put_record(uuid,text,jsonb,uuid,timestamptz,text,text) to service_role;
revoke all on function public.head_coach_register_media(
  uuid,text,text,text,text,text,text,text,text,text,bigint,uuid,timestamptz,text,text
) from public, anon, authenticated;
grant execute on function public.head_coach_register_media(
  uuid,text,text,text,text,text,text,text,text,text,bigint,uuid,timestamptz,text,text
) to service_role;
;
