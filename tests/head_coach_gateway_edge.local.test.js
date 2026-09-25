"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { createClient } = require("@supabase/supabase-js");

const endpoint = process.env.VISION_COACH_GATEWAY_LOCAL_HTTP_URL || "";
const supabaseUrl = process.env.VISION_COACH_GATEWAY_LOCAL_SUPABASE_URL || "";
const serviceKey = process.env.VISION_COACH_GATEWAY_LOCAL_SERVICE_KEY || "";
const anonKey = process.env.VISION_COACH_GATEWAY_LOCAL_ANON_KEY || "";
const configured = !!(endpoint && supabaseUrl && serviceKey && anonKey);
const localHost = (value) => ["localhost", "127.0.0.1", "::1"].includes(new URL(value).hostname);
const teamId = "12345678-1234-4234-8234-123456789abc";
const uuid = () => crypto.randomUUID();

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

test("Edge Gateway persists a scoped game-model create/update and rejects stale revision", {
  skip: !configured && "requer Edge Gateway, PostgREST e chaves sintéticas da stack Supabase local; nunca usa produção",
  timeout: 30_000,
}, async () => {
  assert.ok(localHost(endpoint), "Este teste aceita apenas Edge Gateway localhost.");
  assert.ok(localHost(supabaseUrl), "Este teste aceita apenas PostgREST localhost.");
  const admin = createClient(supabaseUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
  let userId = null;
  let createdTeamId = null;
  try {
    const user = await admin.auth.admin.createUser({
      email: `gateway-local-${uuid()}@vision-coach.local`,
      password: crypto.randomBytes(24).toString("base64url"),
      email_confirm: true,
    });
    assert.ifError(user.error);
    userId = user.data.user.id;

    const team = await admin.from("teams").insert({ owner_id: userId, name: "Gateway local synthetic" }).select("id").single();
    assert.ifError(team.error);
    createdTeamId = team.data.id;

    const authorization = await admin.from("agent_authorizations").insert({
      team_id: createdTeamId, owner_id: userId, agent_subject: "head-coach", scopes: ["read", "write"], enabled: true,
    });
    assert.ifError(authorization.error);

    const first = await gatewayRequest(serviceKey, {
      operation: "put_record", team_id: createdTeamId,
      params: {
        kind: "game_model", payload: { title: "Modelo sintético", principles: ["Apoio após passe"] },
        confirmed: true, idempotency_key: `gateway-local:${uuid()}`,
      },
    });
    assert.equal(first.status, 200, await first.clone().text());
    const created = (await first.json()).data;
    assert.equal(created.kind, "game_model");
    assert.equal(created.actor_type, "agent");
    assert.equal(created.payload.title, "Modelo sintético");

    const update = await gatewayRequest(serviceKey, {
      operation: "put_record", team_id: createdTeamId,
      params: {
        kind: "game_model", payload: { title: "Modelo sintético revisto", principles: ["Apoio e largura"] },
        record_id: created.id, expected_updated_at: created.updated_at, confirmed: true,
        idempotency_key: `gateway-local:${uuid()}`,
      },
    });
    assert.equal(update.status, 200, await update.clone().text());
    const updated = (await update.json()).data;
    assert.equal(updated.id, created.id);
    assert.equal(updated.payload.title, "Modelo sintético revisto");

    const stale = await gatewayRequest(serviceKey, {
      operation: "put_record", team_id: createdTeamId,
      params: {
        kind: "game_model", payload: { title: "Não deve sobrescrever" },
        record_id: created.id, expected_updated_at: created.updated_at, confirmed: true,
        idempotency_key: `gateway-local:${uuid()}`,
      },
    });
    assert.equal(stale.status, 400, await stale.clone().text());
    assert.match((await stale.json()).error, /record_conflict/);

    const stored = await admin.from("workspace_records").select("id,payload,actor_type").eq("team_id", createdTeamId).eq("kind", "game_model");
    assert.ifError(stored.error);
    assert.equal(stored.data.length, 1);
    assert.equal(stored.data[0].payload.title, "Modelo sintético revisto");
  } finally {
    if (createdTeamId) {
      const removedTeam = await admin.from("teams").delete().eq("id", createdTeamId);
      assert.ifError(removedTeam.error);
    }
    if (userId) {
      const removedUser = await admin.auth.admin.deleteUser(userId);
      assert.ifError(removedUser.error);
    }
  }
});
