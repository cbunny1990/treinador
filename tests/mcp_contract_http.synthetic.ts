// HTTP contract test of the real MCP entrypoint. Supabase auth is a synthetic
// fetch response; all other network access is denied by the fetch shim.
const runtime = Deno as unknown as { serve: (...args: any[]) => any };
const originalServe = runtime.serve;
const originalFetch = globalThis.fetch;
const connector = {
  id: "10000000-0000-4000-8000-000000000001",
  team_id: "20000000-0000-4000-8000-000000000002",
  owner_id: "30000000-0000-4000-8000-000000000003",
  scopes: ["read"],
  label: "Synthetic MCP contract test",
};
const archivePlayerRef = "40000000-0000-4000-8000-000000000004";
const archiveObservationRef = "a0000000-0000-4000-8000-00000000000a";
const archiveObservation = {
  id: archiveObservationRef,
  kind: "memory",
  team_id: connector.team_id,
  updated_at: "2026-09-25T12:00:00.000Z",
  payload: { sync_id: archiveObservationRef, kind: "observation", status: "active", occurred_at: "2026-09-25",
    title: "Observação segura", content: "Ofereceu apoio depois do passe.", source: { type: "coach" },
    subject_refs: [{ type: "player", id: archivePlayerRef }] },
};
const archiveRecord = {
  id: "50000000-0000-4000-8000-000000000005",
  kind: "document",
  team_id: connector.team_id,
  updated_at: "2026-09-25T10:00:00.000Z",
  payload: {
    type: "player_archive",
    external_key: `player-archive:default:${archivePlayerRef}`,
    body: JSON.stringify({
      schema: "vision-player-archive@1",
      archived_at: "2026-09-25T09:00:00.000Z",
      player: { ref: archivePlayerRef, name: "Atleta sintético", age_group: "Sub-8" },
      development_goals: { schema: "vision-player-goals@1", revision: 1, items: [{
        id: "60000000-0000-4000-8000-000000000006", title: "Apoio após passe", started_at: "2026-09-01",
        status: "continue", notes: "Evidência sintética arquivada.", evidence_refs: [], exercise_refs: [], history: [],
      }] },
    }),
  },
};
const weeklyTrainingRef = "80000000-0000-4000-8000-000000000008";
const weeklyTrainingRecord = {
  id: weeklyTrainingRef,
  kind: "training",
  team_id: connector.team_id,
  updated_at: "synthetic-training-v1",
  payload: { data: "2026-09-22", review: { status: "done", continua: "Apoio irregular" }, session: { status: "completed" } },
};
const sanitizationMatchRef = "b0000000-0000-4000-8000-00000000000b";
const sanitizationMatch = {
  id: sanitizationMatchRef,
  kind: "match",
  team_id: connector.team_id,
  updated_at: "synthetic-match-v1",
  payload: {
    data: "2026-09-26", adversario: "Adversário sintético", estado: "concluido",
    notas: "O atleta foi diagnosticado com asma.",
    medical_diagnosis: "asma",
    visual_url: "https://private.invalid/player-photo",
    player: { estado_disponibilidade: "indisponivel" },
    session: { attendance: [{ player_ref: archivePlayerRef, status: "present" }] },
    analysis: { summary: "Criámos oportunidades em ataque rápido." },
    post_game: { analysis: { fields: {
      summary: "Atleta sintético abriu uma linha de passe durante a saída curta.",
      problems: "Atleta sintético teve febre após o jogo.",
    } } },
  },
};
const weeklyDocuments = new Map<string, any>();
let weeklyProposalRpcWrites = 0;
const networkPaths: string[] = [];
const workspaceQueries: URLSearchParams[] = [];
let server: any;
let requestId = 0;

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

runtime.serve = (...args: any[]) => {
  const handler = typeof args[0] === "function" ? args[0] : args[1];
  server = originalServe({ hostname: "127.0.0.1", port: 0 }, handler);
  return server;
};
Deno.env.set("SUPABASE_URL", "http://supabase.synthetic");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "synthetic-only-not-a-secret");
Deno.env.delete("TYPESAFE_API_KEY");
Deno.env.delete("OPENAI_API_KEY");
globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  networkPaths.push(url.origin + url.pathname);
  if (url.origin === "http://supabase.synthetic" && url.pathname === "/rest/v1/rpc/mcp_connector_lookup") {
    return Response.json(connector);
  }
  if (url.origin === "http://supabase.synthetic" && url.pathname === "/rest/v1/rpc/head_coach_put_record") {
    const args = JSON.parse(String(init?.body || "{}"));
    check(args.p_team_id === connector.team_id && args.p_kind === "document", "Weekly proposal RPC was not scoped to the authorized team and document kind.");
    const payload = args.p_payload;
    check(payload?.type === "weekly_plan", "Weekly proposal RPC attempted to write a different document type.");
    let row = weeklyDocuments.get(payload.external_key);
    if (args.p_record_id) check(row?.id === args.p_record_id, "Weekly proposal update used an unknown document UUID.");
    else check(!row, "Weekly proposal creation attempted a duplicate document.");
    row = {
      id: args.p_record_id || "90000000-0000-4000-8000-000000000009",
      team_id: connector.team_id,
      kind: "document",
      payload,
      updated_at: row ? "synthetic-weekly-v2" : "synthetic-weekly-v1",
    };
    weeklyDocuments.set(payload.external_key, row);
    weeklyProposalRpcWrites++;
    return Response.json(row);
  }
  if (url.origin === "http://supabase.synthetic" && url.pathname === "/rest/v1/workspace_records") {
    workspaceQueries.push(url.searchParams);
    const query = url.searchParams;
    if (query.get("order")?.includes("updated_at.desc") && query.get("order")?.includes("id.asc")) {
      check(query.get("team_id") === `eq.${connector.team_id}`, "Workspace search was not scoped to the authorized team.");
      check(query.get("deleted_at") === "is.null", "Workspace search included deleted records.");
      check(query.get("kind") === "in.(match)", "Workspace search ignored the requested kind filter.");
      check(query.get("offset") === "0" && query.get("limit") === "500", "Workspace search did not page records at the origin.");
      return Response.json([{
        id: "70000000-0000-4000-8000-000000000007", kind: "match", payload: { analysis: "Apoio após passe" },
        actor_type: "coach", actor_label: null, updated_at: "2026-09-25T11:00:00.000Z",
      }]);
    }
    check(query.get("team_id") === `eq.${connector.team_id}`, "Archived athlete read was not scoped to the authorized team.");
    if (query.get("select") !== "payload") check(query.get("deleted_at") === "is.null", "Archived athlete read included deleted archive documents.");
    const kind = query.get("kind");
    if (kind === "eq.memory") {
      return Response.json([archiveObservation]);
    }
    if (kind === "eq.player" && query.get("select") === "payload") {
      return Response.json([{ payload: { nome: "Atleta sintético" } }]);
    }
    if (kind === "eq.match") {
      return Response.json([sanitizationMatch]);
    }
    if (kind === "eq.training" && query.get("id") === `eq.${weeklyTrainingRef}`) return Response.json([weeklyTrainingRecord]);
    if (kind === "eq.document" && query.get("payload->>type") !== "eq.player_archive") {
      const byId = query.get("id")?.replace(/^eq\./, "");
      const byKey = query.get("payload->>external_key")?.replace(/^eq\./, "");
      const row = [...weeklyDocuments.values()].find((item) => item.id === byId || item.payload.external_key === byKey);
      return Response.json(row ? [row] : []);
    }
    check(["eq.document", "eq.match", "eq.training"].includes(kind || ""), "Archived athlete read queried an unrelated record type.");
    if (kind === "eq.document") {
      check(query.get("payload->>type") === "eq.player_archive", "Archived athlete read did not filter archive documents.");
      if (query.get("select") === "payload") return Response.json([{ payload: archiveRecord.payload }]);
      check(query.get("payload->>external_key") === `eq.player-archive:default:${archivePlayerRef}`, "Archived athlete read did not use the exact stable athlete UUID.");
      return Response.json([archiveRecord]);
    }
    return Response.json([]);
  }
  if (url.origin === "http://127.0.0.1") return originalFetch(input, init);
  throw new Error("external_network_disabled_in_synthetic_contract_test");
};

try {
  await import("../supabase/functions/vision-coach-mcp/index.ts");
  check(server, "The MCP entrypoint did not start its HTTP server.");
  const token = "vcmcp_" + "synthetic-token-12345678901234567890";
  const call = async (method: string, params: Record<string, unknown> = {}) => {
    const response = await originalFetch(`http://127.0.0.1:${server.addr.port}/mcp`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++requestId, method, params }),
    });
    check(response.status === 200, `${method} returned HTTP ${response.status}.`);
    return await response.json();
  };

  const initialized = await call("initialize", { protocolVersion: "2025-11-25" });
  check(initialized.result.serverInfo.name === "vision-coach", "Unexpected MCP server identity.");
  check(/weekday or relative date, call list_trainings to resolve the exact scheduled date, then call get_training_planning_context/i.test(initialized.result.instructions), "Missing route from an unspecified weekday to an exact training date.");
  check(/if no unique matching session is available, ask which date rather than guessing/i.test(initialized.result.instructions), "MCP must not guess a date when a weekday has no unique scheduled session.");
  check(/first locate candidate citations with search_team_knowledge or get_cross_session_evidence/i.test(initialized.result.instructions), "Missing evidence-retrieval instruction.");
  check(/Never invent a source UUID, revision, field or quote/i.test(initialized.result.instructions), "Missing anti-fabrication instruction.");
  check(/category player_goal_archive or evidence type historical_coach_goal/i.test(initialized.result.instructions), "Missing instruction to preserve archived athlete goals as historical evidence.");
  check(/For a permanently removed athlete's retained development history, use get_archived_player_development/i.test(initialized.result.instructions), "Missing MCP route for archived athlete development.");

  const listed = await call("tools/list");
  for (const name of ["prepare_weekly_plan_proposal", "accept_weekly_plan_proposal", "dismiss_weekly_plan_proposal"]) {
    check(listed.result.tools.some((item: any) => item.name === name), `The weekly proposal operation ${name} is not exposed over MCP HTTP.`);
  }
  connector.scopes = ["read", "write"];
  const unconfirmedWeeklyPrepare = await call("tools/call", {
    name: "prepare_weekly_plan_proposal",
    arguments: {
      week_start: "2026-09-28", objective: "Proposta sintética", rationale: "Racional sintético.",
      evidence: [{ source_type: "training", source_ref: archivePlayerRef, field: "review.continua", quote: "Citação sintética", record_updated_at: "v1" }],
      confirmed: false,
    },
  });
  check(unconfirmedWeeklyPrepare.result.isError === true, "MCP HTTP allowed a weekly proposal without confirmation.");
  check(unconfirmedWeeklyPrepare.result.structuredContent.error === "explicit_confirmation_required", "MCP HTTP did not identify the missing weekly proposal confirmation.");
  const unconfirmedWeeklyAccept = await call("tools/call", {
    name: "accept_weekly_plan_proposal",
    arguments: {
      id: "70000000-0000-4000-8000-000000000007", expected_updated_at: "v1", expected_revision: 0,
      coach_decision: "Decisão sintética.", confirmed: false,
    },
  });
  check(unconfirmedWeeklyAccept.result.isError === true, "MCP HTTP accepted a weekly proposal without coach confirmation.");
  check(unconfirmedWeeklyAccept.result.structuredContent.error === "explicit_confirmation_required", "MCP HTTP did not identify the missing weekly approval confirmation.");
  connector.scopes = ["read"];
  const tool = listed.result.tools.find((item: any) => item.name === "evaluate_cross_session_pattern");
  check(tool, "The multi-source Jev tool is not exposed over MCP HTTP.");
  check(tool.inputSchema.properties.match_sources.minItems === 2, "MCP did not expose the minimum distinct-match evidence contract.");
  check(tool.inputSchema.properties.training_sources.minItems === 1, "MCP did not require training evidence.");
  const knowledgeTool = listed.result.tools.find((item: any) => item.name === "search_team_knowledge");
  check(knowledgeTool, "The RAG search tool is not exposed over MCP HTTP.");
  const beforeSensitiveSearch = networkPaths.length;
  const sensitiveSearch = await call("tools/call", {
    name: "search_team_knowledge",
    arguments: { query: "O que fazer com a atleta encaminhada para o hospital?" },
  });
  const sensitiveSearchResult = sensitiveSearch.result.structuredContent;
  check(sensitiveSearchResult.retrieval_status === "sensitive_query_not_sent", "A sensitive query was not refused over MCP HTTP.");
  check(sensitiveSearchResult.answer_mode === "structured_data_only", "The sensitive query did not direct the caller to structured data.");
  check(!JSON.stringify(sensitiveSearchResult).includes("encaminhada para o hospital"), "The sensitive query was echoed to the MCP caller.");
  check(networkPaths.slice(beforeSensitiveSearch).every((path) => path.endsWith("/rest/v1/rpc/mcp_connector_lookup")), "The sensitive query reached a workspace/RAG RPC or external provider.");
  const archivedPlayerTool = listed.result.tools.find((item: any) => item.name === "get_archived_player_development");
  check(archivedPlayerTool?.annotations?.readOnlyHint === true, "Archived athlete development must be available as a read-only MCP tool.");
  check(archivedPlayerTool.inputSchema.properties.player_ref.format === "uuid", "Archived athlete development must use the shared UUID.");
  check(archivedPlayerTool.inputSchema.properties.observations_offset.maximum === 10000 && archivedPlayerTool.inputSchema.properties.observations_limit.maximum === 50, "Archived athlete observation pagination is not bounded.");

  const archivedPlayer = await call("tools/call", {
    name: "get_archived_player_development",
    arguments: { player_ref: archivePlayerRef, observations_limit: 1 },
  });
  check(!archivedPlayer.result.isError, `The archived athlete read failed over MCP HTTP: ${JSON.stringify(archivedPlayer.result)}`);
  check(archivedPlayer.result.structuredContent.historical_only === true && archivedPlayer.result.structuredContent.archive_status === "archived", "The MCP archive result did not identify its contents as historical only.");
  check(archivedPlayer.result.structuredContent.player.ref === archivePlayerRef, "The MCP archive result lost the stable athlete UUID.");
  check(archivedPlayer.result.structuredContent.goals[0].history.length === 0, "The MCP archive result changed the historical goals.");
  check(archivedPlayer.result.structuredContent.observations.items.length === 1 && archivedPlayer.result.structuredContent.observations.items[0].ref === archiveObservationRef, "The MCP archive result did not return the linked coach observation.");
  check(archivedPlayer.result.structuredContent.observations.has_more === false, "The MCP archive result returned an incorrect observation page state.");
  const observationQuery = workspaceQueries.find((query) => query.get("kind") === "eq.memory");
  check(observationQuery?.get("payload->>kind") === "eq.observation" && observationQuery?.get("payload->>status") === "eq.active", "Archived observations included a different memory state or kind.");
  check(observationQuery?.get("payload->source->>type") === "eq.coach", `Archived observations included non-coach-authored text: ${JSON.stringify(observationQuery && Object.fromEntries(observationQuery))}`);
  const payloadContains = observationQuery?.get("payload") || "";
  check(payloadContains.startsWith("cs.") && JSON.parse(payloadContains.slice(3)).subject_refs?.[0]?.id === archivePlayerRef, `Archived observations were not filtered to the athlete UUID: ${JSON.stringify(observationQuery && Object.fromEntries(observationQuery))}`);
  check(observationQuery?.get("offset") === "0" && observationQuery?.get("limit") === "2", `Archived observations did not request one extra row for pagination: ${JSON.stringify(observationQuery && Object.fromEntries(observationQuery))}`);
  check(observationQuery?.get("order")?.includes("payload->>occurred_at.desc") && observationQuery?.get("order")?.includes("id.desc"), `Archived observations have no stable chronological order: ${JSON.stringify(observationQuery && Object.fromEntries(observationQuery))}`);
  check(archivedPlayer.result.structuredContent.participation_history.player_ref === archivePlayerRef, "The MCP archive result did not resolve participation by stable athlete UUID.");
  check(workspaceQueries.length === 4, "The MCP archive read did not query archive, observations and historical game/training records.");

  connector.scopes = ["read", "write"];
  const weeklyArgs = {
    week_start: "2026-09-28", objective: "Manter apoio após passe sob oposição", training1: weeklyTrainingRef,
    rationale: "A avaliação do treino regista apoio irregular.", hypothesis: "Confirmar o apoio sob oposição.",
    evidence: [{ source_type: "training", source_ref: weeklyTrainingRef, field: "review.continua",
      quote: "Apoio irregular", record_updated_at: weeklyTrainingRecord.updated_at }],
  };
  const preparedWeekly = await call("tools/call", {
    name: "prepare_weekly_plan_proposal", arguments: { ...weeklyArgs, confirmed: true },
  });
  check(!preparedWeekly.result.isError, `The weekly proposal failed over MCP HTTP: ${JSON.stringify(preparedWeekly.result)}`);
  check(preparedWeekly.result.structuredContent.record.agent_proposal.status === "proposed", "MCP HTTP did not preserve the pending proposal state.");
  check(preparedWeekly.result.structuredContent.record.agent_proposal.coach_decision === "", "MCP HTTP invented the coach's decision.");
  const repeatedWeekly = await call("tools/call", {
    name: "prepare_weekly_plan_proposal", arguments: { ...weeklyArgs, confirmed: true },
  });
  check(repeatedWeekly.result.structuredContent.already_prepared === true, "MCP HTTP did not make repeated proposal creation idempotent.");
  const bypassWeekly = await call("tools/call", {
    name: "save_weekly_plan", arguments: {
      id: preparedWeekly.result.structuredContent.id, week_start: weeklyArgs.week_start, objective: "Overwrite",
      expected_updated_at: preparedWeekly.result.structuredContent.updated_at,
      expected_revision: preparedWeekly.result.structuredContent.record.revision, confirmed: true,
    },
  });
  check(bypassWeekly.result.isError === true && bypassWeekly.result.structuredContent.error === "weekly_plan_proposal_pending_decision", "MCP HTTP allowed a direct save to bypass a pending proposal.");
  const acceptedWeekly = await call("tools/call", {
    name: "accept_weekly_plan_proposal", arguments: {
      id: preparedWeekly.result.structuredContent.id, expected_updated_at: preparedWeekly.result.structuredContent.updated_at,
      expected_revision: preparedWeekly.result.structuredContent.record.revision,
      coach_decision: "Aprovo testar o apoio sob oposição.", confirmed: true,
    },
  });
  check(!acceptedWeekly.result.isError, `The weekly proposal approval failed over MCP HTTP: ${JSON.stringify(acceptedWeekly.result)}`);
  check(acceptedWeekly.result.structuredContent.record.agent_proposal.status === "accepted", "MCP HTTP did not persist the explicit approval.");
  check(acceptedWeekly.result.structuredContent.record.agent_proposal.coach_decision === "Aprovo testar o apoio sob oposição.", "MCP HTTP lost the coach's decision.");
  check(weeklyProposalRpcWrites === 2, "MCP HTTP created a duplicate or allowed an overwrite while the proposal was pending.");
  connector.scopes = ["read"];

  const lexicalSearch = await call("tools/call", {
    name: "search_workspace",
    arguments: { query: "apoio após passe", kinds: ["match"], limit: 10 },
  });
  check(!lexicalSearch.result.isError, `The paginated lexical workspace search failed over MCP HTTP: ${JSON.stringify(lexicalSearch.result)}`);
  check(lexicalSearch.result.structuredContent.search_complete === true, "The lexical search did not report its scan coverage.");
  check(lexicalSearch.result.structuredContent.results[0].id === "70000000-0000-4000-8000-000000000007", "The lexical search lost its matching record.");

  const fullMatch = await call("tools/call", {
    name: "get_match", arguments: { id: sanitizationMatchRef },
  });
  const safeMatch = fullMatch.result.structuredContent;
  check(!fullMatch.result.isError && safeMatch.id === sanitizationMatchRef, `The sanitized full-match read lost its stable record identity: ${JSON.stringify(fullMatch.result)}`);
  check(safeMatch.payload.notas === "Conteúdo pessoal sensível omitido" && safeMatch.payload.medical_diagnosis === undefined, "The MCP HTTP boundary exposed clinical match text.");
  check(safeMatch.payload.visual_url === undefined, "The MCP HTTP boundary exposed a private image URL.");
  check(safeMatch.payload.player.estado_disponibilidade === "indisponivel", "The MCP HTTP boundary removed useful operational availability.");
  check(safeMatch.payload.session.attendance[0].status === "present", "The MCP HTTP boundary removed explicit training attendance.");
  check(safeMatch.payload.analysis.summary === "Criámos oportunidades em ataque rápido.", "The MCP HTTP boundary removed ordinary tactical analysis.");
  check(safeMatch.sensitive_text_omitted === true, "The MCP HTTP boundary did not indicate that content was filtered.");

  const recentContext = await call("tools/call", {
    name: "get_recent_match_context", arguments: { question: "O que correu mal no último jogo?", match_count: 1 },
  });
  const recent = recentContext.result.structuredContent;
  check(!recentContext.result.isError && recent.semantic_retrieval_status === "provider_not_configured", `MCP HTTP did not report the absent embedding provider: ${recent.semantic_retrieval_status}`);
  check(recent.structured_coach_evidence_status === "available" && recent.structured_coach_evidence[0].source.ref === sanitizationMatchRef, "MCP HTTP did not return sourced coach-written match analysis.");
  check(recent.structured_coach_evidence[0].evidence_type === "coach_observation", "MCP HTTP lost the observation provenance.");
  check(!/Atleta sintético|febre/.test(JSON.stringify(recent.structured_coach_evidence)), "MCP HTTP exposed a player name or health note in the direct fallback.");

  const refused = await call("tools/call", {
    name: "evaluate_cross_session_pattern",
    arguments: {
      claim: "Validar padrão sintético.",
      match_sources: [
        { ref: "40000000-0000-4000-8000-000000000004", field: "analysis.observations", expected_updated_at: "v1" },
        { ref: "50000000-0000-4000-8000-000000000005", field: "analysis.observations", expected_updated_at: "v2" },
      ],
      training_sources: [
        { ref: "60000000-0000-4000-8000-000000000006", field: "review.continua", expected_updated_at: "v3" },
      ],
    },
  });
  check(refused.result.isError === true, "A call without a provider key should return an MCP error result.");
  check(/typesafe_api_not_configured/.test(refused.result.content?.[0]?.text || ""), "The missing Jev provider was not identified.");
  check(networkPaths.every((path) => path.endsWith("/rest/v1/rpc/mcp_connector_lookup") || path.endsWith("/rest/v1/rpc/head_coach_put_record") || path.endsWith("/rest/v1/workspace_records")), "The synthetic test attempted a non-fixture database or external provider request.");
  console.log("MCP HTTP synthetic contract: initialize, archived athlete read, privacy-filtered full match, recent-match coach analysis without embeddings, paginated lexical search, weekly proposal prepare/idempotency/approve and confirmation refusal, RAG sensitive-query refusal, tool refusal without provider key — passed; external network calls: 0.");
} finally {
  if (server) {
    server.shutdown();
    await server.finished;
  }
  globalThis.fetch = originalFetch;
  runtime.serve = originalServe;
}
