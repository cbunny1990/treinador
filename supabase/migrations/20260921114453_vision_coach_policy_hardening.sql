
drop policy if exists records_select on public.workspace_records;
create policy records_select on public.workspace_records for select to authenticated
using (private.is_team_member(team_id) and deleted_at is null);

drop policy if exists records_insert on public.workspace_records;
create policy records_insert on public.workspace_records for insert to authenticated
with check (private.is_team_member(team_id));

drop policy if exists records_update on public.workspace_records;
create policy records_update on public.workspace_records for update to authenticated
using (private.is_team_member(team_id))
with check (private.is_team_member(team_id));

drop policy if exists records_delete on public.workspace_records;
create policy records_delete on public.workspace_records for delete to authenticated
using (private.is_team_member(team_id));

drop policy if exists media_select on public.media_assets;
create policy media_select on public.media_assets for select to authenticated
using (private.is_team_member(team_id) and deleted_at is null);

drop policy if exists media_insert on public.media_assets;
create policy media_insert on public.media_assets for insert to authenticated
with check (private.is_team_member(team_id));

drop policy if exists media_update on public.media_assets;
create policy media_update on public.media_assets for update to authenticated
using (private.is_team_member(team_id))
with check (private.is_team_member(team_id));

drop policy if exists media_delete on public.media_assets;
create policy media_delete on public.media_assets for delete to authenticated
using (private.is_team_member(team_id));

drop policy if exists activity_select on public.activity_log;
create policy activity_select on public.activity_log for select to authenticated
using (private.is_team_member(team_id));

drop policy if exists activity_insert on public.activity_log;
create policy activity_insert on public.activity_log for insert to authenticated
with check (private.is_team_member(team_id));

drop policy if exists agent_auth_select on public.agent_authorizations;
create policy agent_auth_select on public.agent_authorizations for select to authenticated
using (private.is_team_owner(team_id) and owner_id = (select auth.uid()));

drop policy if exists agent_auth_insert on public.agent_authorizations;
create policy agent_auth_insert on public.agent_authorizations for insert to authenticated
with check (private.is_team_owner(team_id) and owner_id = (select auth.uid()));

drop policy if exists agent_auth_update on public.agent_authorizations;
create policy agent_auth_update on public.agent_authorizations for update to authenticated
using (private.is_team_owner(team_id) and owner_id = (select auth.uid()))
with check (private.is_team_owner(team_id) and owner_id = (select auth.uid()));

drop policy if exists agent_auth_delete on public.agent_authorizations;
create policy agent_auth_delete on public.agent_authorizations for delete to authenticated
using (private.is_team_owner(team_id) and owner_id = (select auth.uid()));

drop policy if exists team_media_select on storage.objects;
create policy team_media_select on storage.objects for select to authenticated
using (
  bucket_id = 'team-media'
  and private.is_team_member(((storage.foldername(name))[1])::uuid)
);

drop policy if exists team_media_insert on storage.objects;
create policy team_media_insert on storage.objects for insert to authenticated
with check (
  bucket_id = 'team-media'
  and private.is_team_member(((storage.foldername(name))[1])::uuid)
);

drop policy if exists team_media_update on storage.objects;
create policy team_media_update on storage.objects for update to authenticated
using (
  bucket_id = 'team-media'
  and private.is_team_member(((storage.foldername(name))[1])::uuid)
)
with check (
  bucket_id = 'team-media'
  and private.is_team_member(((storage.foldername(name))[1])::uuid)
);

drop policy if exists team_media_delete on storage.objects;
create policy team_media_delete on storage.objects for delete to authenticated
using (
  bucket_id = 'team-media'
  and private.is_team_member(((storage.foldername(name))[1])::uuid)
);

drop function if exists public.is_team_member(uuid);
drop function if exists public.is_team_owner(uuid);

create index if not exists teams_owner_id_idx on public.teams(owner_id);
create index if not exists team_members_user_id_idx on public.team_members(user_id);
create index if not exists workspace_records_created_by_idx on public.workspace_records(created_by);
create index if not exists media_assets_created_by_idx on public.media_assets(created_by);
create index if not exists activity_log_created_by_idx on public.activity_log(created_by);
create index if not exists agent_authorizations_owner_id_idx on public.agent_authorizations(owner_id);
;
