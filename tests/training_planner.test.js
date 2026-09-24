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

test("normalização usa a avaliação da sessão quando a do plano está vazia, preservando precedência explícita", () => {
  const sessionReview = { status: "done", continua: "Apoio após passe" };
  const legacy = TrainingPlanner.normalizeTraining({ review: {}, session: { status: "completed", review: sessionReview } });
  assert.equal(legacy.review.status, "done");
  assert.equal(legacy.review.continua, "Apoio após passe");
  const planPending = TrainingPlanner.normalizeTraining({ review: { status: "pending" }, session: { status: "completed", review: sessionReview } });
  assert.equal(planPending.review.status, "pending");
});

test("snapshot do exercício congela conteúdo e só guarda referência segura da imagem", () => {
  const exercise = {
    sync_id: "exercise-uuid",
    nome: "Passe e apoio",
    external_key: "exercise-passe-apoio",
    montagem: "Quatro cones",
    passos: ["Passar", "Apoiar"],
    visual_storage_path: "team/exercise-images/exercise-uuid/original.png",
    visual_image: { sha256: "a".repeat(64), width: 1448, height: 1086, bytes: 1234 },
    visual_url: "https://example.test/original.png?token=temporary",
    visual_data_url: "data:image/png;base64,AA==",
  };
  const snapshot = TrainingPlanner.exerciseSnapshot(exercise);
  exercise.passos[0] = "Alterado";
  exercise.visual_image.width = 1;

  assert.equal(snapshot.schema, "vision-coach-exercise-snapshot@1");
  assert.deepEqual(snapshot.passos, ["Passar", "Apoiar"]);
  assert.deepEqual(snapshot.visual, {
    external_key: "exercise-passe-apoio",
    removed: false,
    storage_path: "team/exercise-images/exercise-uuid/original.png",
    image: { sha256: "a".repeat(64), width: 1448, height: 1086, bytes: 1234 },
    url: null,
  });
  const fromSnapshot = TrainingPlanner.exerciseFromSnapshot(snapshot, "exercise-uuid");
  assert.equal(fromSnapshot.visual_storage_path, exercise.visual_storage_path);
  assert.deepEqual(fromSnapshot.passos, ["Passar", "Apoiar"]);
});
