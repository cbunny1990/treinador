"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { createClient } = require("@supabase/supabase-js");

const supabaseUrl = process.env.VISION_COACH_SUPABASE_LOCAL_URL || "";
const serviceKey = process.env.VISION_COACH_SUPABASE_LOCAL_SERVICE_KEY || "";
const mcpUrl = process.env.VISION_COACH_MCP_LOCAL_HTTP_URL || "";
const configured = !!(supabaseUrl && serviceKey && mcpUrl);
const localHost = (value) => ["localhost", "127.0.0.1", "::1"].includes(new URL(value).hostname);
const uuid = () => crypto.randomUUID();

async function mcpRequest(token, method, params = {}) {
  return fetch(mcpUrl, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: uuid(), method, params }),
    signal: AbortSignal.timeout(10_000),
  });
}

test("MCP HTTP expõe RAG e declara provider ausente sem enviar texto externo", {
  skip: !configured && "requer Edge Function local e Supabase local; nunca usar endpoint ou credenciais de produção",
  timeout: 30_000,
}, async () => {
  assert.ok(localHost(supabaseUrl), "Este teste aceita apenas Supabase em localhost.");
  assert.ok(localHost(mcpUrl), "Este teste aceita apenas MCP HTTP em localhost.");
  const admin = createClient(supabaseUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const users = [];
  const teams = [];
  try {
    const email = `rag-http-${uuid()}@vision-coach.local`;
    const createdUser = await admin.auth.admin.createUser({
      email, password: crypto.randomBytes(24).toString("base64url"), email_confirm: true,
    });
    assert.ifError(createdUser.error);
    users.push(createdUser.data.user.id);

    const createdTeam = await admin.from("teams").insert({
      owner_id: createdUser.data.user.id, name: "RAG HTTP local",
      metadata: { escalao: "Sub-8" },
    }).select("id").single();
    assert.ifError(createdTeam.error);
    teams.push(createdTeam.data.id);

    const matchDates = ["2026-09-01", "2026-09-05", "2026-09-10", "2026-09-17", "2026-09-20", "2026-09-22"];
    const matchIds = [...matchDates.map(() => uuid()), uuid()];
    const seededMatches = await admin.from("workspace_records").insert([
      ...matchDates.map((date, index) => ({
        id: matchIds[index], team_id: teams[0], kind: "match", actor_type: "human",
        payload: { data: date, estado: "concluido", adversario: `Adversário local ${index + 1}` },
      })),
      { id: matchIds[6], team_id: teams[0], kind: "match", actor_type: "human", payload: { estado: "concluido", adversario: "Jogo local sem data" } },
    ]);
    assert.ifError(seededMatches.error);

    const token = `vcmcp_${crypto.randomBytes(32).toString("base64url")}`;
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    const connector = await admin.rpc("mcp_connector_create", {
      p_team_id: teams[0], p_owner_id: users[0], p_token_hash: tokenHash,
      p_token_prefix: "vcmcp_http001", p_label: "RAG HTTP local",
      p_scopes: ["read"], p_expires_at: null,
    });
    assert.ifError(connector.error);

    const initialize = await mcpRequest(token, "initialize", {
      protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "local-test", version: "1" },
    });
    assert.equal(initialize.status, 200, await initialize.clone().text());
    const initialized = await initialize.json();
    assert.equal(initialized.result.serverInfo.version, "1.14.2");
    assert.match(initialized.result.instructions, /get_training_planning_context/);
    assert.match(initialized.result.instructions, /get_recent_match_context/);
    assert.match(initialized.result.instructions, /evidence is insufficient/);

    const listed = await mcpRequest(token, "tools/list");
    assert.equal(listed.status, 200);
    const tools = (await listed.json()).result.tools;
    assert.ok(tools.some((tool) => tool.name === "search_team_knowledge"));
    assert.ok(tools.some((tool) => tool.name === "get_training_planning_context"));
    assert.ok(tools.some((tool) => tool.name === "reindex_team_knowledge"));
    assert.equal(tools.find((tool) => tool.name === "search_team_knowledge").inputSchema.properties.match_refs.maxItems, 10);
    assert.equal(tools.find((tool) => tool.name === "search_team_knowledge").inputSchema.properties.per_match_limit.maximum, 4);

    const recentMatches = await mcpRequest(token, "tools/call", {
      name: "list_matches", arguments: { state: "concluido", date_order: "desc", limit: 5 },
    });
    assert.equal(recentMatches.status, 200);
    const recentResult = JSON.parse((await recentMatches.json()).result.content[0].text);
    assert.deepEqual(recentResult.map((row) => row.payload.data), ["2026-09-22", "2026-09-20", "2026-09-17", "2026-09-10", "2026-09-05"]);

    const search = await mcpRequest(token, "tools/call", {
      name: "search_team_knowledge", arguments: { query: "problemas nos jogos recentes", match_refs: recentResult.map((row) => row.id) },
    });
    assert.equal(search.status, 200);
    const result = JSON.parse((await search.json()).result.content[0].text);
    assert.equal(result.retrieval_status, "provider_not_configured");
    assert.equal(result.answer_mode, "not_generated");
    assert.deepEqual(result.results, []);
    assert.match(result.message, /Não foi enviada informação da equipa a nenhum provider/);

    const hybridContext = await mcpRequest(token, "tools/call", {
      name: "get_training_planning_context", arguments: { target_date: "2026-09-24", question: "O que correu mal nos jogos recentes?" },
    });
    assert.equal(hybridContext.status, 200);
    const planningContext = JSON.parse((await hybridContext.json()).result.content[0].text);
    assert.equal(planningContext.schema, "vision-training-planning-context@1");
    assert.equal(planningContext.target_training, null);
    assert.equal(planningContext.recent_matches.length, 5);
    assert.equal(planningContext.evidence_status, "provider_not_configured");
    assert.equal(planningContext.missing_data.target_training, true);

    const rejectedToken = `vcmcp_${crypto.randomBytes(32).toString("base64url")}`;
    const rejected = await mcpRequest(rejectedToken, "tools/list");
    assert.equal(rejected.status, 401);
    assert.equal((await rejected.json()).error, "connector_not_authorized");
  } finally {
    for (const teamId of teams) {
      const removed = await admin.from("teams").delete().eq("id", teamId);
      assert.ifError(removed.error);
    }
    for (const userId of users) {
      const removed = await admin.auth.admin.deleteUser(userId);
      assert.ifError(removed.error);
    }
  }
});
