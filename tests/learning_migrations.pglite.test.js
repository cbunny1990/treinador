"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const A = "00000000-0000-4000-8000-00000000000a";
const B = "00000000-0000-4000-8000-00000000000b";
async function withDb(fn) {
  const { PGlite } = await import("@electric-sql/pglite");
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create schema auth;
      create function auth.uid() returns uuid language sql stable as
        $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
      create function auth.role() returns text language sql stable as
        $$ select current_setting('request.jwt.claim.role', true) $$;
      select set_config('request.jwt.claim.role','service_role',false);`);
    const migration = path.join(__dirname, "..", "supabase", "migrations", "20260926223649_learning_tables.sql");
    assert.ok(fs.existsSync(migration), "migração learning_tables tem de existir com a versão remota");
    await db.exec(fs.readFileSync(migration, "utf8"));
    const seasonMigration = path.join(__dirname, "..", "supabase", "migrations", "20260926233609_learning_season_plan.sql");
    if (fs.existsSync(seasonMigration)) await db.exec(fs.readFileSync(seasonMigration, "utf8"));
    const ownerLinksMigration = path.join(__dirname, "..", "supabase", "migrations", "20260927013751_learning_plan_owner_links.sql");
    if (fs.existsSync(ownerLinksMigration)) await db.exec(fs.readFileSync(ownerLinksMigration, "utf8"));
    await fn(db);
  } finally { await db.close(); }
}
async function asUser(db, id) {
  await db.query("select set_config('request.jwt.claim.role','authenticated',false)");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
  await db.query("set role authenticated");
}

test("seed Sub-8: escalão ativo e 12 módulos em 3 blocos", async () => withDb(async db => {
  const g = await db.query("select code,active from public.learning_age_groups where code='sub8'");
  assert.deepEqual(g.rows, [{ code: "sub8", active: true }]);
  const m = await db.query("select block,count(*)::int n from public.learning_modules where age_group_code='sub8' group by block order by block");
  assert.deepEqual(m.rows, [{ block: "ensinar", n: 4 }, { block: "jogador", n: 4 }, { block: "treinador", n: 4 }]);
}));
test("RLS: outro utilizador não vê nem altera itens do dono", async () => withDb(async db => {
  const mod = (await db.query("select id from public.learning_modules where slug='como-aprendem'")).rows[0].id;
  await asUser(db, A);
  await db.query("insert into public.learning_items(module_id,kind,media,title,url,url_normalized,status) values($1,'ver','video','T','https://youtube.com/watch?v=x','https://youtube.com/watch?v=x','aprovado')", [mod]);
  await db.query("reset role");
  await asUser(db, B);
  assert.equal((await db.query("select * from public.learning_items")).rows.length, 0);
  assert.equal((await db.query("update public.learning_items set notes='x' returning id")).rows.length, 0);
}));
test("URL normalizado é único por dono", async () => withDb(async db => {
  const mod = (await db.query("select id from public.learning_modules where slug='tecnica'")).rows[0].id;
  await asUser(db, A);
  const ins = "insert into public.learning_items(module_id,kind,media,title,url,url_normalized) values($1,'ler','artigo','T','https://a.pt/x','https://a.pt/x')";
  await db.query(ins, [mod]);
  await assert.rejects(() => db.query(ins, [mod]), /duplicate key|unique/i);
}));
test("só um guia aprovado por módulo e dono", async () => withDb(async db => {
  const mod = (await db.query("select id from public.learning_modules where slug='tatica'")).rows[0].id;
  await asUser(db, A);
  const ins = "insert into public.learning_guides(module_id,body_md,status) values($1,'# g','aprovado')";
  await db.query(ins, [mod]);
  await assert.rejects(() => db.query(ins, [mod]), /duplicate key|unique/i);
}));

test("biblioteca: library_code único por dono", async () => withDb(async db => {
  await asUser(db, A);
  const mod = (await db.query("select id from public.learning_modules where slug='treinos-exemplo'")).rows[0].id;
  const ins = "insert into public.learning_sessions(module_id,title,objective,library_code,focus,season_block,status) values($1,'T','O','T01','condução',2,'aprovado')";
  await db.query(ins, [mod]);
  await assert.rejects(() => db.query(ins, [mod]), /duplicate key|unique/i);
  await db.query("reset role");
  await asUser(db, B);
  await db.query(ins, [mod]);
}));

test("plano: semanas únicas, cascade e RLS", async () => withDb(async db => {
  await asUser(db, A);
  const p = (await db.query("insert into public.learning_season_plans(age_group_code,season_label,title,start_date,end_date,status) values('sub8','2026/27','Época','2026-09-07','2027-07-30','aprovado') returning id")).rows[0].id;
  const w = "insert into public.learning_plan_weeks(plan_id,week_no,starts_on,block_no,block_title,objective) values($1,1,'2026-09-07',1,'Adaptação','Conhecer o grupo')";
  await db.query(w, [p]);
  await assert.rejects(() => db.query(w, [p]), /duplicate key|unique/i);
  await db.query("reset role");
  await asUser(db, B);
  assert.equal((await db.query("select * from public.learning_plan_weeks")).rows.length, 0);
  await db.query("reset role");
  await asUser(db, A);
  await db.query("delete from public.learning_season_plans where id=$1", [p]);
  assert.equal((await db.query("select * from public.learning_plan_weeks")).rows.length, 0);
}));

test("semanas não associam planos ou treinos de outro dono", async () => withDb(async db => {
  const mod = (await db.query("select id from public.learning_modules where slug='treinos-exemplo'")).rows[0].id;
  const makePlan = "insert into public.learning_season_plans(age_group_code,season_label,title,start_date,end_date,status) values('sub8','2026/27','Época','2026-09-07','2027-07-30','aprovado') returning id";
  const makeSession = "insert into public.learning_sessions(module_id,title,objective,status) values($1,'Treino','Objetivo','aprovado') returning id";
  await asUser(db, A);
  const planA = (await db.query(makePlan)).rows[0].id;
  const sessionA = (await db.query(makeSession, [mod])).rows[0].id;
  await db.query("reset role");
  await asUser(db, B);
  const planB = (await db.query(makePlan)).rows[0].id;
  const sessionB = (await db.query(makeSession, [mod])).rows[0].id;
  const makeWeek = "insert into public.learning_plan_weeks(plan_id,week_no,starts_on,block_no,block_title,objective,session_a_id,session_b_id) values($1,1,'2026-09-07',1,'Bloco','Foco',$2,$3) returning id";
  await assert.rejects(() => db.query(makeWeek, [planA, sessionB, null]), /foreign key/i);
  await assert.rejects(() => db.query(makeWeek, [planB, sessionA, null]), /foreign key/i);
  await assert.rejects(() => db.query(makeWeek, [planB, sessionB, sessionA]), /foreign key/i);
  const weekB = (await db.query(makeWeek, [planB, sessionB, null])).rows[0].id;
  await assert.rejects(() => db.query("update public.learning_plan_weeks set plan_id=$1 where id=$2", [planA, weekB]), /foreign key/i);
  await assert.rejects(() => db.query("update public.learning_plan_weeks set session_b_id=$1 where id=$2", [sessionA, weekB]), /foreign key/i);
  assert.equal((await db.query("select count(*)::int n from public.learning_plan_weeks")).rows[0].n, 1);
}));
