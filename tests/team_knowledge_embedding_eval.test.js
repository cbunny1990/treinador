const test = require("node:test");
const assert = require("node:assert/strict");
const evaluation = import("../scripts/evaluate-team-knowledge-embeddings.mjs");

test("embedding evaluation cases are synthetic and keep one relevant passage per query", async () => {
  const { TEAM_KNOWLEDGE_EVAL_CASES, buildEmbeddingEvaluationInputs } = await evaluation;
  const inputs = buildEmbeddingEvaluationInputs();
  assert.equal(TEAM_KNOWLEDGE_EVAL_CASES.length, 4);
  assert.equal(inputs.length, 16);
  for (const item of TEAM_KNOWLEDGE_EVAL_CASES) {
    assert.ok(item.documents.some((document) => document.id === item.relevant_id));
    assert.ok(item.documents.length >= 3);
  }
  assert.doesNotMatch(JSON.stringify(inputs), /UUID|nome do atleta|equipa real/i);
});

test("embedding evaluation refuses missing provider key before calling the adapter", async () => {
  const { runTeamKnowledgeEmbeddingEvaluation } = await evaluation;
  let calls = 0;
  await assert.rejects(runTeamKnowledgeEmbeddingEvaluation({ apiKey: "", embedImpl: async () => { calls++; } }), /nenhuma chamada externa foi feita/);
  assert.equal(calls, 0);
});

test("embedding evaluation ranks fixture vectors and reports top-1 and MRR for coach review", async () => {
  const { TEAM_KNOWLEDGE_EVAL_CASES, buildEmbeddingEvaluationInputs, evaluateEmbeddingVectors, runTeamKnowledgeEmbeddingEvaluation } = await evaluation;
  const vectors = new Map();
  for (const item of TEAM_KNOWLEDGE_EVAL_CASES) {
    vectors.set(`${item.id}:query`, [1, 0, 0]);
    item.documents.forEach((document, index) => vectors.set(`${item.id}:${document.id}`, document.id === item.relevant_id ? [1, 0, 0] : [0, index + 1, 0]));
  }
  const scores = evaluateEmbeddingVectors(TEAM_KNOWLEDGE_EVAL_CASES, vectors);
  assert.equal(scores.top_1_accuracy, 1);
  assert.equal(scores.mean_reciprocal_rank, 1);
  assert.equal(scores.evaluation_status, "synthetic_initial_set_not_coach_reviewed");
  let sent;
  const result = await runTeamKnowledgeEmbeddingEvaluation({ apiKey: "test-secret", embedImpl: async (texts, options) => {
    sent = { texts, options };
    return buildEmbeddingEvaluationInputs().map((item) => item.id === "query" ? [1, 0, 0] : TEAM_KNOWLEDGE_EVAL_CASES.find((testCase) => testCase.id === item.case_id).relevant_id === item.id ? [1, 0, 0] : [0, 1, 0]);
  } });
  assert.equal(sent.texts.length, 16);
  assert.equal(sent.options.apiKey, "test-secret");
  assert.equal(result.top_1_accuracy, 1);
  assert.equal(result.model, "text-embedding-3-small");
});

test("embedding evaluation rejects invalid or zero vectors", async () => {
  const { TEAM_KNOWLEDGE_EVAL_CASES, evaluateEmbeddingVectors } = await evaluation;
  const vectors = new Map([[`${TEAM_KNOWLEDGE_EVAL_CASES[0].id}:query`, [0, 0, 0]]]);
  for (const item of TEAM_KNOWLEDGE_EVAL_CASES[0].documents) vectors.set(`${TEAM_KNOWLEDGE_EVAL_CASES[0].id}:${item.id}`, [1, 0, 0]);
  assert.throws(() => evaluateEmbeddingVectors([TEAM_KNOWLEDGE_EVAL_CASES[0]], vectors), /Vetor nulo/);
});
