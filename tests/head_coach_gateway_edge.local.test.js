"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const endpoint = process.env.VISION_COACH_GATEWAY_LOCAL_HTTP_URL || "";
const serviceKey = process.env.VISION_COACH_GATEWAY_LOCAL_SERVICE_KEY || "";
const anonKey = process.env.VISION_COACH_GATEWAY_LOCAL_ANON_KEY || "";
const configured = !!(endpoint && serviceKey && anonKey);
const localHost = (value) => ["localhost", "127.0.0.1", "::1"].includes(new URL(value).hostname);
const teamId = "12345678-1234-4234-8234-123456789abc";

async function gatewayRequest(key, body) {
  return fetch(endpoint, {
    method: "POST",
    headers: {
      apikey: anonKey,
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
}

test("Edge Gateway runtime enforces service role and semantic-write confirmation locally", {
  skip: !configured && "requer Edge Gateway e chaves sintéticas da stack Supabase local; nunca usa produção",
  timeout: 30_000,
}, async () => {
  assert.ok(localHost(endpoint), "Este teste aceita apenas endpoint localhost.");

  const ordinaryUser = await gatewayRequest(anonKey, {
    operation: "capabilities", team_id: teamId,
  });
  assert.equal(ordinaryUser.status, 403, await ordinaryUser.clone().text());
  assert.equal((await ordinaryUser.json()).error, "service_role_required");

  for (const kind of ["player", "match", "training", "exercise", "memory", "document"]) {
    const blocked = await gatewayRequest(serviceKey, {
      operation: "put_record", team_id: teamId,
      params: { kind, payload: { title: "Synthetic" }, confirmed: true },
    });
    assert.equal(blocked.status, 400, await blocked.clone().text());
    assert.equal((await blocked.json()).error, "use_semantic_operation_for_record_kind");
  }

  const needsConfirmation = await gatewayRequest(serviceKey, {
    operation: "put_record", team_id: teamId,
    params: { kind: "game_model", payload: { title: "Synthetic" } },
  });
  assert.equal(needsConfirmation.status, 400, await needsConfirmation.clone().text());
  assert.equal((await needsConfirmation.json()).error, "explicit_confirmation_required");

  const needsRevision = await gatewayRequest(serviceKey, {
    operation: "put_record", team_id: teamId,
    params: { kind: "game_model", payload: { title: "Synthetic" }, confirmed: true, record_id: teamId },
  });
  assert.equal(needsRevision.status, 400, await needsRevision.clone().text());
  assert.equal((await needsRevision.json()).error, "expected_updated_at_required");
});
