"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  selecionarContextoHeadCoach,
  normalizarRespostaHeadCoach,
  validarRespostaContraContexto,
  construirPromptHeadCoach,
} = require("../js/head_coach_chat.js");

test("seleciona primeiro memória relevante e prioridades explícitas", () => {
  const context = { schema: "head-coach-context@1", memory: [
    { id: 1, kind: "observation", title: "Finalização", content: "Remates", metadata: {} },
    { id: 2, kind: "decision", title: "Saída de bola", content: "Apoios ao guarda-redes", metadata: { priority: 1 } },
  ] };
  const selected = selecionarContextoHeadCoach(context, "Como melhorar a saída de bola?", 1);
  assert.equal(selected.memory[0].id, 2);
});

test("normaliza a estrutura e limita recomendações", () => {
  const response = normalizarRespostaHeadCoach({
    summary: "Plano", claims: [{ kind: "observation", text: "Há pouca largura.", evidence_ids: [1, 1] }],
    recommendations: Array.from({ length: 7 }, (_, i) => ({ action: `Ação ${i}`, evidence_ids: [1] })),
  });
  assert.deepEqual(response.claims[0].evidence_ids, [1]);
  assert.equal(response.recommendations.length, 5);
});

test("remove referências inventadas e rebaixa diagnóstico sem evidência", () => {
  const normalized = normalizarRespostaHeadCoach({
    summary: "Análise",
    claims: [{ kind: "diagnosis", text: "Problema estrutural.", evidence_ids: [999] }],
    recommendations: [{ action: "Treinar apoios.", evidence_ids: [1, 999] }],
  });
  const validated = validarRespostaContraContexto(normalized, { memory: [{ id: 1 }] });
  assert.equal(validated.claims[0].kind, "hypothesis");
  assert.deepEqual(validated.claims[0].evidence_ids, []);
  assert.deepEqual(validated.recommendations[0].evidence_ids, [1]);
  assert.match(validated.uncertainties[0], /sem evidência válida/);
});

test("prompt proíbe invenções e exige JSON", () => {
  const prompt = construirPromptHeadCoach("O que priorizar?", { memory: [] });
  assert.match(prompt.system, /Nunca inventes/);
  assert.match(prompt.system, /JSON válido/);
  assert.match(prompt.user, /O que priorizar/);
});
