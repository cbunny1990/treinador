"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  normalizarWorkspaceDocument,
  normalizarActivity,
  workspaceTimeline,
  workspacePriority,
} = require("../js/workspace.js");

test("documento partilhado preserva autoria do agente", () => {
  const doc = normalizarWorkspaceDocument({
    type: "training_plan",
    title: "Treino de terça",
    body: "Objetivo: saída sob pressão.",
    status: "ready",
    created_by: "agent",
    created_by_label: "Head Coach",
  }, { now: "2026-09-21T09:00:00.000Z" });

  assert.equal(doc.team_id, "default");
  assert.equal(doc.created_by, "agent");
  assert.equal(doc.created_by_label, "Head Coach");
  assert.equal(doc.status, "ready");
});

test("atividade separa humano, agente e sistema", () => {
  assert.equal(normalizarActivity({ actor: "human" }).actor_label, "Treinador");
  assert.equal(normalizarActivity({ actor: "agent" }).actor_label, "Agente");
  assert.equal(normalizarActivity({ actor: "system" }).actor_label, "Sistema");
});

test("prioridades usam apenas memória ativa com prioridade explícita", () => {
  const rows = workspacePriority([
    { id: 1, status: "active", title: "B", metadata: { priority: 2 }, created_at: "2026-09-20" },
    { id: 2, status: "active", title: "A", metadata: { priority: 1 }, created_at: "2026-09-21" },
    { id: 3, status: "archived", title: "X", metadata: { priority: 1 }, created_at: "2026-09-22" },
    { id: 4, status: "active", title: "Sem", metadata: {}, created_at: "2026-09-23" },
  ]);
  assert.deepEqual(rows.map((x) => x.id), [2, 1]);
});

test("timeline mistura documentos, atividade, jogos e memória por data", () => {
  const rows = workspaceTimeline({
    activity: [{ created_at: "2026-09-21T10:00:00Z", summary: "Agente criou plano", actor: "agent" }],
    documents: [{ updated_at: "2026-09-21T09:00:00Z", title: "Plano", created_by: "agent" }],
    memory: [{ occurred_at: "2026-09-20", title: "Observação", metadata: { actor: "human" } }],
    matches: [{ data: "2026-09-19", adversario: "Teste" }],
    trainings: [],
  });
  assert.equal(rows[0].type, "activity");
  assert.equal(rows[1].type, "document");
  assert.equal(rows[2].type, "memory");
  assert.equal(rows[3].type, "match");
});

test("documento inválido é recusado", () => {
  assert.throws(() => normalizarWorkspaceDocument({ type: "chat", title: "X" }), /Tipo/);
  assert.throws(() => normalizarWorkspaceDocument({ type: "note", title: "" }), /título/);
});
