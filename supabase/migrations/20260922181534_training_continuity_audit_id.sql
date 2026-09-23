do $fix$
declare definition text; patched text;
begin
 definition:=pg_get_functiondef('public.head_coach_commit_training_continuity(uuid,uuid,timestamptz,jsonb,text)'::regprocedure);
 patched:=replace(definition,'insert into public.activity_log(team_id,actor_type,actor_label,action,summary,entity_type,entity_ref,metadata)','insert into public.activity_log(id,team_id,actor_type,actor_label,action,summary,entity_type,entity_ref,metadata)');
 patched:=replace(patched,'values(p_team_id,''agent'',private.agent_display_label(p_agent_subject),''training_continuity_''','values(gen_random_uuid(),p_team_id,''agent'',private.agent_display_label(p_agent_subject),''training_continuity_''');
 if patched=definition then raise exception 'audit_patch_did_not_match_expected_definition'; end if;
 execute patched;
end;
$fix$;;
