alter table public.learning_sessions add column if not exists library_code text;
alter table public.learning_sessions add column if not exists focus text;
alter table public.learning_sessions add column if not exists season_block smallint check (season_block between 1 and 5);

create unique index if not exists learning_sessions_library_code
  on public.learning_sessions(owner_id, library_code) where library_code is not null;

create table if not exists public.learning_season_plans (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid(),
  age_group_code text not null references public.learning_age_groups(code),
  season_label text not null,
  title text not null,
  start_date date not null,
  end_date date not null,
  status text not null default 'proposto' check (status in ('proposto','aprovado','rejeitado')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists learning_season_plans_one_approved
  on public.learning_season_plans(owner_id, age_group_code, season_label) where status = 'aprovado';

create table if not exists public.learning_plan_weeks (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid(),
  plan_id uuid not null references public.learning_season_plans(id) on delete cascade,
  week_no int not null,
  starts_on date not null,
  block_no smallint not null check (block_no between 1 and 5),
  block_title text not null,
  objective text not null,
  is_break boolean not null default false,
  session_a_id uuid references public.learning_sessions(id),
  session_b_id uuid references public.learning_sessions(id),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (plan_id, week_no)
);

alter table public.learning_season_plans enable row level security;
alter table public.learning_plan_weeks enable row level security;
grant select, insert, update, delete on public.learning_season_plans, public.learning_plan_weeks to authenticated;
do $$
declare t text;
begin
  foreach t in array array['learning_season_plans','learning_plan_weeks'] loop
    execute format('drop policy if exists %1$s_owner_all on public.%1$s', t);
    execute format('create policy %1$s_owner_all on public.%1$s for all to authenticated
      using (owner_id = auth.uid()) with check (owner_id = auth.uid())', t);
  end loop;
end $$;
