const test = require("node:test");
const assert = require("node:assert/strict");
const evaluation = import("../scripts/evaluate-typesafe-cross-session.mjs");

test("TypeSafe cross-session evaluation is synthetic, bounded and asks one Noul per case", async () => {
  const { buildCrossSessionEvaluationRequest, CROSS_SESSION_EVAL_CASES } = await evaluation;
  const request = buildCrossSessionEvaluationRequest();
  assert.equal(request.model, "jev-latest");
  assert.equal(request.state.contains_real_team_data, false);
  assert.equal(Object.keys(request.questions).length, CROSS_SESSION_EVAL_CASES.length);
  assert.ok(CROSS_SESSION_EVAL_CASES.some((item) => item.id === "planned_is_not_completed"));
  assert.ok(CROSS_SESSION_EVAL_CASES.some((item) => item.id === "work_is_not_proof_of_improvement"));
  for (const item of CROSS_SESSION_EVAL_CASES) {
    assert.equal(request.questions[item.id].type, "noul");
    assert.ok(item.claim && item.match_evidence.length >= 1 && item.training_evidence);
    assert.ok(["yes", "no"].includes(item.expected));
  }
});

test("provider evaluation refuses a missing key before making any network call", async () => {
  const { runCrossSessionEvaluation } = await evaluation;
  let calls = 0;
  await assert.rejects(runCrossSessionEvaluation({ apiKey: "", fetchImpl: async () => { calls++; } }), /nenhuma chamada externa foi feita/);
  assert.equal(calls, 0);
});

test("provider evaluation validates Noul answers and reports synthetic agreement for coach review", async () => {
  const { CROSS_SESSION_EVAL_CASES, runCrossSessionEvaluation } = await evaluation;
  let request;
  const fetchImpl = async (_url, options) => {
    request = JSON.parse(options.body);
    return { ok: true, async json() { return { model: "jev-test", usage: { input_tokens: 10 }, answers: Object.fromEntries(CROSS_SESSION_EVAL_CASES.map((item) => [item.id, { type: "noul", noul: item.expected === "yes" ? 0.9 : 0.1 }])) }; } };
  };
  const result = await runCrossSessionEvaluation({ apiKey: "test-secret", fetchImpl });
  assert.equal(request.state.contains_real_team_data, false);
  assert.equal(result.evaluation_status, "synthetic_initial_set_not_coach_reviewed");
  assert.equal(result.coach_review_required, true);
  assert.equal(result.threshold_agreement, 1);
  assert.equal(result.cases.length, CROSS_SESSION_EVAL_CASES.length);
  await assert.rejects(runCrossSessionEvaluation({ apiKey: "test-secret", fetchImpl: async () => ({ ok: true, async json() { return { answers: {} }; } }) }), /Resposta Noul inválida/);
});
