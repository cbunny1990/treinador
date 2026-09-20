"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizarMemoryItem, normalizarTeam, validarPacoteEquipa } = require("../js/head_coach_memory.js");

test("texto do treinador começa como observação com proveniência", () => {
  const item = normalizarMemoryItem({ content: "A equipa juntou-se ao guarda-redes." }, { now: "2026-09-20T10:00:00.000Z" });
  assert.equal(item.kind, "observation");
  assert.equal(item.source.type, "coach");
  assert.equal(item.source.label, "Treinador");
});

test("diagnóstico sem evidência é recusado", () => {
  assert.throws(() => normalizarMemoryItem({ kind: "diagnosis", content: "Saída sob pressão." }), /evidência/);
});

test("intervenção e resultado exigem cadeia anterior", () => {
  assert.throws(() => normalizarMemoryItem({ kind: "intervention", content: "Exercício 3x2." }), /registo anterior/);
  assert.doesNotThrow(() => normalizarMemoryItem({ kind: "result", content: "Seis em dez.", related_ids: [4] }));
});

test("normalização remove ids inválidos e duplicados", () => {
  const item = normalizarMemoryItem({ content: "Teste", evidence_ids: [1, "1", 0, "x", 2] });
  assert.deepEqual(item.evidence_ids, [1, 2]);
});

test("pacote privado valida schema e propaga team_id", () => {
  const p = validarPacoteEquipa({
    schema: "treinador-team-memory@1",
    team: { id: "equipa-1", nome: "Equipa" },
    memory_items: [{ content: "Observação" }],
  });
  assert.equal(p.team.id, "equipa-1");
  assert.equal(p.memoryItems[0].team_id, "equipa-1");
  assert.throws(() => validarPacoteEquipa({ schema: "outro", team: {} }), /Formato inválido/);
});

test("perfil da equipa preserva campos offline essenciais", () => {
  const team = normalizarTeam({ id: "t", nome: "Sub-8", formato: "5v5", horarios: { texto: "Segunda" } });
  assert.equal(team.formato, "5v5");
  assert.equal(team.horarios.texto, "Segunda");
});
