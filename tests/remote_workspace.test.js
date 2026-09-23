"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  REMOTE_STORE_KINDS,
  REMOTE_KIND_STORES,
  remoteConfigValid,
  remoteActorFor,
  remotePayload,
  remoteFreshLocalRecord,
  remoteSafeFilename,
  remoteIdentityKey,
  remoteNeedsConflict,
  remoteProjectRef,
  remoteShouldUseTus,
  remoteChooseTeamId,
  remoteRecordRow,
  remoteActivityRow,
  RemoteWorkspace,
} = require("../js/remote_workspace.js");

test("configuração remota exige https e publishable key", () => {
  assert.equal(remoteConfigValid({ url: "https://abc.supabase.co", publishableKey: "sb_publishable_test" }), true);
  assert.equal(remoteConfigValid({ url: "http://abc.supabase.co", publishableKey: "x" }), false);
  assert.equal(remoteConfigValid({ url: "https://abc.supabase.co", publishableKey: "" }), false);
});

test("payload remoto remove chaves locais e data_url", () => {
  const payload = remotePayload({
    id: 8,
    team_id: "default",
    sync_id: "uuid",
    sync_dirty: true,
    sync_local_updated_at: "now",
    remote_updated_at: "remote",
    sync_actor_type: "agent",
    sync_actor_label: "Head Coach",
    data_url: "data:image/png;base64,secret",
    nome: "Jogador",
  });
  assert.deepEqual(payload, { nome: "Jogador" });
});

test("registo remoto novo remove por completo o id local", () => {
  const fresh = remoteFreshLocalRecord({
    id: undefined,
    sync_id: "11111111-1111-4111-8111-111111111111",
    title: "Relatório",
  });
  assert.equal(Object.prototype.hasOwnProperty.call(fresh, "id"), false);
  assert.equal(fresh.sync_id, "11111111-1111-4111-8111-111111111111");
});

test("documento usa autoria da última alteração", () => {
  assert.deepEqual(
    remoteActorFor("workspace_documents", {
      created_by: "agent",
      created_by_label: "Head Coach",
      updated_by: "human",
      updated_by_label: "Treinador",
    }),
    { actor_type: "human", actor_label: "Treinador" }
  );
});

test("registo genérico preserva proveniência sincronizada", () => {
  assert.deepEqual(
    remoteActorFor("jogos", { sync_actor_type: "agent", sync_actor_label: "Head Coach" }),
    { actor_type: "agent", actor_label: "Head Coach" }
  );
});

test("conflito exige a versão remota esperada", () => {
  const remote = { updated_at: "2026-09-21T10:00:00Z" };
  assert.equal(remoteNeedsConflict({ sync_dirty: true, remote_updated_at: null }, remote), true);
  assert.equal(remoteNeedsConflict({ sync_dirty: true, remote_updated_at: "old" }, remote), true);
  assert.equal(remoteNeedsConflict({ sync_dirty: true, remote_updated_at: remote.updated_at }, remote), false);
  assert.equal(remoteNeedsConflict({ sync_dirty: false, remote_updated_at: "old" }, remote), false);
});

test("sync_id local default recebe UUID sem sobrescrever identidade remota antiga", async () => {
  const originalDB = globalThis.DB;
  let saved;
  globalThis.DB = { async atualizar(_store, row) { saved = row; return row; } };
  try {
    const repaired = await RemoteWorkspace._ensureSyncId("jogos", { id: 1, sync_id: "default", sync_dirty: false });
    assert.match(repaired.sync_id, /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    assert.equal(repaired.sync_dirty, true);
    assert.equal(saved.sync_id, repaired.sync_id);
    await assert.rejects(RemoteWorkspace._ensureSyncId("jogos", { id: 2, sync_id: "default", remote_updated_at: "v1" }), /reconciliação/);
    assert.equal(saved.id, 1);
  } finally { globalThis.DB = originalDB; }
});

test("tombstone com team_id local default usa equipa UUID remota e versão exata", async () => {
  const id = "11111111-1111-4111-8111-111111111111", team = "22222222-2222-4222-8222-222222222222";
  const originalDB = globalThis.DB, originalInit = RemoteWorkspace.init;
  const tombstones = [{ id: 1, store: "jogos", sync_id: id, team_id: "default", expected_updated_at: "v1" }];
  const updates = [];
  globalThis.DB = { async listar() { return tombstones.slice(); }, async apagar(_store, localId) { tombstones.splice(tombstones.findIndex(x => x.id === localId), 1); } };
  RemoteWorkspace.init = async () => ({ from(table) {
    assert.equal(table, "workspace_records");
    return { filters: [], action: "read", select() { return this; }, eq(k,v) { assert.notEqual(v, "default"); this.filters.push([k,v]); return this; }, is() { return this; }, update(row) { this.action = "update"; updates.push({ row, filters: this.filters }); return this; }, async maybeSingle() { return { data: { id, team_id: team, updated_at: "v1", deleted_at: null }, error: null }; }, then(resolve) { return Promise.resolve({ data: this.action === "update" ? [{ id }] : [], error: null }).then(resolve); } };
  } });
  try {
    const result = await RemoteWorkspace._syncTombstones(team);
    assert.equal(result.deleted, 1);
    assert.equal(tombstones.length, 0);
    assert.equal(updates.length, 1);
    assert.ok(updates[0].filters.some(([key,value]) => key === "team_id" && value === team));
    assert.ok(updates[0].filters.some(([key,value]) => key === "updated_at" && value === "v1"));
  } finally { globalThis.DB = originalDB; RemoteWorkspace.init = originalInit; }
});

test("tombstones inválidos ou com versão alterada permanecem em conflito", async () => {
  const id = "11111111-1111-4111-8111-111111111111", team = "22222222-2222-4222-8222-222222222222";
  const originalDB = globalThis.DB, originalInit = RemoteWorkspace.init;
  const rows = [{ id: 1, store: "jogos", sync_id: "default", team_id: "default" }, { id: 2, store: "jogos", sync_id: id, team_id: "default", expected_updated_at: "v1" }];
  let queries = 0;
  globalThis.DB = { async listar() { return rows.slice(); }, async apagar() { throw Error("must preserve tombstones"); } };
  RemoteWorkspace.init = async () => ({ from() { queries++; return { select() { return this; }, eq(k,v) { assert.notEqual(v,"default"); return this; }, async maybeSingle() { return { data: { id, team_id: team, updated_at: "v2", deleted_at: null }, error: null }; } }; } });
  try {
    const result = await RemoteWorkspace._syncTombstones(team);
    assert.deepEqual(result.conflicts.map(x => x.reason), ["invalid_local_sync_id", "delete_version_mismatch"]);
    assert.equal(rows.length, 2);
    assert.equal(queries, 1);
  } finally { globalThis.DB = originalDB; RemoteWorkspace.init = originalInit; }
});

test("consolidação com sync_id default repara antes da sincronização", async () => {
  const originals = { DB: globalThis.DB, DEFAULT_TEAM_ID: globalThis.DEFAULT_TEAM_ID, navigator: Object.getOwnPropertyDescriptor(globalThis,"navigator"), localStorage: globalThis.localStorage, init: RemoteWorkspace.init, getSession: RemoteWorkspace.getSession, ensureSelectedTeam: RemoteWorkspace.ensureSelectedTeam, syncNow: RemoteWorkspace.syncNow };
  let row = { id: 3, team_id: "default", sync_id: "default", sync_dirty: false }, calls = 0;
  globalThis.DEFAULT_TEAM_ID = "default";
  globalThis.DB = { async listar(store) { return store === "jogos" ? [{ ...row }] : []; }, async atualizar(_store, next) { row = { ...next }; return row; } };
  Object.defineProperty(globalThis,"navigator",{configurable:true,value:{onLine:true}});
  globalThis.localStorage = { setItem() {} };
  RemoteWorkspace.init = async () => ({ from() { return { select() { return this; }, eq(_key,value) { assert.notEqual(value,"default"); return this; }, then(resolve) { return Promise.resolve({ data: [], error: null }).then(resolve); } }; } });
  RemoteWorkspace.getSession = async () => ({ user: { id: "coach" } });
  RemoteWorkspace.ensureSelectedTeam = async () => "22222222-2222-4222-8222-222222222222";
  RemoteWorkspace.syncNow = async () => { calls++; assert.match(row.sync_id,/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i); return { pushed:0,pulled:0,deleted:0,conflicts:[] }; };
  try { const result=await RemoteWorkspace.consolidateNow(); assert.equal(result.repaired,1); assert.equal(calls,2); assert.equal(row.sync_dirty,true); }
  finally { globalThis.DB=originals.DB; globalThis.DEFAULT_TEAM_ID=originals.DEFAULT_TEAM_ID; if(originals.navigator)Object.defineProperty(globalThis,"navigator",originals.navigator);else delete globalThis.navigator; globalThis.localStorage=originals.localStorage; RemoteWorkspace.init=originals.init; RemoteWorkspace.getSession=originals.getSession; RemoteWorkspace.ensureSelectedTeam=originals.ensureSelectedTeam; RemoteWorkspace.syncNow=originals.syncNow; }
});

test("referência UUID já remota é validada na equipa sem chamar IndexedDB com NaN", async () => {
  const team = "22222222-2222-4222-8222-222222222222", ref = "11111111-1111-4111-8111-111111111111";
  const originalDB = globalThis.DB, originalInit = RemoteWorkspace.init;
  const filters = [];
  globalThis.DB = { async obter() { throw Error("IDBObjectStore.get must not run for a UUID"); } };
  RemoteWorkspace.init = async () => ({ from(table) {
    assert.equal(table, "workspace_records");
    return { select() { return this; }, eq(key,value) { filters.push([key,value]); return this; }, is() { return this; }, async maybeSingle() { return { data: { id: ref }, error: null }; } };
  } });
  try {
    const result = await RemoteWorkspace._subjectRemoteRef("player", ref, team);
    assert.equal(result, ref);
    assert.deepEqual(filters, [["id",ref],["team_id",team],["kind","player"]]);
    const payload = await RemoteWorkspace._payloadForRemote("workspace_documents", { refs: [{ type: "player", id: ref }] }, team);
    assert.equal(payload.refs[0].id, ref);
  } finally { globalThis.DB = originalDB; RemoteWorkspace.init = originalInit; }
});

test("referências locais sem chave válida ficam por reconciliar sem acesso IndexedDB inválido", async () => {
  const team = "22222222-2222-4222-8222-222222222222";
  const originalDB = globalThis.DB, originalInit = RemoteWorkspace.init;
  let reads = 0;
  globalThis.DB = { async obter(_store,id) { reads++; assert.equal(id, 7); return null; } };
  RemoteWorkspace.init = async () => ({ from() { return { select() { return this; }, eq() { return this; }, is() { return this; }, async maybeSingle() { return { data: null, error: null }; } }; } });
  try {
    for (const id of [undefined, "", "default", "abc", "0", "-2"]) {
      await assert.rejects(RemoteWorkspace._subjectRemoteRef("player", id, team), error => error.code === "LOCAL_REFERENCE_CONFLICT");
    }
    assert.equal(reads, 0);
    await assert.rejects(RemoteWorkspace._subjectRemoteRef("player", "7", team), error => error.reason === "subject_not_found_locally");
    assert.equal(reads, 1);
    await assert.rejects(RemoteWorkspace._subjectRemoteRef("player", "11111111-1111-4111-8111-111111111111", team), error => error.reason === "subject_uuid_not_in_team");
    assert.equal(reads, 1);
  } finally { globalThis.DB = originalDB; RemoteWorkspace.init = originalInit; }
});

test("um documento com referência inválida fica em conflito e não bloqueia outro documento", async () => {
  const team = "22222222-2222-4222-8222-222222222222";
  const originals = { DB: globalThis.DB, DEFAULT_TEAM_ID: globalThis.DEFAULT_TEAM_ID, init: RemoteWorkspace.init };
  const rows = [
    { id: 1, team_id: "default", sync_id: "11111111-1111-4111-8111-111111111111", sync_dirty: true, refs: [{ type: "player", id: "default" }], title: "Referência pendente" },
    { id: 2, team_id: "default", sync_id: "33333333-3333-4333-8333-333333333333", sync_dirty: true, refs: [], title: "Documento válido" },
  ];
  const remote = [];
  globalThis.DEFAULT_TEAM_ID = "default";
  globalThis.DB = {
    async listar(store) { return store === "workspace_documents" ? rows.map(x => ({ ...x })) : []; },
    async atualizar(store, row) { assert.equal(store, "workspace_documents"); rows[rows.findIndex(x => x.id === row.id)] = { ...row }; },
    async criar() { throw Error("unexpected local duplicate"); },
  };
  RemoteWorkspace.init = async () => ({ from(table) {
    assert.equal(table, "workspace_records");
    return { inserted: null, select() { return this; }, eq(key,value) { assert.notEqual(value, "default"); return this; }, is() { return this; }, insert(row) { this.inserted = row; return this; }, async single() {
      const saved = { ...this.inserted, updated_at: "v1", deleted_at: null };
      remote.push(saved);
      return { data: saved, error: null };
    }, then(resolve) { return Promise.resolve({ data: remote.map(x => ({ ...x })), error: null }).then(resolve); } };
  } });
  try {
    const result = await RemoteWorkspace._syncRecords(team, "44444444-4444-4444-8444-444444444444");
    assert.equal(result.pushed, 1);
    assert.equal(result.conflicts.length, 1);
    assert.equal(result.conflicts[0].reason, "invalid_subject_id");
    assert.equal(rows[0].sync_dirty, true);
    assert.equal(rows[1].sync_dirty, false);
    assert.equal(remote[0].payload.title, "Documento válido");
  } finally { globalThis.DB = originals.DB; globalThis.DEFAULT_TEAM_ID = originals.DEFAULT_TEAM_ID; RemoteWorkspace.init = originals.init; }
});

test("external_key impede identidade duplicada entre browsers", () => {
  assert.equal(remoteIdentityKey("match", { external_key: " JOGO-1 " }), "match|jogo-1");
  assert.equal(remoteIdentityKey("match", {}), null);
});

test("uploads grandes usam TUS no endpoint direto", () => {
  assert.equal(remoteShouldUseTus(6 * 1024 * 1024), false);
  assert.equal(remoteShouldUseTus(6 * 1024 * 1024 + 1), true);
  assert.equal(remoteProjectRef("https://abcdefghijklmnopqrst.supabase.co"), "abcdefghijklmnopqrst");
});

test("mapeamento store/kind é reversível", () => {
  for (const [store, kind] of Object.entries(REMOTE_STORE_KINDS)) {
    assert.equal(REMOTE_KIND_STORES[kind], store);
  }
});

test("nome de ficheiro remoto é normalizado", () => {
  assert.equal(remoteSafeFilename("Vídeo saída 01.mp4"), "Video-saida-01.mp4");
});

test("registo remoto preserva UUID e separa payload", () => {
  const row = remoteRecordRow("jogadores", {
    sync_id: "11111111-1111-4111-8111-111111111111",
    nome: "A",
    team_id: "default",
  }, "22222222-2222-4222-8222-222222222222", "33333333-3333-4333-8333-333333333333");
  assert.equal(row.kind, "player");
  assert.equal(row.payload.nome, "A");
  assert.equal(row.payload.team_id, undefined);
  assert.equal(row.actor_type, "human");
  assert.equal(row.actor_label, "Treinador");
});

test("atividade remota mantém autoria e entidade", () => {
  const row = remoteActivityRow({
    sync_id: "11111111-1111-4111-8111-111111111111",
    actor: "agent",
    actor_label: "Head Coach",
    action: "created_document",
    summary: "Criou plano",
    entity_type: "document",
    entity_id: 7,
    created_at: "2026-09-21T10:00:00Z",
  }, "22222222-2222-4222-8222-222222222222", null);
  assert.equal(row.actor_type, "agent");
  assert.equal(row.entity_ref, "7");
});


test("exercise é tipo remoto oficial sem confundir biblioteca legada", () => {
  assert.equal(REMOTE_STORE_KINDS.exercicios, "exercise");
  assert.equal(REMOTE_KIND_STORES.exercise, "exercicios");
});


test("seleção remota reutiliza equipa válida e adota a única equipa disponível", () => {
  const teams = [{ id: "team-a" }];
  assert.equal(remoteChooseTeamId("team-a", teams), "team-a");
  assert.equal(remoteChooseTeamId(null, teams), "team-a");
  assert.equal(remoteChooseTeamId("team-antiga", teams), "team-a");
  assert.equal(remoteChooseTeamId(null, [{ id: "a" }, { id: "b" }]), null);
});
