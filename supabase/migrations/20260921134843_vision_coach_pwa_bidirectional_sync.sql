-- Allow authenticated team members to observe tombstones so every PWA copy can
-- apply remote soft-deletes. RLS still limits rows to the current team.
drop policy if exists records_select on public.workspace_records;
create policy records_select on public.workspace_records
for select to authenticated
using (private.is_team_member(team_id));
drop policy if exists media_select on public.media_assets;
create policy media_select on public.media_assets
for select to authenticated
using (private.is_team_member(team_id));
