
create or replace function public.is_team_owner(target_team uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.teams
    where id = target_team and owner_id = auth.uid()
  );
$$;

create or replace function public.is_team_member(target_team uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_team_owner(target_team)
  or exists (
    select 1 from public.team_members
    where team_id = target_team and user_id = auth.uid()
  );
$$;

revoke all on function public.is_team_owner(uuid) from public;
revoke all on function public.is_team_member(uuid) from public;
grant execute on function public.is_team_owner(uuid) to authenticated;
grant execute on function public.is_team_member(uuid) to authenticated;

alter table public.teams enable row level security;
alter table public.team_members enable row level security;
alter table public.workspace_records enable row level security;
alter table public.media_assets enable row level security;
alter table public.activity_log enable row level security;
alter table public.agent_authorizations enable row level security;
;
