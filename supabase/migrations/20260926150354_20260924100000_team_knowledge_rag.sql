create extension if not exists vector with schema extensions;

create table if not exists private.team_knowledge_chunks (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  source_id uuid not null,
  source_kind text not null,
  source_path text not null,
  chunk_no integer not null check (chunk_no >= 0),
  source_updated_at timestamptz not null,
  source_date date,
  match_ref uuid,
  training_ref uuid,
  player_ref uuid,
  category text,
  evidence_type text not null,
  title text not null,
  content text not null,
  content_hash text not null,
  embedding_model text not null,
  embedding extensions.vector(1536) not null,
  content_tsv tsvector generated always as (to_tsvector('simple', content)) stored,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (team_id, source_id, source_path, chunk_no, embedding_model)
);

create table if not exists private.team_knowledge_jobs (
  team_id uuid not null references public.teams(id) on delete cascade,
  source_id uuid not null,
  source_updated_at timestamptz not null,
  attempts integer not null default 0,
  claim_token uuid,
  locked_until timestamptz,
  last_error text,
  queued_at timestamptz not null default now(),
  primary key (team_id, source_id)
);

alter table private.team_knowledge_chunks enable row level security;
alter table private.team_knowledge_jobs enable row level security;
revoke all on private.team_knowledge_chunks from public, anon, authenticated;
revoke all on private.team_knowledge_jobs from public, anon, authenticated;

create index if not exists team_knowledge_chunks_scope_idx
  on private.team_knowledge_chunks(team_id, source_kind, source_date desc);
create index if not exists team_knowledge_chunks_source_idx
  on private.team_knowledge_chunks(team_id, source_id, source_updated_at);
create index if not exists team_knowledge_chunks_search_idx
  on private.team_knowledge_chunks using gin(content_tsv);
create index if not exists team_knowledge_chunks_embedding_idx
  on private.team_knowledge_chunks using hnsw(embedding extensions.vector_cosine_ops);
create index if not exists team_knowledge_jobs_queue_idx
  on private.team_knowledge_jobs(team_id, queued_at);

create or replace function private.queue_team_knowledge_source()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
begin
  if tg_op = 'UPDATE' and old.team_id <> new.team_id then
    delete from private.team_knowledge_jobs where team_id = old.team_id and source_id = old.id;
    delete from private.team_knowledge_chunks where team_id = old.team_id and source_id = old.id;
  end if;
  if tg_op = 'DELETE' then
    delete from private.team_knowledge_jobs where team_id = old.team_id and source_id = old.id;
    delete from private.team_knowledge_chunks where team_id = old.team_id and source_id = old.id;
    return old;
  end if;
  if new.deleted_at is not null or new.kind not in ('player','match','training','memory','document','game_model','exercise') then
    delete from private.team_knowledge_jobs where team_id = new.team_id and source_id = new.id;
    delete from private.team_knowledge_chunks where team_id = new.team_id and source_id = new.id;
    return new;
  end if;

  insert into private.team_knowledge_jobs(team_id, source_id, source_updated_at)
  values (new.team_id, new.id, new.updated_at)
  on conflict (team_id, source_id) do update
    set source_updated_at = excluded.source_updated_at,
        attempts = 0,
        claim_token = null,
        locked_until = null,
        last_error = null,
        queued_at = now();
  return new;
end;
$$;

create or replace function public.release_team_knowledge_jobs(p_team_id uuid, p_claims jsonb, p_error text)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare released integer;
begin
  if auth.role() <> 'service_role' then raise exception 'service_role_required'; end if;
  if p_team_id is null or p_claims is null or jsonb_typeof(p_claims) <> 'array' or jsonb_array_length(p_claims) > 64 then raise exception 'invalid_knowledge_job_request'; end if;
  update private.team_knowledge_jobs
     set locked_until = null, last_error = left(coalesce(p_error,'indexing_failed'),240)
   where team_id = p_team_id and (source_id,claim_token) in (
     select x.source_id,x.claim_token from jsonb_to_recordset(p_claims) as x(source_id uuid,claim_token uuid)
   );
  get diagnostics released = row_count;
  return released;
end;
$$;

create or replace function public.queue_team_knowledge_reindex(p_team_id uuid)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare queued integer;
begin
  if auth.role() <> 'service_role' then raise exception 'service_role_required'; end if;
  if p_team_id is null then raise exception 'invalid_team_uuid'; end if;
  delete from private.team_knowledge_chunks where team_id = p_team_id;
  delete from private.team_knowledge_jobs where team_id = p_team_id;
  insert into private.team_knowledge_jobs(team_id,source_id,source_updated_at)
  select team_id,id,updated_at from public.workspace_records
  where team_id=p_team_id and deleted_at is null
    and kind in ('player','match','training','memory','document','game_model','exercise');
  get diagnostics queued = row_count;
  return queued;
end;
$$;
revoke all on function private.queue_team_knowledge_source() from public, anon, authenticated;

drop trigger if exists workspace_records_queue_team_knowledge on public.workspace_records;
create trigger workspace_records_queue_team_knowledge
after insert or update of kind, payload, updated_at, deleted_at, team_id or delete on public.workspace_records
for each row execute function private.queue_team_knowledge_source();

create or replace function private.queue_team_knowledge_on_team_age_group_change()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
begin
  if (old.metadata->>'escalao') is distinct from (new.metadata->>'escalao')
     or (old.metadata->>'age_group') is distinct from (new.metadata->>'age_group') then
    insert into private.team_knowledge_jobs(team_id, source_id, source_updated_at)
    select team_id, id, updated_at from public.workspace_records
    where team_id = new.id and deleted_at is null
      and kind in ('player','match','training','memory','document','game_model','exercise')
    on conflict (team_id, source_id) do update
      set source_updated_at = excluded.source_updated_at,
          attempts = 0,
          claim_token = null,
          locked_until = null,
          last_error = null,
          queued_at = now();
  end if;
  return new;
end;
$$;
revoke all on function private.queue_team_knowledge_on_team_age_group_change() from public, anon, authenticated;

drop trigger if exists teams_queue_team_knowledge_age_group on public.teams;
create trigger teams_queue_team_knowledge_age_group
after update of metadata on public.teams
for each row execute function private.queue_team_knowledge_on_team_age_group_change();

insert into private.team_knowledge_jobs(team_id, source_id, source_updated_at)
select team_id, id, updated_at from public.workspace_records
where deleted_at is null and kind in ('player','match','training','memory','document','game_model','exercise')
on conflict (team_id, source_id) do nothing;

create or replace function public.claim_team_knowledge_jobs(p_team_id uuid, p_limit integer default 16)
returns table(source_id uuid, source_updated_at timestamptz, source_kind text, payload jsonb, claim_token uuid)
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
begin
  if auth.role() <> 'service_role' then raise exception 'service_role_required'; end if;
  if p_team_id is null or p_limit < 1 or p_limit > 64 then raise exception 'invalid_knowledge_job_request'; end if;
  return query
  with picked as (
    select j.team_id, j.source_id
    from private.team_knowledge_jobs j
    join public.workspace_records r on r.id = j.source_id and r.team_id = j.team_id
    where j.team_id = p_team_id and (j.locked_until is null or j.locked_until < now())
      and r.deleted_at is null and r.updated_at = j.source_updated_at
    order by j.queued_at
    limit p_limit
    for update of j skip locked
  ), claimed as (
    update private.team_knowledge_jobs j
       set locked_until = now() + interval '3 minutes', attempts = attempts + 1, claim_token = gen_random_uuid()
      from picked p
     where j.team_id = p.team_id and j.source_id = p.source_id
    returning j.team_id, j.source_id, j.source_updated_at, j.claim_token
  )
  select r.id, r.updated_at, r.kind, r.payload, j.claim_token
  from claimed j join public.workspace_records r
    on r.id = j.source_id and r.team_id = j.team_id and r.updated_at = j.source_updated_at
  where r.deleted_at is null;
end;
$$;

create or replace function public.replace_team_knowledge_source(
  p_team_id uuid, p_source_id uuid, p_source_updated_at timestamptz, p_claim_token uuid, p_chunks jsonb
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, private, extensions
as $$
declare inserted_count integer;
begin
  if auth.role() <> 'service_role' then raise exception 'service_role_required'; end if;
  if p_chunks is null or jsonb_typeof(p_chunks) <> 'array' or jsonb_array_length(p_chunks) > 512 then
    raise exception 'invalid_knowledge_chunks';
  end if;
  if not exists (
    select 1 from public.workspace_records r
    where r.id = p_source_id and r.team_id = p_team_id
      and r.updated_at = p_source_updated_at and r.deleted_at is null
      and r.kind in ('player','match','training','memory','document','game_model','exercise')
  ) then raise exception 'knowledge_source_changed_or_deleted'; end if;
  if not exists (
    select 1 from private.team_knowledge_jobs j
    where j.team_id=p_team_id and j.source_id=p_source_id
      and j.source_updated_at=p_source_updated_at and j.claim_token=p_claim_token
  ) then raise exception 'knowledge_job_claim_stale'; end if;

  delete from private.team_knowledge_chunks
  where team_id = p_team_id and source_id = p_source_id;

  insert into private.team_knowledge_chunks(
    team_id, source_id, source_kind, source_path, chunk_no, source_updated_at,
    source_date, match_ref, training_ref, player_ref, category, evidence_type,
    title, content, content_hash, embedding_model, embedding, metadata
  )
  select p_team_id, p_source_id, x.source_kind, x.source_path, x.chunk_no,
    p_source_updated_at, nullif(x.source_date,'')::date,
    nullif(x.match_ref,'')::uuid, nullif(x.training_ref,'')::uuid,
    nullif(x.player_ref,'')::uuid, x.category, x.evidence_type, x.title,
    x.content, x.content_hash, x.embedding_model, x.embedding::extensions.vector(1536),
    coalesce(x.metadata, '{}'::jsonb)
  from jsonb_to_recordset(p_chunks) as x(
    source_kind text, source_path text, chunk_no integer, source_date text,
    match_ref text, training_ref text, player_ref text, category text,
    evidence_type text, title text, content text, content_hash text,
    embedding_model text, embedding text, metadata jsonb
  );
  get diagnostics inserted_count = row_count;

  delete from private.team_knowledge_jobs
  where team_id = p_team_id and source_id = p_source_id
    and source_updated_at = p_source_updated_at and claim_token=p_claim_token;
  return inserted_count;
end;
$$;

create or replace function public.search_team_knowledge_chunks(
  p_team_id uuid, p_embedding extensions.vector(1536), p_query text,
  p_limit integer default 8, p_source_kinds text[] default null,
  p_from date default null, p_to date default null,
  p_match_ref uuid default null, p_training_ref uuid default null,
  p_player_ref uuid default null, p_category text default null
)
returns table(
  source_id uuid, source_kind text, source_path text, source_updated_at timestamptz,
  source_date date, match_ref uuid, training_ref uuid, player_ref uuid,
  category text, evidence_type text, title text, content text,
  metadata jsonb, similarity real, lexical_rank real
)
language plpgsql
security definer
set search_path = pg_catalog, public, private, extensions
as $$
begin
  if auth.role() <> 'service_role' then raise exception 'service_role_required'; end if;
  if p_team_id is null or p_limit < 1 or p_limit > 12 then raise exception 'invalid_knowledge_search'; end if;
  -- Keep filling filtered HNSW scans when vectors from other teams dominate the nearest neighbors.
  perform set_config('hnsw.iterative_scan', 'strict_order', true);
  return query
  with eligible as not materialized (
    select k.* from private.team_knowledge_chunks k
    join public.workspace_records r
      on r.id = k.source_id and r.team_id = k.team_id
     and r.updated_at = k.source_updated_at and r.deleted_at is null
    where k.team_id = p_team_id
      and (p_source_kinds is null or k.source_kind = any(p_source_kinds))
      and (p_from is null or k.source_date is null or k.source_date >= p_from)
      and (p_to is null or k.source_date is null or k.source_date <= p_to)
      and (p_match_ref is null or k.match_ref = p_match_ref)
      and (p_training_ref is null or k.training_ref = p_training_ref)
      and (p_player_ref is null or k.player_ref = p_player_ref)
      and (p_category is null or k.category = p_category)
  ), semantic as (
    select e.id, row_number() over(order by e.embedding <=> p_embedding) as rank
    from eligible e order by e.embedding <=> p_embedding limit 48
  ), lexical as (
    select e.id, row_number() over(order by ts_rank_cd(e.content_tsv, plainto_tsquery('simple',p_query)) desc) as rank
    from eligible e where e.content_tsv @@ plainto_tsquery('simple',p_query)
    order by ts_rank_cd(e.content_tsv, plainto_tsquery('simple',p_query)) desc limit 48
  ), fused as (
    select id, sum(1.0/(60+rank)) as rrf from (
      select id,rank from semantic union all select id,rank from lexical
    ) x group by id
  )
  select e.source_id,e.source_kind,e.source_path,e.source_updated_at,e.source_date,
    e.match_ref,e.training_ref,e.player_ref,e.category,e.evidence_type,e.title,
    e.content,e.metadata,(1-(e.embedding <=> p_embedding))::real,
    coalesce(ts_rank_cd(e.content_tsv,plainto_tsquery('simple',p_query)),0)::real
  from fused f join eligible e on e.id=f.id
  order by f.rrf desc limit p_limit;
end;
$$;

revoke all on function public.claim_team_knowledge_jobs(uuid,integer) from public, anon, authenticated;
revoke all on function public.release_team_knowledge_jobs(uuid,jsonb,text) from public, anon, authenticated;
revoke all on function public.queue_team_knowledge_reindex(uuid) from public, anon, authenticated;
revoke all on function public.replace_team_knowledge_source(uuid,uuid,timestamptz,uuid,jsonb) from public, anon, authenticated;
revoke all on function public.search_team_knowledge_chunks(uuid,extensions.vector,text,integer,text[],date,date,uuid,uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.claim_team_knowledge_jobs(uuid,integer) to service_role;
grant execute on function public.release_team_knowledge_jobs(uuid,jsonb,text) to service_role;
grant execute on function public.queue_team_knowledge_reindex(uuid) to service_role;
grant execute on function public.replace_team_knowledge_source(uuid,uuid,timestamptz,uuid,jsonb) to service_role;
grant execute on function public.search_team_knowledge_chunks(uuid,extensions.vector,text,integer,text[],date,date,uuid,uuid,uuid,text) to service_role;
