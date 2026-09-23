
insert into storage.buckets (id, name, public)
values ('team-media', 'team-media', false)
on conflict (id) do update set public = false;

drop policy if exists team_media_select on storage.objects;
create policy team_media_select on storage.objects for select to authenticated
using (
  bucket_id = 'team-media'
  and public.is_team_member(((storage.foldername(name))[1])::uuid)
);

drop policy if exists team_media_insert on storage.objects;
create policy team_media_insert on storage.objects for insert to authenticated
with check (
  bucket_id = 'team-media'
  and public.is_team_member(((storage.foldername(name))[1])::uuid)
);

drop policy if exists team_media_update on storage.objects;
create policy team_media_update on storage.objects for update to authenticated
using (
  bucket_id = 'team-media'
  and public.is_team_member(((storage.foldername(name))[1])::uuid)
)
with check (
  bucket_id = 'team-media'
  and public.is_team_member(((storage.foldername(name))[1])::uuid)
);

drop policy if exists team_media_delete on storage.objects;
create policy team_media_delete on storage.objects for delete to authenticated
using (
  bucket_id = 'team-media'
  and public.is_team_member(((storage.foldername(name))[1])::uuid)
);
;
