import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.116.0";

import { IMAGE_TOOLS, executeImageTool } from "./image_uploads.mjs";
import { SESSION_TOOLS, executeSessionTool } from "./training_sessions.mjs";
import { CONTINUITY_TOOLS, executeContinuityTool } from "./training_continuity.mjs";
import { MATCH_VISUAL_TOOLS, executeMatchVisualTool } from "./match_visual.mjs";
import { MATCH_EVENTS_TOOLS, executeMatchEventsTool } from "./match_events.mjs";
import { MATCH_ANALYSIS_TOOLS, executeMatchAnalysisTool } from "./match_analysis.mjs";
import { MATCH_EVIDENCE_TOOLS, executeMatchEvidenceTool } from "./match_evidence.mjs";
import { PLAYER_GOAL_TOOLS, executePlayerGoalTool } from "./player_goals.mjs";
import { TEAM_DEVELOPMENT_TOOLS, executeTeamDevelopmentTool } from "./team_development.mjs";
import { SEASON_TOOLS, executeSeasonTool } from "./seasons.mjs";
import { REPORT_TOOLS, executeReportTool } from "./reports.mjs";

const SERVER_NAME = "vision-coach";
const SERVER_VERSION = "1.12.0";
const MODERN_PROTOCOL = "2026-07-28";
const LEGACY_PROTOCOLS = new Set(["2025-11-25", "2025-06-18", "2025-03-26"]);
const MAX_BODY_BYTES = 256 * 1024;

function headers(extra: Record<string,string> = {}) {
  return {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "authorization, content-type, mcp-protocol-version, mcp-method, mcp-name, mcp-session-id",
    "access-control-allow-methods": "POST, OPTIONS, DELETE",
    "access-control-expose-headers": "Mcp-Session-Id, MCP-Protocol-Version",
    ...extra,
  };
}

function response(status: number, body: unknown, extra: Record<string,string> = {}) {
  return new Response(body == null ? null : JSON.stringify(body), {
    status,
    headers: headers(extra),
  });
}

function rpcResult(id: unknown, result: unknown) {
  return { jsonrpc: "2.0", id, result };
}

function rpcError(id: unknown, code: number, message: string, data?: unknown) {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message, ...(data === undefined ? {} : { data }) } };
}

function textResult(data: unknown, isError = false) {
  const text = typeof data === "string" ? data : JSON.stringify(data, null, 2);
  return {
    content: [{ type: "text", text }],
    structuredContent: typeof data === "object" && data !== null ? data : { value: data },
    ...(isError ? { isError: true } : {}),
  };
}

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return [...digest].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function slug(value: unknown) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function clampLimit(value: unknown, fallback = 20, max = 100) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(1, Math.min(Math.floor(n), max)) : fallback;
}

function validUuid(value: unknown) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ""));
}

function requireScope(connector: any, scope: string) {
  if (!Array.isArray(connector?.scopes) || !connector.scopes.includes(scope)) {
    throw new Error("connector_scope_" + scope + "_required");
  }
}

function normalizePlayerAvailability(value: unknown) {
  const status = String(value || "disponivel").trim().toLowerCase();
  const allowed = new Set(["disponivel","indisponivel","lesionado","castigado","ausente"]);
  if (!allowed.has(status)) throw new Error("invalid_player_availability");
  return status;
}

const TOOLS = [
  ...IMAGE_TOOLS,
  ...SESSION_TOOLS,
  ...CONTINUITY_TOOLS,
  ...MATCH_VISUAL_TOOLS,
  ...MATCH_EVENTS_TOOLS,
  ...MATCH_ANALYSIS_TOOLS,
  ...MATCH_EVIDENCE_TOOLS,
  ...PLAYER_GOAL_TOOLS,
  ...TEAM_DEVELOPMENT_TOOLS,
  ...SEASON_TOOLS,
  ...REPORT_TOOLS,
  {
    name: "workspace_summary",
    description: "Resumo atual do workspace Vision Coach: equipa, próximos jogos, exercícios e treinos recentes.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  {
    name: "search_workspace",
    description: "Pesquisa texto nos registos ativos do workspace (jogos, exercícios, treinos, documentos, memória e jogadores).",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", minLength: 1 },
        kinds: { type: "array", items: { type: "string", enum: ["player","match","training","exercise","memory","document","game_model"] } },
        limit: { type: "integer", minimum: 1, maximum: 50 },
      },
      required: ["query"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  {
    name: "list_players",
    description: "Lista o plantel atual e o estado operacional de disponibilidade de cada jogador. Não devolve diagnósticos médicos.",
    inputSchema: {
      type: "object",
      properties: {
        availability: { type: "string", enum: ["disponivel","indisponivel","lesionado","castigado","ausente"] },
        include_retired: { type: "boolean", default: false },
        limit: { type: "integer", minimum: 1, maximum: 100 },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  {
    name: "list_matches",
    description: "Lista jogos do workspace, ordenados por data.",
    inputSchema: {
      type: "object",
      properties: {
        state: { type: "string", description: "Ex.: agendado, concluido, cancelado." },
        limit: { type: "integer", minimum: 1, maximum: 50 },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  {
    name: "get_match",
    description: "Obtém um jogo pelo UUID remoto ou external_key.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", format: "uuid" },
        external_key: { type: "string" },
      },
      additionalProperties: false,
      oneOf: [{ required: ["id"], not: { required: ["external_key"] } }, { required: ["external_key"], not: { required: ["id"] } }],
    },
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  {
    name: "list_exercises",
    description: "Lista e pesquisa exercícios da Biblioteca Vision Coach.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        favorites_only: { type: "boolean" },
        limit: { type: "integer", minimum: 1, maximum: 100 },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  {
    name: "list_trainings",
    description: "Lista treinos planeados no workspace.",
    inputSchema: {
      type: "object",
      properties: { limit: { type: "integer", minimum: 1, maximum: 50 } },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  {
    name: "update_player_availability",
    description: "Altera apenas o estado operacional de disponibilidade de um jogador do plantel. Não regista diagnósticos médicos.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", format: "uuid", description: "UUID remoto do jogador." },
        external_key: { type: "string" },
        availability: { type: "string", enum: ["disponivel","indisponivel","lesionado","castigado","ausente"] },
        expected_updated_at: { type: "string" },
        confirmed: { type: "boolean", const: true },
      },
      required: ["availability", "expected_updated_at", "confirmed"],
      additionalProperties: false,
      oneOf: [{ required: ["id"], not: { required: ["external_key"] } }, { required: ["external_key"], not: { required: ["id"] } }],
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  {
    name: "set_player_roster_status",
    description: "Retira ou reintegra um jogador no plantel, preservando o histórico.",
    inputSchema: {type:"object",properties:{id:{type:"string",format:"uuid"},external_key:{type:"string"},active:{type:"boolean"},expected_updated_at:{type:"string"},confirmed:{type:"boolean",const:true}},required:["active","expected_updated_at","confirmed"],additionalProperties:false,oneOf:[{required:["id"],not:{required:["external_key"]}},{required:["external_key"],not:{required:["id"]}}]},
    annotations: {readOnlyHint:false,destructiveHint:false},
  },
  {
    name: "remove_player_permanently",
    description: "Retira definitivamente um jogador do workspace ativo, preservando o histórico interno.",
    inputSchema: {type:"object",properties:{id:{type:"string",format:"uuid"},external_key:{type:"string"},expected_updated_at:{type:"string"},confirmed:{type:"boolean",const:true}},required:["expected_updated_at","confirmed"],additionalProperties:false,oneOf:[{required:["id"],not:{required:["external_key"]}},{required:["external_key"],not:{required:["id"]}}]},
    annotations: {readOnlyHint:false,destructiveHint:true},
  },
  {
    name: "create_exercise",
    description: "Cria um exercício reutilizável na Biblioteca Vision Coach.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", minLength: 1 },
        objective: { type: "string", minLength: 1 },
        age_group: { type: "string", default: "Sub-8" },
        game_model: { type: "string", default: "5x5-1-2-1" },
        organization: { type: "string" },
        area: { type: "string" },
        series: { type: "integer", minimum: 1, maximum: 20 },
        minutes_per_series: { type: "number", minimum: 0, maximum: 120 },
        material: { type: "array", items: { type: "string" } },
        rules: { type: "array", items: { type: "string" } },
        coaching_points: { type: "array", items: { type: "string" } },
        progression: { type: "string" },
        regression: { type: "string" },
        tags: { type: "array", items: { type: "string" } },
        favorite: { type: "boolean" },
        external_key: { type: "string" },
        confirmed: { type: "boolean", const: true },
      },
      required: ["name", "objective", "confirmed"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  {
    name: "create_training",
    description: "Cria um treino por blocos usando exercícios existentes da Biblioteca Vision Coach.",
    inputSchema: {
      type: "object",
      properties: {
        date: { type: "string", description: "YYYY-MM-DD" },
        time: { type: "string", description: "HH:MM" },
        objective: { type: "string", minLength: 1 },
        location: { type: "string" },
        notes: { type: "string" },
        source_match_ref: { type: "string", format: "uuid", description: "UUID remoto do jogo relacionado." },
        source_match_expected_updated_at: { type: "string", description: "Revisão atual do jogo de origem; obrigatório quando source_match_ref é usado." },
        external_key: { type: "string" },
        blocks: {
          type: "array",
          minItems: 1,
          items: {
            type: "object",
            properties: {
              exercise_id: { type: "string" },
              exercise_external_key: { type: "string" },
              phase: { type: "string", enum: ["ativacao","principal","jogo","retorno"] },
              duration_min: { type: "number", minimum: 0, maximum: 180 },
              notes: { type: "string" },
            },
            additionalProperties: false,
          },
        },
        confirmed: { type: "boolean", const: true },
      },
      required: ["date", "objective", "blocks", "confirmed"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  {
    name: "update_match_pre_game",
    description: "Atualiza apenas o plano pré-jogo, preservando convocatória, alinhamento, durante e pós-jogo.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", format: "uuid" },
        external_key: { type: "string" },
        expected_updated_at: { type: "string" },
        confirmed: { type: "boolean", const: true },
        main_objective: { type: "string" },
        game_plan: { type: "string" },
        opponent_notes: { type: "string" },
        opponent_formation: { type: "string", maxLength: 40 },
        opponent_style: { type: "string", enum: ["posse","direto","pressao_alta","bloco_baixo","transicoes"] },
        opponent_strengths: { type: "array", items: { type: "string", maxLength: 500 }, maxItems: 20 },
        opponent_vulnerabilities: { type: "array", items: { type: "string", maxLength: 500 }, maxItems: 20 },
        observation_points: { type: "array", items: { type: "string" } },
      },
      additionalProperties: false,
      required: ["expected_updated_at", "confirmed"],
      oneOf: [{ required: ["id"], not: { required: ["external_key"] } }, { required: ["external_key"], not: { required: ["id"] } }],
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  {
    name: "get_media",
    description: "Lê um media do workspace pelo UUID estável, incluindo a revisão atual e a associação.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string", format: "uuid" } },
      required: ["id"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  {
    name: "update_external_media",
    description: "Atualiza metadados ou URL HTTPS de um media externo após leitura e confirmação explícita do treinador. Não altera ficheiros privados.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", format: "uuid" },
        expected_updated_at: { type: "string", minLength: 1 },
        title: { type: "string", minLength: 1, maxLength: 160 },
        note: { type: "string", maxLength: 2000 },
        url: { type: "string", minLength: 8, maxLength: 8000 },
        confirmed: { type: "boolean", const: true },
      },
      required: ["id", "expected_updated_at", "confirmed"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  {
    name: "add_external_media",
    description: "Associa ao workspace um vídeo, fotografia ou ficheiro por URL HTTPS.",
    inputSchema: {
      type: "object",
      properties: {
        subject_type: { type: "string", enum: ["player","match","training","exercise","memory","document","game_model"] },
        subject_ref: { type: "string" },
        media_type: { type: "string", enum: ["photo","video","file"] },
        title: { type: "string", minLength: 1 },
        url: { type: "string", minLength: 8 },
        note: { type: "string" },
        confirmed: { type: "boolean", const: true },
      },
      required: ["subject_type","subject_ref","media_type","title","url","confirmed"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
];

async function findRecord(admin: any, teamId: string, kind: string, args: any) {
  if (Boolean(args?.id) === Boolean(args?.external_key)) throw new Error("exactly_one_record_identifier_required");
  if (args?.id && !validUuid(args.id)) throw new Error("invalid_record_uuid");
  if (args?.external_key && !String(args.external_key).trim()) throw new Error("invalid_external_key");
  const { data, error } = await admin.from("workspace_records")
    .select("*").eq("team_id", teamId).eq("kind", kind).is("deleted_at", null);
  if (error) throw error;
  const rows = data || [];
  if (args?.id) return rows.find((x: any) => x.id === String(args.id)) || null;
  if (args?.external_key) {
    const key = String(args.external_key).trim().toLowerCase();
    return rows.find((x: any) => String(x.payload?.external_key || "").trim().toLowerCase() === key) || null;
  }
  return null;
}

async function putRecord(admin: any, teamId: string, kind: string, payload: any, existing?: any, requestKey?: string) {
  const { data, error } = await admin.rpc("head_coach_put_record", {
    p_team_id: teamId,
    p_kind: kind,
    p_payload: payload,
    p_record_id: existing?.id || null,
    p_expected_updated_at: existing?.updated_at || null,
    p_idempotency_key: requestKey || null,
    p_agent_subject: "head-coach",
  });
  if (error) throw error;
  return data;
}

async function executeTool(admin: any, connector: any, name: string, args: any, requestId: unknown) {
  const teamId = String(connector.team_id);
  if (MATCH_VISUAL_TOOLS.some((tool) => tool.name === name)) return executeMatchVisualTool(admin,connector,name,args);
  if (MATCH_EVENTS_TOOLS.some((tool) => tool.name === name)) return executeMatchEventsTool(admin,connector,name,args);
  if (MATCH_ANALYSIS_TOOLS.some((tool) => tool.name === name)) return executeMatchAnalysisTool(admin,connector,name,args);
  if (MATCH_EVIDENCE_TOOLS.some((tool) => tool.name === name)) return executeMatchEvidenceTool(admin,connector,name,args);
  if (PLAYER_GOAL_TOOLS.some((tool) => tool.name === name)) return executePlayerGoalTool(admin,connector,name,args);
  if (TEAM_DEVELOPMENT_TOOLS.some((tool) => tool.name === name)) return executeTeamDevelopmentTool(admin,connector,name,args);
  if (SEASON_TOOLS.some((tool) => tool.name === name)) return executeSeasonTool(admin,connector,name,args);
  if (REPORT_TOOLS.some((tool) => tool.name === name)) return executeReportTool(admin,connector,name,args);
  if (CONTINUITY_TOOLS.some((tool) => tool.name === name)) return executeContinuityTool(admin,connector,name,args);
  if (SESSION_TOOLS.some((tool) => tool.name === name)) return executeSessionTool(admin,connector,name,args);
  if (IMAGE_TOOLS.some((tool) => tool.name === name)) return executeImageTool(admin,connector,name,args,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "");

  if (name === "workspace_summary") {
    requireScope(connector, "read");
    const [{ data: team, error: teamError }, { data: records, error: recordsError }] = await Promise.all([
      admin.from("teams").select("id,name,metadata,updated_at").eq("id", teamId).maybeSingle(),
      admin.from("workspace_records").select("id,kind,payload,actor_type,actor_label,updated_at")
        .eq("team_id", teamId).is("deleted_at", null),
    ]);
    if (teamError) throw teamError;
    if (recordsError) throw recordsError;
    const rows = records || [];
    const matches = rows.filter((x: any) => x.kind === "match")
      .sort((a: any,b: any) => String(a.payload?.data || "").localeCompare(String(b.payload?.data || "")));
    const today = new Date().toISOString().slice(0,10);
    const upcoming = matches.filter((x: any) => String(x.payload?.data || "") >= today).slice(0,5);
    const trainings = rows.filter((x: any) => x.kind === "training")
      .sort((a: any,b: any) => String(b.payload?.data || "").localeCompare(String(a.payload?.data || ""))).slice(0,5);
    const exercises = rows.filter((x: any) => x.kind === "exercise");
    return {
      connector: { label: connector.label, scopes: connector.scopes },
      team,
      upcoming_matches: upcoming,
      exercise_count: exercises.length,
      recent_trainings: trainings,
    };
  }

  if (name === "search_workspace") {
    requireScope(connector, "read");
    const query = String(args?.query || "").trim().toLowerCase();
    if (!query) throw new Error("query_required");
    const kinds = Array.isArray(args?.kinds) && args.kinds.length ? new Set(args.kinds.map(String)) : null;
    const limit = clampLimit(args?.limit, 20, 50);
    const { data, error } = await admin.from("workspace_records")
      .select("id,kind,payload,actor_type,actor_label,updated_at")
      .eq("team_id", teamId).is("deleted_at", null);
    if (error) throw error;
    return (data || [])
      .filter((x: any) => (!kinds || kinds.has(x.kind)) && JSON.stringify(x.payload || {}).toLowerCase().includes(query))
      .slice(0, limit);
  }

  if (name === "list_players") {
    requireScope(connector, "read");
    const limit = clampLimit(args?.limit, 50, 100);
    const requested = args?.availability ? normalizePlayerAvailability(args.availability) : null;
    const { data, error } = await admin.from("workspace_records")
      .select("id,payload,actor_type,actor_label,updated_at")
      .eq("team_id", teamId).eq("kind", "player").is("deleted_at", null);
    if (error) throw error;
    return (data || [])
      .filter((row: any) => args?.include_retired || row.payload?.plantel_ativo !== false)
      .filter((row: any) => !requested || normalizePlayerAvailability(row.payload?.estado_disponibilidade) === requested)
      .sort((a: any,b: any) => String(a.payload?.nome || "").localeCompare(String(b.payload?.nome || "")))
      .slice(0, limit)
      .map((row: any) => ({
        id: row.id,
        updated_at: row.updated_at,
        actor_type: row.actor_type,
        actor_label: row.actor_label,
        player: {
          nome: row.payload?.nome || null,
          numero: row.payload?.numero ?? null,
          escalao: row.payload?.escalao || null,
          posicao: row.payload?.posicao || null,
          estado_disponibilidade: normalizePlayerAvailability(row.payload?.estado_disponibilidade),
          plantel_ativo: row.payload?.plantel_ativo !== false,
          external_key: row.payload?.external_key || null,
        },
      }));
  }

  if (name === "list_matches") {
    requireScope(connector, "read");
    const limit = clampLimit(args?.limit, 20, 50);
    const { data, error } = await admin.from("workspace_records")
      .select("id,kind,payload,actor_type,actor_label,updated_at")
      .eq("team_id", teamId).eq("kind", "match").is("deleted_at", null);
    if (error) throw error;
    let rows = data || [];
    if (args?.state) rows = rows.filter((x: any) => String(x.payload?.estado || "") === String(args.state));
    rows.sort((a: any,b: any) => String(a.payload?.data || "").localeCompare(String(b.payload?.data || "")));
    return rows.slice(0, limit);
  }

  if (name === "get_match") {
    requireScope(connector, "read");
    const row = await findRecord(admin, teamId, "match", args);
    if (!row) throw new Error("match_not_found");
    return row;
  }

  if (name === "list_exercises") {
    requireScope(connector, "read");
    const limit = clampLimit(args?.limit, 50, 100);
    const query = String(args?.query || "").trim().toLowerCase();
    const { data, error } = await admin.from("workspace_records")
      .select("id,kind,payload,actor_type,actor_label,updated_at")
      .eq("team_id", teamId).eq("kind", "exercise").is("deleted_at", null);
    if (error) throw error;
    return (data || []).filter((x: any) => {
      if (args?.favorites_only && !x.payload?.favorito) return false;
      return !query || JSON.stringify(x.payload || {}).toLowerCase().includes(query);
    }).sort((a: any,b: any) => String(a.payload?.nome || "").localeCompare(String(b.payload?.nome || ""))).slice(0, limit);
  }

  if (name === "list_trainings") {
    requireScope(connector, "read");
    const limit = clampLimit(args?.limit, 20, 50);
    const { data, error } = await admin.from("workspace_records")
      .select("id,kind,payload,actor_type,actor_label,updated_at")
      .eq("team_id", teamId).eq("kind", "training").is("deleted_at", null);
    if (error) throw error;
    return (data || []).sort((a: any,b: any) =>
      String(b.payload?.data || "").localeCompare(String(a.payload?.data || ""))
    ).slice(0, limit);
  }

  if (name === "update_player_availability") {
    requireScope(connector, "write");
    if (args?.confirmed !== true) throw new Error("explicit_confirmation_required");
    const availability = normalizePlayerAvailability(args?.availability);
    const existing = await findRecord(admin, teamId, "player", args);
    if (!existing) throw new Error("player_not_found");
    if (!args.expected_updated_at || args.expected_updated_at !== existing.updated_at) throw new Error("record_conflict_read_again");
    if (existing.payload?.plantel_ativo === false) throw new Error("player_not_in_roster");
    const payload = {
      ...(existing.payload || {}),
      estado_disponibilidade: availability,
    };
    const record = await putRecord(admin, teamId, "player", payload, existing,
      "mcp:" + connector.id + ":player-availability:" + existing.id + ":" + existing.updated_at + ":" + availability);
    return {
      updated: true,
      player: {
        id: existing.id,
        nome: payload.nome || null,
        estado_disponibilidade: availability,
      },
      record,
    };
  }

  if (name === "set_player_roster_status") {
    requireScope(connector,"write");
    if (args?.confirmed !== true) throw new Error("explicit_confirmation_required");
    const existing=await findRecord(admin,teamId,"player",args);
    if(!existing) throw new Error("player_not_found");
    if(!args.expected_updated_at||args.expected_updated_at!==existing.updated_at) throw new Error("record_conflict_read_again");
    const active=Boolean(args?.active);
    const payload={...(existing.payload||{}),plantel_ativo:active,estado_disponibilidade:active?normalizePlayerAvailability(existing.payload?.estado_disponibilidade):"indisponivel"};
    const record=await putRecord(admin,teamId,"player",payload,existing,"mcp:"+connector.id+":player-roster:"+existing.id+":"+existing.updated_at+":"+String(active));
    return {updated:true,player:{id:existing.id,nome:payload.nome||null,plantel_ativo:active,estado_disponibilidade:payload.estado_disponibilidade},record};
  }
  if (name === "remove_player_permanently") {
    requireScope(connector,"write");
    if (args?.confirmed !== true) throw new Error("explicit_confirmation_required");
    const existing=await findRecord(admin,teamId,"player",args);
    if(!existing) throw new Error("player_not_found");
    if(!args.expected_updated_at||args.expected_updated_at!==existing.updated_at) throw new Error("record_conflict_read_again");
    const {data,error}=await admin.rpc("head_coach_soft_delete_record",{p_team_id:teamId,p_record_id:existing.id,p_expected_updated_at:existing.updated_at,p_idempotency_key:"mcp:"+connector.id+":player-remove:"+existing.id+":"+existing.updated_at,p_agent_subject:"head-coach"});
    if(error) throw error;
    if(!data) throw new Error("player_remove_conflict");
    return {removed:true,player:{id:existing.id,nome:existing.payload?.nome||null,deleted_at:data.deleted_at||null},record:data};
  }

  if (name === "create_exercise") {
    requireScope(connector, "write");
    if (args?.confirmed !== true) throw new Error("explicit_confirmation_required");
    const exerciseName = String(args?.name || "").trim();
    const objective = String(args?.objective || "").trim();
    if (!exerciseName || !objective) throw new Error("name_and_objective_required");
    const series = Math.max(1, Number(args?.series || 1));
    const minutes = Math.max(0, Number(args?.minutes_per_series || 0));
    const externalKey = String(args?.external_key || ("exercise-" + slug(exerciseName))).slice(0,200);
    const existing = await findRecord(admin, teamId, "exercise", { external_key: externalKey });
    if (existing) return { created: false, record: existing };

    const payload = {
      workspace_v2: true,
      nome: exerciseName,
      escalao: String(args?.age_group || "Sub-8"),
      modelo: String(args?.game_model || "5x5-1-2-1"),
      objetivo: objective,
      organizacao: String(args?.organization || ""),
      espaco: String(args?.area || ""),
      series,
      duracao_serie_min: minutes,
      duracao_total_min: series * minutes,
      material: Array.isArray(args?.material) ? args.material.map(String) : [],
      regras: Array.isArray(args?.rules) ? args.rules.map(String) : [],
      coaching_points: Array.isArray(args?.coaching_points) ? args.coaching_points.map(String) : [],
      progressao: args?.progression ? String(args.progression) : null,
      regressao: args?.regression ? String(args.regression) : null,
      tags: Array.isArray(args?.tags) ? args.tags.map(String) : [],
      favorito: Boolean(args?.favorite),
      status: "active",
      external_key: externalKey,
      source: "mcp",
    };
    const record = await putRecord(admin, teamId, "exercise", payload, undefined,
      "mcp:" + connector.id + ":exercise:" + externalKey);
    return { created: true, record };
  }

  if (name === "create_training") {
    requireScope(connector, "write");
    if (args?.confirmed !== true) throw new Error("explicit_confirmation_required");
    const date = String(args?.date || "");
    const objective = String(args?.objective || "").trim();
    const blocksInput = Array.isArray(args?.blocks) ? args.blocks : [];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !objective || !blocksInput.length) {
      throw new Error("date_objective_and_blocks_required");
    }
    const { data: exerciseRows, error: exerciseError } = await admin.from("workspace_records")
      .select("id,payload").eq("team_id", teamId).eq("kind", "exercise").is("deleted_at", null);
    if (exerciseError) throw exerciseError;

    const blocks = blocksInput.map((block: any, index: number) => {
      const exercise = (exerciseRows || []).find((x: any) =>
        (block.exercise_id && x.id === String(block.exercise_id)) ||
        (block.exercise_external_key && String(x.payload?.external_key || "") === String(block.exercise_external_key))
      );
      if (!exercise) throw new Error("exercise_not_found_for_block_" + (index + 1));
      const duration = Math.max(0, Number(block.duration_min ?? exercise.payload?.duracao_total_min ?? 0));
      return {
        order: index,
        exercise_ref: exercise.id,
        exercise_name: exercise.payload?.nome || "Exercício",
        phase: String(block.phase || "principal"),
        duration_min: duration,
        notes: block.notes ? String(block.notes) : null,
      };
    });

    if (args?.source_match_ref) {
      if (!validUuid(args.source_match_ref)) throw new Error("invalid_source_match_ref");
      const source = await findRecord(admin, teamId, "match", { id: args.source_match_ref });
      if (!source) throw new Error("source_match_not_found");
      if (!args.source_match_expected_updated_at || args.source_match_expected_updated_at !== source.updated_at) throw new Error("record_conflict_read_source_again");
    }

    const externalKey = String(args?.external_key ||
      ("training-" + date + "-" + slug(args?.time || "session") + "-" + slug(objective).slice(0,40))).slice(0,200);
    const existing = await findRecord(admin, teamId, "training", { external_key: externalKey });
    if (existing) return { created: false, record: existing };

    const { data: team, error: teamError } = await admin.from("teams")
      .select("metadata").eq("id", teamId).maybeSingle();
    if (teamError) throw teamError;
    const payload = {
      data: date,
      hora: args?.time ? String(args.time) : null,
      local: args?.location ? String(args.location) : null,
      escalao: team?.metadata?.escalao || "sub-8",
      objetivo: objective,
      notas: args?.notes ? String(args.notes) : null,
      source_match_ref: args?.source_match_ref ? String(args.source_match_ref) : null,
      status: "ready",
      blocos: blocks,
      duracao_min: blocks.reduce((sum: number,b: any) => sum + Number(b.duration_min || 0), 0),
      external_key: externalKey,
      source: "mcp",
    };
    const record = await putRecord(admin, teamId, "training", payload, undefined,
      "mcp:" + connector.id + ":training:" + externalKey);
    return { created: true, record };
  }

  if (name === "update_match_pre_game") {
    requireScope(connector, "write");
    if (args?.confirmed !== true) throw new Error("explicit_confirmation_required");
    const existing = await findRecord(admin, teamId, "match", args);
    if (!existing) throw new Error("match_not_found");
    if (!args.expected_updated_at || args.expected_updated_at !== existing.updated_at) throw new Error("record_conflict_read_again");
    const payload = { ...(existing.payload || {}) };
    payload.pre_game = {
      ...(payload.pre_game || {}),
      status: "ready",
      objetivo_principal: args?.main_objective ?? payload.pre_game?.objetivo_principal ?? null,
      plano_jogo: args?.game_plan ?? payload.pre_game?.plano_jogo ?? null,
      adversario_notas: args?.opponent_notes ?? payload.pre_game?.adversario_notas ?? null,
      adversario_sistema: args?.opponent_formation ?? payload.pre_game?.adversario_sistema ?? null,
      adversario_estilo: args?.opponent_style ?? payload.pre_game?.adversario_estilo ?? null,
      adversario_pontos_fortes: Array.isArray(args?.opponent_strengths)
        ? args.opponent_strengths.map((x: unknown) => String(x).trim().slice(0, 500)).filter(Boolean).slice(0, 20)
        : (payload.pre_game?.adversario_pontos_fortes || []),
      adversario_vulnerabilidades: Array.isArray(args?.opponent_vulnerabilities)
        ? args.opponent_vulnerabilities.map((x: unknown) => String(x).trim().slice(0, 500)).filter(Boolean).slice(0, 20)
        : (payload.pre_game?.adversario_vulnerabilidades || []),
      pontos_observar: Array.isArray(args?.observation_points)
        ? args.observation_points.map(String)
        : (payload.pre_game?.pontos_observar || []),
    };
    const record = await putRecord(admin, teamId, "match", payload, existing,
      "mcp:" + connector.id + ":match-pre:" + existing.id + ":" + existing.updated_at);
    return { updated: true, record };
  }

  if (name === "add_external_media") {
    requireScope(connector, "media");
    if (args?.confirmed !== true) throw new Error("explicit_confirmation_required");
    const url = String(args?.url || "").trim();
    if (!/^https:\/\//i.test(url)) throw new Error("https_url_required");
    if (!validUuid(args?.subject_ref)) throw new Error("invalid_subject_ref");
    const { data, error } = await admin.rpc("head_coach_register_media", {
      p_team_id: teamId,
      p_subject_type: String(args.subject_type),
      p_subject_ref: String(args.subject_ref),
      p_media_type: String(args.media_type),
      p_title: String(args.title),
      p_note: args?.note ? String(args.note) : null,
      p_external_url: url,
      p_storage_path: null,
      p_file_name: null,
      p_mime_type: null,
      p_size_bytes: null,
      p_media_id: null,
      p_expected_updated_at: null,
      p_idempotency_key: "mcp:" + connector.id + ":media:" + String(requestId ?? crypto.randomUUID()),
      p_agent_subject: "head-coach",
    });
    if (error) throw error;
    return { created: true, media: data };
  }

  if (name === "get_media") {
    requireScope(connector, "read");
    if (!validUuid(args?.id)) throw new Error("invalid_media_uuid");
    const { data, error } = await admin.from("media_assets")
      .select("id,team_id,subject_type,subject_ref,media_type,title,note,external_url,storage_path,file_name,mime_type,size_bytes,actor_type,actor_label,created_at,updated_at,deleted_at")
      .eq("team_id", teamId).eq("id", args.id).maybeSingle();
    if (error) throw error;
    if (!data || data.deleted_at) throw new Error("media_not_found");
    return data;
  }

  if (name === "update_external_media") {
    requireScope(connector, "media");
    if (args?.confirmed !== true) throw new Error("explicit_confirmation_required");
    if (!validUuid(args?.id)) throw new Error("invalid_media_uuid");
    if (!args?.expected_updated_at) throw new Error("expected_updated_at_required");
    if (!["title", "note", "url"].some((key) => Object.prototype.hasOwnProperty.call(args, key))) {
      throw new Error("media_update_field_required");
    }
    const { data: existing, error: readError } = await admin.from("media_assets")
      .select("id,team_id,subject_type,subject_ref,media_type,title,note,external_url,storage_path,file_name,mime_type,size_bytes,updated_at,deleted_at")
      .eq("team_id", teamId).eq("id", args.id).maybeSingle();
    if (readError) throw readError;
    if (!existing || existing.deleted_at) throw new Error("media_not_found");
    if (!existing.external_url || existing.storage_path) throw new Error("private_or_local_media_is_not_editable_via_agent");
    if (existing.updated_at !== args.expected_updated_at) throw new Error("record_conflict_read_again");
    const url = Object.prototype.hasOwnProperty.call(args, "url") ? String(args.url || "").trim() : existing.external_url;
    if (!/^https:\/\//i.test(url)) throw new Error("https_url_required");
    const title = Object.prototype.hasOwnProperty.call(args, "title") ? String(args.title || "").trim() : existing.title;
    if (!title) throw new Error("media_title_required");
    const note = Object.prototype.hasOwnProperty.call(args, "note") ? String(args.note || "") : existing.note;
    if (title.length > 160 || note.length > 2000 || url.length > 8000) throw new Error("media_field_too_long");
    const { data, error } = await admin.rpc("head_coach_register_media", {
      p_team_id: teamId,
      p_subject_type: existing.subject_type,
      p_subject_ref: existing.subject_ref,
      p_media_type: existing.media_type,
      p_title: title,
      p_note: note,
      p_external_url: url,
      p_storage_path: existing.storage_path,
      p_file_name: existing.file_name,
      p_mime_type: existing.mime_type,
      p_size_bytes: existing.size_bytes,
      p_media_id: existing.id,
      p_expected_updated_at: existing.updated_at,
      p_idempotency_key: "mcp:" + connector.id + ":media-update:" + String(requestId ?? crypto.randomUUID()),
      p_agent_subject: "head-coach",
    });
    if (error) throw error;
    return { updated: true, media: data };
  }

  throw new Error("unknown_tool");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: headers() });
  if (req.method === "DELETE") return response(200, { ok: true });
  if (req.method !== "POST") return response(405, { error: "method_not_allowed" });

  const contentLength = Number(req.headers.get("content-length") || "0");
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return response(413, rpcError(null, -32600, "Request too large"));
  }

  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token.startsWith("vcmcp_") || token.length < 30) {
    return response(401, { error: "invalid_connector_token" }, {
      "www-authenticate": 'Bearer realm="Vision Coach MCP"',
    });
  }

  const url = Deno.env.get("SUPABASE_URL") || "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!url || !serviceKey) return response(500, { error: "server_not_configured" });
  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  const tokenHash = await sha256(token);
  const { data: connector, error: connectorError } = await admin.rpc("mcp_connector_lookup", {
    p_token_hash: tokenHash,
  });
  if (connectorError || !connector) {
    return response(401, { error: "connector_not_authorized" }, {
      "www-authenticate": 'Bearer realm="Vision Coach MCP"',
    });
  }

  let message: any;
  try {
    message = await req.json();
  } catch (_) {
    return response(400, rpcError(null, -32700, "Parse error"));
  }

  if (!message || message.jsonrpc !== "2.0" || typeof message.method !== "string") {
    return response(400, rpcError(message?.id ?? null, -32600, "Invalid Request"));
  }

  const requestedVersion = String(
    req.headers.get("mcp-protocol-version") ||
    message.params?.protocolVersion ||
    MODERN_PROTOCOL
  );
  const protocolVersion = requestedVersion === MODERN_PROTOCOL || LEGACY_PROTOCOLS.has(requestedVersion)
    ? requestedVersion
    : MODERN_PROTOCOL;
  const commonHeaders = { "MCP-Protocol-Version": protocolVersion };

  if (message.method === "notifications/initialized") {
    return new Response(null, { status: 204, headers: headers(commonHeaders) });
  }

  if (message.method === "initialize") {
    const legacyVersion = LEGACY_PROTOCOLS.has(String(message.params?.protocolVersion))
      ? String(message.params.protocolVersion)
      : "2025-11-25";
    return response(200, rpcResult(message.id, {
      protocolVersion: legacyVersion,
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
      instructions: "Vision Coach workspace connector. Read before writing. For approved exercise images use get_exercise_image, prepare_exercise_image_upload, binary PUT of original bytes, then complete_exercise_image_upload. Never regenerate or downsize an approved image; never claim success before completion. Guide: docs/ai-image-workflow.md in cbunny1990/treinador.",
    }), {
      "MCP-Protocol-Version": legacyVersion,
      "Mcp-Session-Id": crypto.randomUUID(),
    });
  }

  if (message.method === "server/discover") {
    return response(200, rpcResult(message.id, {
      protocolVersion: MODERN_PROTOCOL,
      serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
      capabilities: { tools: {} },
    }), { "MCP-Protocol-Version": MODERN_PROTOCOL });
  }

  if (message.method === "ping") {
    return response(200, rpcResult(message.id, {}), commonHeaders);
  }

  if (message.method === "tools/list") {
    return response(200, rpcResult(message.id, {
      tools: TOOLS,
      ttlMs: 300000,
      cacheScope: "private",
    }), commonHeaders);
  }

  if (message.method === "tools/call") {
    const toolName = String(message.params?.name || "");
    const toolArgs = message.params?.arguments && typeof message.params.arguments === "object"
      ? message.params.arguments
      : {};
    if (!TOOLS.some((tool) => tool.name === toolName)) {
      return response(200, rpcResult(message.id, textResult({ error: "unknown_tool", tool: toolName }, true)), commonHeaders);
    }
    try {
      const data = await executeTool(admin, connector, toolName, toolArgs, message.id);
      return response(200, rpcResult(message.id, textResult(data)), commonHeaders);
    } catch (error) {
      const detail = error instanceof Error ? error.message : "tool_error";
      return response(200, rpcResult(message.id, textResult({ error: detail, tool: toolName }, true)), commonHeaders);
    }
  }

  return response(200, rpcError(message.id, -32601, "Method not found"), commonHeaders);
});
