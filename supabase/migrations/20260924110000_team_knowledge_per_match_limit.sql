-- Keep RAG results from a multi-match question distributed across the cited games.
-- The existing overload remains available for clients without per-match balancing.
create or replace function public.search_team_knowledge_chunks(
  p_team_id uuid, p_embedding extensions.vector(1536), p_query text,
  p_limit integer, p_source_kinds text[],
  p_from date, p_to date,
  p_match_ref uuid, p_training_ref uuid,
  p_player_ref uuid, p_category text,
  p_match_refs uuid[], p_per_match_limit integer
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
  if p_match_refs is not null and (cardinality(p_match_refs) > 10 or cardinality(p_match_refs) < 1) then raise exception 'invalid_knowledge_match_refs'; end if;
  if p_per_match_limit is not null and (p_match_refs is null or p_per_match_limit < 1 or p_per_match_limit > 4) then raise exception 'invalid_knowledge_per_match_limit'; end if;
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
      and (p_match_refs is null or k.match_ref = any(p_match_refs))
      and (p_training_ref is null or k.training_ref = p_training_ref)
      and (p_player_ref is null or k.player_ref = p_player_ref)
      and (p_category is null or k.category = p_category)
  ), semantic_global as (
    select e.id, row_number() over(order by e.embedding <=> p_embedding) as rank
    from eligible e
    where p_per_match_limit is null
    order by e.embedding <=> p_embedding limit 48
  ), semantic_by_match as (
    select c.id, row_number() over(partition by c.match_ref order by c.distance) as rank
    from unnest(p_match_refs) requested(match_ref)
    cross join lateral (
      select e.id, e.match_ref, e.embedding <=> p_embedding as distance
      from eligible e
      where e.match_ref = requested.match_ref
      order by e.embedding <=> p_embedding
      limit 48
    ) c
    where p_per_match_limit is not null
  ), semantic as (
    select id,rank from semantic_global
    union all
    select id,rank from semantic_by_match
  ), lexical_global as (
    select e.id, row_number() over(order by ts_rank_cd(e.content_tsv, plainto_tsquery('simple',p_query)) desc) as rank
    from eligible e
    where p_per_match_limit is null
      and e.content_tsv @@ plainto_tsquery('simple',p_query)
    order by ts_rank_cd(e.content_tsv, plainto_tsquery('simple',p_query)) desc limit 48
  ), lexical_by_match as (
    select c.id, row_number() over(partition by c.match_ref order by c.score desc) as rank
    from unnest(p_match_refs) requested(match_ref)
    cross join lateral (
      select e.id, e.match_ref, ts_rank_cd(e.content_tsv,plainto_tsquery('simple',p_query)) as score
      from eligible e
      where e.match_ref = requested.match_ref
        and e.content_tsv @@ plainto_tsquery('simple',p_query)
      order by ts_rank_cd(e.content_tsv,plainto_tsquery('simple',p_query)) desc
      limit 48
    ) c
    where p_per_match_limit is not null
  ), lexical as (
    select id,rank from lexical_global
    union all
    select id,rank from lexical_by_match
  ), fused as (
    select id, sum(1.0/(60+rank)) as rrf from (
      select id,rank from semantic union all select id,rank from lexical
    ) x group by id
  ), ranked as (
    select f.id, row_number() over(partition by e.match_ref order by f.rrf desc,e.id) as match_rank
    from fused f join eligible e on e.id=f.id
  )
  select e.source_id,e.source_kind,e.source_path,e.source_updated_at,e.source_date,
    e.match_ref,e.training_ref,e.player_ref,e.category,e.evidence_type,e.title,
    e.content,e.metadata,(1-(e.embedding <=> p_embedding))::real,
    coalesce(ts_rank_cd(e.content_tsv,plainto_tsquery('simple',p_query)),0)::real
  from fused f join eligible e on e.id=f.id join ranked r on r.id=f.id
  where p_per_match_limit is null or r.match_rank <= p_per_match_limit
  order by f.rrf desc,e.match_ref nulls last,e.id
  limit p_limit;
end;
$$;

revoke all on function public.search_team_knowledge_chunks(uuid,extensions.vector,text,integer,text[],date,date,uuid,uuid,uuid,text,uuid[],integer) from public, anon, authenticated;
grant execute on function public.search_team_knowledge_chunks(uuid,extensions.vector,text,integer,text[],date,date,uuid,uuid,uuid,text,uuid[],integer) to service_role;
