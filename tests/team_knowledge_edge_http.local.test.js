"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { createClient } = require("@supabase/supabase-js");

const supabaseUrl = process.env.VISION_COACH_SUPABASE_LOCAL_URL || "";
const serviceKey = process.env.VISION_COACH_SUPABASE_LOCAL_SERVICE_KEY || "";
const mcpUrl = process.env.VISION_COACH_MCP_LOCAL_HTTP_URL || "";
const configured = !!(supabaseUrl && serviceKey && mcpUrl);
const localHost = (value) => ["localhost", "127.0.0.1", "::1"].includes(new URL(value).hostname);
function localStorageUrl(value) {
  const url = new URL(value);
  assert.ok(localHost(url.href) || url.hostname === "kong", `Expected local Storage host, got ${url.hostname}.`);
  if (url.hostname === "kong") {
    const localApi = new URL(supabaseUrl);
    url.protocol = localApi.protocol;
    url.host = localApi.host;
  }
  return url;
}
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
  const uploadedExerciseObjects = [];
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
    const foreignTeam = await admin.from("teams").insert({
      owner_id: users[0], name: "RAG HTTP outra equipa", metadata: { escalao: "Sub-10" },
    }).select("id").single();
    assert.ifError(foreignTeam.error);
    teams.push(foreignTeam.data.id);
    const headCoachAuthorization = await admin.from("agent_authorizations").insert({
      team_id: teams[0], owner_id: users[0], agent_subject: "head-coach", scopes: ["read", "write"], enabled: true,
    });
    assert.ifError(headCoachAuthorization.error);

    const matchDates = ["2026-09-01", "2026-09-05", "2026-09-10", "2026-09-17", "2026-09-20", "2026-09-22"];
    const matchIds = [...matchDates.map(() => uuid()), uuid()];
    const seededMatches = await admin.from("workspace_records").insert([
      ...matchDates.map((date, index) => ({
        id: matchIds[index], team_id: teams[0], kind: "match", actor_type: "human",
        payload: {
          data: date, estado: "concluido", adversario: `Adversário local ${index + 1}`,
          ...(index === 5 ? { golos_favor: 2, golos_contra: 1 } : {}),
          match_events: { events: index === 5 ? [
            { id: uuid(), type: "loss", at_ms: 60000, reason: "pass", zone: "def_c", note: "Passe errado na saída" },
            { id: uuid(), type: "recovery", at_ms: 120000, zone: "med_c", note: "Recuperação central" },
          ] : [] },
        },
      })),
      { id: matchIds[6], team_id: teams[0], kind: "match", actor_type: "human", payload: { estado: "concluido", adversario: "Jogo local sem data" } },
      { id: uuid(), team_id: teams[1], kind: "match", actor_type: "human", payload: { data: "2026-09-25", estado: "concluido", adversario: "SEGREDO_EQUIPA_EXTERNA" } },
    ]);
    assert.ifError(seededMatches.error);

    const exerciseRef = uuid();
    const completedTrainingRef = uuid();
    const unstartedTrainingRef = uuid();
    const targetTrainingRef = uuid();
    const seededPlanning = await admin.from("workspace_records").insert([
      {
        id: completedTrainingRef, team_id: teams[0], kind: "training", actor_type: "human",
        payload: { data: "2026-09-22", status: "ready", session: { status: "completed", blocks: [{ exercise_ref: exerciseRef, exercise_name: "Apoio após passe" }] } },
      },
      {
        id: unstartedTrainingRef, team_id: teams[0], kind: "training", actor_type: "human",
        payload: { data: "2026-09-21", status: "ready", session: { status: "not_started", blocks: [{ exercise_ref: exerciseRef, exercise_name: "Apoio após passe" }] } },
      },
      {
        id: targetTrainingRef, team_id: teams[0], kind: "training", actor_type: "human",
        payload: { data: "2026-09-24", status: "ready", duracao_min: 60, session: { status: "not_started", blocks: [{ exercise_ref: exerciseRef, exercise_name: "Apoio após passe" }] } },
      },
      {
        id: exerciseRef, team_id: teams[0], kind: "exercise", actor_type: "human",
        payload: { nome: "Apoio após passe", objetivo: "Criar uma linha de apoio depois do passe." },
      },
    ]);
    assert.ifError(seededPlanning.error);

    const token = `vcmcp_${crypto.randomBytes(32).toString("base64url")}`;
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    const connector = await admin.rpc("mcp_connector_create", {
      p_team_id: teams[0], p_owner_id: users[0], p_token_hash: tokenHash,
      p_token_prefix: "vcmcp_http001", p_label: "RAG HTTP local",
      p_scopes: ["read"], p_expires_at: null,
    });
    assert.ifError(connector.error);
    const createConnectorToken = async (scopes, prefix, label) => {
      const value = `vcmcp_${crypto.randomBytes(32).toString("base64url")}`;
      const created = await admin.rpc("mcp_connector_create", {
        p_team_id: teams[0], p_owner_id: users[0],
        p_token_hash: crypto.createHash("sha256").update(value).digest("hex"),
        p_token_prefix: prefix, p_label: label, p_scopes: scopes, p_expires_at: null,
      });
      assert.ifError(created.error);
      return value;
    };

    const initialize = await mcpRequest(token, "initialize", {
      protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "local-test", version: "1" },
    });
    assert.equal(initialize.status, 200, await initialize.clone().text());
    const initialized = await initialize.json();
    assert.equal(initialized.result.serverInfo.version, "1.14.3");
    assert.match(initialized.result.instructions, /get_training_planning_context/);
    assert.match(initialized.result.instructions, /get_recent_match_context/);
    assert.match(initialized.result.instructions, /roster and availability, use list_players/i);
    assert.match(initialized.result.instructions, /attendance and actual timings, use get_training_session/i);
    assert.match(initialized.result.instructions, /recorded attendance and match usage, use get_player_participation_history/i);
    assert.match(initialized.result.instructions, /recorded match events, statistics, and player usage, use get_match_report/i);
    assert.match(initialized.result.instructions, /structured event or result is a registered fact; coach-entered text is an observation/i);
    assert.match(initialized.result.instructions, /structured facts such as roster, availability, dates, attendance, duration, results, counted events, and minutes/i);
    assert.match(initialized.result.instructions, /semantic retrieval is not their source of truth/i);
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
      name: "list_matches", arguments: { state: "concluido", date_order: "desc", limit: 5, team_id: teams[1] },
    });
    assert.equal(recentMatches.status, 200);
    const recentResult = JSON.parse((await recentMatches.json()).result.content[0].text);
    assert.deepEqual(recentResult.map((row) => row.payload.data), ["2026-09-22", "2026-09-20", "2026-09-17", "2026-09-10", "2026-09-05"]);
    assert.doesNotMatch(JSON.stringify(recentResult), /SEGREDO_EQUIPA_EXTERNA/);

    const recentContextResponse = await mcpRequest(token, "tools/call", {
      name: "get_recent_match_context", arguments: { question: "O que aconteceu nos últimos jogos?", match_count: 5 },
    });
    assert.equal(recentContextResponse.status, 200);
    const recentContext = JSON.parse((await recentContextResponse.json()).result.content[0].text);
    assert.equal(recentContext.schema, "vision-recent-match-context@1");
    assert.equal(recentContext.selection.returned, 5);
    assert.deepEqual(recentContext.matches.map((match) => match.date), ["2026-09-22", "2026-09-20", "2026-09-17", "2026-09-10", "2026-09-05"]);
    assert.deepEqual(recentContext.matches[0].result, { for: 2, against: 1, provenance: "introduced_manual" });
    assert.equal(recentContext.matches[0].recorded_event_count, 2);
    assert.equal(recentContext.matches[0].statistics_provenance, "counted_from_recorded_events");
    assert.deepEqual(recentContext.matches[0].registered_event_counts, {
      goals_for: 0, goals_against: 0, shots_on_target: 0, shots_off_target: 0, corners_for: 0,
      corners_against: 0, losses: 1, recoveries: 1, through_balls: 0, striker_foot_balls: 0,
    });
    assert.deepEqual(recentContext.matches[0].losses_by_reason, { "passe errado": 1 });
    assert.deepEqual(recentContext.matches[0].losses_by_zone, { "defesa central": 1 });
    assert.deepEqual(recentContext.matches[0].recoveries_by_zone, { "meio-campo central": 1 });
    assert.equal(recentContext.missing_data.structured_event_counts, false);
    assert.equal(recentContext.semantic_retrieval_status, "provider_not_configured");
    assert.deepEqual(recentContext.semantic_evidence, []);
    assert.doesNotMatch(JSON.stringify(recentContext), /SEGREDO_EQUIPA_EXTERNA/);

    const search = await mcpRequest(token, "tools/call", {
      name: "search_team_knowledge", arguments: { query: "problemas nos jogos recentes", match_refs: recentResult.map((row) => row.id) },
    });
    assert.equal(search.status, 200);
    const result = JSON.parse((await search.json()).result.content[0].text);
    assert.equal(result.retrieval_status, "provider_not_configured");
    assert.equal(result.answer_mode, "not_generated");
    assert.deepEqual(result.results, []);
    assert.match(result.message, /Não foi enviada informação da equipa a nenhum provider/);

    const sensitiveSearch = await mcpRequest(token, "tools/call", {
      name: "search_team_knowledge", arguments: { query: "Como adaptar o treino para uma atleta com dislexia?" },
    });
    assert.equal(sensitiveSearch.status, 200);
    const sensitiveResult = JSON.parse((await sensitiveSearch.json()).result.content[0].text);
    assert.equal(sensitiveResult.retrieval_status, "sensitive_query_not_sent");
    assert.equal(sensitiveResult.answer_mode, "structured_data_only");
    assert.match(sensitiveResult.message, /outros dados pessoais sensíveis/i);
    assert.doesNotMatch(JSON.stringify(sensitiveResult), /dislexia/i);

    const hybridContext = await mcpRequest(token, "tools/call", {
      name: "get_training_planning_context", arguments: { target_date: "2026-09-24", question: "O que correu mal nos jogos recentes?" },
    });
    assert.equal(hybridContext.status, 200);
    const planningContext = JSON.parse((await hybridContext.json()).result.content[0].text);
    assert.equal(planningContext.schema, "vision-training-planning-context@1");
    assert.equal(planningContext.target_training.ref, targetTrainingRef);
    assert.equal(planningContext.target_training.exercise_count, 1);
    assert.equal(planningContext.missing_data.target_training_duration, false);
    assert.equal(planningContext.missing_data.target_training_exercises, false);
    assert.deepEqual(planningContext.recent_trainings.map((row) => row.ref), [completedTrainingRef]);
    assert.ok(planningContext.recent_trainings.every((row) => row.status === "completed"));
    assert.deepEqual(planningContext.recent_exercise_use, [{ exercise_ref: exerciseRef, name: "Apoio após passe", uses: 1, last_used: "2026-09-22" }]);
    assert.match(planningContext.guidance, /não inclui o plano alvo nem sessões por iniciar/);
    assert.equal(planningContext.recent_matches.length, 5);
    assert.equal(planningContext.evidence_status, "provider_not_configured");
    assert.equal(planningContext.missing_data.target_training, false);

    const imageWriteToken = await createConnectorToken(["read", "write", "media"], "vcmcp_imgwrite", "Imagem original local");
    const imageReadToken = await createConnectorToken(["read", "media"], "vcmcp_imgread1", "Imagem no segundo dispositivo");
    const exerciseImagePath = path.join(__dirname, "../assets/exercises/approved-20260922/01_ativacao_conduzir_passar_dar_opcao.png");
    const exerciseImageBytes = new Uint8Array(fs.readFileSync(exerciseImagePath));
    const { imageInfo, imageHash } = await import("../supabase/functions/vision-coach-mcp/image_uploads.mjs");
    const exerciseImageMeta = {
      ...imageInfo(exerciseImageBytes), sha256: await imageHash(exerciseImageBytes),
      file_name: path.basename(exerciseImagePath),
    };
    const existingImage = await mcpRequest(token, "tools/call", {
      name: "get_exercise_image", arguments: { id: exerciseRef },
    });
    assert.equal(existingImage.status, 200);
    const exerciseBeforeUpload = JSON.parse((await existingImage.json()).result.content[0].text);
    const preparedImageResponse = await mcpRequest(imageWriteToken, "tools/call", {
      name: "prepare_exercise_image_upload",
      arguments: { id: exerciseRef, approved: true, expected_updated_at: exerciseBeforeUpload.updated_at, ...exerciseImageMeta },
    });
    assert.equal(preparedImageResponse.status, 200);
    const preparedImage = JSON.parse((await preparedImageResponse.json()).result.content[0].text);
    assert.equal(preparedImage.already_linked, false);
    const uploadUrl = localStorageUrl(preparedImage.upload_url);
    assert.match(uploadUrl.pathname, /\/storage\/v1\/object\/upload\/sign\/team-media\//);
    const uploadObjectPath = decodeURIComponent(uploadUrl.pathname.split("/upload/sign/team-media/")[1] || "");
    assert.ok(uploadObjectPath.startsWith(`${teams[0]}/exercise-images/${exerciseRef}/`));
    uploadedExerciseObjects.push(uploadObjectPath);
    const uploadedImage = await fetch(uploadUrl, {
      method: "PUT", redirect: "error", headers: preparedImage.headers, body: exerciseImageBytes,
    });
    assert.equal(uploadedImage.status, 200, await uploadedImage.clone().text());
    const completedImageResponse = await mcpRequest(imageWriteToken, "tools/call", {
      name: "complete_exercise_image_upload", arguments: { ticket: preparedImage.ticket },
    });
    assert.equal(completedImageResponse.status, 200);
    const completedImage = JSON.parse((await completedImageResponse.json()).result.content[0].text);
    assert.equal(completedImage.verified, true, JSON.stringify(completedImage).replace(/https?:\/\/[^\s"\\]+/g, "[redacted-local-url]"));
    assert.equal(completedImage.exercise.image.sha256, exerciseImageMeta.sha256);

    const syncedImageResponse = await mcpRequest(imageReadToken, "tools/call", {
      name: "get_exercise_image", arguments: { id: exerciseRef, download: true },
    });
    assert.equal(syncedImageResponse.status, 200);
    const syncedImage = JSON.parse((await syncedImageResponse.json()).result.content[0].text);
    assert.equal(syncedImage.storage_path, completedImage.exercise.storage_path);
    assert.equal(syncedImage.image.sha256, exerciseImageMeta.sha256);
    assert.equal(syncedImage.visual_url, null);
    const downloadUrl = localStorageUrl(syncedImage.download_url);
    assert.match(downloadUrl.pathname, /\/storage\/v1\/object\/sign\/team-media\//);
    const downloadedImage = await fetch(downloadUrl, { redirect: "error" });
    assert.equal(downloadedImage.status, 200);
    assert.equal(await imageHash(new Uint8Array(await downloadedImage.arrayBuffer())), exerciseImageMeta.sha256);

    const rejectedToken = `vcmcp_${crypto.randomBytes(32).toString("base64url")}`;
    const rejected = await mcpRequest(rejectedToken, "tools/list");
    assert.equal(rejected.status, 401);
    assert.equal((await rejected.json()).error, "connector_not_authorized");
  } finally {
    if (uploadedExerciseObjects.length) {
      const removedObjects = await admin.storage.from("team-media").remove(uploadedExerciseObjects);
      assert.ifError(removedObjects.error);
    }
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
