-- Vision Coach: shared Human-Agent workspace
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

create index if not exists workspace_records_team_kind_idx on public.workspace_records(team_id, kind);
create index if not exists workspace_records_updated_idx on public.workspace_records(team_id, updated_at desc);

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

create index if not exists media_assets_team_idx on public.media_assets(team_id, updated_at desc);
create index if not exists media_assets_subject_idx on public.media_assets(team_id, subject_type, subject_ref);

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

create index if not exists activity_log_team_idx on public.activity_log(team_id, created_at desc);

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

drop policy if exists teams_select on public.teams;
create policy teams_select on public.teams for select to authenticated
using (public.is_team_member(id));

drop policy if exists teams_insert on public.teams;
create policy teams_insert on public.teams for insert to authenticated
with check (auth.uid() is not null and owner_id = auth.uid());

drop policy if exists teams_update on public.teams;
create policy teams_update on public.teams for update to authenticated
using (public.is_team_owner(id)) with check (public.is_team_owner(id));

drop policy if exists teams_delete on public.teams;
create policy teams_delete on public.teams for delete to authenticated
using (public.is_team_owner(id));

drop policy if exists members_select on public.team_members;
create policy members_select on public.team_members for select to authenticated
using (public.is_team_member(team_id));

drop policy if exists members_insert on public.team_members;
create policy members_insert on public.team_members for insert to authenticated
with check (public.is_team_owner(team_id));

drop policy if exists members_update on public.team_members;
create policy members_update on public.team_members for update to authenticated
using (public.is_team_owner(team_id)) with check (public.is_team_owner(team_id));

drop policy if exists members_delete on public.team_members;
create policy members_delete on public.team_members for delete to authenticated
using (public.is_team_owner(team_id));

drop policy if exists records_select on public.workspace_records;
create policy records_select on public.workspace_records for select to authenticated
using (public.is_team_member(team_id) and deleted_at is null);

drop policy if exists records_insert on public.workspace_records;
create policy records_insert on public.workspace_records for insert to authenticated
with check (public.is_team_member(team_id));

drop policy if exists records_update on public.workspace_records;
create policy records_update on public.workspace_records for update to authenticated
using (public.is_team_member(team_id))
with check (public.is_team_member(team_id));

drop policy if exists records_delete on public.workspace_records;
create policy records_delete on public.workspace_records for delete to authenticated
using (public.is_team_member(team_id));

drop policy if exists media_select on public.media_assets;
create policy media_select on public.media_assets for select to authenticated
using (public.is_team_member(team_id) and deleted_at is null);

drop policy if exists media_insert on public.media_assets;
create policy media_insert on public.media_assets for insert to authenticated
with check (public.is_team_member(team_id));

drop policy if exists media_update on public.media_assets;
create policy media_update on public.media_assets for update to authenticated
using (public.is_team_member(team_id))
with check (public.is_team_member(team_id));

drop policy if exists media_delete on public.media_assets;
create policy media_delete on public.media_assets for delete to authenticated
using (public.is_team_member(team_id));
drop policy if exists activity_select on public.activity_log;
create policy activity_select on public.activity_log for select to authenticated
using (public.is_team_member(team_id));
drop policy if exists activity_insert on public.activity_log;
create policy activity_insert on public.activity_log for insert to authenticated
with check (public.is_team_member(team_id));
drop policy if exists agent_auth_select on public.agent_authorizations;
create policy agent_auth_select on public.agent_authorizations for select to authenticated
using (public.is_team_owner(team_id) and owner_id = auth.uid());
drop policy if exists agent_auth_insert on public.agent_authorizations;
create policy agent_auth_insert on public.agent_authorizations for insert to authenticated
with check (public.is_team_owner(team_id) and owner_id = auth.uid());
drop policy if exists agent_auth_update on public.agent_authorizations;
create policy agent_auth_update on public.agent_authorizations for update to authenticated
using (public.is_team_owner(team_id) and owner_id = auth.uid())
with check (public.is_team_owner(team_id) and owner_id = auth.uid());
drop policy if exists agent_auth_delete on public.agent_authorizations;
create policy agent_auth_delete on public.agent_authorizations for delete to authenticated
using (public.is_team_owner(team_id) and owner_id = auth.uid());
grant usage on schema public to authenticated;
grant select, insert, update, delete on public.teams to authenticated;
grant select, insert, update, delete on public.team_members to authenticated;
grant select, insert, update, delete on public.workspace_records to authenticated;
grant select, insert, update, delete on public.media_assets to authenticated;
grant select, insert on public.activity_log to authenticated;
grant select, insert, update, delete on public.agent_authorizations to authenticated;
insert into storage.buckets (id, name, public)
values ('team-media', 'team-media', false)
on conflict (id) do update set public = false;
drop policy if exists team_media_select on storage.objects;
create policy team_media_select on storage.objects for select to authenticated
using (bucket_id = 'team-media' and public.is_team_member(((storage.foldername(name))[1])::uuid));
drop policy if exists team_media_insert on storage.objects;
create policy team_media_insert on storage.objects for insert to authenticated
with check (bucket_id = 'team-media' and public.is_team_member(((storage.foldername(name))[1])::uuid));
drop policy if exists team_media_update on storage.objects;
create policy team_media_update on storage.objects for update to authenticated
using (bucket_id = 'team-media' and public.is_team_member(((storage.foldername(name))[1])::uuid))
with check (bucket_id = 'team-media' and public.is_team_member(((storage.foldername(name))[1])::uuid));
drop policy if exists team_media_delete on storage.objects;
create policy team_media_delete on storage.objects for delete to authenticated
using (bucket_id = 'team-media' and public.is_team_member(((storage.foldername(name))[1])::uuid));
