"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const MIGRATION = path.join(ROOT, "supabase", "migrations", "20260926150407_20260926120000_enforce_team_member_roles.sql");
const TEAM = "10000000-0000-4000-8000-000000000001";
const OWNER = "20000000-0000-4000-8000-000000000001";
const COACH = "20000000-0000-4000-8000-000000000002";
const VIEWER = "20000000-0000-4000-8000-000000000003";
const ROW = "30000000-0000-4000-8000-000000000001";

async function fixture() {
  const { PGlite } = await import("@electric-sql/pglite");
  const db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create schema auth;
    create schema private;
    create schema storage;
    grant usage on schema storage to authenticated;
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create table public.teams(id uuid primary key, owner_id uuid not null);
    create table public.team_members(
      team_id uuid not null, user_id uuid not null,
      role text not null default 'member' check (role in ('owner','coach','viewer')),
      primary key(team_id,user_id)
    );
    create table public.workspace_records(id uuid primary key, team_id uuid not null, payload jsonb not null default '{}');
    create table public.media_assets(id uuid primary key, team_id uuid not null);
    create table public.activity_log(id uuid primary key, team_id uuid not null);
    create table storage.objects(bucket_id text not null, name text not null);
    create function storage.foldername(value text) returns text[] language sql immutable as
      $$ select string_to_array(value, '/') $$;
    create function private.is_team_owner(target_team uuid) returns boolean
    language sql stable security definer set search_path = public, pg_catalog as $$
      select exists (select 1 from public.teams where id=target_team and owner_id=(select auth.uid()))
    $$;
    create function private.is_team_member(target_team uuid) returns boolean
    language sql stable security definer set search_path = public, pg_catalog as $$
      select private.is_team_owner(target_team) or exists (
        select 1 from public.team_members where team_id=target_team and user_id=(select auth.uid())
      )
    $$;
    insert into public.teams values ('${TEAM}','${OWNER}');
    insert into public.team_members(team_id,user_id,role) values
      ('${TEAM}','${OWNER}','owner'),('${TEAM}','${COACH}','coach'),('${TEAM}','${VIEWER}','viewer');
    insert into public.workspace_records(id,team_id,payload) values ('${ROW}','${TEAM}','{"text":"shared"}');
    grant select,insert,update,delete on public.team_members,public.workspace_records,public.media_assets,public.activity_log,storage.objects to authenticated;
    alter table public.workspace_records enable row level security;
    alter table public.media_assets enable row level security;
    alter table public.activity_log enable row level security;
    alter table storage.objects enable row level security;
    create policy records_select on public.workspace_records for select to authenticated using (private.is_team_member(team_id));
    create policy records_insert on public.workspace_records for insert to authenticated with check (private.is_team_member(team_id));
    create policy records_update on public.workspace_records for update to authenticated using (private.is_team_member(team_id)) with check (private.is_team_member(team_id));
    create policy records_delete on public.workspace_records for delete to authenticated using (private.is_team_member(team_id));
    create policy media_select on public.media_assets for select to authenticated using (private.is_team_member(team_id));
    create policy media_insert on public.media_assets for insert to authenticated with check (private.is_team_member(team_id));
    create policy media_update on public.media_assets for update to authenticated using (private.is_team_member(team_id)) with check (private.is_team_member(team_id));
    create policy media_delete on public.media_assets for delete to authenticated using (private.is_team_member(team_id));
    create policy activity_select on public.activity_log for select to authenticated using (private.is_team_member(team_id));
    create policy activity_insert on public.activity_log for insert to authenticated with check (private.is_team_member(team_id));
    create policy team_media_select on storage.objects for select to authenticated using (private.is_team_member(((storage.foldername(name))[1])::uuid));
    create policy team_media_insert on storage.objects for insert to authenticated with check (private.is_team_member(((storage.foldername(name))[1])::uuid));
    create policy team_media_update on storage.objects for update to authenticated using (private.is_team_member(((storage.foldername(name))[1])::uuid)) with check (private.is_team_member(((storage.foldername(name))[1])::uuid));
    create policy team_media_delete on storage.objects for delete to authenticated using (private.is_team_member(((storage.foldername(name))[1])::uuid));
  `);
  await db.exec(fs.readFileSync(MIGRATION, "utf8"));
  return db;
}

async function asUser(db, userId) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [userId]);
  await db.exec("set role authenticated");
}

test("viewer members can read team records but cannot write records or media", async (t) => {
  const db = await fixture();
  t.after(() => db.close());

  await asUser(db, VIEWER);
  assert.equal((await db.query("select id from public.workspace_records")).rows.length, 1);
  await assert.rejects(
    db.query("insert into public.workspace_records(id,team_id) values ($1,$2)", ["30000000-0000-4000-8000-000000000002", TEAM]),
    /row-level security|policy/,
  );
  await assert.rejects(
    db.query("insert into public.media_assets(id,team_id) values ($1,$2)", ["40000000-0000-4000-8000-000000000001", TEAM]),
    /row-level security|policy/,
  );
  await assert.rejects(
    db.query("insert into public.activity_log(id,team_id) values ($1,$2)", ["50000000-0000-4000-8000-000000000001", TEAM]),
    /row-level security|policy/,
  );
  assert.equal((await db.query("update public.workspace_records set payload='{}' where id=$1", [ROW])).rowCount, 0);
  assert.equal((await db.query("delete from public.workspace_records where id=$1", [ROW])).rowCount, 0);
  await assert.rejects(
    db.query("insert into storage.objects(bucket_id,name) values ('team-media',$1)", [`${TEAM}/players/photo.jpg`]),
    /row-level security|policy/,
  );
});

test("coaches retain workspace writes and omitted membership role defaults to coach", async (t) => {
  const db = await fixture();
  t.after(() => db.close());

  await asUser(db, COACH);
  await db.query("insert into public.workspace_records(id,team_id) values ($1,$2)", ["30000000-0000-4000-8000-000000000003", TEAM]);
  await db.query("insert into public.media_assets(id,team_id) values ($1,$2)", ["40000000-0000-4000-8000-000000000002", TEAM]);
  await db.query("insert into public.activity_log(id,team_id) values ($1,$2)", ["50000000-0000-4000-8000-000000000002", TEAM]);
  await db.query("insert into storage.objects(bucket_id,name) values ('team-media',$1)", [`${TEAM}/players/coach.jpg`]);
  await db.exec("reset role");
  const defaultRole = await db.query("select column_default from information_schema.columns where table_schema='public' and table_name='team_members' and column_name='role'");
  assert.equal(defaultRole.rows[0].column_default, "'coach'::text");
  await db.query("insert into public.team_members(team_id,user_id) values ($1,$2)", [TEAM, "20000000-0000-4000-8000-000000000004"]);
  const member = await db.query("select role from public.team_members where user_id=$1", ["20000000-0000-4000-8000-000000000004"]);
  assert.equal(member.rows[0].role, "coach");
});
