-- INSERT ... RETURNING must see the newly inserted team before its AFTER trigger
-- adds the owner's team_members row. Limit that temporary visibility to its owner.
drop policy if exists teams_select on public.teams;
create policy teams_select on public.teams
for select to authenticated
using (
  private.is_team_member(id)
  or owner_id = (select auth.uid())
);
