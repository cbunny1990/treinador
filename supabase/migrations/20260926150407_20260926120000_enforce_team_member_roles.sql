-- Keep viewer memberships read-only at every direct Supabase/PostgREST boundary.
-- Owners and coaches retain the write behavior used by the PWA sync client.

alter table public.team_members
  alter column role set default 'coach';

create or replace function private.is_team_writer(target_team uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select private.is_team_owner(target_team)
  or exists (
    select 1 from public.team_members
    where team_id = target_team
      and user_id = (select auth.uid())
      and role in ('owner', 'coach')
  );
$$;

revoke all on function private.is_team_writer(uuid) from public, anon;
grant execute on function private.is_team_writer(uuid) to authenticated;

drop policy if exists records_insert on public.workspace_records;
create policy records_insert on public.workspace_records for insert to authenticated
with check (private.is_team_writer(team_id));

drop policy if exists records_update on public.workspace_records;
create policy records_update on public.workspace_records for update to authenticated
using (private.is_team_writer(team_id))
with check (private.is_team_writer(team_id));

drop policy if exists records_delete on public.workspace_records;
create policy records_delete on public.workspace_records for delete to authenticated
using (private.is_team_writer(team_id));

drop policy if exists media_insert on public.media_assets;
create policy media_insert on public.media_assets for insert to authenticated
with check (private.is_team_writer(team_id));

drop policy if exists media_update on public.media_assets;
create policy media_update on public.media_assets for update to authenticated
using (private.is_team_writer(team_id))
with check (private.is_team_writer(team_id));

drop policy if exists media_delete on public.media_assets;
create policy media_delete on public.media_assets for delete to authenticated
using (private.is_team_writer(team_id));

drop policy if exists activity_insert on public.activity_log;
create policy activity_insert on public.activity_log for insert to authenticated
with check (private.is_team_writer(team_id));

drop policy if exists team_media_insert on storage.objects;
create policy team_media_insert on storage.objects for insert to authenticated
with check (
  bucket_id = 'team-media'
  and private.is_team_writer(((storage.foldername(name))[1])::uuid)
);

drop policy if exists team_media_update on storage.objects;
create policy team_media_update on storage.objects for update to authenticated
using (
  bucket_id = 'team-media'
  and private.is_team_writer(((storage.foldername(name))[1])::uuid)
)
with check (
  bucket_id = 'team-media'
  and private.is_team_writer(((storage.foldername(name))[1])::uuid)
);

drop policy if exists team_media_delete on storage.objects;
create policy team_media_delete on storage.objects for delete to authenticated
using (
  bucket_id = 'team-media'
  and private.is_team_writer(((storage.foldername(name))[1])::uuid)
);
