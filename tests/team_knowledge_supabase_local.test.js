"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { createClient } = require("@supabase/supabase-js");

const url = process.env.VISION_COACH_SUPABASE_LOCAL_URL || "";
const anonKey = process.env.VISION_COACH_SUPABASE_LOCAL_ANON_KEY || "";
const serviceKey = process.env.VISION_COACH_SUPABASE_LOCAL_SERVICE_KEY || "";
const enabled = !!(url && anonKey && serviceKey);
const isLoopback = (value) => ["localhost", "127.0.0.1", "::1"].includes(new URL(value).hostname);
const uuid = () => crypto.randomUUID();

test("RAG real no Supabase mantém indexação, consultas e referências isoladas por conector/equipa", {
  skip: !enabled && "requer URL e chaves da stack Supabase local; nunca usar credenciais de produção",
  timeout: 60_000,
}, async () => {
  assert.ok(isLoopback(url), "Este teste aceita apenas Supabase em localhost.");
  const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const { executeTeamKnowledgeTool } = await import("../supabase/functions/vision-coach-mcp/team_knowledge.mjs");
  const users = [];
  const teams = [];
  const tokenHashes = [];
  const providerInputs = [];

  try {
    const email = `rag-local-${uuid()}@vision-coach.local`;
    const createdUser = await admin.auth.admin.createUser({
      email, password: crypto.randomBytes(24).toString("base64url"), email_confirm: true,
    });
    assert.ifError(createdUser.error);
    users.push(createdUser.data.user.id);

    const teamRows = [];
    for (const label of ["A", "B"]) {
      const createdTeam = await admin.from("teams").insert({
        owner_id: createdUser.data.user.id, name: `RAG ${label} local`, metadata: { escalao: label === "A" ? "Sub-8" : "Sub-10" },
      }).select("id").single();
      assert.ifError(createdTeam.error);
      teams.push(createdTeam.data.id);
      teamRows.push({ id: createdTeam.data.id, label });
    }

    const connectors = [];
    for (const team of teamRows) {
      const tokenHash = crypto.createHash("sha256").update(uuid()).digest("hex");
      tokenHashes.push(tokenHash);
      const created = await admin.rpc("mcp_connector_create", {
        p_team_id: team.id, p_owner_id: createdUser.data.user.id, p_token_hash: tokenHash,
        p_token_prefix: `vcmcp_RAGtest${team.label.toLowerCase()}`, p_label: `RAG ${team.label} test`,
        p_scopes: ["read"], p_expires_at: null,
      });
      assert.ifError(created.error);
      const lookedUp = await admin.rpc("mcp_connector_lookup", { p_token_hash: tokenHash });
      assert.ifError(lookedUp.error);
      assert.equal(lookedUp.data.team_id, team.id);
      connectors.push(lookedUp.data);
    }

    const sources = [];
    for (const team of teamRows) {
      const sourceId = uuid();
      const saved = await admin.from("workspace_records").insert({
        id: sourceId, team_id: team.id, kind: "match", actor_type: "human",
        updated_at: "2026-09-24T10:00:00.000Z",
        payload: {
          data: "2026-09-20", estado: "concluido", adversario: `Adversário ${team.label}`,
          post_game: { analysis: { fields: {
            problems: `Equipa ${team.label}: pressão alta na construção e perda de bola no corredor central.`,
            observations: team.label === "A" ? "The player has hypertension and should avoid intense exercise." : "",
          } } },
          match_events: team.label === "A" ? {
            events: Array.from({ length: 72 }, (_, index) => ({
              id: uuid(), type: "loss", at_ms: index * 30_000,
              note: `Pressão alta na construção após perda de bola, sequência ${index + 1}.`,
            })),
          } : { events: [] },
        },
      });
      assert.ifError(saved.error);
      sources.push({ team, sourceId });
    }
    const secondMatchId = uuid();
    const secondMatch = await admin.from("workspace_records").insert({
      id: secondMatchId, team_id: teamRows[0].id, kind: "match", actor_type: "human",
      updated_at: "2026-09-24T10:00:00.000Z",
        payload: {
        data: "2026-09-13", estado: "concluido", adversario: "Outro adversário A",
        post_game: { analysis: { fields: { problems: "Equipa A: pressão alta na construção e perda de bola no corredor central voltou a surgir." } } },
      },
    });
    assert.ifError(secondMatch.error);
    const evergreenExerciseId = uuid();
    const evergreenExercise = await admin.from("workspace_records").insert({
      id: evergreenExerciseId, team_id: teamRows[0].id, kind: "exercise", actor_type: "human",
      updated_at: "2026-09-24T10:00:00.000Z",
      payload: { nome: "Apoios próximos", objetivo: "Criar linhas de passe após passe curto e progressão coletiva." },
    });
    assert.ifError(evergreenExercise.error);

    const provider = {
      apiKey: "local-test-only",
      async fetchImpl(_url, init) {
        const body = JSON.parse(init.body);
        providerInputs.push(...body.input);
        return {
          ok: true,
          status: 200,
          async json() {
            return { data: body.input.map(() => ({ embedding: [1, ...Array(1535).fill(0)] })) };
          },
        };
      },
    };

    for (let i = 0; i < teamRows.length; i++) {
      const output = await executeTeamKnowledgeTool(admin, connectors[i], "search_team_knowledge", {
        query: "pressão alta construção",
        source_kinds: ["match"],
        limit: 8,
      }, { provider });
      assert.equal(output.retrieval_status, "ready");
      assert.ok(output.results.length > 0);
      const expectedRefs = i === 0 ? [sources[i].sourceId, secondMatchId] : [sources[i].sourceId];
      assert.ok(output.results.every((item) => expectedRefs.includes(item.source.ref)));
      assert.ok(output.results.every((item) => item.metadata.age_group === (i === 0 ? "Sub-8" : "Sub-10")));
    }

    const multiMatch = await executeTeamKnowledgeTool(admin, connectors[0], "search_team_knowledge", {
      query: "pressão alta construção", source_kinds: ["match"],
      match_refs: [sources[0].sourceId, secondMatchId], per_match_limit: 1, limit: 12,
    }, { provider });
    assert.equal(multiMatch.retrieval_status, "ready");
    assert.deepEqual(new Set(multiMatch.results.map((item) => item.source.match_ref)), new Set([sources[0].sourceId, secondMatchId]));
    assert.ok(multiMatch.results.every((item) => item.source.ref !== sources[1].sourceId));
    assert.ok(multiMatch.results.every((item) => multiMatch.results.filter((other) => other.source.match_ref === item.source.match_ref).length <= 1));
    const emptyMatchFilter = await admin.rpc("search_team_knowledge_chunks", {
      p_team_id: teamRows[0].id, p_embedding: `[${Array(1536).fill(0).join(",")}]`, p_query: "pressão alta",
      p_limit: 8, p_source_kinds: ["match"], p_from: null, p_to: null, p_match_ref: null,
      p_training_ref: null, p_player_ref: null, p_category: null, p_match_refs: [],
    });
    assert.match(emptyMatchFilter.error?.message || "", /invalid_knowledge_match_refs/);

    const evergreen = await executeTeamKnowledgeTool(admin, connectors[0], "search_team_knowledge", {
      query: "apoios próximos progressão coletiva", source_kinds: ["exercise"], to: "2026-09-24", limit: 8,
    }, { provider });
    assert.ok(evergreen.results.some((item) => item.source.ref === evergreenExerciseId));

    const ownChunks = providerInputs.filter((input) => input.includes("Problemas identificados: Equipa"));
    assert.deepEqual(ownChunks.sort(), [
      "Problemas identificados: Equipa A: pressão alta na construção e perda de bola no corredor central.",
      "Problemas identificados: Equipa B: pressão alta na construção e perda de bola no corredor central.",
      "Problemas identificados: Equipa A: pressão alta na construção e perda de bola no corredor central voltou a surgir.",
    ].sort());
    assert.doesNotMatch(providerInputs.join("\n"), /hypertension|blood pressure|hipertens/i, "notas de saúde não chegam ao provider de embeddings");
    assert.match(providerInputs.join("\n"), /pressão alta/i, "observação tática continua a ser indexada");

    const unrelatedMetadataUpdate = await admin.from("teams").update({ metadata: { escalao: "Sub-8", badge_revision: 2 } }).eq("id", teamRows[0].id);
    assert.ifError(unrelatedMetadataUpdate.error);
    const noAgeChangeJobs = await admin.rpc("claim_team_knowledge_jobs", { p_team_id: teamRows[0].id, p_limit: 64 });
    assert.ifError(noAgeChangeJobs.error);
    assert.deepEqual(noAgeChangeJobs.data, []);

    const ageGroupUpdate = await admin.from("teams").update({ metadata: { escalao: "Sub-9" } }).eq("id", teamRows[0].id);
    assert.ifError(ageGroupUpdate.error);
    const refreshed = await executeTeamKnowledgeTool(admin, connectors[0], "search_team_knowledge", {
      query: "pressão alta construção", source_kinds: ["match"], match_refs: [sources[0].sourceId, secondMatchId], limit: 8,
    }, { provider });
    assert.ok(refreshed.results.length > 0);
    assert.ok(refreshed.results.every((item) => item.metadata.age_group === "Sub-9"));

    const malformedMatchIds = Array.from({ length: 55 }, () => uuid());
    const malformedMatches = await admin.from("workspace_records").insert(malformedMatchIds.map((id, index) => ({
      id, team_id: teamRows[0].id, kind: "match", actor_type: "human", updated_at: `2026-09-24T11:${String(index % 60).padStart(2, "0")}:00.000Z`,
      payload: { data: "2026-09-2!", estado: "concluido", adversario: `Data legada inválida ${index + 1}` },
    })));
    assert.ifError(malformedMatches.error);
    const recentContext = await executeTeamKnowledgeTool(admin, connectors[0], "get_recent_match_context", {
      question: "O que aconteceu nos jogos recentes?", match_count: 5,
    }, { provider });
    assert.equal(recentContext.matches.length, 2, "só os dois jogos com data válida entram no histórico");
    assert.deepEqual(new Set(recentContext.matches.map((item) => item.ref)), new Set([sources[0].sourceId, secondMatchId]));
    assert.ok(recentContext.matches.every((item) => !malformedMatchIds.includes(item.ref)));
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
