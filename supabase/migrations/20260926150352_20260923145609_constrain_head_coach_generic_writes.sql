-- Keep the legacy agent gateway read-compatible, but advertise that its raw
-- record writer is reserved for game-model records. Domain records with
-- semantic MCP operations must use those validated, versioned operations.
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
    'put_record_write_kinds',jsonb_build_array('game_model'),
    'actor','agent',
    'provenance_label',private.agent_display_label(p_agent_subject)
  );
end;
$$;

revoke all on function public.head_coach_capabilities(uuid,text)
  from public, anon, authenticated;
grant execute on function public.head_coach_capabilities(uuid,text)
  to service_role;
