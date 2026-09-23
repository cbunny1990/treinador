"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  AGENT_WORKSPACE_SCHEMA,
  agentPublicDocument,
  agentPublicMedia,
  agentTextContains,
} = require("../js/agent_contract.js");

test("contrato do agente tem schema estável", () => {
  assert.equal(AGENT_WORKSPACE_SCHEMA, "treinador-agent-workspace@2");
});

test("citação só corresponde a texto realmente presente na origem", () => {
  assert.equal(agentTextContains({ during: { notes: ["Pressão alta recuperou a bola"] } }, "Pressão alta recuperou a bola"), true);
  assert.equal(agentTextContains({ during: { notes: ["Pressão alta recuperou a bola"] } }, "Golo aos dez minutos"), false);
});

test("documento público mantém autoria e última edição", () => {
  const doc = agentPublicDocument({
    id: 7,
    type: "training_plan",
    title: "Treino",
    body: "Conteúdo",
    status: "ready",
    created_by: "agent",
    created_by_label: "Head Coach",
    updated_by: "human",
    updated_by_label: "Treinador",
    created_at: "2026-09-21T09:00:00Z",
    updated_at: "2026-09-21T10:00:00Z",
  });
  assert.equal(doc.created_by, "agent");
  assert.equal(doc.updated_by, "human");
});

test("media exposto ao agente não inclui data_url local", () => {
  const media = agentPublicMedia({
    id: 1,
    type: "photo",
    title: "Lance",
    subject_type: "match",
    subject_id: 3,
    data_url: "data:image/jpeg;base64,SECRET",
    created_at: "2026-09-21T09:00:00Z",
  });
  assert.equal(Object.hasOwn(media, "data_url"), false);
});
