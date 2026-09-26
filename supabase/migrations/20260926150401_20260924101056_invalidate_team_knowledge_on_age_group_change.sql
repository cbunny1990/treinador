create or replace function private.queue_team_knowledge_on_team_age_group_change()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
begin
  if (old.metadata->>'escalao') is distinct from (new.metadata->>'escalao')
     or (old.metadata->>'age_group') is distinct from (new.metadata->>'age_group') then
    -- Chunks carry the previous age group as retrieval metadata. Invalidate them
    -- immediately so a delayed/failed embedding job cannot expose stale context.
    delete from private.team_knowledge_chunks where team_id = new.id;
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
