
drop policy if exists teams_select on public.teams;
create policy teams_select on public.teams for select to authenticated
using (public.is_team_member(id));

drop policy if exists teams_insert on public.teams;
create policy teams_insert on public.teams for insert to authenticated
with check (auth.uid() is not null and owner_id = auth.uid());

drop policy if exists teams_update on public.teams;
create policy teams_update on public.teams for update to authenticated
using (public.is_team_owner(id)) with check (public.is_team_owner(id));

drop policy if exists teams_delete on public.teams;
create policy teams_delete on public.teams for delete to authenticated
using (public.is_team_owner(id));

drop policy if exists members_select on public.team_members;
create policy members_select on public.team_members for select to authenticated
using (public.is_team_member(team_id));

drop policy if exists members_insert on public.team_members;
create policy members_insert on public.team_members for insert to authenticated
with check (public.is_team_owner(team_id));

drop policy if exists members_update on public.team_members;
create policy members_update on public.team_members for update to authenticated
using (public.is_team_owner(team_id)) with check (public.is_team_owner(team_id));

drop policy if exists members_delete on public.team_members;
create policy members_delete on public.team_members for delete to authenticated
using (public.is_team_owner(team_id));

drop policy if exists records_select on public.workspace_records;
create policy records_select on public.workspace_records for select to authenticated
using (public.is_team_member(team_id) and deleted_at is null);

drop policy if exists records_insert on public.workspace_records;
create policy records_insert on public.workspace_records for insert to authenticated
with check (public.is_team_member(team_id));

drop policy if exists records_update on public.workspace_records;
create policy records_update on public.workspace_records for update to authenticated
using (public.is_team_member(team_id))
with check (public.is_team_member(team_id));

drop policy if exists records_delete on public.workspace_records;
create policy records_delete on public.workspace_records for delete to authenticated
using (public.is_team_member(team_id));

drop policy if exists media_select on public.media_assets;
create policy media_select on public.media_assets for select to authenticated
using (public.is_team_member(team_id) and deleted_at is null);

drop policy if exists media_insert on public.media_assets;
create policy media_insert on public.media_assets for insert to authenticated
with check (public.is_team_member(team_id));

drop policy if exists media_update on public.media_assets;
create policy media_update on public.media_assets for update to authenticated
using (public.is_team_member(team_id))
with check (public.is_team_member(team_id));

drop policy if exists media_delete on public.media_assets;
create policy media_delete on public.media_assets for delete to authenticated
using (public.is_team_member(team_id));
;
