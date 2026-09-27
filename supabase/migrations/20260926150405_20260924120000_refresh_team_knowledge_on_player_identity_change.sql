-- Names may occur in coach-authored match notes and other retained sources.
-- Purge those derived chunks before reindexing the team's active sources when a
-- player is renamed, moved, soft-deleted, or physically deleted.
create or replace function private.refresh_team_knowledge_for_player(p_team_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
begin
  if p_team_id is null then return; end if;
  delete from private.team_knowledge_chunks where team_id = p_team_id;
  insert into private.team_knowledge_jobs(team_id, source_id, source_updated_at)
  select team_id, id, updated_at from public.workspace_records
  where team_id = p_team_id and deleted_at is null
    and kind in ('player','match','training','memory','document','game_model','exercise')
  on conflict (team_id, source_id) do update
    set source_updated_at = excluded.source_updated_at,
        attempts = 0,
        claim_token = null,
        locked_until = null,
        last_error = null,
        queued_at = now();
end;
$$;
revoke all on function private.refresh_team_knowledge_for_player(uuid) from public, anon, authenticated;

create or replace function private.queue_team_knowledge_source()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
begin
  if tg_op = 'DELETE' then
    if old.kind = 'player' then
      perform private.refresh_team_knowledge_for_player(old.team_id);
    end if;
    delete from private.team_knowledge_jobs where team_id = old.team_id and source_id = old.id;
    delete from private.team_knowledge_chunks where team_id = old.team_id and source_id = old.id;
    return old;
  end if;

  if tg_op = 'UPDATE' and old.team_id <> new.team_id then
    delete from private.team_knowledge_jobs where team_id = old.team_id and source_id = old.id;
    delete from private.team_knowledge_chunks where team_id = old.team_id and source_id = old.id;
  end if;

  if tg_op = 'UPDATE' and old.kind = 'player'
     and (old.team_id is distinct from new.team_id
       or old.payload->>'nome' is distinct from new.payload->>'nome'
       or new.deleted_at is not null) then
    perform private.refresh_team_knowledge_for_player(old.team_id);
    if new.team_id is distinct from old.team_id then
      perform private.refresh_team_knowledge_for_player(new.team_id);
    end if;
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
revoke all on function private.queue_team_knowledge_source() from public, anon, authenticated;
