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
    const migration = path.join(__dirname, "..", "supabase", "migrations", "20260926120000_learning_tables.sql");
    if (fs.existsSync(migration)) await db.exec(fs.readFileSync(migration, "utf8"));
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
