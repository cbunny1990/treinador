"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { construirDashboardHeadCoach } = require("../js/head_coach_dashboard.js");

function base(overrides = {}) {
  return {
    team: { id: "default", nome: "Sub-8" }, game_model: null, players: [], memory: [],
    trainings: [], matches: [], training_items: [], exercises: [], ...overrides,
  };
}

test("prioridades explícitas vencem sugestões e mantêm ordem 1-3", () => {
  const d = construirDashboardHeadCoach(base({ memory: [
    { id: 1, kind: "observation", title: "Sugestão", content: "Obs", status: "active", occurred_at: "2026-09-20", subject_refs: [] },
    { id: 2, kind: "diagnosis", title: "Prioridade 2", content: "D2", status: "active", occurred_at: "2026-09-18", metadata: { priority: 2 }, subject_refs: [] },
    { id: 3, kind: "diagnosis", title: "Prioridade 1", content: "D1", status: "active", occurred_at: "2026-09-17", metadata: { priority: 1 }, subject_refs: [] },
  ] }), "2026-09-20T12:00:00Z");
  assert.deepEqual(d.priorities.map((x) => x.id), [3, 2, 1]);
  assert.deepEqual(d.priorities.map((x) => x.explicit), [true, true, false]);
});

test("observação individual sinaliza jogador mas não prioridade coletiva", () => {
  const d = construirDashboardHeadCoach(base({
    players: [{ id: 7, nome: "Jogador" }],
    memory: [{ id: 1, kind: "observation", title: "Individual", content: "Obs", status: "active", occurred_at: "2026-09-20", subject_refs: [{ type: "player", id: "7" }] }],
  }), "2026-09-20T12:00:00Z");
  assert.equal(d.priorities.length, 0);
  assert.equal(d.players_attention[0].player.nome, "Jogador");
});

test("próximo treino recebe objetivo e exercícios reais", () => {
  const d = construirDashboardHeadCoach(base({
    memory: [{ id: 4, kind: "decision", title: "Decisão", content: "Trabalhar saída curta.", status: "active", occurred_at: "2026-09-20", subject_refs: [] }],
    trainings: [{ id: 8, data: "2026-09-21", escalao: "sub-8" }],
    training_items: [{ treino_id: 8, exercicio_id: 11, ordem: 0, duracao_min: 15 }],
    exercises: [{ id: 11, titulo: "Saída 3x2" }],
  }), "2026-09-20T12:00:00Z");
  assert.equal(d.next_training.event.id, 8);
  assert.equal(d.next_training.objective, "Trabalhar saída curta.");
  assert.equal(d.next_training.exercises[0].exercise.titulo, "Saída 3x2");
});

test("último jogo e comparação usam apenas jogos concluídos", () => {
  const d = construirDashboardHeadCoach(base({ matches: [
    { id: 1, data: "2026-09-10", golos_favor: 1, golos_contra: 4 },
    { id: 2, data: "2026-09-19", golos_favor: 2, golos_contra: 3 },
    { id: 3, data: "2026-09-25", golos_favor: null, golos_contra: null },
  ] }), "2026-09-20T12:00:00Z");
  assert.equal(d.last_match.id, 2);
  assert.match(d.match_change, /positiva/);
});
