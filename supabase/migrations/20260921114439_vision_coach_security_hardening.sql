
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
;
