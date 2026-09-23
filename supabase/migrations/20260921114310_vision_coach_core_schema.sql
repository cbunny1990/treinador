
create extension if not exists pgcrypto;

create table if not exists public.teams (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null default 'Equipa principal',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.team_members (
  team_id uuid not null references public.teams(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner','coach','viewer')),
  created_at timestamptz not null default now(),
  primary key (team_id, user_id)
);

create table if not exists public.workspace_records (
  id uuid primary key,
  team_id uuid not null references public.teams(id) on delete cascade,
  kind text not null check (kind in ('player','match','training','memory','document','game_model')),
  payload jsonb not null default '{}'::jsonb,
  actor_type text not null default 'human' check (actor_type in ('human','agent','system')),
  actor_label text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.media_assets (
  id uuid primary key,
  team_id uuid not null references public.teams(id) on delete cascade,
  subject_type text not null,
  subject_ref text not null,
  media_type text not null check (media_type in ('photo','video','file')),
  title text not null,
  note text,
  external_url text,
  storage_path text,
  file_name text,
  mime_type text,
  size_bytes bigint,
  actor_type text not null default 'human' check (actor_type in ('human','agent','system')),
  actor_label text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint media_has_source check (external_url is not null or storage_path is not null)
);

create table if not exists public.activity_log (
  id uuid primary key,
  team_id uuid not null references public.teams(id) on delete cascade,
  actor_type text not null check (actor_type in ('human','agent','system')),
  actor_label text not null,
  action text not null,
  summary text not null,
  entity_type text,
  entity_ref text,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.agent_authorizations (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  agent_subject text not null,
  scopes text[] not null default array['read']::text[],
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(team_id, agent_subject)
);

create index if not exists workspace_records_team_kind_idx on public.workspace_records(team_id, kind);
create index if not exists workspace_records_updated_idx on public.workspace_records(team_id, updated_at desc);
create index if not exists media_assets_team_idx on public.media_assets(team_id, updated_at desc);
create index if not exists media_assets_subject_idx on public.media_assets(team_id, subject_type, subject_ref);
create index if not exists activity_log_team_idx on public.activity_log(team_id, created_at desc);

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists teams_touch_updated_at on public.teams;
create trigger teams_touch_updated_at before update on public.teams
for each row execute function public.touch_updated_at();

drop trigger if exists workspace_records_touch_updated_at on public.workspace_records;
create trigger workspace_records_touch_updated_at before update on public.workspace_records
for each row execute function public.touch_updated_at();

drop trigger if exists media_assets_touch_updated_at on public.media_assets;
create trigger media_assets_touch_updated_at before update on public.media_assets
for each row execute function public.touch_updated_at();

drop trigger if exists agent_authorizations_touch_updated_at on public.agent_authorizations;
create trigger agent_authorizations_touch_updated_at before update on public.agent_authorizations
for each row execute function public.touch_updated_at();

create or replace function public.add_owner_membership()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.team_members(team_id, user_id, role)
  values (new.id, new.owner_id, 'owner')
  on conflict (team_id, user_id) do update set role = 'owner';
  return new;
end;
$$;

drop trigger if exists teams_add_owner_membership on public.teams;
create trigger teams_add_owner_membership after insert on public.teams
for each row execute function public.add_owner_membership();
;
