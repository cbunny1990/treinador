const test = require("node:test");
const assert = require("node:assert/strict");
const evaluation = import("../scripts/evaluate-team-knowledge-embeddings.mjs");

test("embedding evaluation spans twelve synthetic domains and supports multiple relevant passages", async () => {
  const { TEAM_KNOWLEDGE_EVAL_CASES, buildEmbeddingEvaluationInputs } = await evaluation;
  const inputs = buildEmbeddingEvaluationInputs();
  assert.equal(TEAM_KNOWLEDGE_EVAL_CASES.length, 12);
  assert.equal(inputs.length, 60);
  assert.equal(new Set(TEAM_KNOWLEDGE_EVAL_CASES.map((item) => item.domain)).size, 9);
  for (const item of TEAM_KNOWLEDGE_EVAL_CASES) {
    assert.ok(Object.keys(item.relevance).length >= 1);
    assert.ok(Object.entries(item.relevance).every(([id, grade]) => item.documents.some((document) => document.id === id) && grade >= 1 && grade <= 2));
    assert.equal(item.documents.length, 4);
  }
  assert.doesNotMatch(JSON.stringify(inputs), /UUID|nome do atleta|equipa real|nota de saúde|diagnóstico médico/i);
});

test("embedding evaluation refuses missing provider key before calling the adapter", async () => {
  const { runTeamKnowledgeEmbeddingEvaluation } = await evaluation;
  let calls = 0;
  await assert.rejects(runTeamKnowledgeEmbeddingEvaluation({ apiKey: "", embedImpl: async () => { calls++; } }), /nenhuma chamada externa foi feita/);
  assert.equal(calls, 0);
});

test("embedding evaluation ranks fixture vectors and reports top-1, MRR, recall and nDCG for coach review", async () => {
  const { TEAM_KNOWLEDGE_EVAL_CASES, buildEmbeddingEvaluationInputs, evaluateEmbeddingVectors, runTeamKnowledgeEmbeddingEvaluation } = await evaluation;
  const vectors = new Map();
  for (const item of TEAM_KNOWLEDGE_EVAL_CASES) {
    vectors.set(`${item.id}:query`, [1, 0, 0]);
    item.documents.forEach((document, index) => vectors.set(`${item.id}:${document.id}`, item.relevance[document.id] === 2 ? [1, 0, 0] : item.relevance[document.id] === 1 ? [0.9, 0.1, 0] : [0, index + 1, 0]));
  }
  const scores = evaluateEmbeddingVectors(TEAM_KNOWLEDGE_EVAL_CASES, vectors);
  assert.equal(scores.top_1_accuracy, 1);
  assert.equal(scores.mean_reciprocal_rank, 1);
  assert.equal(scores.mean_recall_at_3, 1);
  assert.equal(scores.mean_ndcg_at_3, 1);
  assert.equal(scores.evaluation_status, "synthetic_expanded_set_not_coach_reviewed");
  let sent;
  const result = await runTeamKnowledgeEmbeddingEvaluation({ apiKey: "test-secret", embedImpl: async (texts, options) => {
    sent = { texts, options };
    return buildEmbeddingEvaluationInputs().map((item) => { const testCase = TEAM_KNOWLEDGE_EVAL_CASES.find((candidate) => candidate.id === item.case_id); return item.id === "query" ? [1, 0, 0] : testCase.relevance[item.id] === 2 ? [1, 0, 0] : testCase.relevance[item.id] === 1 ? [0.9, 0.1, 0] : [0, 1, 0]; });
  } });
  assert.equal(sent.texts.length, 60);
  assert.equal(sent.options.apiKey, "test-secret");
  assert.equal(result.top_1_accuracy, 1);
  assert.equal(result.mean_recall_at_3, 1);
  assert.equal(result.mean_ndcg_at_3, 1);
  assert.equal(result.model, "text-embedding-3-small");
});

test("embedding evaluation counts multiple relevant passages instead of treating an alternative as a miss", async () => {
  const { evaluateEmbeddingVectors } = await evaluation;
  const cases = [{ id: "multi", relevance: { strong: 2, supporting: 1 }, documents: [{ id: "distractor" }, { id: "strong" }, { id: "supporting" }, { id: "other" }] }];
  const vectors = new Map([["multi:query", [1, 0, 0]], ["multi:distractor", [1, 0, 0]], ["multi:strong", [0.9, 0.1, 0]], ["multi:supporting", [0.8, 0.2, 0]], ["multi:other", [0, 1, 0]]]);
  const scores = evaluateEmbeddingVectors(cases, vectors);
  assert.equal(scores.top_1_accuracy, 0);
  assert.equal(scores.mean_reciprocal_rank, 0.5);
  assert.equal(scores.cases[0].recall_at_3, 1);
  assert.ok(scores.cases[0].ndcg_at_3 > 0.5 && scores.cases[0].ndcg_at_3 < 1);
});

test("embedding evaluation rejects invalid or zero vectors", async () => {
  const { TEAM_KNOWLEDGE_EVAL_CASES, evaluateEmbeddingVectors } = await evaluation;
  const vectors = new Map([[`${TEAM_KNOWLEDGE_EVAL_CASES[0].id}:query`, [0, 0, 0]]]);
  for (const item of TEAM_KNOWLEDGE_EVAL_CASES[0].documents) vectors.set(`${TEAM_KNOWLEDGE_EVAL_CASES[0].id}:${item.id}`, [1, 0, 0]);
  assert.throws(() => evaluateEmbeddingVectors([TEAM_KNOWLEDGE_EVAL_CASES[0]], vectors), /Vetor nulo/);
});
