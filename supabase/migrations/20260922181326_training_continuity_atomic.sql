-- Narrow atomic gateway for the authenticated MCP, not a public/RLS bypass endpoint.
create or replace function public.head_coach_commit_training_continuity(
 p_team_id uuid, p_source_id uuid, p_expected_updated_at timestamptz,
 p_change jsonb, p_agent_subject text default 'head-coach'
) returns jsonb language plpgsql security invoker
set search_path = pg_catalog, public, private
as $$
declare
 src public.workspace_records%rowtype; mem public.workspace_records%rowtype;
 child public.workspace_records%rowtype; ex public.workspace_records%rowtype;
 next_payload jsonb; m jsonb; target jsonb; v jsonb;
 mid uuid; tid uuid; now_at timestamptz := clock_timestamp(); linked boolean := false;
 action text := p_change->>'action';
begin
 if private.agent_has_scope(p_team_id,p_agent_subject,'write') is distinct from true then raise exception 'agent_write_not_authorized'; end if;
 if action is null or action not in ('review','clear_review','propose','save_proposal','dismiss','approve') then raise exception 'invalid_continuity_action'; end if;
 select * into src from public.workspace_records where id=p_source_id and team_id=p_team_id and kind='training' for update;
 if not found or src.deleted_at is not null then raise exception 'source_training_deleted_or_missing'; end if;
 if p_expected_updated_at is null or src.updated_at<>p_expected_updated_at then raise exception 'record_conflict_read_again'; end if;
 next_payload:=p_change->'source'; m:=p_change->'memory'; mid:=(p_change->>'memory_ref')::uuid;
 if jsonb_typeof(next_payload) is distinct from 'object' or jsonb_typeof(m) is distinct from 'object' or mid is null then raise exception 'invalid_continuity_payload'; end if;
 if (next_payload - 'review' - 'continuity') is distinct from (src.payload - 'review' - 'continuity') then raise exception 'continuity_must_preserve_source_plan'; end if;
 if (next_payload#>>'{continuity,schema}') is distinct from 'vision-training-continuity@1'
 or (next_payload#>>'{continuity,revision}')::integer is distinct from coalesce((src.payload#>>'{continuity,revision}')::integer,0)+1 then raise exception 'continuity_revision_conflict'; end if;
 if m->>'external_key' is distinct from 'training-review-'||p_source_id::text
 or m#>>'{metadata,managed_by}' is distinct from 'training_review_v1'
 or m#>>'{metadata,source_training_ref}' is distinct from p_source_id::text then raise exception 'invalid_review_memory'; end if;
 -- Refuse exercise modifications/deletions between the MCP read and this transaction.
 for v in select value from jsonb_array_elements(coalesce(p_change->'exercise_versions','[]'::jsonb)) loop
  select * into ex from public.workspace_records where id=(v->>'id')::uuid and team_id=p_team_id and kind='exercise' for share;
  if not found or ex.deleted_at is not null or ex.updated_at is distinct from (v->>'updated_at')::timestamptz then raise exception 'exercise_changed_read_again'; end if;
 end loop;
 if action='approve' then
  if (p_change->>'confirmed')::boolean is distinct from true then raise exception 'explicit_approval_required'; end if;
  target:=p_change->'target';tid:=(p_change->>'target_ref')::uuid;
  if tid is null or tid=p_source_id or jsonb_typeof(target) is distinct from 'object'
   or next_payload#>>'{continuity,proposal,status}' is distinct from 'approved'
   or next_payload#>>'{continuity,proposal,target_ref}' is distinct from tid::text
   or target->>'source_training_ref' is distinct from p_source_id::text
   or target->>'external_key' is distinct from 'training-continuation-'||p_source_id::text
   or coalesce(target#>>'{continuity_origin,approval_signature}','')='' then raise exception 'invalid_followup_identity'; end if;
  if target ? 'session' or target->'review'->>'status' is distinct from 'pending' then raise exception 'followup_cannot_copy_execution'; end if;
  if jsonb_typeof(target->'blocos') is distinct from 'array' or jsonb_array_length(target->'blocos')<1 then raise exception 'followup_requires_exercises'; end if;
  for v in select value from jsonb_array_elements(target->'blocos') loop
   if not exists (select 1 from jsonb_array_elements(coalesce(p_change->'exercise_versions','[]'::jsonb)) ev where ev->>'id'=v->>'exercise_ref') then raise exception 'exercise_revision_required'; end if;
  end loop;
  select * into child from public.workspace_records where id=tid for update;
  if found then
   if child.team_id<>p_team_id or child.kind<>'training' or child.deleted_at is not null then raise exception 'followup_deleted_or_identity_conflict'; end if;
   if child.payload#>>'{continuity_origin,approval_signature}' is distinct from target#>>'{continuity_origin,approval_signature}' then raise exception 'followup_already_exists_with_different_plan'; end if;
  else
   insert into public.workspace_records(id,team_id,kind,payload,actor_type,actor_label,created_at,updated_at)
   values(tid,p_team_id,'training',target,'agent',private.agent_display_label(p_agent_subject),now_at,now_at);
  end if;
 elsif p_change ? 'target' and p_change->'target'<>'null'::jsonb then raise exception 'only_approval_may_create_followup'; end if;
 select * into mem from public.workspace_records where id=mid for update;
 if found then
  if mem.team_id<>p_team_id or mem.kind<>'memory' then raise exception 'memory_identity_conflict'; end if;
  if mem.deleted_at is null then
   if mem.payload#>>'{metadata,managed_by}' is distinct from 'training_review_v1' then raise exception 'memory_not_managed_by_training_review'; end if;
   update public.workspace_records set payload=mem.payload||m,updated_at=now_at where id=mid;linked:=m->>'status'='active';
  end if;
 else
  -- A legacy memory with another UUID must be reconciled, not duplicated.
  if exists(select 1 from public.workspace_records where team_id=p_team_id and kind='memory' and payload->>'external_key'=m->>'external_key') then raise exception 'existing_review_memory_needs_reconciliation'; end if;
  if m->>'status'='active' then
   insert into public.workspace_records(id,team_id,kind,payload,actor_type,actor_label,created_at,updated_at)
   values(mid,p_team_id,'memory',m,'agent',private.agent_display_label(p_agent_subject),now_at,now_at);linked:=true;
  end if;
 end if;
 update public.workspace_records set payload=next_payload || jsonb_build_object('continuity',(next_payload->'continuity')||jsonb_build_object('memory_ref',mid)),updated_at=now_at where id=p_source_id;
 insert into public.activity_log(team_id,actor_type,actor_label,action,summary,entity_type,entity_ref,metadata)
 values(p_team_id,'agent',private.agent_display_label(p_agent_subject),'training_continuity_'||action,'Atualizou continuidade e memória do treino','training',p_source_id::text,jsonb_build_object('target_ref',tid,'memory_ref',mid,'operation',action));
 return jsonb_build_object('source_id',p_source_id,'target_id',tid,'memory_ref',mid,'memory_linked',linked,'updated_at',now_at);
end;
$$;
revoke all on function public.head_coach_commit_training_continuity(uuid,uuid,timestamptz,jsonb,text) from public, anon, authenticated;
grant execute on function public.head_coach_commit_training_continuity(uuid,uuid,timestamptz,jsonb,text) to service_role;;
