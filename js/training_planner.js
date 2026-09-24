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

function tpExerciseSnapshot(exercise) {
  const row = tpNormalizeExercise(exercise);
  const image = row.visual_image && typeof row.visual_image === "object" ? {
    sha256: String(row.visual_image.sha256 || ""),
    width: Number(row.visual_image.width || 0) || null,
    height: Number(row.visual_image.height || 0) || null,
    bytes: Number(row.visual_image.bytes || 0) || null,
  } : null;
  const visualUrl = /^assets\/exercises\/[a-z0-9_./-]+$/i.test(String(row.visual_url || "")) && !String(row.visual_url).includes("..")
    ? String(row.visual_url) : null;
  return {
    schema: "vision-coach-exercise-snapshot@1",
    exercise_ref: tpExerciseRef(row),
    nome: row.nome,
    objetivo: row.objetivo,
    montagem: String(row.montagem || row.organizacao || ""),
    passos: tpArray(row.passos).map(String),
    organizacao: row.organizacao,
    espaco: row.espaco,
    material: tpArray(row.material).map(String),
    regras: tpArray(row.regras).map(String),
    coaching_points: tpArray(row.coaching_points).map(String),
    visual: {
      external_key: row.external_key || null,
      removed: Boolean(row.visual_removed),
      storage_path: row.visual_storage_path || null,
      image,
      url: visualUrl,
    },
  };
}

function tpExerciseFromSnapshot(snapshot, exerciseRef, fallbackName) {
  if (!snapshot || typeof snapshot !== "object") return null;
  const visual = snapshot.visual && typeof snapshot.visual === "object" ? snapshot.visual : {};
  return {
    sync_id: String(exerciseRef || snapshot.exercise_ref || ""),
    external_key: visual.external_key || null,
    nome: snapshot.nome || fallbackName || "Exercício",
    objetivo: snapshot.objetivo || "",
    montagem: snapshot.montagem || snapshot.organizacao || "",
    passos: tpArray(snapshot.passos).map(String),
    organizacao: snapshot.organizacao || "",
    espaco: snapshot.espaco || "",
    material: tpArray(snapshot.material).map(String),
    regras: tpArray(snapshot.regras).map(String),
    coaching_points: tpArray(snapshot.coaching_points).map(String),
    visual_removed: Boolean(visual.removed),
    visual_storage_path: visual.storage_path || null,
    visual_image: visual.image || null,
    visual_url: visual.url || null,
  };
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
  const planReview = row.review && typeof row.review === "object" ? row.review : null;
  const sessionReview = row.session?.review && typeof row.session.review === "object" ? row.session.review : null;
  const selectedReview = typeof planReview?.status === "string" && planReview.status.trim()
    ? planReview
    : (typeof sessionReview?.status === "string" && sessionReview.status.trim() ? sessionReview : planReview || sessionReview);
  row.review = {
    status: "pending",
    melhorou: null,
    continua: null,
    proxima_acao: null,
    conclusao: null,
    ...(selectedReview || {})
  };
  return row;
}

const TrainingPlanner = {
  slug: tpSlug,
  exerciseRef: tpExerciseRef,
  exerciseSnapshot: tpExerciseSnapshot,
  exerciseFromSnapshot: tpExerciseFromSnapshot,
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
