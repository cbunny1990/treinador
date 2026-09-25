"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const TEAM = "12345678-1234-4234-8234-123456789abc";
const jwtFor = (role) => `header.${Buffer.from(JSON.stringify({ role })).toString("base64url")}.signature`;

async function setup() {
  const { createGatewayHandler } = await import("../supabase/functions/head-coach-gateway/handler.mjs");
  const rpcCalls = [];
  let clientCreates = 0;
  const admin = {
    async rpc(name, args) {
      rpcCalls.push({ name, args });
      return { data: { accepted: true }, error: null };
    },
  };
  const handler = createGatewayHandler({
    env: { get: (name) => ({ SUPABASE_URL: "http://127.0.0.1:54321", SUPABASE_SERVICE_ROLE_KEY: "synthetic-local-key" })[name] },
    createClient(url, key) {
      clientCreates++;
      assert.equal(url, "http://127.0.0.1:54321");
      assert.equal(key, "synthetic-local-key");
      return admin;
    },
  });
  async function request(body, role = "service_role") {
    const response = await handler(new Request("http://127.0.0.1/functions/v1/head-coach-gateway", {
      method: "POST",
      headers: { authorization: `Bearer ${jwtFor(role)}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    }));
    return { response, body: await response.json() };
  }
  return { request, rpcCalls, get clientCreates() { return clientCreates; } };
}

test("HTTP handler rejects ordinary authenticated JWT before creating service client", async () => {
  const f = await setup();
  const result = await f.request({ operation: "capabilities", team_id: TEAM }, "authenticated");
  assert.equal(result.response.status, 403);
  assert.equal(result.body.error, "service_role_required");
  assert.equal(f.clientCreates, 0);
  assert.equal(f.rpcCalls.length, 0);
});

test("HTTP handler rejects generic writes for semantic record kinds before RPC", async () => {
  const f = await setup();
  for (const kind of ["player", "match", "training", "exercise", "memory", "document"]) {
    const result = await f.request({
      operation: "put_record", team_id: TEAM,
      params: { kind, payload: { title: "Synthetic" }, confirmed: true },
    });
    assert.equal(result.response.status, 400);
    assert.equal(result.body.error, "use_semantic_operation_for_record_kind");
  }
  assert.equal(f.clientCreates, 6);
  assert.equal(f.rpcCalls.length, 0);
});

test("HTTP handler requires confirmation and current version before generic update", async () => {
  const f = await setup();
  const denied = await f.request({
    operation: "put_record", team_id: TEAM,
    params: { kind: "game_model", payload: {}, record_id: "record-1" },
  });
  assert.equal(denied.response.status, 400);
  assert.equal(denied.body.error, "explicit_confirmation_required");

  const staleGuard = await f.request({
    operation: "put_record", team_id: TEAM,
    params: { kind: "game_model", payload: {}, record_id: "record-1", confirmed: true },
  });
  assert.equal(staleGuard.response.status, 400);
  assert.equal(staleGuard.body.error, "expected_updated_at_required");
  assert.equal(f.rpcCalls.length, 0);
});

test("HTTP handler permits confirmed game-model write with the expected revision", async () => {
  const f = await setup();
  const result = await f.request({
    operation: "put_record", team_id: TEAM, agent_subject: "head-coach",
    params: {
      kind: "game_model", payload: { title: "Modelo fictício" }, record_id: "record-1",
      expected_updated_at: "revision-1", idempotency_key: "synthetic-key", confirmed: true,
    },
  });
  assert.equal(result.response.status, 200);
  assert.deepEqual(result.body.data, { accepted: true });
  assert.equal(f.rpcCalls.length, 1);
  assert.equal(f.rpcCalls[0].name, "head_coach_put_record");
  assert.equal(f.rpcCalls[0].args.p_kind, "game_model");
  assert.equal(f.rpcCalls[0].args.p_expected_updated_at, "revision-1");
  assert.equal(f.rpcCalls[0].args.p_team_id, TEAM);
});
