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
globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  networkPaths.push(url.origin + url.pathname);
  if (url.origin === "http://supabase.synthetic" && url.pathname === "/rest/v1/rpc/mcp_connector_lookup") {
    return Response.json(connector);
  }
  if (url.origin === "http://supabase.synthetic" && url.pathname === "/rest/v1/workspace_records") {
    workspaceQueries.push(url.searchParams);
    const query = url.searchParams;
    check(query.get("team_id") === `eq.${connector.team_id}`, "Archived athlete read was not scoped to the authorized team.");
    check(query.get("kind") === "eq.document", "Archived athlete read queried a non-document record.");
    check(query.get("payload->>type") === "eq.player_archive", "Archived athlete read did not filter archive documents.");
    check(query.get("payload->>external_key") === `eq.player-archive:default:${archivePlayerRef}`, "Archived athlete read did not use the exact stable athlete UUID.");
    check(query.get("deleted_at") === "is.null", "Archived athlete read included deleted archive documents.");
    return Response.json([archiveRecord]);
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
  check(/first locate candidate citations with search_team_knowledge or get_cross_session_evidence/i.test(initialized.result.instructions), "Missing evidence-retrieval instruction.");
  check(/Never invent a source UUID, revision, field or quote/i.test(initialized.result.instructions), "Missing anti-fabrication instruction.");
  check(/category player_goal_archive or evidence type historical_coach_goal/i.test(initialized.result.instructions), "Missing instruction to preserve archived athlete goals as historical evidence.");
  check(/For a permanently removed athlete's retained development history, use get_archived_player_development/i.test(initialized.result.instructions), "Missing MCP route for archived athlete development.");

  const listed = await call("tools/list");
  const tool = listed.result.tools.find((item: any) => item.name === "evaluate_cross_session_pattern");
  check(tool, "The multi-source Jev tool is not exposed over MCP HTTP.");
  check(tool.inputSchema.properties.match_sources.minItems === 2, "MCP did not expose the minimum distinct-match evidence contract.");
  check(tool.inputSchema.properties.training_sources.minItems === 1, "MCP did not require training evidence.");
  const archivedPlayerTool = listed.result.tools.find((item: any) => item.name === "get_archived_player_development");
  check(archivedPlayerTool?.annotations?.readOnlyHint === true, "Archived athlete development must be available as a read-only MCP tool.");
  check(archivedPlayerTool.inputSchema.properties.player_ref.format === "uuid", "Archived athlete development must use the shared UUID.");

  const archivedPlayer = await call("tools/call", {
    name: "get_archived_player_development",
    arguments: { player_ref: archivePlayerRef },
  });
  check(!archivedPlayer.result.isError, "The archived athlete read failed over MCP HTTP.");
  check(archivedPlayer.result.structuredContent.historical_only === true && archivedPlayer.result.structuredContent.archive_status === "archived", "The MCP archive result did not identify its contents as historical only.");
  check(archivedPlayer.result.structuredContent.player.ref === archivePlayerRef, "The MCP archive result lost the stable athlete UUID.");
  check(archivedPlayer.result.structuredContent.goals[0].history.length === 0, "The MCP archive result changed the historical goals.");
  check(workspaceQueries.length === 1, "The MCP archive read did not make exactly one scoped data query.");

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
  check(networkPaths.every((path) => path.endsWith("/rest/v1/rpc/mcp_connector_lookup") || path.endsWith("/rest/v1/workspace_records")), "The synthetic test attempted a non-fixture database or external provider request.");
  console.log("MCP HTTP synthetic contract: initialize, archived athlete read, tools/list, tool refusal without provider key — passed; external network calls: 0.");
} finally {
  if (server) {
    server.shutdown();
    await server.finished;
  }
  globalThis.fetch = originalFetch;
  runtime.serve = originalServe;
}
