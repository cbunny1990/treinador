"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  construirCiclosAprendizagem,
  proximoPassoMemoria,
  prepararLigacaoSeguinte,
} = require("../js/head_coach_cycle.js");

function item(id, kind, links = {}) {
  return { id, kind, title: kind + " " + id, content: kind, status: "active", occurred_at: "2026-09-" + String(10 + id), ...links };
}

test("reconstrói ciclo completo observação até resultado", () => {
  const memory = [
    item(1, "observation"),
    item(2, "diagnosis", { evidence_ids: [1] }),
    item(3, "decision", { related_ids: [2] }),
    item(4, "intervention", { related_ids: [3] }),
    item(5, "result", { related_ids: [4] }),
  ];
  const cycles = construirCiclosAprendizagem(memory);
  assert.equal(cycles.completed.length, 1);
  assert.equal(cycles.open.length, 0);
  assert.equal(cycles.completed[0].complete, true);
  assert.equal(cycles.completed[0].diagnosis.id, 2);
  assert.equal(cycles.completed[0].intervention.id, 4);
});

test("deteta intervenção ainda por medir", () => {
  const memory = [item(1, "diagnosis", { evidence_ids: [9] }), item(2, "decision", { related_ids: [1] }), item(3, "intervention", { related_ids: [2] })];
  const cycles = construirCiclosAprendizagem(memory);
  assert.equal(cycles.open.length, 1);
  assert.equal(cycles.open[0].intervention.id, 3);
});

test("prepara o passo seguinte sem perder associação", () => {
  const seed = item(7, "observation", { subject_refs: [{ type: "match", id: "4", relation: "about" }] });
  assert.equal(proximoPassoMemoria("observation"), "diagnosis");
  const next = prepararLigacaoSeguinte(seed, "diagnosis");
  assert.deepEqual(next.evidence_ids, [7]);
  assert.equal(next.subject_refs[0].type, "match");
  assert.equal(next.chain_root_id, 7);
});
