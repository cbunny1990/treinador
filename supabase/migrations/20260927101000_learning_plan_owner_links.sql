-- A member may know another owner's UUID. RLS on the week alone must not let
-- that UUID become a reference to a plan or session outside the member's data.
alter table public.learning_season_plans
  add constraint learning_season_plans_id_owner_unique unique (id, owner_id);

alter table public.learning_sessions
  add constraint learning_sessions_id_owner_unique unique (id, owner_id);

alter table public.learning_plan_weeks
  add constraint learning_plan_weeks_plan_owner_fk
  foreign key (plan_id, owner_id)
  references public.learning_season_plans (id, owner_id)
  on delete cascade;

alter table public.learning_plan_weeks
  add constraint learning_plan_weeks_session_a_owner_fk
  foreign key (session_a_id, owner_id)
  references public.learning_sessions (id, owner_id);

alter table public.learning_plan_weeks
  add constraint learning_plan_weeks_session_b_owner_fk
  foreign key (session_b_id, owner_id)
  references public.learning_sessions (id, owner_id);
