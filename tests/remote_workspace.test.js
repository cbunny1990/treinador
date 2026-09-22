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
