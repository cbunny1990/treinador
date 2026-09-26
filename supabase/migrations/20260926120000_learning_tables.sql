-- Formação do treinador: tabelas novas, sem referências às tabelas existentes.
create table public.learning_age_groups (
  code text primary key, name text not null, sort int not null, active boolean not null default false
);
create table public.learning_modules (
  id uuid primary key default gen_random_uuid(),
  age_group_code text not null references public.learning_age_groups(code),
  block text not null check (block in ('jogador','ensinar','treinador')),
  slug text not null, title text not null, sort int not null,
  unique (age_group_code, slug)
);
create table public.learning_items (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid(),
  module_id uuid not null references public.learning_modules(id),
  kind text not null check (kind in ('ver','ler','seguir')),
  media text not null check (media in ('video','artigo','manual','blog','rede_social','canal','outro')),
  title text not null, url text not null, url_normalized text not null,
  source text, summary_pt text, key_points jsonb not null default '[]'::jsonb,
  why text, status text not null default 'proposto' check (status in ('proposto','aprovado','rejeitado')),
  reject_reason text, broken boolean not null default false, seen_at timestamptz,
  notes text, proposed_by text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (owner_id, url_normalized)
);
create table public.learning_guides (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null default auth.uid(),
  module_id uuid not null references public.learning_modules(id), body_md text not null,
  citations jsonb not null default '[]'::jsonb,
  status text not null default 'proposto' check (status in ('proposto','aprovado','rejeitado')),
  version int not null default 1,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create unique index learning_guides_one_approved on public.learning_guides(owner_id,module_id) where status='aprovado';
create table public.learning_sessions (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null default auth.uid(),
  module_id uuid not null references public.learning_modules(id),
  title text not null, objective text not null, pillars text[] not null default '{}',
  duration_min int, equipment text, season_phase text check (season_phase in ('inicio','meio','fim')),
  exercises jsonb not null default '[]'::jsonb, why text,
  citations jsonb not null default '[]'::jsonb,
  status text not null default 'proposto' check (status in ('proposto','aprovado','rejeitado')),
  seen_at timestamptz, notes text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
alter table public.learning_age_groups enable row level security;
alter table public.learning_modules enable row level security;
alter table public.learning_items enable row level security;
alter table public.learning_guides enable row level security;
alter table public.learning_sessions enable row level security;
create policy learning_age_groups_select on public.learning_age_groups for select to authenticated using (true);
create policy learning_modules_select on public.learning_modules for select to authenticated using (true);
create policy learning_items_owner_all on public.learning_items for all to authenticated using (owner_id=auth.uid()) with check (owner_id=auth.uid());
create policy learning_guides_owner_all on public.learning_guides for all to authenticated using (owner_id=auth.uid()) with check (owner_id=auth.uid());
create policy learning_sessions_owner_all on public.learning_sessions for all to authenticated using (owner_id=auth.uid()) with check (owner_id=auth.uid());
grant usage on schema auth to authenticated;
grant select on public.learning_age_groups, public.learning_modules to authenticated;
grant select, insert, update, delete on public.learning_items, public.learning_guides, public.learning_sessions to authenticated;

insert into public.learning_age_groups(code,name,sort,active) values
  ('sub8','Sub-8',8,true),('sub9','Sub-9',9,false),('sub10','Sub-10',10,false),
  ('sub11','Sub-11',11,false),('sub12','Sub-12',12,false),('sub13','Sub-13',13,false),
  ('sub14','Sub-14',14,false),('sub15','Sub-15',15,false),('sub17','Sub-17',17,false),
  ('sub19','Sub-19',19,false),('senior','Sénior',99,false)
on conflict (code) do nothing;
insert into public.learning_modules(age_group_code,block,slug,title,sort) values
  ('sub8','jogador','quem-sao','Quem são os Sub-8',1),
  ('sub8','jogador','como-aprendem','Como aprendem',2),
  ('sub8','jogador','objetivos-ate-idade','Objetivos até esta idade',3),
  ('sub8','jogador','fica-para-depois','O que fica para depois',4),
  ('sub8','ensinar','tecnica','Técnica',5),
  ('sub8','ensinar','tatica','Tática',6),
  ('sub8','ensinar','fisico-coordenacao','Físico e coordenação',7),
  ('sub8','ensinar','psicossocial','Psicossocial',8),
  ('sub8','treinador','ensinar-explicar','Como ensinar e explicar',9),
  ('sub8','treinador','como-agir','Como agir',10),
  ('sub8','treinador','planeamento','Planeamento da época',11),
  ('sub8','treinador','treinos-exemplo','Treinos-exemplo',12)
on conflict (age_group_code, slug) do nothing;
