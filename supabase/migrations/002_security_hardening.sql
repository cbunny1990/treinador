-- Vision Coach: security and performance hardening

create schema if not exists private;
revoke all on schema private from public;
revoke all on schema private from anon;
grant usage on schema private to authenticated;

create or replace function private.is_team_owner(target_team uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select exists (
    select 1 from public.teams
    where id = target_team and owner_id = (select auth.uid())
  );
$$;

create or replace function private.is_team_member(target_team uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select private.is_team_owner(target_team)
  or exists (
    select 1 from public.team_members
    where team_id = target_team and user_id = (select auth.uid())
  );
$$;

revoke all on function private.is_team_owner(uuid) from public;
revoke all on function private.is_team_owner(uuid) from anon;
revoke all on function private.is_team_member(uuid) from public;
revoke all on function private.is_team_member(uuid) from anon;
grant execute on function private.is_team_owner(uuid) to authenticated;
grant execute on function private.is_team_member(uuid) to authenticated;

alter function public.touch_updated_at() set search_path = pg_catalog;
revoke execute on function public.add_owner_membership() from public;
revoke execute on function public.add_owner_membership() from anon;
revoke execute on function public.add_owner_membership() from authenticated;

drop policy if exists teams_select on public.teams;
create policy teams_select on public.teams for select to authenticated
using (private.is_team_member(id));

drop policy if exists teams_insert on public.teams;
create policy teams_insert on public.teams for insert to authenticated
with check ((select auth.uid()) is not null and owner_id = (select auth.uid()));

drop policy if exists teams_update on public.teams;
create policy teams_update on public.teams for update to authenticated
using (private.is_team_owner(id))
with check (private.is_team_owner(id));
drop policy if exists teams_delete on public.teams;
create policy teams_delete on public.teams for delete to authenticated
using (private.is_team_owner(id));

drop policy if exists members_select on public.team_members;
create policy members_select on public.team_members for select to authenticated
using (private.is_team_member(team_id));

drop policy if exists members_insert on public.team_members;
create policy members_insert on public.team_members for insert to authenticated
with check (private.is_team_owner(team_id));

drop policy if exists members_update on public.team_members;
create policy members_update on public.team_members for update to authenticated
using (private.is_team_owner(team_id))
with check (private.is_team_owner(team_id));

drop policy if exists members_delete on public.team_members;
create policy members_delete on public.team_members for delete to authenticated
using (private.is_team_owner(team_id));

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

create index if not exists teams_owner_id_idx
  on public.teams(owner_id);
create index if not exists team_members_user_id_idx
  on public.team_members(user_id);
create index if not exists workspace_records_created_by_idx
  on public.workspace_records(created_by);
create index if not exists media_assets_created_by_idx
  on public.media_assets(created_by);
create index if not exists activity_log_created_by_idx
  on public.activity_log(created_by);
create index if not exists agent_authorizations_owner_id_idx
  on public.agent_authorizations(owner_id);
