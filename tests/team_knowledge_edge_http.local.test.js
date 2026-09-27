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
    const registeredLossRef = uuid();
    const registeredRecoveryRef = uuid();
    const seededMatches = await admin.from("workspace_records").insert([
      ...matchDates.map((date, index) => ({
        id: matchIds[index], team_id: teams[0], kind: "match", actor_type: "human",
        payload: {
          data: date, estado: "concluido", adversario: `Adversário local ${index + 1}`,
          ...(index === 5 ? { golos_favor: 2, golos_contra: 1 } : {}),
          match_events: { events: index === 5 ? [
            { id: registeredLossRef, type: "loss", at_ms: 60000, reason: "pass", zone: "def_c", note: "Passe errado na saída" },
            { id: registeredRecoveryRef, type: "recovery", at_ms: 120000, zone: "med_c", note: "Recuperação central" },
          ] : [] },
          ...(index === 5 ? { post_game: { analysis: {
            schema: "vision-match-analysis@1", revision: 2, status: "done",
            fields: { observations: "Observação guardada pelo treinador", interpretation: "Apoio insuficiente pode explicar a perda", hypotheses: "Confirmar se o padrão se repete", decisions: "Trabalhar linhas de apoio" },
            goals_conceded: {}, history: [], agent_proposal: null,
          } } } : {}),
        },
      })),
      { id: matchIds[6], team_id: teams[0], kind: "match", actor_type: "human", payload: { estado: "concluido", adversario: "Jogo local sem data" } },
      { id: uuid(), team_id: teams[1], kind: "match", actor_type: "human", payload: { data: "2026-09-25", estado: "concluido", adversario: "SEGREDO_EQUIPA_EXTERNA" } },
    ]);
    assert.ifError(seededMatches.error);

    const sanitizerMatchRef = uuid();
    const sanitizerMatchInsert = await admin.from("workspace_records").insert({
      id: sanitizerMatchRef, team_id: teams[0], kind: "match", actor_type: "human",
      payload: {
        data: "2026-09-26", estado: "agendado", adversario: "Adversário sintético",
        notas: "O atleta foi diagnosticado com asma.", medical_diagnosis: "asma",
        photo_url: "https://private.invalid/player-photo",
        fotoUrl: "https://storage.invalid/private/player?token=synthetic-secret",
        player: { estado_disponibilidade: "lesionado" },
        attendance: [{ player_ref: uuid(), status: "present" }],
        analysis: { summary: "Criámos oportunidades em ataque rápido." },
      },
    });
    assert.ifError(sanitizerMatchInsert.error);

    const exerciseRef = uuid();
    const completedTrainingRef = uuid();
    const unstartedTrainingRef = uuid();
    const targetTrainingRef = uuid();
    const seededPlanning = await admin.from("workspace_records").insert([
      {
        id: completedTrainingRef, team_id: teams[0], kind: "training", actor_type: "human",
        payload: { data: "2026-09-22", status: "ready", review: { status: "done", continua: "Apoio irregular" }, session: { status: "completed", blocks: [
          { key: "recorded-support", exercise_ref: exerciseRef, exercise_name: "Apoio após passe", done: true, elapsed_ms: 60000 },
          { key: "untouched-finishing", exercise_ref: uuid(), exercise_name: "Remate", done: false, elapsed_ms: 0 },
        ] } },
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

    const archivedPlayerRef = uuid();
    const currentPlayerRef = uuid();
    const currentPlayerRow = {
      id: currentPlayerRef, team_id: teams[0], kind: "player", actor_type: "human",
      payload: { nome: "Atleta Local", development_goals: { schema: "vision-player-goals@1", revision: 2, items: [
        { id: uuid(), title: "Apoio após passe", started_at: "2026-09-01", status: "active",
          notes: "Oferecer linha de passe.", evidence_refs: [], exercise_refs: [], history: [
            { id: uuid(), title: "Objetivo após lesão no joelho", started_at: "2026-08-01", status: "active",
              notes: "Registo histórico.", evidence_refs: [], exercise_refs: [] },
          ] },
        { id: uuid(), title: "Objetivo de apoio", started_at: "2026-09-02", status: "active",
          notes: "Observação clínica sobre lesão.", evidence_refs: [], exercise_refs: [], history: [] },
      ] } },
    };
    const archiveRow = {
      id: uuid(), team_id: teams[0], kind: "document", actor_type: "human",
      payload: { type: "player_archive", external_key: `player-archive:default:${archivedPlayerRef}`,
        body: JSON.stringify({ schema: "vision-player-archive@1", archived_at: "2026-09-25T09:00:00.000Z",
          player: { ref: archivedPlayerRef, name: "Atleta Arquivado", age_group: "Sub-8" },
          development_goals: { schema: "vision-player-goals@1", revision: 0, items: [] } }) },
    };
    const coachMemory = (teamId, ref, date, content) => ({
      id: uuid(), team_id: teamId, kind: "memory", actor_type: "human",
      payload: { sync_id: uuid(), kind: "observation", status: "active", occurred_at: date,
        title: `Observação ${date}`, content, source: { type: "coach" },
        subject_refs: [{ type: "player", id: ref }] },
    });
    const seededArchiveHistory = await admin.from("workspace_records").insert([
      currentPlayerRow,
      archiveRow,
      coachMemory(teams[0], archivedPlayerRef, "2026-09-25", "Ofereceu apoio depois do passe."),
      coachMemory(teams[0], archivedPlayerRef, "2026-09-24", "Criou linha de passe no corredor."),
      coachMemory(teams[0], archivedPlayerRef, "2026-09-23", "Observação clínica sobre lesão."),
      coachMemory(teams[1], archivedPlayerRef, "2026-09-26", "SEGREDO de outra equipa."),
      coachMemory(teams[0], uuid(), "2026-09-27", "Observação de outro atleta."),
    ]);
    assert.ifError(seededArchiveHistory.error);

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
    const imageWriteToken = await createConnectorToken(["read", "write", "media"], "vcmcp_imgwrite", "Imagem original local");
    const imageReadToken = await createConnectorToken(["read", "media"], "vcmcp_imgread1", "Imagem no segundo dispositivo");

    const initialize = await mcpRequest(token, "initialize", {
      protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "local-test", version: "1" },
    });
    assert.equal(initialize.status, 200, await initialize.clone().text());
    const initialized = await initialize.json();
    assert.equal(initialized.result.serverInfo.version, "1.14.9");
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
    assert.ok(tools.some((tool) => tool.name === "get_archived_player_development"));
    assert.ok(tools.some((tool) => tool.name === "search_team_knowledge"));
    assert.ok(tools.some((tool) => tool.name === "get_training_planning_context"));
    assert.ok(tools.some((tool) => tool.name === "reindex_team_knowledge"));
    assert.ok(tools.some((tool) => tool.name === "prepare_weekly_plan_proposal"));
    assert.ok(tools.some((tool) => tool.name === "accept_weekly_plan_proposal"));
    assert.ok(tools.some((tool) => tool.name === "dismiss_weekly_plan_proposal"));
    assert.equal(tools.find((tool) => tool.name === "search_team_knowledge").inputSchema.properties.match_refs.maxItems, 10);
    assert.equal(tools.find((tool) => tool.name === "search_team_knowledge").inputSchema.properties.per_match_limit.maximum, 4);

    const sanitizedMatchResponse = await mcpRequest(token, "tools/call", {
      name: "get_match", arguments: { id: sanitizerMatchRef },
    });
    assert.equal(sanitizedMatchResponse.status, 200);
    const sanitizedMatchResult = await sanitizedMatchResponse.json();
    const sanitizedMatch = JSON.parse(sanitizedMatchResult.result.content[0].text);
    assert.equal(sanitizedMatch.id, sanitizerMatchRef);
    assert.equal(sanitizedMatch.payload.notas, "Conteúdo pessoal sensível omitido");
    assert.equal(sanitizedMatch.payload.medical_diagnosis, undefined);
    assert.equal(sanitizedMatch.payload.photo_url, undefined);
    assert.equal(sanitizedMatch.payload.fotoUrl, undefined);
    assert.equal(sanitizedMatch.payload.player.estado_disponibilidade, "lesionado");
    assert.equal(sanitizedMatch.payload.attendance[0].status, "present");
    assert.equal(sanitizedMatch.payload.analysis.summary, "Criámos oportunidades em ataque rápido.");
    assert.equal(sanitizedMatch.sensitive_text_omitted, true);
    assert.doesNotMatch(JSON.stringify(sanitizedMatch), /diagnosticado|asma|private\.invalid|storage\.invalid|synthetic-secret/);

    const archivedPlayerResponse = await mcpRequest(token, "tools/call", {
      name: "get_archived_player_development", arguments: { player_ref: archivedPlayerRef, observations_limit: 1 },
    });
    assert.equal(archivedPlayerResponse.status, 200);
    const archivedPlayer = JSON.parse((await archivedPlayerResponse.json()).result.content[0].text);
    assert.equal(archivedPlayer.historical_only, true);
    assert.deepEqual(archivedPlayer.observations.items.map((item) => item.content), ["Ofereceu apoio depois do passe."]);
    assert.equal(archivedPlayer.observations.has_more, true);
    assert.equal(archivedPlayer.observations.next_offset, 1);
    const archivedPlayerPage2Response = await mcpRequest(token, "tools/call", {
      name: "get_archived_player_development", arguments: { player_ref: archivedPlayerRef, observations_limit: 1, observations_offset: 1 },
    });
    assert.equal(archivedPlayerPage2Response.status, 200);
    const archivedPlayerPage2 = JSON.parse((await archivedPlayerPage2Response.json()).result.content[0].text);
    assert.deepEqual(archivedPlayerPage2.observations.items.map((item) => item.content), ["Criou linha de passe no corredor."]);
    assert.doesNotMatch(JSON.stringify([archivedPlayer, archivedPlayerPage2]), /clínica|lesão|SEGREDO|outro atleta/i);

    const developmentGoalsResponse = await mcpRequest(token, "tools/call", {
      name: "get_player_development_goals", arguments: { id: currentPlayerRef },
    });
    assert.equal(developmentGoalsResponse.status, 200);
    const developmentGoals = JSON.parse((await developmentGoalsResponse.json()).result.content[0].text);
    assert.equal(developmentGoals.goals[0].notes, "Oferecer linha de passe.");
    assert.equal(developmentGoals.goals[0].history[0].title, "Conteúdo pessoal omitido");
    assert.equal(developmentGoals.goals[0].sensitive_text_omitted, true);
    assert.equal(developmentGoals.goals[1].notes, "");
    assert.equal(developmentGoals.goals[1].sensitive_text_omitted, true);
    assert.doesNotMatch(JSON.stringify(developmentGoals), /clínica|lesão|joelho/i);

    const recentMatches = await mcpRequest(token, "tools/call", {
      name: "list_matches", arguments: { state: "concluido", date_order: "desc", limit: 5, team_id: teams[1] },
    });
    assert.equal(recentMatches.status, 200);
    const recentResult = JSON.parse((await recentMatches.json()).result.content[0].text);
    assert.deepEqual(recentResult.matches.map((row) => row.payload.data), ["2026-09-22", "2026-09-20", "2026-09-17", "2026-09-10", "2026-09-05"]);
    assert.equal(recentResult.has_more, true);
    assert.equal(recentResult.next_offset, 5);
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

    const sourceAnalysisResponse = await mcpRequest(token, "tools/call", {
      name: "get_match_analysis", arguments: { id: matchIds[5] },
    });
    assert.equal(sourceAnalysisResponse.status, 200);
    const sourceAnalysis = JSON.parse((await sourceAnalysisResponse.json()).result.content[0].text);
    const proposedChanges = {
      summary: "Há duas perdas registadas na saída e apoio irregular nas observações do treinador.",
      hypotheses: ["O apoio tardio pode contribuir para uma perda; a relação precisa de confirmação."],
      next_priority: "Rever apoio após passe no próximo treino.",
      evidence_ids: [registeredLossRef],
    };
    const refusedProposalResponse = await mcpRequest(imageWriteToken, "tools/call", {
      name: "prepare_match_analysis",
      arguments: {
        id: matchIds[5], expected_updated_at: sourceAnalysis.updated_at,
        expected_revision: sourceAnalysis.analysis_revision, confirmed: false, proposal: proposedChanges,
      },
    });
    assert.equal(refusedProposalResponse.status, 200);
    const refusedProposal = JSON.parse((await refusedProposalResponse.json()).result.content[0].text);
    assert.equal(refusedProposal.error, "explicit_confirmation_required");
    const unchangedAnalysisResponse = await mcpRequest(token, "tools/call", {
      name: "get_match_analysis", arguments: { id: matchIds[5] },
    });
    const unchangedAnalysis = JSON.parse((await unchangedAnalysisResponse.json()).result.content[0].text);
    assert.equal(unchangedAnalysis.analysis.agent_proposal, null);

    const preparedProposalResponse = await mcpRequest(imageWriteToken, "tools/call", {
      name: "prepare_match_analysis",
      arguments: {
        id: matchIds[5], expected_updated_at: sourceAnalysis.updated_at,
        expected_revision: sourceAnalysis.analysis_revision, confirmed: true, proposal: proposedChanges,
      },
    });
    assert.equal(preparedProposalResponse.status, 200);
    const preparedProposal = JSON.parse((await preparedProposalResponse.json()).result.content[0].text);
    assert.equal(preparedProposal.analysis.agent_proposal.status, "proposed");
    assert.deepEqual(preparedProposal.analysis.agent_proposal.evidence_ids, [registeredLossRef]);
    assert.equal(preparedProposal.analysis.fields.observations, "Observação guardada pelo treinador");
    assert.equal(preparedProposal.analysis.fields.decisions, "Trabalhar linhas de apoio");
    const staleProposalResponse = await mcpRequest(imageWriteToken, "tools/call", {
      name: "prepare_match_analysis",
      arguments: {
        id: matchIds[5], expected_updated_at: sourceAnalysis.updated_at,
        expected_revision: sourceAnalysis.analysis_revision, confirmed: true, proposal: proposedChanges,
      },
    });
    const staleProposal = JSON.parse((await staleProposalResponse.json()).result.content[0].text);
    assert.equal(staleProposal.error, "record_conflict_read_again");
    const trainingCount = await admin.from("workspace_records").select("id", { count: "exact", head: true })
      .eq("team_id", teams[0]).eq("kind", "training").is("deleted_at", null);
    assert.ifError(trainingCount.error);
    assert.equal(trainingCount.count, 3, "preparing a match analysis proposal must not create a training");

    const search = await mcpRequest(token, "tools/call", {
      name: "search_team_knowledge", arguments: { query: "problemas nos jogos recentes", match_refs: recentResult.matches.map((row) => row.id) },
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
    assert.deepEqual(planningContext.recent_exercise_use, [{
      exercise_ref: exerciseRef, name: "Apoio após passe", uses: 1, last_used: "2026-09-22",
      usage_evidence: [{ training_ref: completedTrainingRef, training_date: "2026-09-22", block_ref: "recorded-support" }],
    }]);
    assert.equal(planningContext.recent_exercise_use_status, "recorded");
    assert.equal(planningContext.missing_data.recent_exercise_use, false);
    assert.match(planningContext.guidance, /não inclui o plano alvo, blocos intocados nem sessões por iniciar/);
    assert.equal(planningContext.recent_matches.length, 5);
    assert.equal(planningContext.evidence_status, "provider_not_configured");
    assert.equal(planningContext.missing_data.target_training, false);

    const trainingForProposal = await admin.from("workspace_records").select("updated_at")
      .eq("team_id", teams[0]).eq("kind", "training").eq("id", completedTrainingRef).single();
    assert.ifError(trainingForProposal.error);
    const proposalArgs = {
      week_start: "2026-09-28", objective: "Manter apoio após passe sob oposição", training1: completedTrainingRef,
      rationale: "A avaliação do treino regista apoio irregular.",
      hypothesis: "Confirmar se o apoio se mantém disponível sob oposição.",
      evidence: [{ source_type: "training", source_ref: completedTrainingRef, field: "review.continua",
        quote: "Apoio irregular", record_updated_at: trainingForProposal.data.updated_at }],
    };
    const refusedWeeklyProposalResponse = await mcpRequest(imageWriteToken, "tools/call", {
      name: "prepare_weekly_plan_proposal", arguments: { ...proposalArgs, confirmed: false },
    });
    const refusedWeeklyProposal = JSON.parse((await refusedWeeklyProposalResponse.json()).result.content[0].text);
    assert.equal(refusedWeeklyProposal.error, "explicit_confirmation_required");
    const preparedWeeklyProposalResponse = await mcpRequest(imageWriteToken, "tools/call", {
      name: "prepare_weekly_plan_proposal", arguments: { ...proposalArgs, confirmed: true },
    });
    assert.equal(preparedWeeklyProposalResponse.status, 200);
    const preparedWeeklyProposal = JSON.parse((await preparedWeeklyProposalResponse.json()).result.content[0].text);
    assert.equal(preparedWeeklyProposal.already_prepared, false);
    assert.equal(preparedWeeklyProposal.record.agent_proposal.status, "proposed");
    assert.equal(preparedWeeklyProposal.record.agent_proposal.coach_decision, "");
    const repeatedWeeklyProposalResponse = await mcpRequest(imageWriteToken, "tools/call", {
      name: "prepare_weekly_plan_proposal", arguments: { ...proposalArgs, confirmed: true },
    });
    const repeatedWeeklyProposal = JSON.parse((await repeatedWeeklyProposalResponse.json()).result.content[0].text);
    assert.equal(repeatedWeeklyProposal.already_prepared, true, "repeating an identical proposal must be idempotent");
    const refusedWeeklyOverwriteResponse = await mcpRequest(imageWriteToken, "tools/call", {
      name: "save_weekly_plan", arguments: {
        id: preparedWeeklyProposal.id, week_start: proposalArgs.week_start, objective: "Overwrite silencioso",
        expected_updated_at: preparedWeeklyProposal.updated_at, expected_revision: preparedWeeklyProposal.record.revision, confirmed: true,
      },
    });
    const refusedWeeklyOverwrite = JSON.parse((await refusedWeeklyOverwriteResponse.json()).result.content[0].text);
    assert.equal(refusedWeeklyOverwrite.error, "weekly_plan_proposal_pending_decision");
    const sourceBeforeChange = await admin.from("workspace_records").select("payload")
      .eq("team_id", teams[0]).eq("kind", "training").eq("id", completedTrainingRef).single();
    assert.ifError(sourceBeforeChange.error);
    const changedTrainingPayload = { ...sourceBeforeChange.data.payload,
      review: { ...sourceBeforeChange.data.payload.review, continua: "Apoio melhorou" } };
    const changedTraining = await admin.from("workspace_records").update({ payload: changedTrainingPayload })
      .eq("team_id", teams[0]).eq("kind", "training").eq("id", completedTrainingRef).select("updated_at").single();
    assert.ifError(changedTraining.error);
    const staleWeeklyApprovalResponse = await mcpRequest(imageWriteToken, "tools/call", {
      name: "accept_weekly_plan_proposal", arguments: {
        id: preparedWeeklyProposal.id, expected_updated_at: preparedWeeklyProposal.updated_at,
        expected_revision: preparedWeeklyProposal.record.revision, coach_decision: "Aprovo.", confirmed: true,
      },
    });
    const staleWeeklyApproval = JSON.parse((await staleWeeklyApprovalResponse.json()).result.content[0].text);
    assert.equal(staleWeeklyApproval.error, "evidence_source_changed_read_again");
    const dismissedWeeklyResponse = await mcpRequest(imageWriteToken, "tools/call", {
      name: "dismiss_weekly_plan_proposal", arguments: {
        id: preparedWeeklyProposal.id, expected_updated_at: preparedWeeklyProposal.updated_at,
        expected_revision: preparedWeeklyProposal.record.revision, confirmed: true,
      },
    });
    const dismissedWeekly = JSON.parse((await dismissedWeeklyResponse.json()).result.content[0].text);
    assert.equal(dismissedWeekly.record.agent_proposal.status, "dismissed");
    const currentWeekArgs = {
      ...proposalArgs, week_start: "2026-10-05",
      evidence: [{ ...proposalArgs.evidence[0], quote: "Apoio melhorou", record_updated_at: changedTraining.data.updated_at }],
    };
    const currentProposalResponse = await mcpRequest(imageWriteToken, "tools/call", {
      name: "prepare_weekly_plan_proposal", arguments: { ...currentWeekArgs, confirmed: true },
    });
    const currentProposal = JSON.parse((await currentProposalResponse.json()).result.content[0].text);
    assert.equal(currentProposal.record.agent_proposal.status, "proposed");
    const acceptedWeeklyResponse = await mcpRequest(imageWriteToken, "tools/call", {
      name: "accept_weekly_plan_proposal", arguments: {
        id: currentProposal.id, expected_updated_at: currentProposal.updated_at,
        expected_revision: currentProposal.record.revision,
        coach_decision: "Aprovo testar o apoio sob oposição nesta semana.", confirmed: true,
      },
    });
    const acceptedWeekly = JSON.parse((await acceptedWeeklyResponse.json()).result.content[0].text);
    assert.equal(acceptedWeekly.record.agent_proposal.status, "accepted");
    assert.equal(acceptedWeekly.record.agent_proposal.coach_decision, "Aprovo testar o apoio sob oposição nesta semana.");
    const weeklyTrainingCount = await admin.from("workspace_records").select("id", { count: "exact", head: true })
      .eq("team_id", teams[0]).eq("kind", "training").is("deleted_at", null);
    assert.ifError(weeklyTrainingCount.error);
    assert.equal(weeklyTrainingCount.count, 3, "accepting or dismissing a weekly proposal must not create training sessions");

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
