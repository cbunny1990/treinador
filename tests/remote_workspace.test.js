"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  REMOTE_STORE_KINDS,
  REMOTE_KIND_STORES,
  remoteConfigValid,
  remoteActorFor,
  remotePayload,
  remoteSafeFilename,
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
    data_url: "data:image/png;base64,secret",
    nome: "Jogador",
  });
  assert.deepEqual(payload, { nome: "Jogador" });
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
