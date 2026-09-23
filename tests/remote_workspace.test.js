"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const MatchVisual = require("../js/match_visual.js");
const MatchEvents = require("../js/match_events.js");
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
  remoteTombstoneNeedsConflict,
  remoteDeletionConflictsWithLocalEdit,
  remoteActivityMatches,
  remoteSyncRetryDelay,
  remoteRowBelongsToTeam,
  RemoteWorkspace,
  remoteProjectRef,
  remoteShouldUseTus,
  remoteChooseTeamId,
  remoteRecordRow,
  remoteActivityRow,
} = require("../js/remote_workspace.js");

test("configuração remota exige https, exceto HTTP em loopback para desenvolvimento local", () => {
  assert.equal(remoteConfigValid({ url: "https://abc.supabase.co", publishableKey: "sb_publishable_test" }), true);
  assert.equal(remoteConfigValid({ url: "http://abc.supabase.co", publishableKey: "x" }), false);
  assert.equal(remoteConfigValid({ url: "http://127.0.0.1:54321", publishableKey: "sb_publishable_local" }), true);
  assert.equal(remoteConfigValid({ url: "http://localhost:54321", publishableKey: "sb_publishable_local" }), true);
  assert.equal(remoteConfigValid({ url: "http://192.168.1.2:54321", publishableKey: "sb_publishable_local" }), false);
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
  assert.deepEqual(remotePayload({ nome: "Jogador", foto: "https://signed.example/photo?token=x", profile_media_ref: "media-1" }), { nome: "Jogador" });
  assert.deepEqual(remotePayload({ nome: "Legado", foto: "https://legacy.example/photo.jpg" }), { nome: "Legado", foto: "https://legacy.example/photo.jpg" });
});

test("falhas de sincronização têm espera progressiva limitada", () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 20].map(remoteSyncRetryDelay), [2000, 4000, 8000, 16000, 32000, 60000, 60000]);
});

test("realtime agenda sincronização para alterações de atividade da equipa", async () => {
  const originals = {
    init: RemoteWorkspace.init,
    scheduleSync: RemoteWorkspace.scheduleSync,
    channel: RemoteWorkspace._realtimeChannel,
    teamId: RemoteWorkspace._realtimeTeamId,
  };
  const subscriptions = [];
  const scheduled = [];
  const client = {
    channel() {
      return {
        on(_type, filter, callback) { subscriptions.push({ filter, callback }); return this; },
        subscribe() { return this; },
      };
    },
  };
  RemoteWorkspace.init = async () => client;
  RemoteWorkspace.scheduleSync = (delay) => scheduled.push(delay);
  RemoteWorkspace._realtimeChannel = null;
  RemoteWorkspace._realtimeTeamId = null;
  try {
    await RemoteWorkspace.startRealtime("team-1");
    const activity = subscriptions.find(({ filter }) => filter.table === "activity_log");
    assert.ok(activity);
    assert.equal(activity.filter.filter, "team_id=eq.team-1");
    activity.callback();
    assert.deepEqual(scheduled, [120]);
  } finally {
    RemoteWorkspace.init = originals.init;
    RemoteWorkspace.scheduleSync = originals.scheduleSync;
    RemoteWorkspace._realtimeChannel = originals.channel;
    RemoteWorkspace._realtimeTeamId = originals.teamId;
  }
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

test("eliminação offline só pode ser consolidada sobre a versão vista antes de apagar", () => {
  const item = { expected_updated_at: "v1" };
  assert.equal(remoteTombstoneNeedsConflict(item, { updated_at: "v2", deleted_at: null }), true);
  assert.equal(remoteTombstoneNeedsConflict(item, { updated_at: "v1", deleted_at: null }), false);
  assert.equal(remoteTombstoneNeedsConflict(item, { updated_at: "v2", deleted_at: "deleted" }), false);
  assert.equal(remoteTombstoneNeedsConflict({ expected_updated_at: null }, { updated_at: "v1", deleted_at: null }), true);
});

test("remoção remota não pode descartar alterações locais pendentes", () => {
  assert.equal(remoteDeletionConflictsWithLocalEdit({ sync_dirty: true }, { deleted_at: "deleted" }), true);
  assert.equal(remoteDeletionConflictsWithLocalEdit({ sync_dirty: false }, { deleted_at: "deleted" }), false);
  assert.equal(remoteDeletionConflictsWithLocalEdit({ sync_dirty: true }, { deleted_at: null }), false);
});

test("atividade imutável repetida só é idempotente quando o conteúdo coincide", () => {
  const expected = { actor_type: "human", actor_label: "Treinador", action: "edited", summary: "Nota", entity_type: "match", entity_ref: "match-1", created_at: "t1", metadata: { b: 2, a: { z: 1, x: 4 } } };
  assert.equal(remoteActivityMatches(expected, { ...expected, metadata: { a: { x: 4, z: 1 }, b: 2 } }), true);
  assert.equal(remoteActivityMatches(expected, { ...expected, summary: "Outro trabalho" }), false);
  assert.equal(remoteActivityMatches(expected, { ...expected, metadata: { ...expected.metadata, b: 3 } }), false);
});

test("registo associado a outro workspace remoto nunca é enviado para a equipa selecionada", () => {
  assert.equal(remoteRowBelongsToTeam({ remote_team_id: "team-a" }, "team-a"), true);
  assert.equal(remoteRowBelongsToTeam({ remote_team_id: "team-a" }, "team-b"), false);
  assert.equal(remoteRowBelongsToTeam({ sync_dirty: true }, "team-b"), true);
});

test("registo antigo sem origem remota confirmável não é enviado para outra equipa", async () => {
  let lookups = 0;
  const belongs = await RemoteWorkspace._bindRemoteTeam({
    from() { lookups++; return { select() { return this; }, eq() { return this; }, async maybeSingle() { return { data: null, error: null }; } }; },
  }, "jogadores", { id: 9, sync_id: "legacy-id", remote_updated_at: "seen-v1" }, "team-b");
  assert.equal(belongs, null);
  assert.equal(lookups, 0, "an invalid local identity must not be sent to a UUID query");
});

test("local sentinel sync IDs are rekeyed only before any remote version was acknowledged", async () => {
  let saved;
  const originalDB = globalThis.DB;
  globalThis.DB = { async atualizar(store, row) { saved = { store, ...row }; return row; } };
  try {
    const belongs = await RemoteWorkspace._bindRemoteTeam({ from() { throw new Error("must not query with local sentinel"); } }, "jogadores", { id: 9, sync_id: "default", sync_dirty: false }, "team-b");
    assert.equal(belongs, true);
    const repaired = await RemoteWorkspace._ensureSyncId("jogadores", { id: 9, sync_id: "default", sync_dirty: false });
    assert.match(repaired.sync_id, /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    assert.equal(repaired.sync_dirty, true);
    assert.equal(saved.sync_id, repaired.sync_id);
    const knownRemote = await RemoteWorkspace._bindRemoteTeam({ from() { throw new Error("must not query with local sentinel"); } }, "jogadores", { id: 10, sync_id: "default", remote_updated_at: "v1" }, "team-b");
    assert.equal(knownRemote, null, "a row with a remote version stays in conflict instead of receiving a new identity");
  } finally { globalThis.DB = originalDB; }
});

test("consolidação repara sync_id local default antes de sincronizar", async () => {
  const originals = {
    DB: globalThis.DB, navigator: Object.getOwnPropertyDescriptor(globalThis, "navigator"),
    localStorage: globalThis.localStorage, DEFAULT_TEAM_ID: globalThis.DEFAULT_TEAM_ID, init: RemoteWorkspace.init,
    getSession: RemoteWorkspace.getSession, ensureSelectedTeam: RemoteWorkspace.ensureSelectedTeam,
    syncNow: RemoteWorkspace.syncNow,
  };
  const rows = { jogos: [{ id: 7, team_id: "default", sync_id: "default", sync_dirty: false }] };
  const writes = [];
  let calls = 0;
  globalThis.DB = {
    async listar(store) { return (rows[store] || []).map((row) => ({ ...row })); },
    async obter(store, id) { return rows[store]?.find((row) => row.id === id) || null; },
    async atualizar(store, row) { rows[store] = (rows[store] || []).map((old) => old.id === row.id ? { ...row } : old); writes.push({ store, ...row }); return row; },
  };
  globalThis.DEFAULT_TEAM_ID = "default";
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { onLine: true } });
  globalThis.localStorage = { setItem() {} };
  RemoteWorkspace.init = async () => ({ from() { return { select() { return this; }, eq() { return this; }, then(resolve) { return Promise.resolve({ data: [], error: null }).then(resolve); } }; } });
  RemoteWorkspace.getSession = async () => ({ user: { id: "coach" } });
  RemoteWorkspace.ensureSelectedTeam = async () => "team-uuid";
  RemoteWorkspace.syncNow = async () => {
    calls++;
    assert.match(rows.jogos[0].sync_id, /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    return { pushed: 1, pulled: 0, deleted: 0, conflicts: [] };
  };
  try {
    const result = await RemoteWorkspace.consolidateNow();
    assert.equal(result.repaired, 1);
    assert.equal(result.pushed, 2);
    assert.equal(calls, 2);
    assert.equal(rows.jogos[0].sync_dirty, true, "consolidation leaves upload to the normal versioned sync path");
    assert.equal(writes.length, 1);
  } finally {
    globalThis.DB = originals.DB;
    globalThis.DEFAULT_TEAM_ID = originals.DEFAULT_TEAM_ID;
    if (originals.navigator) Object.defineProperty(globalThis, "navigator", originals.navigator); else delete globalThis.navigator;
    globalThis.localStorage = originals.localStorage;
    RemoteWorkspace.init = originals.init;
    RemoteWorkspace.getSession = originals.getSession;
    RemoteWorkspace.ensureSelectedTeam = originals.ensureSelectedTeam;
    RemoteWorkspace.syncNow = originals.syncNow;
  }
});

test("versão remota sem UUID estável fica em conflito em vez de ser duplicada", async () => {
  let remoteLookups = 0;
  const client = {
    from() {
      remoteLookups++;
      return { select() { return this; }, eq() { return this; }, async maybeSingle() { return { data: null, error: null }; } };
    },
  };
  const belongs = await RemoteWorkspace._bindRemoteTeam(
    client, "jogadores", { id: 19, remote_updated_at: "seen-v2", sync_dirty: true }, "team-b"
  );
  assert.equal(belongs, null);
  assert.equal(remoteLookups, 0);
});

test("registo local sem versão remota pode receber a equipa atualmente selecionada", async () => {
  let remoteLookups = 0;
  const belongs = await RemoteWorkspace._bindRemoteTeam({
    from() { remoteLookups++; throw new Error("registo sem UUID não deve consultar remoto"); },
  }, "jogadores", { id: 20, sync_dirty: true }, "team-b");
  assert.equal(belongs, true);
  assert.equal(remoteLookups, 0);
});

test("tombstone legado com ID não UUID fica em conflito sem bloquear as restantes sincronizações", async () => {
  const originalInit = RemoteWorkspace.init, originalDB = globalThis.DB;
  let remoteQueries = 0;
  globalThis.DB = { async listar() { return [{ id: 1, store: "jogadores", sync_id: "default", team_id: "default" }]; } };
  RemoteWorkspace.init = async () => ({ from() { remoteQueries++; throw new Error("invalid local ID reached Supabase"); } });
  try {
    const result = await RemoteWorkspace._syncTombstones("team-b");
    assert.equal(remoteQueries, 0);
    assert.equal(result.conflicts[0].reason, "invalid_local_sync_id");
    assert.equal(result.conflicts[0].sync_id, "default");
  } finally { RemoteWorkspace.init = originalInit; globalThis.DB = originalDB; }
});

test("referências media usam UUIDs estáveis e não atravessam workspaces", async () => {
  const originalDB = globalThis.DB, originalInit = RemoteWorkspace.init;
  const playerRef = "11111111-1111-4111-8111-111111111111";
  let player = { id: 7, sync_id: playerRef, remote_team_id: "team-b", nome: "Atleta" };
  globalThis.DB = {
    async obter(store, id) { return store === "jogadores" && Number(id) === 7 ? player : undefined; },
    async listar(store) { return store === "jogadores" && player ? [player] : []; },
  };
  RemoteWorkspace.init = async () => ({ from(table) {
    assert.equal(table, "workspace_records");
    const filters = [];
    return { select() { return this; }, eq(key,value) { filters.push([key,value]); return this; }, is() { return this; },
      async maybeSingle() { assert.deepEqual(filters, [["id",playerRef],["team_id","team-b"],["kind","player"]]); return { data: { id: playerRef }, error: null }; } };
  } });
  try {
    const media = await RemoteWorkspace._mediaRemoteRow({
      sync_id: "22222222-2222-4222-8222-222222222222", subject_type: "player", subject_id: 7,
      type: "photo", title: "Foto", note: "Foto de perfil do atleta",
    }, "team-b", "user-1");
    assert.equal(media.subject_ref, playerRef);
    assert.equal(await RemoteWorkspace._localIdForRemoteRef("player", playerRef, "team-b"), "7");

    player.remote_team_id = "team-a";
    assert.equal(await RemoteWorkspace._localIdForRemoteRef("player", playerRef, "team-b"), playerRef);
    await assert.rejects(
      RemoteWorkspace._subjectRemoteRef("player", 7, "team-b"),
      error => error.code === "LOCAL_REFERENCE_CONFLICT" && error.reason === "subject_other_team",
    );

    player = undefined;
    await assert.rejects(
      RemoteWorkspace._subjectRemoteRef("player", 7, "team-b"),
      error => error.code === "LOCAL_REFERENCE_CONFLICT" && error.reason === "subject_not_found_locally",
    );
    assert.equal(
      await RemoteWorkspace._subjectRemoteRef("player", playerRef, "team-b"),
      playerRef,
    );
    await assert.rejects(RemoteWorkspace._subjectRemoteRef("player", "default", "team-b"),
      error => error.code === "LOCAL_REFERENCE_CONFLICT" && error.reason === "invalid_subject_id");
  } finally { globalThis.DB = originalDB; RemoteWorkspace.init = originalInit; }
});

test("sync de registos isola o push por equipa remota de origem", async () => {
  const originalInit = RemoteWorkspace.init;
  const originalDB = globalThis.DB;
  const originalTeamId = globalThis.DEFAULT_TEAM_ID;
  const originalPayload = RemoteWorkspace._payloadForRemote;
  const locals = new Map([
    ["jogadores", [
      { id: 1, team_id: "default", remote_team_id: "team-a", sync_id: "player-a", sync_dirty: true, nome: "Equipa A" },
      { id: 2, team_id: "default", sync_dirty: true, nome: "Novo" },
      { id: 3, team_id: "default", sync_id: "default", remote_updated_at: "seen-v2", sync_dirty: true, nome: "UUID perdido" },
      { id: 4, team_id: "default", sync_id: "default", sync_dirty: true, nome: "UUID local antigo" },
    ]],
  ]);
  const inserted = [];
  globalThis.DB = {
    async obter(store, id) { return (locals.get(store) || []).find((item) => item.id === id); },
    async listar(store) { return locals.get(store) || []; },
    async atualizar(store, row) { const rows = locals.get(store) || []; locals.set(store, rows.map((item) => item.id === row.id ? row : item)); return row; },
  };
  globalThis.DEFAULT_TEAM_ID = "default";
  RemoteWorkspace._payloadForRemote = async (_store, row) => ({ nome: row.nome });
  RemoteWorkspace.init = async () => ({
    from(table) {
      const query = { table, operation: "select", select() { return this; }, eq() { return this; },
        insert(row) { this.operation = "insert"; this.row = row; inserted.push(row); return this; },
        then(resolve) { return Promise.resolve({ data: [], error: null }).then(resolve); },
        async single() { return { data: { ...this.row, updated_at: "v1", actor_type: "human", actor_label: "Treinador" }, error: null }; },
      };
      return query;
    },
  });
  try {
    const result = await RemoteWorkspace._syncRecords("team-b", "user-1");
    assert.equal(result.pushed, 2);
    assert.equal(result.conflicts.some((item) => item.local_id === 3 && item.reason === "invalid_local_sync_id"), true);
    assert.equal(inserted.length, 2);
    assert.equal(inserted.some((row) => row.payload.nome === "Novo"), true);
    assert.equal(inserted.some((row) => row.payload.nome === "UUID local antigo" && /^[0-9a-f-]{36}$/i.test(row.id)), true);
    assert.ok(inserted.every((row) => row.team_id === "team-b"));
  } finally {
    RemoteWorkspace.init = originalInit;
    RemoteWorkspace._payloadForRemote = originalPayload;
    globalThis.DB = originalDB;
    globalThis.DEFAULT_TEAM_ID = originalTeamId;
  }
});

test("troca de workspace identifica a origem dos dados legados antes de mudar", async () => {
  const originalInit = RemoteWorkspace.init, originalStorage = globalThis.localStorage;
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator"), originalDB = globalThis.DB, originalTeamId = globalThis.DEFAULT_TEAM_ID, originalSchedule = RemoteWorkspace.scheduleSync;
  const values = new Map([["treinador.remote.supabase.v1", JSON.stringify({ remoteTeamId: "team-a" })]]);
  const rows = [
    { id: 1, team_id: "default", sync_id: "11111111-1111-4111-8111-111111111111", remote_updated_at: "v1", sync_dirty: false },
    { id: 2, team_id: "default", sync_id: "offline-player", sync_dirty: true },
  ];
  globalThis.localStorage = { getItem(key) { return values.get(key) || null; }, setItem(key, value) { values.set(key, value); } };
  Object.defineProperty(globalThis, "navigator", { value: { onLine: true }, configurable: true });
  globalThis.DB = {
    async listar(store) { return store === "jogadores" ? rows.slice() : []; },
    async obter(_store, id) { return rows.find((item) => item.id === id); },
    async atualizar(_store, row) { const index = rows.findIndex((item) => item.id === row.id); if (index >= 0) rows[index] = row; return row; },
  };
  globalThis.DEFAULT_TEAM_ID = "default";
  RemoteWorkspace.scheduleSync = () => {};
  RemoteWorkspace.init = async () => ({ from() { return { select() { return this; }, eq(_key, id) { this.id = id; return this; }, async maybeSingle() { return { data: this.id === "11111111-1111-4111-8111-111111111111" ? { team_id: "team-a" } : null, error: null }; } }; } });
  try {
    await RemoteWorkspace.useTeam("team-b");
    assert.equal(rows[0].remote_team_id, "team-a");
    assert.equal(rows[1].remote_team_id, "team-a");
    assert.equal(JSON.parse(values.get("treinador.remote.supabase.v1")).remoteTeamId, "team-b");
  } finally {
    RemoteWorkspace.init = originalInit;
    RemoteWorkspace.scheduleSync = originalSchedule;
    globalThis.DB = originalDB;
    globalThis.DEFAULT_TEAM_ID = originalTeamId;
    globalThis.localStorage = originalStorage;
    if (originalNavigator) Object.defineProperty(globalThis, "navigator", originalNavigator); else delete globalThis.navigator;
  }
});

test("troca de workspace não altera a seleção quando está offline", async () => {
  const originalStorage = globalThis.localStorage;
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator"), originalInit = RemoteWorkspace.init;
  const values = new Map([["treinador.remote.supabase.v1", JSON.stringify({ remoteTeamId: "team-a" })]]);
  globalThis.localStorage = { getItem(key) { return values.get(key) || null; }, setItem(key, value) { values.set(key, value); } };
  Object.defineProperty(globalThis, "navigator", { value: { onLine: false }, configurable: true });
  RemoteWorkspace.init = async () => { throw new Error("não deve ligar"); };
  try {
    await assert.rejects(RemoteWorkspace.useTeam("team-b"), /Liga à Internet antes de trocar/);
    assert.equal(JSON.parse(values.get("treinador.remote.supabase.v1")).remoteTeamId, "team-a");
  } finally {
    RemoteWorkspace.init = originalInit;
    globalThis.localStorage = originalStorage;
    if (originalNavigator) Object.defineProperty(globalThis, "navigator", originalNavigator); else delete globalThis.navigator;
  }
});

test("troca de workspace espera a sync atual antes de alterar a equipa selecionada", async () => {
  const originalStorage = globalThis.localStorage;
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const originalInit = RemoteWorkspace.init;
  const originalDB = globalThis.DB;
  const originalSchedule = RemoteWorkspace.scheduleSync;
  const originalPromise = RemoteWorkspace._syncPromise;
  const originalSyncTeam = RemoteWorkspace._syncTeamId;
  const values = new Map([["treinador.remote.supabase.v1", JSON.stringify({ remoteTeamId: "team-a" })]]);
  let releaseSync;
  globalThis.localStorage = {
    getItem(key) { return values.get(key) || null; },
    setItem(key, value) { values.set(key, value); },
  };
  Object.defineProperty(globalThis, "navigator", { value: { onLine: true }, configurable: true });
  globalThis.DB = { async listar() { return []; } };
  RemoteWorkspace.init = async () => ({});
  RemoteWorkspace.scheduleSync = () => {};
  RemoteWorkspace._syncPromise = new Promise((resolve) => { releaseSync = resolve; });
  RemoteWorkspace._syncTeamId = "team-a";
  try {
    const switching = RemoteWorkspace.useTeam("team-b");
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(JSON.parse(values.get("treinador.remote.supabase.v1")).remoteTeamId, "team-a");
    releaseSync({ conflicts: [] });
    await switching;
    assert.equal(JSON.parse(values.get("treinador.remote.supabase.v1")).remoteTeamId, "team-b");
  } finally {
    RemoteWorkspace.init = originalInit;
    RemoteWorkspace.scheduleSync = originalSchedule;
    RemoteWorkspace._syncPromise = originalPromise;
    RemoteWorkspace._syncTeamId = originalSyncTeam;
    globalThis.DB = originalDB;
    globalThis.localStorage = originalStorage;
    if (originalNavigator) Object.defineProperty(globalThis, "navigator", originalNavigator); else delete globalThis.navigator;
  }
});

test("foto de perfil segue a media associada e a remoção limpa apenas referências geridas", async () => {
  const originalDB = globalThis.DB, originalTeam = globalThis.DEFAULT_TEAM_ID;
  let players = [
    { id: 1, nome: "Atleta", foto: "https://old.invalid/photo", sync_dirty: false },
    { id: 2, nome: "Legado", foto: "https://legacy.invalid/photo", sync_dirty: false },
  ];
  let media = [{ id: 20, sync_id: "media-20", subject_type: "player", subject_id: 1, type: "photo", note: "Foto de perfil do atleta", url: "https://signed.example/photo", updated_at: "v2" }];
  globalThis.DB = {
    async porIndice(store) { return store === "jogadores" ? players.slice() : media.slice(); },
    async atualizar(_store, row) { players = players.map((player) => player.id === row.id ? row : player); return row; },
  };
  globalThis.DEFAULT_TEAM_ID = "default";
  try {
    await RemoteWorkspace._refreshPlayerProfilePhotos();
    assert.equal(players[0].foto, "https://signed.example/photo");
    assert.equal(players[0].profile_media_ref, "media-20");
    media = [];
    await RemoteWorkspace._refreshPlayerProfilePhotos();
    assert.equal(players[0].foto, null);
    assert.equal(players[0].profile_media_ref, undefined);
    assert.equal(players[0].nome, "Atleta");
    assert.equal(players[1].foto, "https://legacy.invalid/photo");
  } finally { globalThis.DB = originalDB; globalThis.DEFAULT_TEAM_ID = originalTeam; }
});

test("media sem origem confirmável não escapa ao segundo passe nem é enviada a outra equipa", async () => {
  const originalInit = RemoteWorkspace.init, originalDB = globalThis.DB, originalTeam = globalThis.DEFAULT_TEAM_ID;
  const media = [{
    id: 33, team_id: "default", subject_type: "team", subject_id: "default", type: "file",
    title: "Media antiga", sync_id: "default", remote_updated_at: "seen-v2", sync_dirty: true,
  }];
  const inserted = [];
  globalThis.DB = {
    async listar(store) { return store === "media_items" ? media.slice() : []; },
    async obter(_store, id) { return media.find((item) => item.id === id); },
    async atualizar(_store, row) { const index = media.findIndex((item) => item.id === row.id); if (index >= 0) media[index] = row; return row; },
    async porIndice() { return []; },
  };
  globalThis.DEFAULT_TEAM_ID = "default";
  RemoteWorkspace.init = async () => ({
    from() {
      const query = {
        select() { return this; },
        eq() { return this; },
        insert(row) { inserted.push(row); this.row = row; return this; },
        async maybeSingle() { return { data: null, error: null }; },
        async single() { return { data: { ...this.row, updated_at: "v3" }, error: null }; },
        then(resolve) { return Promise.resolve({ data: [], error: null }).then(resolve); },
      };
      return query;
    },
  });
  try {
    const result = await RemoteWorkspace._syncMedia("team-b", "user-1");
    assert.equal(result.pushed, 0);
    assert.equal(inserted.length, 0);
    assert.equal(result.conflicts.filter((item) => item.sync_id === "default" && item.reason === "invalid_local_sync_id").length, 1);
  } finally { RemoteWorkspace.init = originalInit; globalThis.DB = originalDB; globalThis.DEFAULT_TEAM_ID = originalTeam; }
});

test("sincronização não envia media com caminho Storage de outra equipa", async () => {
  const originalInit = RemoteWorkspace.init, originalDB = globalThis.DB, originalTeam = globalThis.DEFAULT_TEAM_ID;
  const media = [{
    id: 34, team_id: "default", subject_type: "team", subject_id: "default", type: "file",
    title: "Ficheiro fora da equipa", sync_id: "asset-local", remote_team_id: "team-b",
    storage_path: "team-a/asset-local/file.jpg", sync_dirty: true,
  }];
  const inserted = [];
  globalThis.DEFAULT_TEAM_ID = "default";
  globalThis.DB = {
    async listar(store) { return store === "media_items" ? media.slice() : []; },
    async obter(_store, id) { return media.find((item) => item.id === id); },
    async atualizar(_store, row) { const i = media.findIndex((item) => item.id === row.id); if (i >= 0) media[i] = row; return row; },
    async porIndice() { return []; },
  };
  RemoteWorkspace.init = async () => ({ from() {
    return {
      select() { return this; }, eq() { return this; },
      insert(row) { inserted.push(row); return this; },
      then(resolve) { return Promise.resolve({ data: [], error: null }).then(resolve); },
    };
  } });
  try {
    const result = await RemoteWorkspace._syncMedia("team-b", "user-1");
    assert.equal(result.pushed, 0);
    assert.equal(inserted.length, 0);
    assert.equal(result.conflicts[0].reason, "storage_path_team_mismatch");
  } finally { RemoteWorkspace.init = originalInit; globalThis.DB = originalDB; globalThis.DEFAULT_TEAM_ID = originalTeam; }
});

test("sincronização não assina nem guarda media remota com caminho de outra equipa", async () => {
  const originalInit = RemoteWorkspace.init, originalDB = globalThis.DB, originalTeam = globalThis.DEFAULT_TEAM_ID;
  const remote = {
    id: "asset-remote", team_id: "team-b", subject_type: "team", subject_ref: "team-b",
    media_type: "file", title: "Ficheiro fora da equipa", storage_path: "team-a/asset-remote/file.jpg",
    updated_at: "v1", deleted_at: null,
  };
  let signCalls = 0, localCreates = 0;
  globalThis.DEFAULT_TEAM_ID = "default";
  globalThis.DB = {
    async listar() { return []; }, async porIndice() { return []; },
    async criar() { localCreates++; },
  };
  RemoteWorkspace.init = async () => ({
    from() { return { select() { return this; }, eq() { return this; }, then(resolve) { return Promise.resolve({ data: [remote], error: null }).then(resolve); } }; },
    storage: { from() { return { async createSignedUrl() { signCalls++; return { data: { signedUrl: "https://private.invalid" }, error: null }; } }; } },
  });
  try {
    const result = await RemoteWorkspace._syncMedia("team-b", "user-1");
    assert.equal(result.pulled, 0);
    assert.equal(signCalls, 0);
    assert.equal(localCreates, 0);
    assert.equal(result.conflicts[0].reason, "storage_path_team_mismatch");
  } finally { RemoteWorkspace.init = originalInit; globalThis.DB = originalDB; globalThis.DEFAULT_TEAM_ID = originalTeam; }
});

test("falha ao criar URL assinada mantém media privada e reporta tentativa pendente", async () => {
  const originalInit = RemoteWorkspace.init, originalDB = globalThis.DB, originalTeam = globalThis.DEFAULT_TEAM_ID, originalMediaSubjectKey = globalThis.mediaSubjectKey;
  const remote = {
    id: "asset-private", team_id: "team-b", subject_type: "team", subject_ref: "team-b",
    media_type: "file", title: "Ficheiro privado", storage_path: "team-b/asset-private/file.pdf",
    updated_at: "v1", deleted_at: null,
  };
  const localRows = [];
  globalThis.DEFAULT_TEAM_ID = "default";
  globalThis.mediaSubjectKey = (team, type, id) => [team, type, id].join("|");
  globalThis.DB = {
    async listar() { return []; }, async porIndice() { return []; },
    async criar(_store, row) { localRows.push(row); return 41; },
  };
  RemoteWorkspace.init = async () => ({
    from() { return { select() { return this; }, eq() { return this; }, then(resolve) { return Promise.resolve({ data: [remote], error: null }).then(resolve); } }; },
    storage: { from() { return { async createSignedUrl() { return { data: null, error: new Error("Storage temporariamente indisponível") }; } }; } },
  });
  try {
    const result = await RemoteWorkspace._syncMedia("team-b", "user-1");
    assert.equal(result.pulled, 1);
    assert.equal(result.conflicts[0].reason, "storage_signed_url_failed");
    assert.equal(localRows[0].storage_path, remote.storage_path);
    assert.equal(localRows[0].url, null);
    assert.equal(localRows[0].remote_team_id, "team-b");
  } finally { RemoteWorkspace.init = originalInit; globalThis.DB = originalDB; globalThis.DEFAULT_TEAM_ID = originalTeam; globalThis.mediaSubjectKey = originalMediaSubjectKey; }
});

test("tombstone com versão remota alterada fica pendente e reporta conflito", async () => {
  const originalInit = RemoteWorkspace.init, originalDB = globalThis.DB;
  const tombstones = [{ id: 1, store: "jogadores", sync_id: "11111111-1111-4111-8111-111111111111", team_id: "default", remote_team_id: "remote-team-1", expected_updated_at: "v1" }];
  const remote = { id: "11111111-1111-4111-8111-111111111111", updated_at: "v2", deleted_at: null, team_id: "remote-team-1" };
  let updateAttempted = false, readFilters = [];
  globalThis.DB = { async listar(store) { return store === "sync_tombstones" ? tombstones.slice() : []; }, async apagar(store, id) { if (store === "sync_tombstones") tombstones.splice(0, tombstones.length); } };
  RemoteWorkspace.init = async () => ({ from() { const q = { filters: [], op: "select", select() { return this; }, update() { this.op = "update"; updateAttempted = true; return this; }, eq(key, value) { this.filters.push([key, value]); return this; }, is(key, value) { this.filters.push([key, value]); return this; }, async maybeSingle() { readFilters = this.filters.slice(); return { data: remote, error: null }; }, then(resolve) { return Promise.resolve({ data: [], error: null }).then(resolve); } }; return q; } });
  try {
    const result = await RemoteWorkspace._syncTombstones("selected-other-team");
    assert.equal(updateAttempted, false);
    assert.ok(readFilters.some(([key, value]) => key === "team_id" && value === "remote-team-1"));
    assert.ok(!readFilters.some(([key, value]) => key === "team_id" && value === "default"));
    assert.equal(tombstones.length, 1);
    assert.equal(result.conflicts[0].reason, "delete_version_mismatch");
    assert.equal(result.conflicts[0].expected_updated_at, "v1");
    assert.equal(result.conflicts[0].remote_updated_at, "v2");
  } finally { RemoteWorkspace.init = originalInit; globalThis.DB = originalDB; }
});

test("tombstone apaga apenas na equipa remota de origem, nunca no team_id local", async () => {
  const originalInit = RemoteWorkspace.init, originalDB = globalThis.DB;
  const tombstones = [{ id: 2, store: "jogadores", sync_id: "22222222-2222-4222-8222-222222222222", team_id: "default", remote_team_id: "remote-team-2", expected_updated_at: "v1" }];
  const reads = [], writes = [];
  const remote = { id: "22222222-2222-4222-8222-222222222222", updated_at: "v1", deleted_at: null, team_id: "remote-team-2" };
  globalThis.DB = { async listar(store) { return store === "sync_tombstones" ? tombstones.slice() : []; }, async apagar(_store, id) { const i = tombstones.findIndex(x => x.id === id); if (i >= 0) tombstones.splice(i, 1); } };
  RemoteWorkspace.init = async () => ({ from(table) { assert.equal(table, "workspace_records"); const q = { filters: [], op: "select", select() { return this; }, update() { this.op = "update"; writes.push(this.filters); return this; }, eq(key, value) { this.filters.push([key, value]); return this; }, is(key, value) { this.filters.push([key, value]); return this; }, async maybeSingle() { reads.push(this.filters.slice()); return { data: remote, error: null }; }, then(resolve) { return Promise.resolve({ data: this.op === "update" ? [{ id: remote.id }] : [], error: null }).then(resolve); } }; return q; } });
  try {
    const result = await RemoteWorkspace._syncTombstones("selected-other-team");
    assert.equal(result.deleted, 1);
    assert.equal(tombstones.length, 0);
    assert.ok(reads[0].some(([key, value]) => key === "team_id" && value === "remote-team-2"));
    assert.ok(writes[0].some(([key, value]) => key === "team_id" && value === "remote-team-2"));
    assert.ok(!writes[0].some(([key, value]) => key === "team_id" && value === "default"));
  } finally { RemoteWorkspace.init = originalInit; globalThis.DB = originalDB; }
});

test("resolução de conflito exige escolha explícita e usa a versão atual confirmada", async () => {
  const originalDB = globalThis.DB, originalStorage = globalThis.localStorage, originalSync = RemoteWorkspace.syncNow;
  let tombstone = { id: 9, store: "jogadores", sync_id: "99999999-9999-4999-8999-999999999999", expected_updated_at: "v1" }, syncCalls = 0;
  const storage = new Map([["treinador.remote.supabase.v1", JSON.stringify({ conflicts: [{ sync_id: "99999999-9999-4999-8999-999999999999", reason: "delete_version_mismatch", remote_updated_at: "v2" }] })]]);
  globalThis.localStorage = { getItem: (key) => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) };
  globalThis.DB = {
    async listar() { return tombstone ? [tombstone] : []; },
    async apagar(_store, id) { if (tombstone?.id === id) tombstone = null; },
    async modificar(_store, id, fn) { assert.equal(id, 9); tombstone = fn(tombstone); return tombstone; },
  };
  RemoteWorkspace.syncNow = async () => { syncCalls++; return { conflicts: [] }; };
  try {
    await assert.rejects(RemoteWorkspace.resolveDeleteConflict("99999999-9999-4999-8999-999999999999", "discard_both"), /Escolhe/);
    await RemoteWorkspace.resolveDeleteConflict("99999999-9999-4999-8999-999999999999", "delete_remote");
    assert.equal(tombstone.expected_updated_at, "v2");
    assert.equal(syncCalls, 1);
    await RemoteWorkspace.resolveDeleteConflict("99999999-9999-4999-8999-999999999999", "keep_remote");
    assert.equal(tombstone, null);
    assert.equal(syncCalls, 2);
  } finally { globalThis.DB = originalDB; globalThis.localStorage = originalStorage; RemoteWorkspace.syncNow = originalSync; }
});

test("restauro de edição após eliminação remota é condicional à versão exata", async () => {
  const originalDB = globalThis.DB, originalStorage = globalThis.localStorage, originalSync = RemoteWorkspace.syncNow, originalInit = RemoteWorkspace.init;
  let local = { id: 12, sync_id: "media-12", sync_dirty: true, title: "Alteração local" }, filters = [];
  const storage = new Map([["treinador.remote.supabase.v1", JSON.stringify({ remoteTeamId: "team-1", conflicts: [{ store: "media_items", sync_id: "media-12", reason: "remote_deleted_local_dirty", remote_updated_at: "v4", remote_deleted_at: "deleted-v4" }] })]]);
  globalThis.localStorage = { getItem: (key) => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) };
  globalThis.DB = { async listar(store) { return store === "media_items" ? [local] : []; }, async modificar(_store, id, fn) { assert.equal(id, 12); local = fn(local); return local; } };
  RemoteWorkspace.init = async () => ({ from(table) { assert.equal(table, "media_assets"); return { update() { return this; }, eq(key, value) { filters.push([key, value]); return this; }, select() { return this; }, async maybeSingle() { return { data: { id: "media-12", updated_at: "v5" }, error: null }; } }; } });
  RemoteWorkspace.syncNow = async () => ({ conflicts: [] });
  try {
    await RemoteWorkspace.restoreLocallyEditedRecord("media-12");
    assert.ok(filters.some(([key, value]) => key === "updated_at" && value === "v4"));
    assert.ok(filters.some(([key, value]) => key === "deleted_at" && value === "deleted-v4"));
    assert.equal(local.remote_updated_at, "v5");
    assert.equal(local.sync_dirty, true);
  } finally { globalThis.DB = originalDB; globalThis.localStorage = originalStorage; RemoteWorkspace.syncNow = originalSync; RemoteWorkspace.init = originalInit; }
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
    assert.equal(queries, 2);
  } finally { globalThis.DB = originalDB; RemoteWorkspace.init = originalInit; }
});

test("consolidação com sync_id default repara antes da sincronização", async () => {
  const originals = { DB: globalThis.DB, DEFAULT_TEAM_ID: globalThis.DEFAULT_TEAM_ID, navigator: Object.getOwnPropertyDescriptor(globalThis,"navigator"), localStorage: globalThis.localStorage, init: RemoteWorkspace.init, getSession: RemoteWorkspace.getSession, ensureSelectedTeam: RemoteWorkspace.ensureSelectedTeam, syncNow: RemoteWorkspace.syncNow };
  let row = { id: 3, team_id: "default", sync_id: "default", sync_dirty: false }, calls = 0;
  globalThis.DEFAULT_TEAM_ID = "default";
  globalThis.DB = { async listar(store) { return store === "jogos" ? [{ ...row }] : []; }, async obter(store, id) { return store === "jogos" && id === row.id ? { ...row } : null; }, async atualizar(_store, next) { row = { ...next }; return row; } };
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

test("treino sincronizado converte exercício local em UUID estável sem alterar o plano local", async () => {
  const team = "22222222-2222-4222-8222-222222222222";
  const originalDB = globalThis.DB, originalTeam = globalThis.DEFAULT_TEAM_ID;
  let exercise = { id: 7, team_id: "default", workspace_v2: true, nome: "Passe e apoio" };
  globalThis.DEFAULT_TEAM_ID = "default";
  globalThis.DB = {
    async obter(store, id) { assert.equal(store, "exercicios"); return id === 7 ? { ...exercise } : null; },
    async atualizar(store, row) { assert.equal(store, "exercicios"); exercise = { ...row }; return row; },
  };
  const training = { id: 3, team_id: "default", blocos: [{ exercise_ref: "7", duration_min: 12 }] };
  try {
    const payload = await RemoteWorkspace._payloadForRemote("treinos", training, team);
    assert.match(payload.blocos[0].exercise_ref, /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    assert.equal(payload.blocos[0].exercise_ref, exercise.sync_id);
    assert.equal(training.blocos[0].exercise_ref, "7");
    await assert.rejects(RemoteWorkspace._payloadForRemote("treinos", { ...training, blocos: [{ exercise_ref: "999" }] }, team), error => error.code === "LOCAL_REFERENCE_CONFLICT" && error.reason === "subject_not_found_locally");
    exercise.remote_team_id = "33333333-3333-4333-8333-333333333333";
    await assert.rejects(RemoteWorkspace._payloadForRemote("treinos", training, team), error => error.code === "LOCAL_REFERENCE_CONFLICT" && error.reason === "subject_other_team");
  } finally { globalThis.DB = originalDB; globalThis.DEFAULT_TEAM_ID = originalTeam; }
});

test("um documento com referência inválida fica em conflito e não bloqueia outro documento", async () => {
  const team = "22222222-2222-4222-8222-222222222222";
  const originals = { DB: globalThis.DB, DEFAULT_TEAM_ID: globalThis.DEFAULT_TEAM_ID, init: RemoteWorkspace.init };
  const rows = [
    { id: 1, team_id: "default", remote_team_id: team, sync_id: "11111111-1111-4111-8111-111111111111", sync_dirty: true, refs: [{ type: "player", id: "default" }], title: "Referência pendente" },
    { id: 2, team_id: "default", remote_team_id: team, sync_id: "33333333-3333-4333-8333-333333333333", sync_dirty: true, refs: [], title: "Documento válido" },
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

function createSharedRemoteWorkspace() {
  const tables = { workspace_records: [], media_assets: [] };
  const rows = tables.workspace_records;
  const mediaRows = tables.media_assets;
  const files = new Map();
  let revision = 0;
  const stamp = () => `v${++revision}`;
  const matches = (row, filters) => filters.every(([op, key, value]) =>
    op === "eq" ? row[key] === value : (row[key] ?? null) === value
  );
  return {
    rows,
    client: {
      from(table) {
        const query = {
          filters: [], action: "select", patch: null, input: null,
          select() { return this; },
          eq(key, value) { this.filters.push(["eq", key, value]); return this; },
          is(key, value) { this.filters.push(["is", key, value]); return this; },
          insert(input) { this.action = "insert"; this.input = input; return this; },
          update(patch) { this.action = "update"; this.patch = patch; return this; },
          async execute() {
            const tableRows = tables[table] || [];
            if (this.action === "insert") {
              if (tableRows.some((row) => row.id === this.input.id)) return { data: null, error: { code: "23505", message: "duplicate key" } };
              const saved = { ...this.input, created_at: stamp(), updated_at: stamp(), deleted_at: null };
              tableRows.push(saved);
              return { data: [saved], error: null };
            }
            const found = tableRows.filter((row) => matches(row, this.filters));
            if (this.action === "update") {
              for (const row of found) Object.assign(row, this.patch, { updated_at: stamp() });
            }
            return { data: found, error: null };
          },
          async single() { const result = await this.execute(); return { ...result, data: result.data?.[0] || null }; },
          async maybeSingle() { const result = await this.execute(); return { ...result, data: result.data?.[0] || null }; },
          then(resolve, reject) { return this.execute().then(resolve, reject); },
        };
        return query;
      },
      storage: {
        from(bucket) {
          assert.equal(bucket, "team-media");
          return {
            async upload(path, blob) { files.set(path, blob); return { error: null }; },
            async createSignedUrl(path) {
              return files.has(path)
                ? { data: { signedUrl: `https://signed.example/${path}` }, error: null }
                : { data: null, error: new Error("ficheiro inexistente") };
            },
          };
        },
      },
    },
    mediaRows,
    files,
  };
}

function createDeviceDatabase() {
  const stores = new Map();
  let nextId = 1;
  return {
    stores,
    async listar(store) { return (stores.get(store) || []).map((row) => ({ ...row })); },
    async porIndice(store, index, value) {
      return (stores.get(store) || []).filter((row) => row[index] === value).map((row) => ({ ...row }));
    },
    async obter(store, id) { return (stores.get(store) || []).find((row) => row.id === id); },
    async criar(store, input) {
      const rows = stores.get(store) || [];
      stores.set(store, rows);
      const row = { ...input, id: input.id ?? nextId++ };
      rows.push(row);
      return row.id;
    },
    async atualizar(store, input) {
      const rows = stores.get(store) || [];
      const index = rows.findIndex((row) => row.id === input.id);
      if (index < 0) throw new Error(`Registo local ausente: ${store}/${input.id}`);
      rows[index] = { ...input };
      return rows[index];
    },
    async modificar(store, id, update) {
      const rows = stores.get(store) || [];
      const index = rows.findIndex((row) => row.id === id);
      if (index < 0) throw new Error(`Registo local ausente: ${store}/${id}`);
      rows[index] = update({ ...rows[index] });
      return rows[index];
    },
    async apagar(store, id, options = {}) {
      const rows = stores.get(store) || [];
      const index = rows.findIndex((row) => row.id === id);
      if (index < 0) return false;
      const [row] = rows.splice(index, 1);
      if (!options.remote && row.sync_id) await this.criar("sync_tombstones", {
        store, sync_id: row.sync_id, team_id: row.team_id || "default",
        remote_team_id: row.remote_team_id || null,
        expected_updated_at: row.remote_updated_at || null,
      });
      return true;
    },
  };
}

async function withTwoDeviceSync(run) {
  const originalInit = RemoteWorkspace.init;
  const originalDB = globalThis.DB;
  const originalTeam = globalThis.DEFAULT_TEAM_ID;
  const originalMediaSubjectKey = globalThis.mediaSubjectKey;
  const remoteTeamId = "team-shared";
  const remote = createSharedRemoteWorkspace();
  const devices = [createDeviceDatabase(), createDeviceDatabase()];
  globalThis.DEFAULT_TEAM_ID = "default";
  globalThis.mediaSubjectKey = (team, type, id) => [team, type, id].join("|");
  RemoteWorkspace.init = async () => remote.client;
  try {
    await run({ remote, devices, remoteTeamId, useDevice(index) { globalThis.DB = devices[index]; } });
  } finally {
    RemoteWorkspace.init = originalInit;
    globalThis.DB = originalDB;
    globalThis.DEFAULT_TEAM_ID = originalTeam;
    globalThis.mediaSubjectKey = originalMediaSubjectKey;
  }
}

test("dois dispositivos sincronizam criação, edição e eliminação sem duplicar ou ressuscitar registos", async () => {
  await withTwoDeviceSync(async ({ remote, devices, remoteTeamId, useDevice }) => {
    useDevice(0);
    const localId = await devices[0].criar("jogos", {
      team_id: "default", adversario: "Rivais", data: "2026-10-01",
      external_key: "match-two-devices-1", nota_tatica: "Primeira versão",
      sync_dirty: true,
    });
    const pushed = await RemoteWorkspace._syncRecords(remoteTeamId, "coach");
    const firstLocal = await devices[0].obter("jogos", localId);
    assert.equal(pushed.pushed, 1);
    assert.ok(firstLocal.sync_id);
    assert.equal(firstLocal.sync_dirty, false);

    useDevice(1);
    const pulled = await RemoteWorkspace._syncRecords(remoteTeamId, "coach");
    let secondLocal = (await devices[1].listar("jogos"))[0];
    assert.equal(pulled.pulled, 1);
    assert.equal(secondLocal.sync_id, firstLocal.sync_id);
    assert.equal(secondLocal.nota_tatica, "Primeira versão");

    useDevice(1);
    await devices[1].atualizar("jogos", { ...secondLocal, nota_tatica: "Editado no telemóvel", sync_dirty: true });
    const edited = await RemoteWorkspace._syncRecords(remoteTeamId, "coach");
    assert.equal(edited.pushed, 1);

    useDevice(0);
    const received = await RemoteWorkspace._syncRecords(remoteTeamId, "coach");
    const firstAfterPull = await devices[0].obter("jogos", localId);
    assert.equal(received.pulled, 1);
    assert.equal(firstAfterPull.nota_tatica, "Editado no telemóvel");
    assert.equal((await devices[0].listar("jogos")).length, 1);

    await devices[0].apagar("jogos", localId);
    const tombstoneResult = await RemoteWorkspace._syncTombstones(remoteTeamId);
    assert.equal(tombstoneResult.deleted, 1);
    assert.equal(remote.rows[0].deleted_at != null, true);
    assert.equal((await devices[0].listar("sync_tombstones")).length, 0);

    useDevice(1);
    const remoteDelete = await RemoteWorkspace._syncRecords(remoteTeamId, "coach");
    assert.equal(remoteDelete.deleted, 1);
    assert.equal((await devices[1].listar("jogos")).length, 0);
    const repeated = await RemoteWorkspace._syncRecords(remoteTeamId, "coach");
    assert.equal(repeated.pulled, 0);
    assert.equal((await devices[1].listar("jogos")).length, 0);
    assert.equal(remote.rows.length, 1);
  });
});

test("plano antigo com referência numérica de exercício chega ao segundo dispositivo com UUID", async () => {
  await withTwoDeviceSync(async ({ remote, devices, remoteTeamId, useDevice }) => {
    useDevice(0);
    const exerciseId = await devices[0].criar("exercicios", {
      team_id: "default", workspace_v2: true, nome: "Passe e apoio",
      external_key: "exercise-passe-apoio", sync_dirty: true,
    });
    await devices[0].criar("treinos", {
      team_id: "default", data: "2026-10-04", external_key: "training-legacy-exercise-ref",
      blocos: [{ exercise_ref: String(exerciseId), duration_min: 12 }], sync_dirty: true,
    });
    const pushed = await RemoteWorkspace._syncRecords(remoteTeamId, "coach");
    assert.equal(pushed.pushed, 2);
    assert.equal(pushed.conflicts.length, 0);
    const exerciseRemote = remote.rows.find(row => row.kind === "exercise");
    const trainingRemote = remote.rows.find(row => row.kind === "training");
    assert.equal(trainingRemote.payload.blocos[0].exercise_ref, exerciseRemote.id);

    useDevice(1);
    const received = await RemoteWorkspace._syncRecords(remoteTeamId, "coach");
    assert.equal(received.pulled, 2);
    const [exercise] = await devices[1].listar("exercicios");
    const [training] = await devices[1].listar("treinos");
    assert.equal(training.blocos[0].exercise_ref, exercise.sync_id);
    assert.equal((await devices[1].listar("treinos")).length, 1);
  });
});

test("alterações e eliminação acumuladas offline sincronizam ao reconectar sem ressuscitar o registo", async () => {
  await withTwoDeviceSync(async ({ remote, devices, remoteTeamId, useDevice }) => {
    // PC fica offline: cria e edita localmente antes de existir qualquer linha remota.
    useDevice(0);
    const localId = await devices[0].criar("jogos", {
      team_id: "default", adversario: "Rivais", data: "2026-10-03",
      external_key: "offline-match-reconnect", nota_tatica: "Rascunho offline",
      sync_dirty: true,
    });
    const offlineCreated = await devices[0].obter("jogos", localId);
    await devices[0].atualizar("jogos", {
      ...offlineCreated, nota_tatica: "Versão final offline", sync_dirty: true,
    });
    assert.equal(remote.rows.length, 0);

    // Ao reconectar, só a versão final é publicada e o telemóvel recebe um único registo.
    const reconnected = await RemoteWorkspace._syncRecords(remoteTeamId, "coach");
    assert.equal(reconnected.pushed, 1);
    assert.equal(remote.rows.length, 1);
    assert.equal(remote.rows[0].payload.nota_tatica, "Versão final offline");
    useDevice(1);
    const pulled = await RemoteWorkspace._syncRecords(remoteTeamId, "coach");
    assert.equal(pulled.pulled, 1);
    assert.equal((await devices[1].listar("jogos")).length, 1);

    // O telemóvel apaga sem ligação; o tombstone é aplicado ao reconectar.
    const phoneRow = (await devices[1].listar("jogos"))[0];
    await devices[1].apagar("jogos", phoneRow.id);
    assert.equal(remote.rows[0].deleted_at, null);
    const deletedOnReconnect = await RemoteWorkspace._syncTombstones(remoteTeamId);
    assert.equal(deletedOnReconnect.deleted, 1);
    assert.equal(remote.rows[0].deleted_at != null, true);
    assert.equal((await devices[1].listar("sync_tombstones")).length, 0);

    useDevice(0);
    const deletionPulled = await RemoteWorkspace._syncRecords(remoteTeamId, "coach");
    assert.equal(deletionPulled.deleted, 1);
    assert.equal((await devices[0].listar("jogos")).length, 0);
    assert.equal((await devices[0].listar("sync_tombstones")).length, 0);
    const repeated = await RemoteWorkspace._syncRecords(remoteTeamId, "coach");
    assert.equal(repeated.pulled, 0);
    assert.equal((await devices[0].listar("jogos")).length, 0);
    assert.equal(remote.rows.length, 1);
  });
});

test("edições concorrentes em dois dispositivos produzem conflito sem overwrite silencioso", async () => {
  await withTwoDeviceSync(async ({ remote, devices, remoteTeamId, useDevice }) => {
    useDevice(0);
    const localId = await devices[0].criar("jogos", {
      team_id: "default", adversario: "Rivais", data: "2026-10-02",
      external_key: "match-two-devices-conflict", nota_tatica: "Base",
      sync_dirty: true,
    });
    await RemoteWorkspace._syncRecords(remoteTeamId, "coach");

    useDevice(1);
    await RemoteWorkspace._syncRecords(remoteTeamId, "coach");
    const secondLocal = (await devices[1].listar("jogos"))[0];
    await devices[1].atualizar("jogos", { ...secondLocal, nota_tatica: "Versão do telemóvel", sync_dirty: true });
    await RemoteWorkspace._syncRecords(remoteTeamId, "coach");

    useDevice(0);
    const firstLocal = await devices[0].obter("jogos", localId);
    await devices[0].atualizar("jogos", { ...firstLocal, nota_tatica: "Versão do PC", sync_dirty: true });
    const conflict = await RemoteWorkspace._syncRecords(remoteTeamId, "coach");
    assert.equal(conflict.pushed, 0);
    assert.equal(conflict.conflicts[0].reason, "version_mismatch");
    assert.equal((await devices[0].obter("jogos", localId)).nota_tatica, "Versão do PC");
    assert.equal(remote.rows[0].payload.nota_tatica, "Versão do telemóvel");
  });
});

test("media carregada num dispositivo sincroniza em privado e aparece no outro com referência remota estável", async () => {
  await withTwoDeviceSync(async ({ remote, devices, remoteTeamId, useDevice }) => {
    useDevice(0);
    await devices[0].criar("media_items", {
      team_id: "default", subject_type: "team", subject_id: "default",
      type: "file", title: "Evidência de teste", file_name: "evidencia.txt",
      mime_type: "text/plain", data_url: "data:text/plain;base64,SGVsbG8=",
      sync_dirty: true,
    });
    const pushed = await RemoteWorkspace._syncMedia(remoteTeamId, "coach");
    const firstLocal = (await devices[0].listar("media_items"))[0];
    assert.equal(pushed.pushed, 1);
    assert.equal(firstLocal.sync_dirty, false);
    assert.equal(firstLocal.remote_team_id, remoteTeamId);
    assert.equal(remote.mediaRows.length, 1);
    assert.equal(remote.mediaRows[0].subject_ref, remoteTeamId);
    assert.equal(remote.mediaRows[0].storage_path.startsWith(`${remoteTeamId}/`), true);
    assert.equal(remote.files.has(remote.mediaRows[0].storage_path), true);

    useDevice(1);
    const pulled = await RemoteWorkspace._syncMedia(remoteTeamId, "coach");
    const secondLocal = (await devices[1].listar("media_items"))[0];
    assert.equal(pulled.pulled, 1);
    assert.equal(secondLocal.sync_id, firstLocal.sync_id);
    assert.equal(secondLocal.storage_path, remote.mediaRows[0].storage_path);
    assert.equal(secondLocal.url, `https://signed.example/${remote.mediaRows[0].storage_path}`);
    assert.equal((await devices[1].listar("media_items")).length, 1);
  });
});

test("foto do atleta faz ida e volta entre dispositivos pela UUID estável e Storage privado", async () => {
  await withTwoDeviceSync(async ({ remote, devices, remoteTeamId, useDevice }) => {
    const playerRef = "11111111-1111-4111-8111-111111111111";
    const photoRef = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const phonePhotoRef = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const imageData = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7RxycAAAAASUVORK5CYII=";

    useDevice(0);
    const playerLocalId = await devices[0].criar("jogadores", {
      team_id: "default", nome: "Atleta de teste", sync_id: playerRef,
      remote_team_id: remoteTeamId, sync_dirty: true,
    });
    assert.equal((await RemoteWorkspace._syncRecords(remoteTeamId, "coach")).pushed, 1);

    useDevice(1);
    await devices[1].criar("sync_tombstones", { store: "legacy", sync_id: "device-local-seed" });
    assert.equal((await RemoteWorkspace._syncRecords(remoteTeamId, "coach")).pulled, 1);
    const phonePlayer = (await devices[1].listar("jogadores"))[0];
    assert.equal(phonePlayer.sync_id, playerRef);
    assert.notEqual(phonePlayer.id, playerLocalId);

    useDevice(0);
    await devices[0].criar("media_items", {
      team_id: "default", subject_type: "player", subject_id: playerLocalId,
      type: "photo", title: "Fotografia do atleta", note: "Foto de perfil do atleta",
      file_name: "perfil.png", mime_type: "image/png", data_url: imageData,
      sync_id: photoRef, remote_team_id: remoteTeamId, sync_dirty: true,
    });
    const pushedPhoto = await RemoteWorkspace._syncMedia(remoteTeamId, "coach");
    assert.equal(pushedPhoto.pushed, 1);
    const storedPhoto = remote.mediaRows.find((row) => row.id === photoRef);
    assert.equal(storedPhoto.subject_type, "player");
    assert.equal(storedPhoto.subject_ref, playerRef);
    assert.equal(storedPhoto.storage_path.startsWith(`${remoteTeamId}/${photoRef}/`), true);
    assert.equal("data_url" in storedPhoto, false);
    assert.equal(remote.files.has(storedPhoto.storage_path), true);

    useDevice(1);
    const pulledPhoto = await RemoteWorkspace._syncMedia(remoteTeamId, "coach");
    assert.equal(pulledPhoto.pulled, 1);
    const phoneMedia = (await devices[1].listar("media_items"))[0];
    const refreshedPhonePlayer = await devices[1].obter("jogadores", phonePlayer.id);
    assert.equal(phoneMedia.sync_id, photoRef);
    assert.equal(phoneMedia.subject_id, String(phonePlayer.id));
    assert.equal(phoneMedia.data_url, undefined);
    assert.equal(refreshedPhonePlayer.profile_media_ref, photoRef);
    assert.equal(refreshedPhonePlayer.foto, `https://signed.example/${storedPhoto.storage_path}`);

    await devices[1].criar("media_items", {
      team_id: "default", subject_type: "player", subject_id: phonePlayer.id,
      type: "photo", title: "Nova fotografia", note: "Foto de perfil do atleta",
      file_name: "perfil-novo.png", mime_type: "image/png", data_url: imageData,
      sync_id: phonePhotoRef, remote_team_id: remoteTeamId, sync_dirty: true,
    });
    assert.equal((await RemoteWorkspace._syncMedia(remoteTeamId, "coach")).pushed, 1);

    useDevice(0);
    const returnedPhoto = await RemoteWorkspace._syncMedia(remoteTeamId, "coach");
    assert.equal(returnedPhoto.pulled, 2);
    const returnedMedia = (await devices[0].listar("media_items")).find((row) => row.sync_id === phonePhotoRef);
    const returnedPlayer = await devices[0].obter("jogadores", playerLocalId);
    assert.equal(returnedMedia.subject_id, String(playerLocalId));
    assert.equal(returnedPlayer.profile_media_ref, phonePhotoRef);
    assert.equal(returnedPlayer.foto, `https://signed.example/${remote.mediaRows.find((row) => row.id === phonePhotoRef).storage_path}`);
    assert.equal(remote.mediaRows.length, 2);

    useDevice(1);
    const phoneLatestPhoto = (await devices[1].listar("media_items")).find((row) => row.sync_id === phonePhotoRef);
    await devices[1].apagar("media_items", phoneLatestPhoto.id);
    assert.equal(remote.mediaRows.find((row) => row.id === phonePhotoRef).deleted_at, null);
    assert.equal((await RemoteWorkspace._syncTombstones(remoteTeamId)).deleted, 1);
    assert.notEqual(remote.mediaRows.find((row) => row.id === phonePhotoRef).deleted_at, null);

    useDevice(0);
    assert.equal((await RemoteWorkspace._syncMedia(remoteTeamId, "coach")).deleted, 1);
    const afterDeletePlayer = await devices[0].obter("jogadores", playerLocalId);
    assert.equal((await devices[0].listar("media_items")).some((row) => row.sync_id === phonePhotoRef), false);
    assert.equal(afterDeletePlayer.profile_media_ref, photoRef);
    assert.equal(afterDeletePlayer.foto, imageData);
    assert.equal((await RemoteWorkspace._syncMedia(remoteTeamId, "coach")).pulled, 1);
    assert.equal((await devices[0].listar("media_items")).length, 1);
    assert.equal((await devices[0].listar("media_items")).some((row) => row.sync_id === phonePhotoRef), false);
  });
});

test("ida e volta entre dispositivos preserva lances, minutos, sessão, memória e proposta sem duplicar", async () => {
  await withTwoDeviceSync(async ({ remote, devices, remoteTeamId, useDevice }) => {
    const playerRefs = Array.from({ length: 6 }, (_, i) => `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`);
    const roster = playerRefs.map((sync_id, i) => ({ sync_id, nome: `Atleta ${i + 1}`, numero: i + 1, plantel_ativo: true, estado_disponibilidade: "disponivel" }));
    const base = Date.parse("2026-09-27T10:00:00Z");
    let match = {
      team_id: "default", external_key: "sync-audit-match", adversario: "Teste", data: "2026-09-27", estado: "agendado",
      callup: { player_ids: playerRefs },
      lineup: { system: "1-2-1", goalkeeper_id: playerRefs[0], starters: playerRefs.slice(1, 5), substitutes: [playerRefs[5]] },
    };
    match = MatchVisual.apply(match, { type: "start", expected_revision: 0, confirmed: true }, { now: base, controller_id: "pc", players: roster });
    match = MatchEvents.apply(match, {
      type: "record", id: "event-loss-1", event_type: "loss", at_ms: 300000,
      player_ref: playerRefs[1], zone: "def_c", reason: "pass", expected_revision: 0,
    }, { now: base + 360000, actor: "Treinador", players: roster });
    match = MatchVisual.apply(match, {
      type: "substitute", expected_revision: 1, id: "substitution-1", out_ref: playerRefs[1], in_ref: playerRefs[5], confirmed: true,
    }, { now: base + 360000, controller_id: "pc", players: roster });
    match = MatchVisual.apply(match, { type: "finish", expected_revision: 2, confirmed: true }, { now: base + 600000, controller_id: "pc", players: roster });
    const records = [
      ["jogos", { ...match, coach_marker: "game-v1", sync_dirty: true }],
      ["treinos", {
        team_id: "default", external_key: "sync-audit-training", data: "2026-09-20",
        attendance: [{ player_ref: "11111111-1111-4111-8111-111111111111", status: "present" }],
        blocks: [{ exercise_ref: "22222222-2222-4222-8222-222222222222", elapsed_ms: 420000, note: "apoio após passe" }],
        coach_marker: "training-v1", sync_dirty: true,
      }],
      ["memory_items", {
        team_id: "default", external_key: "sync-audit-memory", title: "Apoio após passe",
        source_ref: "33333333-3333-4333-8333-333333333333", evidence: [{ type: "coach_observation", quote: "observado no treino" }],
        coach_marker: "memory-v1", sync_dirty: true,
      }],
      ["workspace_documents", {
        team_id: "default", external_key: "sync-audit-proposal", type: "team_goal", status: "proposed",
        source_refs: ["33333333-3333-4333-8333-333333333333"], coach_marker: "proposal-v1", sync_dirty: true,
      }],
    ];

    useDevice(0);
    const pcIds = new Map();
    for (const [store, payload] of records) pcIds.set(store, await devices[0].criar(store, payload));
    const pushed = await RemoteWorkspace._syncRecords(remoteTeamId, "coach");
    assert.equal(pushed.pushed, records.length);
    assert.equal(remote.rows.length, records.length);

    useDevice(1);
    const pulled = await RemoteWorkspace._syncRecords(remoteTeamId, "coach");
    assert.equal(pulled.pulled, records.length);
    for (const [store] of records) {
      const [phoneRow] = await devices[1].listar(store);
      assert.ok(phoneRow.sync_id);
      assert.equal(phoneRow.remote_team_id, remoteTeamId);
      assert.equal(phoneRow.coach_marker, `${store === "jogos" ? "game" : store === "treinos" ? "training" : store === "memory_items" ? "memory" : "proposal"}-v1`);
      await devices[1].atualizar(store, { ...phoneRow, coach_marker: "editado-no-telemovel", sync_dirty: true });
    }

    const phoneEdits = await RemoteWorkspace._syncRecords(remoteTeamId, "coach");
    assert.equal(phoneEdits.pushed, records.length);
    useDevice(0);
    const returned = await RemoteWorkspace._syncRecords(remoteTeamId, "coach");
    assert.equal(returned.pulled, records.length);
    for (const [store] of records) {
      const pcRow = await devices[0].obter(store, pcIds.get(store));
      assert.equal(pcRow.coach_marker, "editado-no-telemovel");
      assert.equal(pcRow.sync_dirty, false);
      assert.equal((await devices[0].listar(store)).length, 1);
    }
    const savedMatch = remote.rows.find((row) => row.kind === "match");
    assert.equal(savedMatch.payload.match_events.events[0].id, "event-loss-1");
    assert.equal(savedMatch.payload.match_events.events[0].player_ref, playerRefs[1]);
    assert.equal(savedMatch.payload.visual_match.events[0].id, "substitution-1");
    const recordedMinutes = MatchVisual.replay(savedMatch.payload).players;
    assert.equal(recordedMinutes.find((player) => player.ref === playerRefs[1]).elapsed_ms, 360000);
    assert.equal(recordedMinutes.find((player) => player.ref === playerRefs[5]).elapsed_ms, 240000);
    const pulledMatch = (await devices[1].listar("jogos"))[0];
    assert.equal(pulledMatch.match_events.events[0].player_ref, playerRefs[1]);
    assert.deepEqual(MatchVisual.replay(pulledMatch).players.map((player) => [player.ref, player.elapsed_ms]), recordedMinutes.map((player) => [player.ref, player.elapsed_ms]));
    const savedTraining = remote.rows.find((row) => row.kind === "training");
    assert.equal(savedTraining.payload.blocks[0].exercise_ref, "22222222-2222-4222-8222-222222222222");
    assert.equal(remote.rows.length, records.length);
  });
});

test("sincronizações simultâneas serializam, repetem a passagem do mesmo workspace e isolam a equipa seguinte", async () => {
  const originalRun = RemoteWorkspace._syncNow;
  const originalStorage = globalThis.localStorage;
  const originalPromise = RemoteWorkspace._syncPromise;
  const originalTeam = RemoteWorkspace._syncTeamId;
  const originalAgain = RemoteWorkspace._syncAgain;
  let selectedTeamId = "team-a";
  let calls = 0;
  let active = 0, maxActive = 0;
  const releases = [];
  globalThis.localStorage = {
    getItem() { return JSON.stringify({ remoteTeamId: selectedTeamId }); },
    setItem() {},
  };
  RemoteWorkspace._syncPromise = null;
  RemoteWorkspace._syncTeamId = null;
  RemoteWorkspace._syncAgain = false;
  RemoteWorkspace._syncNow = () => {
    calls++;
    active++;
    maxActive = Math.max(maxActive, active);
    if (calls <= 3) return new Promise((resolve) => {
      releases[calls - 1] = (result) => { active--; resolve(result); };
    });
    active--;
    return Promise.resolve({ run: calls });
  };
  try {
    const first = RemoteWorkspace.syncNow();
    await new Promise((resolve) => setImmediate(resolve));
    const repeated = RemoteWorkspace.syncNow();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(calls, 1);
    releases[0]({ run: 1 });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(calls, 2);
    releases[1]({ run: 2 });
    assert.deepEqual(await first, { run: 2 });
    assert.deepEqual(await repeated, { run: 2 });

    const teamA = RemoteWorkspace.syncNow();
    await new Promise((resolve) => setImmediate(resolve));
    selectedTeamId = "team-b";
    const teamB = RemoteWorkspace.syncNow();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(calls, 3);
    releases[2]({ run: 3 });
    assert.deepEqual(await teamA, { run: 3 });
    assert.deepEqual(await teamB, { run: 4 });
    assert.equal(calls, 4);
    assert.equal(maxActive, 1);
  } finally {
    RemoteWorkspace._syncNow = originalRun;
    RemoteWorkspace._syncPromise = originalPromise;
    RemoteWorkspace._syncTeamId = originalTeam;
    RemoteWorkspace._syncAgain = originalAgain;
    globalThis.localStorage = originalStorage;
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
