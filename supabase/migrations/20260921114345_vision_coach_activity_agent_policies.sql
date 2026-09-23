
drop policy if exists activity_select on public.activity_log;
create policy activity_select on public.activity_log for select to authenticated
using (public.is_team_member(team_id));

drop policy if exists activity_insert on public.activity_log;
create policy activity_insert on public.activity_log for insert to authenticated
with check (public.is_team_member(team_id));

drop policy if exists agent_auth_select on public.agent_authorizations;
create policy agent_auth_select on public.agent_authorizations for select to authenticated
using (public.is_team_owner(team_id) and owner_id = auth.uid());

drop policy if exists agent_auth_insert on public.agent_authorizations;
create policy agent_auth_insert on public.agent_authorizations for insert to authenticated
with check (public.is_team_owner(team_id) and owner_id = auth.uid());

drop policy if exists agent_auth_update on public.agent_authorizations;
create policy agent_auth_update on public.agent_authorizations for update to authenticated
using (public.is_team_owner(team_id) and owner_id = auth.uid())
with check (public.is_team_owner(team_id) and owner_id = auth.uid());

drop policy if exists agent_auth_delete on public.agent_authorizations;
create policy agent_auth_delete on public.agent_authorizations for delete to authenticated
using (public.is_team_owner(team_id) and owner_id = auth.uid());

grant usage on schema public to authenticated;
grant select, insert, update, delete on public.teams to authenticated;
grant select, insert, update, delete on public.team_members to authenticated;
grant select, insert, update, delete on public.workspace_records to authenticated;
grant select, insert, update, delete on public.media_assets to authenticated;
grant select, insert on public.activity_log to authenticated;
grant select, insert, update, delete on public.agent_authorizations to authenticated;
;
