"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const MIGRATIONS = [
  "20260924100000_team_knowledge_rag.sql",
  "20260924100001_team_knowledge_multi_match_filter.sql",
  "20260924101056_invalidate_team_knowledge_on_age_group_change.sql",
  "20260924110000_team_knowledge_per_match_limit.sql",
  "20260924120000_refresh_team_knowledge_on_player_identity_change.sql",
];
const TEAM_A = "10000000-0000-4000-8000-000000000001";
const TEAM_B = "10000000-0000-4000-8000-000000000002";
const SOURCE_A1 = "20000000-0000-4000-8000-000000000001";
const SOURCE_A2 = "20000000-0000-4000-8000-000000000002";
const SOURCE_B = "20000000-0000-4000-8000-000000000003";
const PLAYER_A = "20000000-0000-4000-8000-000000000004";
const SOURCE_SEMANTIC = "20000000-0000-4000-8000-000000000005";
const SOURCE_LEXICAL = "20000000-0000-4000-8000-000000000006";
const SOURCE_IRRELEVANT = "20000000-0000-4000-8000-000000000007";
const SOURCE_TRAINING = "20000000-0000-4000-8000-000000000008";
const SOURCE_EXERCISE = "20000000-0000-4000-8000-000000000009";
const SOURCE_OTHER_MATCH = "20000000-0000-4000-8000-000000000010";
const MATCH_A1 = "30000000-0000-4000-8000-000000000001";
const MATCH_A2 = "30000000-0000-4000-8000-000000000002";
const MATCH_B = "30000000-0000-4000-8000-000000000003";
const MATCH_SEMANTIC = "30000000-0000-4000-8000-000000000004";
const MATCH_LEXICAL = "30000000-0000-4000-8000-000000000005";
const MATCH_IRRELEVANT = "30000000-0000-4000-8000-000000000006";
const MATCH_OTHER = "30000000-0000-4000-8000-000000000007";
const TRAINING_REF = "40000000-0000-4000-8000-000000000001";
const UPDATED = "2026-09-24T09:00:00.000Z";
const EMBEDDING = `[${[1, ...Array(1535).fill(0)].join(",")}]`;

function testVector(angle) {
  return `[${[Math.cos(angle), Math.sin(angle), ...Array(1534).fill(0)].join(",")}]`;
}

async function fixture() {
  const [{ PGlite }, { vector }] = await Promise.all([
    import("@electric-sql/pglite"),
    import("@electric-sql/pglite-pgvector"),
  ]);
  const db = new PGlite({ extensions: { vector } });
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create schema auth;
    create schema extensions;
    create schema private;
    create function auth.role() returns text language sql stable as
      $$ select current_setting('request.jwt.claim.role', true) $$;
    create table public.teams(id uuid primary key, metadata jsonb not null default '{}'::jsonb);
    create table public.workspace_records(
      id uuid primary key,
      team_id uuid not null references public.teams(id) on delete cascade,
      kind text not null,
      payload jsonb not null default '{}'::jsonb,
      updated_at timestamptz not null,
      deleted_at timestamptz
    );
    insert into public.teams(id, metadata) values
      ('${TEAM_A}', '{"escalao":"Sub-8"}'),
      ('${TEAM_B}', '{"escalao":"Sub-9"}');
    insert into public.workspace_records(id,team_id,kind,payload,updated_at) values
      ('${SOURCE_A1}','${TEAM_A}','match','{"match_id":"${MATCH_A1}","report":"construction losses"}','${UPDATED}'),
      ('${SOURCE_A2}','${TEAM_A}','match','{"match_id":"${MATCH_A2}","report":"construction losses"}','${UPDATED}'),
      ('${SOURCE_B}','${TEAM_B}','match','{"match_id":"${MATCH_B}","report":"construction losses"}','${UPDATED}');
    select set_config('request.jwt.claim.role','service_role',false);
  `);
  for (const file of MIGRATIONS) {
    await db.exec(fs.readFileSync(path.join(ROOT, "supabase", "migrations", file), "utf8"));
  }
  return db;
}

async function indexSource(db, teamId, sourceId, matchRef, row, chunks = 1) {
  assert.ok(row, `expected queued source ${sourceId} to be claimed`);
  const contentChunks = Array.from({ length: chunks }, (_, index) => ({
    source_kind: "match",
    source_path: `payload.report.${index}`,
    chunk_no: index,
    source_date: "2026-09-20",
    match_ref: matchRef,
    training_ref: null,
    player_ref: null,
    category: "observation",
    evidence_type: "coach_observation",
    title: `Match report ${index}`,
    content: `construction losses detail ${index}`,
    content_hash: `hash-${sourceId}-${index}`,
    embedding_model: "test-model",
    embedding: EMBEDDING,
    metadata: { test_fixture: true },
  }));
  await db.query(
    `select public.replace_team_knowledge_source(
       $1::uuid,$2::uuid,$3::timestamptz,$4::uuid,$5::jsonb
     )`,
    [teamId, sourceId, row.source_updated_at, row.claim_token, JSON.stringify(contentChunks)],
  );
}

async function searchBalanced(db, teamId, matchRefs, perMatchLimit, query = "construction losses") {
  return db.query(`
    select * from public.search_team_knowledge_chunks(
      $1::uuid,$2::extensions.vector,$3::text,$4::integer,$5::text[],
      $6::date,$7::date,$8::uuid,$9::uuid,$10::uuid,$11::text,
      $12::uuid[],$13::integer
    )`, [
    teamId, EMBEDDING, query, 12, null,
    null, null, null, null, null, null, matchRefs, perMatchLimit,
  ]);
}

async function searchKnowledge(db, filters = {}) {
  const result = await db.query(`
    select * from public.search_team_knowledge_chunks(
      $1::uuid,$2::extensions.vector,$3::text,$4::integer,$5::text[],
      $6::date,$7::date,$8::uuid,$9::uuid,$10::uuid,$11::text,
      $12::uuid[],$13::integer
    )`, [
    filters.teamId ?? TEAM_A, EMBEDDING, filters.query ?? "apoio", filters.limit ?? 12,
    filters.sourceKinds ?? null, filters.from ?? null, filters.to ?? null,
    filters.matchRef ?? null, filters.trainingRef ?? null, filters.playerRef ?? null,
    filters.category ?? null, filters.matchRefs ?? null, filters.perMatchLimit ?? null,
  ]);
  return result.rows;
}

test("RAG migrations executam em Postgres WASM e preservam limites de equipa e origem", async (t) => {
  const db = await fixture();
  t.after(() => db.close());

  const teamAClaims = await db.query("select * from public.claim_team_knowledge_jobs($1::uuid, 64)", [TEAM_A]);
  const teamBClaims = await db.query("select * from public.claim_team_knowledge_jobs($1::uuid, 64)", [TEAM_B]);
  const claimsA = new Map(teamAClaims.rows.map((row) => [row.source_id, row]));
  await indexSource(db, TEAM_A, SOURCE_A1, MATCH_A1, claimsA.get(SOURCE_A1), 3);
  await indexSource(db, TEAM_A, SOURCE_A2, MATCH_A2, claimsA.get(SOURCE_A2), 2);
  await indexSource(db, TEAM_B, SOURCE_B, MATCH_B, teamBClaims.rows.find((row) => row.source_id === SOURCE_B), 1);

  const balanced = await searchBalanced(db, TEAM_A, [MATCH_A1, MATCH_A2], 1);
  assert.equal(balanced.rows.length, 2);
  assert.deepEqual(new Set(balanced.rows.map((row) => row.match_ref)), new Set([MATCH_A1, MATCH_A2]));
  assert.deepEqual(
    Object.fromEntries([...new Set(balanced.rows.map((row) => row.match_ref))]
      .map((matchRef) => [matchRef, balanced.rows.filter((row) => row.match_ref === matchRef).length])),
    { [MATCH_A1]: 1, [MATCH_A2]: 1 },
  );
  assert.equal((await searchBalanced(db, TEAM_A, [MATCH_B], 1)).rows.length, 0);

  const legacy = await db.query(`
    select * from public.search_team_knowledge_chunks(
      $1::uuid,$2::extensions.vector,$3::text,$4::integer,$5::text[],
      $6::date,$7::date,$8::uuid,$9::uuid,$10::uuid,$11::text,$12::uuid[]
    )`, [TEAM_A, EMBEDDING, "construction losses", 12, null, null, null, null, null, null, null, null]);
  assert.equal(legacy.rows.length, 5, "legacy overload stays available and scoped to team A");

  const policies = await db.query(`
    select relname, relrowsecurity from pg_class
    where oid in ('private.team_knowledge_chunks'::regclass, 'private.team_knowledge_jobs'::regclass)
  `);
  assert.equal(policies.rows.length, 2);
  assert.ok(policies.rows.every((row) => row.relrowsecurity));
  const executeGrants = await db.query(`
    select p.proname, has_function_privilege('anon', p.oid, 'execute') as anon_can_execute,
      has_function_privilege('authenticated', p.oid, 'execute') as auth_can_execute,
      has_function_privilege('service_role', p.oid, 'execute') as service_can_execute
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='search_team_knowledge_chunks'
  `);
  assert.equal(executeGrants.rows.length, 3);
  assert.ok(executeGrants.rows.every((row) => !row.anon_can_execute && !row.auth_can_execute && row.service_can_execute));

  await db.query("select set_config('request.jwt.claim.role','authenticated',false)");
  await assert.rejects(
    () => searchBalanced(db, TEAM_A, [MATCH_A1], 1),
    /service_role_required/,
  );
  await db.query("select set_config('request.jwt.claim.role','service_role',false)");

  await db.query(`update public.teams set metadata='{"escalao":"Sub-10"}'::jsonb where id=$1`, [TEAM_A]);
  const invalidated = await db.query("select count(*)::int as n from private.team_knowledge_chunks where team_id=$1", [TEAM_A]);
  assert.equal(invalidated.rows[0].n, 0, "age-group change invalidates chunks that carry stale team metadata");
  const staleSearch = await searchBalanced(db, TEAM_A, [MATCH_A1, MATCH_A2], 1);
  assert.equal(staleSearch.rows.length, 0, "retrieval cannot return the old metadata while reindexing is pending");
  const pendingAgeRefresh = await db.query("select count(*)::int as n from private.team_knowledge_jobs where team_id=$1", [TEAM_A]);
  assert.equal(pendingAgeRefresh.rows[0].n, 2, "age-group change queues all active team sources for reindexing");
  const refreshedClaims = await db.query("select * from public.claim_team_knowledge_jobs($1::uuid,64)", [TEAM_A]);
  const refreshedBySource = new Map(refreshedClaims.rows.map((row) => [row.source_id, row]));
  await indexSource(db, TEAM_A, SOURCE_A1, MATCH_A1, refreshedBySource.get(SOURCE_A1), 3);
  await indexSource(db, TEAM_A, SOURCE_A2, MATCH_A2, refreshedBySource.get(SOURCE_A2), 2);
  const refreshed = await searchBalanced(db, TEAM_A, [MATCH_A1, MATCH_A2], 1);
  assert.equal(refreshed.rows.length, 2, "new team metadata becomes searchable after idempotent reindexing");

  await db.query("update public.workspace_records set deleted_at=now(), updated_at=now() where id=$1", [SOURCE_A1]);
  const deletedSource = await db.query("select count(*)::int as n from private.team_knowledge_chunks where source_id=$1", [SOURCE_A1]);
  assert.equal(deletedSource.rows[0].n, 0, "soft deletion removes derived chunks");
  await db.query("delete from public.workspace_records where id=$1", [SOURCE_A2]);
  const hardDeleted = await db.query("select count(*)::int as n from private.team_knowledge_chunks where source_id=$1", [SOURCE_A2]);
  assert.equal(hardDeleted.rows[0].n, 0, "physical deletion removes derived chunks");
});

test("pesquisa híbrida recupera paráfrase semântica e correspondência lexical, excluindo conteúdo irrelevante", async (t) => {
  const db = await fixture();
  t.after(() => db.close());
  const sources = [
    { id: SOURCE_SEMANTIC, match: MATCH_SEMANTIC, content: "A saída curta deixou a defesa sem linha de passe e o bloco ficou pressionado junto da baliza.", angle: 0.05 },
    { id: SOURCE_LEXICAL, match: MATCH_LEXICAL, content: "Perdas na construção em zona baixa após pressão adversária.", angle: 0.32 },
    { id: SOURCE_IRRELEVANT, match: MATCH_IRRELEVANT, content: "Bolas paradas e marcação ao segundo poste.", angle: 1.35 },
  ];
  for (const source of sources) {
    await db.query(`insert into public.workspace_records(id,team_id,kind,payload,updated_at)
      values ($1,$2,'match','{}'::jsonb,$3)`, [source.id, TEAM_A, UPDATED]);
  }
  const claims = await db.query("select * from public.claim_team_knowledge_jobs($1::uuid, 64)", [TEAM_A]);
  const claimsBySource = new Map(claims.rows.map((row) => [row.source_id, row]));
  for (const source of sources) {
    const claim = claimsBySource.get(source.id);
    assert.ok(claim, `source ${source.id} must be claimed for indexing`);
    const chunk = {
      source_kind: "match", source_path: "payload.report", chunk_no: 0,
      source_date: "2026-09-20", match_ref: source.match, training_ref: null,
      player_ref: null, category: "observation", evidence_type: "coach_observation",
      title: "Relatório sintético", content: source.content,
      content_hash: `eval-${source.id}`, embedding_model: "synthetic-eval",
      embedding: testVector(source.angle), metadata: { synthetic_eval: true },
    };
    await db.query(`select public.replace_team_knowledge_source(
      $1::uuid,$2::uuid,$3::timestamptz,$4::uuid,$5::jsonb
    )`, [TEAM_A, source.id, claim.source_updated_at, claim.claim_token, JSON.stringify([chunk])]);
  }

  const results = await searchBalanced(db, TEAM_A, [MATCH_SEMANTIC, MATCH_LEXICAL, MATCH_IRRELEVANT], 2, "perdas construção zona baixa");
  const byMatch = new Map(results.rows.map((row) => [row.match_ref, row]));
  assert.ok(byMatch.has(MATCH_SEMANTIC), "semantic match must retrieve a Portuguese paraphrase without shared query words");
  assert.ok(byMatch.has(MATCH_LEXICAL), "lexical match must retrieve exact Portuguese terms despite a weaker synthetic vector");
  assert.deepEqual(new Set(results.rows.slice(0, 2).map((row) => row.match_ref)), new Set([MATCH_SEMANTIC, MATCH_LEXICAL]), "relevant semantic and lexical evidence must rank ahead of the distant distractor");
  assert.equal(byMatch.get(MATCH_SEMANTIC).content, sources[0].content);
  assert.equal(byMatch.get(MATCH_LEXICAL).content, sources[1].content);
  assert.ok(byMatch.get(MATCH_LEXICAL).lexical_rank > 0);
  assert.equal(byMatch.get(MATCH_SEMANTIC).lexical_rank, 0);
});

test("RPC RAG aplica filtros por tipo, data, jogo, treino, atleta e categoria", async (t) => {
  const db = await fixture();
  t.after(() => db.close());
  const sources = [
    { id: SOURCE_SEMANTIC, kind: "match", match: MATCH_SEMANTIC, player: PLAYER_A, category: "loss", date: "2026-09-10" },
    { id: SOURCE_TRAINING, kind: "training", training: TRAINING_REF, player: PLAYER_A, category: "training_observation", date: "2026-09-20" },
    { id: SOURCE_EXERCISE, kind: "exercise", category: "exercise", date: null },
    { id: SOURCE_OTHER_MATCH, kind: "match", match: MATCH_OTHER, category: "goal", date: "2026-09-30" },
  ];
  for (const source of sources) {
    await db.query(`insert into public.workspace_records(id,team_id,kind,payload,updated_at)
      values ($1,$2,$3,'{}'::jsonb,$4)`, [source.id, TEAM_A, source.kind, UPDATED]);
  }
  const claims = await db.query("select * from public.claim_team_knowledge_jobs($1::uuid, 64)", [TEAM_A]);
  const claimsBySource = new Map(claims.rows.map((row) => [row.source_id, row]));
  for (const source of sources) {
    const claim = claimsBySource.get(source.id);
    assert.ok(claim, `source ${source.id} must be claimed for indexing`);
    const chunk = {
      source_kind: source.kind, source_path: "payload.test", chunk_no: 0,
      source_date: source.date, match_ref: source.match ?? null,
      training_ref: source.training ?? null, player_ref: source.player ?? null,
      category: source.category, evidence_type: "coach_observation", title: "Fixture de filtro",
      content: "Apoio depois do passe para teste de filtros.", content_hash: `filter-${source.id}`,
      embedding_model: "filter-eval", embedding: EMBEDDING, metadata: { synthetic_eval: true },
    };
    await db.query(`select public.replace_team_knowledge_source(
      $1::uuid,$2::uuid,$3::timestamptz,$4::uuid,$5::jsonb
    )`, [TEAM_A, source.id, claim.source_updated_at, claim.claim_token, JSON.stringify([chunk])]);
  }
  const ids = async (filters) => new Set((await searchKnowledge(db, filters)).map((row) => row.source_id));
  assert.deepEqual(await ids({ sourceKinds: ["match"] }), new Set([SOURCE_SEMANTIC, SOURCE_OTHER_MATCH]));
  assert.deepEqual(await ids({ from: "2026-09-20", to: "2026-09-20" }), new Set([SOURCE_TRAINING, SOURCE_EXERCISE]), "undated exercise definitions remain eligible in a date-bounded search");
  assert.deepEqual(await ids({ matchRef: MATCH_SEMANTIC }), new Set([SOURCE_SEMANTIC]));
  assert.deepEqual(await ids({ trainingRef: TRAINING_REF }), new Set([SOURCE_TRAINING]));
  assert.deepEqual(await ids({ playerRef: PLAYER_A }), new Set([SOURCE_SEMANTIC, SOURCE_TRAINING]));
  assert.deepEqual(await ids({ category: "goal" }), new Set([SOURCE_OTHER_MATCH]));
});

test("rename e remoção de atleta invalidam excertos com nome antigo e reindexam fontes da equipa", async (t) => {
  const db = await fixture();
  t.after(() => db.close());
  await db.query(`insert into public.workspace_records(id,team_id,kind,payload,updated_at)
    values ($1,$2,'player','{"nome":"Atleta Antigo"}'::jsonb,$3)`, [PLAYER_A, TEAM_A, UPDATED]);

  const firstClaims = await db.query("select * from public.claim_team_knowledge_jobs($1::uuid,64)", [TEAM_A]);
  const firstBySource = new Map(firstClaims.rows.map((row) => [row.source_id, row]));
  await indexSource(db, TEAM_A, SOURCE_A1, MATCH_A1, firstBySource.get(SOURCE_A1));
  await indexSource(db, TEAM_A, SOURCE_A2, MATCH_A2, firstBySource.get(SOURCE_A2));

  await db.query(`update public.workspace_records set payload='{"nome":"Atleta Novo"}'::jsonb,
    updated_at=updated_at + interval '1 second' where id=$1`, [PLAYER_A]);
  let chunks = await db.query("select count(*)::int as n from private.team_knowledge_chunks where team_id=$1", [TEAM_A]);
  let jobs = await db.query("select count(*)::int as n from private.team_knowledge_jobs where team_id=$1", [TEAM_A]);
  assert.equal(chunks.rows[0].n, 0, "renaming immediately removes old-name chunks before embeddings refresh");
  assert.equal(jobs.rows[0].n, 3, "rename queues the player and every active team source");

  const renameClaims = await db.query("select * from public.claim_team_knowledge_jobs($1::uuid,64)", [TEAM_A]);
  const renameBySource = new Map(renameClaims.rows.map((row) => [row.source_id, row]));
  await indexSource(db, TEAM_A, SOURCE_A1, MATCH_A1, renameBySource.get(SOURCE_A1));
  await indexSource(db, TEAM_A, SOURCE_A2, MATCH_A2, renameBySource.get(SOURCE_A2));

  await db.query("update public.workspace_records set deleted_at=now(),updated_at=now() where id=$1", [PLAYER_A]);
  chunks = await db.query("select count(*)::int as n from private.team_knowledge_chunks where team_id=$1", [TEAM_A]);
  jobs = await db.query("select count(*)::int as n from private.team_knowledge_jobs where team_id=$1", [TEAM_A]);
  assert.equal(chunks.rows[0].n, 0, "soft-deleting the player immediately invalidates all retained references");
  assert.equal(jobs.rows[0].n, 2, "soft deletion queues the remaining active match sources");

  const deleteClaims = await db.query("select * from public.claim_team_knowledge_jobs($1::uuid,64)", [TEAM_A]);
  const deleteBySource = new Map(deleteClaims.rows.map((row) => [row.source_id, row]));
  await indexSource(db, TEAM_A, SOURCE_A1, MATCH_A1, deleteBySource.get(SOURCE_A1));
  await indexSource(db, TEAM_A, SOURCE_A2, MATCH_A2, deleteBySource.get(SOURCE_A2));
  await db.query("delete from public.workspace_records where id=$1", [PLAYER_A]);
  chunks = await db.query("select count(*)::int as n from private.team_knowledge_chunks where team_id=$1", [TEAM_A]);
  jobs = await db.query("select count(*)::int as n from private.team_knowledge_jobs where team_id=$1", [TEAM_A]);
  assert.equal(chunks.rows[0].n, 0, "physical player deletion purges derived names from all source chunks");
  assert.equal(jobs.rows[0].n, 2, "physical deletion safely queues active sources again");
});
