"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const TrainingPlanner = require("../js/training_planner.js");

test("normaliza exercício Vision Coach", () => {
  const row = TrainingPlanner.normalizeExercise({
    nome: "Fechar, Cobrir e Deslocar",
    series: 3,
    duracao_serie_min: 4,
    tags: ["defesa"],
  });
  assert.equal(row.workspace_v2, true);
  assert.equal(row.duracao_total_min, 12);
  assert.equal(row.external_key, "exercise-fechar-cobrir-e-deslocar");
  assert.equal(row.modelo, "5x5-1-2-1");
});

test("biblioteca exclui exercícios legados", () => {
  const rows = TrainingPlanner.visionExercises([
    { nome: "Legado" },
    { nome: "Novo", workspace_v2: true, status: "active" },
    { nome: "Arquivado", workspace_v2: true, status: "archived" },
  ]);
  assert.deepEqual(rows.map((x) => x.nome), ["Novo"]);
});
test("pesquisa considera nome, objetivo e tags", () => {
  const row = TrainingPlanner.normalizeExercise({
    nome: "Cobertura",
    objetivo: "Posicionamento defensivo",
    tags: ["deslocamento"],
  });
  assert.equal(TrainingPlanner.exerciseMatches(row, "defensivo", false), true);
  assert.equal(TrainingPlanner.exerciseMatches(row, "deslocamento", false), true);
  assert.equal(TrainingPlanner.exerciseMatches(row, "finalização", false), false);
  row.favorito = false;
  assert.equal(TrainingPlanner.exerciseMatches(row, "", true), false);
});

test("duração do treino soma blocos", () => {
  const training = TrainingPlanner.normalizeTraining({
    blocos: [
      { order: 1, exercise_ref: "a", duration_min: 12 },
      { order: 0, exercise_ref: "b", duration_min: 8 },
    ],
  });
  assert.equal(training.duracao_min, 20);
  assert.deepEqual(training.blocos.map((x) => x.exercise_ref), ["b", "a"]);
});
