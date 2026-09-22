"use strict";

function tpArray(value) {
  return Array.isArray(value) ? value : [];
}

function tpSlug(value) {
  return String(value || "").normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function tpExerciseRef(exercise) {
  return String(exercise?.sync_id || exercise?.id || "");
}

function tpExerciseExternalKey(name) {
  const slug = tpSlug(name);
  return slug ? "exercise-" + slug : null;
}

function tpNormalizeExercise(input) {
  const row = { ...(input || {}) };
  row.workspace_v2 = row.workspace_v2 !== false;
  row.status = row.status || "active";
  row.nome = String(row.nome || "").trim();
  row.escalao = row.escalao || "Sub-8";
  row.modelo = row.modelo || "5x5-1-2-1";
  row.objetivo = row.objetivo || "";
  row.organizacao = row.organizacao || "";
  row.espaco = row.espaco || "";
  row.series = Number(row.series || 1);
  row.duracao_serie_min = Number(row.duracao_serie_min || 0);
  row.duracao_total_min = Number(row.duracao_total_min || (row.series * row.duracao_serie_min) || 0);
  row.material = tpArray(row.material);
  row.regras = tpArray(row.regras);
  row.coaching_points = tpArray(row.coaching_points);
  row.tags = tpArray(row.tags);
  row.favorito = Boolean(row.favorito);
  row.external_key = row.external_key || tpExerciseExternalKey(row.nome);
  return row;
}

function tpVisionExercises(rows) {
  return tpArray(rows).filter((x) => x && x.workspace_v2 && x.status !== "archived");
}

function tpExerciseSearchText(exercise) {
  const e = tpNormalizeExercise(exercise);
  return [
    e.nome, e.escalao, e.modelo, e.objetivo, e.organizacao,
    e.espaco, ...e.tags
  ].join(" ").toLocaleLowerCase("pt-PT");
}

function tpExerciseMatches(exercise, query, favoritesOnly) {
  if (favoritesOnly && !exercise?.favorito) return false;
  const q = String(query || "").trim().toLocaleLowerCase("pt-PT");
  return !q || tpExerciseSearchText(exercise).includes(q);
}

function tpNormalizeBlock(block, index) {
  const b = { ...(block || {}) };
  return {
    ...b,
    block_id: b.block_id || null,
    exercise_name: b.exercise_name || null,
    order: Number(b.order ?? index ?? 0),
    exercise_ref: String(b.exercise_ref || ""),
    phase: b.phase || "principal",
    duration_min: Math.max(0, Number(b.duration_min || 0)),
    notes: b.notes || null,
  };
}

function tpTrainingDuration(blocks) {
  return tpArray(blocks).reduce((sum, block) => {
    return sum + Math.max(0, Number(block?.duration_min || 0));
  }, 0);
}

function tpNormalizeTraining(input) {
  const row = { ...(input || {}) };
  row.status = row.status || "draft";
  row.blocos = tpArray(row.blocos).map(tpNormalizeBlock)
    .sort((a, b) => a.order - b.order);
  row.duracao_min = tpTrainingDuration(row.blocos);
  row.objetivo = row.objetivo || "";
  row.notas = row.notas || null;
  row.source_match_ref = row.source_match_ref || null;
  row.review = {
    status: "pending",
    melhorou: null,
    continua: null,
    proxima_acao: null,
    conclusao: null,
    ...((row.review && typeof row.review === "object") ? row.review : {})
  };
  return row;
}

const TrainingPlanner = {
  slug: tpSlug,
  exerciseRef: tpExerciseRef,
  exerciseExternalKey: tpExerciseExternalKey,
  normalizeExercise: tpNormalizeExercise,
  visionExercises: tpVisionExercises,
  exerciseMatches: tpExerciseMatches,
  normalizeBlock: tpNormalizeBlock,
  trainingDuration: tpTrainingDuration,
  normalizeTraining: tpNormalizeTraining,
};

if (typeof globalThis !== "undefined") globalThis.TrainingPlanner = TrainingPlanner;
if (typeof module !== "undefined" && module.exports) module.exports = TrainingPlanner;
