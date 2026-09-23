
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public' and tablename='workspace_records'
  ) then
    alter publication supabase_realtime add table public.workspace_records;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public' and tablename='media_assets'
  ) then
    alter publication supabase_realtime add table public.media_assets;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public' and tablename='teams'
  ) then
    alter publication supabase_realtime add table public.teams;
  end if;
end $$;;
