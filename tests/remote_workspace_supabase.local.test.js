"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { createClient } = require("@supabase/supabase-js");
const { RemoteWorkspace } = require("../js/remote_workspace.js");
const MatchVisual = require("../js/match_visual.js");
const MatchAnalysis = require("../js/match_analysis.js");
const MatchEvidence = require("../js/match_evidence.js");
const PlayerGoals = require("../js/player_goals.js");
const TeamDevelopment = require("../js/team_development.js");

const url = process.env.VISION_COACH_SUPABASE_LOCAL_URL || "";
const anonKey = process.env.VISION_COACH_SUPABASE_LOCAL_ANON_KEY || "";
const serviceKey = process.env.VISION_COACH_SUPABASE_LOCAL_SERVICE_KEY || "";
const enabled = !!(url && anonKey && serviceKey);
const isLocal = (value) => ["localhost", "127.0.0.1", "::1"].includes(new URL(value).hostname);

function deviceDatabase(initialId = 1) {
  const stores = new Map();
  let nextId = initialId;
  return {
    async listar(store) { return (stores.get(store) || []).map((row) => ({ ...row })); },
    async porIndice(store, key, value) { return (stores.get(store) || []).filter((row) => row[key] === value).map((row) => ({ ...row })); },
    async obter(store, id) { return (stores.get(store) || []).find((row) => row.id === id); },
    async criar(store, input) {
      const rows = stores.get(store) || [];
      stores.set(store, rows);
      const row = { ...input, id: input.id ?? nextId++ };
      rows.push(row);
      return row.id;
    },
    async atualizar(store, input) {
      const rows = stores.get(store) || [];
      const index = rows.findIndex((row) => row.id === input.id);
      assert.notEqual(index, -1, `row missing: ${store}/${input.id}`);
      rows[index] = { ...input };
      return rows[index];
    },
    async modificar(store, id, update) {
      const rows = stores.get(store) || [];
      const index = rows.findIndex((row) => row.id === id);
      assert.notEqual(index, -1, `row missing: ${store}/${id}`);
      rows[index] = update({ ...rows[index] });
      return rows[index];
    },
    async apagar(store, id, options = {}) {
      const rows = stores.get(store) || [];
      const index = rows.findIndex((row) => row.id === id);
      if (index < 0) return false;
      const [row] = rows.splice(index, 1);
      if (!options.remote && row.sync_id) await this.criar("sync_tombstones", {
        store, sync_id: row.sync_id, team_id: row.team_id || "default",
        remote_team_id: row.remote_team_id || null,
        expected_updated_at: row.remote_updated_at || null,
      });
      return true;
    },
  };
}

test("RLS + sincronização real com duas sessões locais: round trip, conflito, tombstone, foto privada e equipa errada", {
  skip: !enabled && "requer URL e chaves da stack Supabase local; nunca usar credenciais de produção",
  timeout: 120_000,
}, async () => {
  assert.ok(isLocal(url), "Este teste aceita apenas Supabase em localhost.");
  const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const users = [];
  const original = {
    db: globalThis.DB,
    team: globalThis.DEFAULT_TEAM_ID,
    subjectKey: globalThis.mediaSubjectKey,
    init: RemoteWorkspace.init,
  };
  const devices = [deviceDatabase(), deviceDatabase(100)];
  const clientFor = () => createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } });
  const makeUser = async (label) => {
    const email = `sync-${label}-${crypto.randomUUID()}@vision-coach.local`;
    const password = crypto.randomBytes(24).toString("base64url");
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    assert.ifError(created.error);
    users.push(created.data.user.id);
    const client = clientFor();
    const signedIn = await client.auth.signInWithPassword({ email, password });
    assert.ifError(signedIn.error);
    return { user: signedIn.data.user, client };
  };
  let teamId;
  let exerciseImagePath;
  let viewerObjectPath;
  let viewerRejectedUploadPath;
  try {
    const owner = await makeUser("owner");
    const coach = await makeUser("coach");
    const outsider = await makeUser("outsider");
    const ownerSession = await owner.client.auth.getUser();
    assert.ifError(ownerSession.error);
    assert.equal(ownerSession.data.user.id, owner.user.id);
    const createdTeam = await owner.client.from("teams").insert({ owner_id: owner.user.id, name: "Equipa de teste local" }).select("id").single();
    assert.ifError(createdTeam.error);
    teamId = createdTeam.data.id;
    const joined = await admin.from("team_members").insert({ team_id: teamId, user_id: coach.user.id, role: "coach" });
    assert.ifError(joined.error);
    const viewer = await makeUser("viewer");
    const viewerMembership = await admin.from("team_members").insert({ team_id: teamId, user_id: viewer.user.id, role: "viewer" });
    assert.ifError(viewerMembership.error);
    const defaultRoleUser = await makeUser("default-role");
    const defaultRoleMembership = await admin.from("team_members").insert({ team_id: teamId, user_id: defaultRoleUser.user.id });
    assert.ifError(defaultRoleMembership.error);
    const defaultRole = await admin.from("team_members").select("role").eq("team_id", teamId).eq("user_id", defaultRoleUser.user.id).single();
    assert.ifError(defaultRole.error);
    assert.equal(defaultRole.data.role, "coach", "an omitted membership role must use a valid writable role");

    const roleProbeId = crypto.randomUUID();
    const roleProbe = await admin.from("workspace_records").insert({
      id: roleProbeId, team_id: teamId, kind: "document", payload: { text: "viewer read-only probe" },
    });
    assert.ifError(roleProbe.error);
    const viewerRead = await viewer.client.from("workspace_records").select("id,payload").eq("id", roleProbeId).single();
    assert.ifError(viewerRead.error);
    assert.equal(viewerRead.data.id, roleProbeId, "viewer membership must retain team reads");
    const viewerInsert = await viewer.client.from("workspace_records").insert({
      id: crypto.randomUUID(), team_id: teamId, kind: "document", payload: { text: "must be rejected" },
    });
    assert.ok(viewerInsert.error, "viewer cannot create workspace records");
    const viewerUpdate = await viewer.client.from("workspace_records").update({ payload: { text: "must remain unchanged" } }).eq("id", roleProbeId).select("id");
    assert.ifError(viewerUpdate.error);
    assert.deepEqual(viewerUpdate.data, [], "viewer cannot update workspace records");
    const viewerDelete = await viewer.client.from("workspace_records").delete().eq("id", roleProbeId).select("id");
    assert.ifError(viewerDelete.error);
    assert.deepEqual(viewerDelete.data, [], "viewer cannot delete workspace records");
    const stillPresent = await admin.from("workspace_records").select("payload").eq("id", roleProbeId).single();
    assert.ifError(stillPresent.error);
    assert.equal(stillPresent.data.payload.text, "viewer read-only probe");

    const coachWriteId = crypto.randomUUID();
    const coachWrite = await coach.client.from("workspace_records").insert({
      id: coachWriteId, team_id: teamId, kind: "document", payload: { text: "coach write allowed" },
    });
    assert.ifError(coachWrite.error, "coach membership keeps workspace writes");
    const viewerMedia = await viewer.client.from("media_assets").insert({
      id: crypto.randomUUID(), team_id: teamId, subject_type: "player", subject_ref: crypto.randomUUID(),
      media_type: "photo", title: "viewer upload probe", storage_path: `${teamId}/players/viewer-blocked.jpg`,
    });
    assert.ok(viewerMedia.error, "viewer cannot create media metadata");
    const mediaProbeId = crypto.randomUUID();
    const seededMedia = await admin.from("media_assets").insert({
      id: mediaProbeId, team_id: teamId, subject_type: "player", subject_ref: crypto.randomUUID(),
      media_type: "file", title: "viewer read-only media", external_url: "https://example.invalid/viewer-probe",
    });
    assert.ifError(seededMedia.error);
    const viewerMediaRead = await viewer.client.from("media_assets").select("id,title").eq("id", mediaProbeId).single();
    assert.ifError(viewerMediaRead.error);
    const viewerMediaUpdate = await viewer.client.from("media_assets").update({ title: "must remain unchanged" }).eq("id", mediaProbeId).select("id");
    assert.ifError(viewerMediaUpdate.error);
    assert.deepEqual(viewerMediaUpdate.data, [], "viewer cannot update media metadata");
    const viewerMediaDelete = await viewer.client.from("media_assets").delete().eq("id", mediaProbeId).select("id");
    assert.ifError(viewerMediaDelete.error);
    assert.deepEqual(viewerMediaDelete.data, [], "viewer cannot delete media metadata");
    const unchangedMedia = await admin.from("media_assets").select("title").eq("id", mediaProbeId).single();
    assert.ifError(unchangedMedia.error);
    assert.equal(unchangedMedia.data.title, "viewer read-only media");
    const removedMediaProbe = await admin.from("media_assets").delete().eq("id", mediaProbeId);
    assert.ifError(removedMediaProbe.error);
    const viewerActivity = await viewer.client.from("activity_log").insert({
      id: crypto.randomUUID(), team_id: teamId, actor_type: "human", actor_label: "viewer",
      action: "viewer_write_probe", summary: "must be rejected",
    });
    assert.ok(viewerActivity.error, "viewer cannot write activity");
    viewerObjectPath = `${teamId}/viewer/${crypto.randomUUID()}.bin`;
    const probeBytes = new Uint8Array([1, 2, 3]);
    const seededObject = await admin.storage.from("team-media").upload(viewerObjectPath, probeBytes, {
      contentType: "application/octet-stream", upsert: false,
    });
    assert.ifError(seededObject.error);
    const viewerObjectRead = await viewer.client.storage.from("team-media").download(viewerObjectPath);
    assert.ifError(viewerObjectRead.error);
    assert.deepEqual(new Uint8Array(await viewerObjectRead.data.arrayBuffer()), probeBytes);
    viewerRejectedUploadPath = `${teamId}/viewer/${crypto.randomUUID()}.bin`;
    const viewerUpload = await viewer.client.storage.from("team-media").upload(viewerRejectedUploadPath, probeBytes, {
      contentType: "application/octet-stream", upsert: false,
    });
    assert.ok(viewerUpload.error, "viewer cannot write the private team-media bucket");
    const viewerObjectUpdate = await viewer.client.storage.from("team-media").update(viewerObjectPath, new Uint8Array([4, 5, 6]), {
      contentType: "application/octet-stream", upsert: false,
    });
    assert.ok(viewerObjectUpdate.error, "viewer cannot update private team media");
    const viewerObjectDelete = await viewer.client.storage.from("team-media").remove([viewerObjectPath]);
    assert.ok(viewerObjectDelete.error || !viewerObjectDelete.data?.length, "viewer cannot delete private team media");
    const objectAfterDeniedDelete = await admin.storage.from("team-media").download(viewerObjectPath);
    assert.ifError(objectAfterDeniedDelete.error, "viewer cannot delete private team media");
    assert.deepEqual(new Uint8Array(await objectAfterDeniedDelete.data.arrayBuffer()), probeBytes);
    const removedRoleProbes = await admin.from("workspace_records").delete().in("id", [roleProbeId, coachWriteId]);
    assert.ifError(removedRoleProbes.error);

    const connectorHash = crypto.createHash("sha256").update(crypto.randomUUID()).digest("hex");
    const connectorCreated = await admin.rpc("mcp_connector_create", {
      p_team_id: teamId,
      p_owner_id: owner.user.id,
      p_token_hash: connectorHash,
      p_token_prefix: "vcmcp_test1234",
      p_label: "RLS local test",
      p_scopes: ["read"],
      p_expires_at: null,
    });
    assert.ifError(connectorCreated.error);
    const connectorId = connectorCreated.data.id;
    const connectorListed = await admin.rpc("mcp_connector_list", { p_team_id: teamId, p_owner_id: owner.user.id });
    assert.ifError(connectorListed.error);
    assert.ok(connectorListed.data.some((row) => row.id === connectorId && row.enabled));
    const connectorLookup = await admin.rpc("mcp_connector_lookup", { p_token_hash: connectorHash });
    assert.ifError(connectorLookup.error);
    assert.equal(connectorLookup.data.id, connectorId);
    const connectorRevoked = await admin.rpc("mcp_connector_revoke", {
      p_token_id: connectorId,
      p_team_id: teamId,
      p_owner_id: owner.user.id,
    });
    assert.ifError(connectorRevoked.error);
    assert.equal(connectorRevoked.data, true);
    const connectorAfterRevoke = await admin.rpc("mcp_connector_lookup", { p_token_hash: connectorHash });
    assert.ifError(connectorAfterRevoke.error);
    assert.equal(connectorAfterRevoke.data, null);

    const inaccessible = await outsider.client.from("workspace_records").select("id").eq("team_id", teamId);
    assert.ifError(inaccessible.error);
    assert.deepEqual(inaccessible.data, []);
    const forbiddenInsert = await outsider.client.from("workspace_records").insert({
      id: crypto.randomUUID(), team_id: teamId, kind: "match", payload: { external_key: "foreign-team-write" },
    }).select("id");
    assert.ok(forbiddenInsert.error, "RLS must reject a write to another team's workspace.");

    const refs = { player: crypto.randomUUID(), playerGoal: crypto.randomUUID(), teamGoal: crypto.randomUUID(), liveMatch: crypto.randomUUID(), evidenceMatch: crypto.randomUUID(), videoMoment: crypto.randomUUID(), deletedVideoMoment: crypto.randomUUID(), deletedMatch: crypto.randomUUID(), historyMatch: crypto.randomUUID(), historyTraining: crypto.randomUUID(), exercise: crypto.randomUUID(), proposal: crypto.randomUUID(), pcDeletedProposal: crypto.randomUUID(), playerArchive: crypto.randomUUID(), photo: crypto.randomUUID(), latestPhoto: crypto.randomUUID(), lossEvent: crypto.randomUUID() };
    globalThis.DEFAULT_TEAM_ID = "local-coach";
    globalThis.mediaSubjectKey = (team, type, id) => `${team}|${type}|${id}`;
    globalThis.DB = devices[0];
    RemoteWorkspace.init = async () => owner.client;
    let initialPlayer = {
      team_id: "local-coach", sync_id: refs.player, remote_team_id: teamId, sync_dirty: true,
      nome: "Atleta sintético", plantel_ativo: true,
    };
    initialPlayer = PlayerGoals.apply(initialPlayer, { type: "save", expected_revision: 0, goal: {
      id: refs.playerGoal, title: "Apoiar após o passe", started_at: "2026-09-01", status: "active",
      evidence_refs: [{ type: "match", id: refs.evidenceMatch }], exercise_refs: [refs.exercise], notes: "Objetivo definido pelo treinador",
    } }, { now: "2026-09-01T12:00:00.000Z" });
    const playerId = await devices[0].criar("jogadores", initialPlayer);
    await devices[0].criar("jogos", {
      team_id: "local-coach", remote_team_id: teamId, sync_dirty: true,
      external_key: "local-sync-legacy-player-ref", adversario: "Jogo histórico",
      callup: { player_ids: [String(playerId)] },
      lineup: { goalkeeper_id: String(playerId), starters: [], substitutes: [] },
    });
    const matchRefs = [refs.player, ...Array.from({ length: 4 }, () => crypto.randomUUID())];
    const matchPlayers = matchRefs.map((sync_id, index) => ({ sync_id, nome: index ? `Colega ${index}` : "Atleta sintético", numero: index + 1, estado_disponibilidade: "disponivel" }));
    for (const player of matchPlayers.slice(1)) await devices[0].criar("jogadores", {
      ...player, team_id: "local-coach", remote_team_id: teamId, sync_dirty: true, plantel_ativo: true,
    });
    let liveMatch = {
      team_id: "local-coach", sync_id: refs.liveMatch, remote_team_id: teamId, sync_dirty: true,
      external_key: "local-sync-live", adversario: "Teste", nota_tatica: "Base",
      callup: { player_ids: matchRefs },
      lineup: { system: "1-2-1", goalkeeper_id: matchRefs[1], starters: [matchRefs[0], ...matchRefs.slice(2)], substitutes: [] },
      match_events: { schema: "vision-match-events@1", revision: 1, possession: { kind: "unknown", value: null }, events: [{ id: refs.lossEvent, type: "loss", at_ms: 30_000, player_ref: refs.player, zone: "def_c", reason: "pass", note: "Passe interceptado no PC" }] },
    };
    const liveMatchStart = Date.parse("2026-09-03T10:00:00.000Z");
    liveMatch = MatchVisual.apply(liveMatch, { type: "start", confirmed: true, expected_revision: 0 }, { controller_id: "local-integration", players: matchPlayers, now: liveMatchStart });
    liveMatch = MatchVisual.apply(liveMatch, { type: "pause", expected_revision: 1 }, { controller_id: "local-integration", players: matchPlayers, now: liveMatchStart + 600_000 });
    liveMatch = MatchVisual.apply(liveMatch, { type: "second_half", confirmed: true, expected_revision: 2 }, { controller_id: "local-integration", players: matchPlayers, now: liveMatchStart + 600_000 });
    liveMatch = MatchVisual.apply(liveMatch, { type: "pause", expected_revision: 3 }, { controller_id: "local-integration", players: matchPlayers, now: liveMatchStart + 660_000 });
    const liveId = await devices[0].criar("jogos", liveMatch);
    const legacySyncId = await devices[0].criar("jogos", {
      team_id: "local-coach", sync_id: "default", remote_team_id: teamId, sync_dirty: true,
      external_key: "local-sync-legacy-default-id", adversario: "Registo legado por reparar",
    });
    const deletedId = await devices[0].criar("jogos", {
      team_id: "local-coach", sync_id: refs.deletedMatch, remote_team_id: teamId, sync_dirty: true,
      external_key: "local-sync-delete", adversario: "Teste para apagar",
    });
    let participationMatch = {
      team_id: "local-coach", sync_id: refs.historyMatch, remote_team_id: teamId, sync_dirty: true,
      external_key: "local-player-history-match", data: "2026-09-03", adversario: "Histórico MCP",
      callup: { player_ids: matchRefs },
      lineup: { system: "1-2-1", goalkeeper_id: matchRefs[1], starters: [matchRefs[0], ...matchRefs.slice(2)], substitutes: [] },
    };
    const matchStart = Date.parse("2026-09-03T10:00:00.000Z");
    participationMatch = MatchVisual.apply(participationMatch, { type: "start", confirmed: true, expected_revision: 0 }, { controller_id: "local-integration", players: matchPlayers, now: matchStart });
    participationMatch = MatchVisual.apply(participationMatch, { type: "pause", expected_revision: 1 }, { controller_id: "local-integration", players: matchPlayers, now: matchStart + 600_000 });
    await devices[0].criar("jogos", participationMatch);
    let evidenceMatch = {
      team_id: "local-coach", sync_id: refs.evidenceMatch, remote_team_id: teamId, sync_dirty: true,
      external_key: "local-sync-evidence-analysis", adversario: "Evidência e análise", data: "2026-09-03",
    };
    evidenceMatch = MatchAnalysis.save(evidenceMatch, { fields: { summary: "Análise inicial no PC" } }, {
      expected_revision: 0, actor: "Treinador", now: "2026-09-03T12:00:00.000Z",
    });
    evidenceMatch = MatchEvidence.apply(evidenceMatch, { type: "add", expected_revision: 0, item: {
      id: refs.videoMoment, url: "https://example.test/jogo.mp4", seconds: 125, category: "goal",
      description: "Golo registado no PC", relation_type: "statistic", relation_ref: "goals.for",
    } }, { now: "2026-09-03T12:01:00.000Z" });
    evidenceMatch = MatchEvidence.apply(evidenceMatch, { type: "add", expected_revision: 1, item: {
      id: refs.deletedVideoMoment, url: "https://example.test/jogo.mp4", seconds: 240, category: "chance",
      description: "Momento a remover no telemóvel", relation_type: "none",
    } }, { now: "2026-09-03T12:02:00.000Z" });
    await devices[0].criar("jogos", evidenceMatch);
    const approvedImageBytes = fs.readFileSync(path.join(__dirname, "../assets/exercises/approved-20260922/01_ativacao_conduzir_passar_dar_opcao.png"));
    const approvedImageSha = crypto.createHash("sha256").update(approvedImageBytes).digest("hex");
    const approvedImageInfo = {
      width: approvedImageBytes.readUInt32BE(16), height: approvedImageBytes.readUInt32BE(20),
      mime_type: "image/png", size_bytes: approvedImageBytes.length, sha256: approvedImageSha,
      file_name: "01_ativacao_conduzir_passar_dar_opcao.png", source: "approved_original_upload",
    };
    exerciseImagePath = `${teamId}/exercise-images/${refs.exercise}/original.png`;
    const exerciseImageUpload = await admin.storage.from("team-media").upload(exerciseImagePath, approvedImageBytes, {
      contentType: "image/png", upsert: false,
    });
    assert.ifError(exerciseImageUpload.error);
    const exerciseId = await devices[0].criar("exercicios", {
      team_id: "local-coach", sync_id: refs.exercise, remote_team_id: teamId, sync_dirty: true,
      workspace_v2: true, external_key: "local-sync-passe-apoio", nome: "Passe + apoio",
      visual_storage_bucket: "team-media", visual_storage_path: exerciseImagePath,
      visual_image: approvedImageInfo, visual_removed: false,
    });
    await devices[0].criar("treinos", {
      team_id: "local-coach", sync_id: refs.historyTraining, remote_team_id: teamId, sync_dirty: true,
      external_key: "local-player-history-training", data: "2026-09-02", objetivo: "Passe + apoio",
      blocos: [{ exercise_ref: String(exerciseId), duration_min: 12 }],
      status: "completed",
      session: { status: "completed", attendance: [{ player_ref: refs.player, name: "Atleta sintético", status: "present" }], blocks: [{ exercise_ref: String(exerciseId), planned_min: 12, elapsed_ms: 60_000 }] },
    });
    const proposalBody = TeamDevelopment.saveGoal(null, {
      title: "Apoio após passe", identified_at: "2026-09-01", stage: "planned",
      sessions: [{ type: "match", id: refs.liveMatch }, { type: "training", id: refs.historyTraining }],
      worked_sessions: [], exercises: [{ type: "exercise", id: refs.exercise }],
      observations: "Identificado no último jogo", interpretation: "O portador precisa de linha de passe",
      agent_proposal: { status: "proposed", rationale: "Proposta para revisão do treinador", evidence_refs: [] },
    }, { expected_revision: 0, now: "2026-09-01T12:00:00.000Z" });
    await devices[0].criar("workspace_documents", {
      team_id: "local-coach", sync_id: refs.proposal, remote_team_id: teamId, sync_dirty: true,
      external_key: "local-sync-team-goal-proposal", type: "team_goal", title: "Proposta de prioridade",
      body: JSON.stringify(proposalBody), status: "ready", target_date: "2026-09-03",
    });
    await devices[0].criar("workspace_documents", {
      team_id: "local-coach", sync_id: refs.pcDeletedProposal, remote_team_id: teamId, sync_dirty: true,
      external_key: "local-sync-team-goal-pc-delete", type: "team_goal", title: "Proposta a apagar no PC",
      body: JSON.stringify({ objective: "Apoio defensivo", agent_proposal: { status: "proposed" } }), status: "ready", target_date: "2026-09-03",
    });
    await devices[0].criar("workspace_documents", {
      team_id: "local-coach", sync_id: refs.playerArchive, remote_team_id: teamId, sync_dirty: true,
      external_key: "player-archive:local-coach:" + refs.player, type: "player_archive", title: "Histórico · Atleta sintético",
      body: JSON.stringify({ schema: "vision-player-archive@1", team_id: "local-coach", player: { ref: refs.player, name: "Atleta sintético", number: 7, age_group: "Sub-8" }, development_goals: { schema: "vision-player-goals@1", revision: 2, items: [{ id: crypto.randomUUID(), title: "Apoio após passe", started_at: "2026-09-01", status: "continue", notes: "Preservar histórico", evidence_refs: [{ type: "match", id: refs.evidenceMatch }], exercise_refs: [refs.exercise], history: [{ title: "Apoio após passe", status: "active", updated_at: "2026-09-02T12:00:00.000Z" }] }] }, archived_at: "2026-09-03T12:00:00.000Z" }), status: "archived",
    });
    const firstPush = await RemoteWorkspace._syncRecords(teamId, owner.user.id);
    assert.equal(firstPush.pushed, 16);
    const pcLegacyPlayerRef = (await devices[0].listar("jogos")).find((row) => row.external_key === "local-sync-legacy-player-ref");
    assert.deepEqual(pcLegacyPlayerRef.callup.player_ids, [refs.player]);
    assert.equal(pcLegacyPlayerRef.lineup.goalkeeper_id, refs.player);
    const pcHistoryTrainingAfterPush = (await devices[0].listar("treinos")).find((row) => row.sync_id === refs.historyTraining);
    assert.equal(pcHistoryTrainingAfterPush.blocos[0].exercise_ref, refs.exercise);
    assert.equal(pcHistoryTrainingAfterPush.session.blocks[0].exercise_ref, refs.exercise);
    const remoteExercise = await owner.client.from("workspace_records").select("payload").eq("id", refs.exercise).single();
    assert.ifError(remoteExercise.error);
    assert.equal(remoteExercise.data.payload.visual_storage_path, exerciseImagePath);
    assert.equal(remoteExercise.data.payload.visual_image.sha256, approvedImageSha);
    assert.equal(remoteExercise.data.payload.visual_url, undefined, "Signed download URLs must never be synchronized.");

    const orphanActivityId = crypto.randomUUID();
    await devices[0].criar("activity_items", {
      team_id: "local-coach", sync_id: orphanActivityId, remote_team_id: teamId, sync_dirty: true,
      actor: "human", actor_label: "Treinador", action: "created_document", summary: "Atividade histórica local",
      entity_type: "document", entity_id: 731, metadata: { origin: "coach" }, created_at: "2026-09-22T10:00:00.000Z",
    });
    const activityPushed = await RemoteWorkspace._syncActivity(teamId, owner.user.id);
    assert.equal(activityPushed.pushed, 1);
    assert.equal(activityPushed.conflicts.length, 0);
    const savedActivity = await owner.client.from("activity_log").select("*").eq("id", orphanActivityId).single();
    assert.ifError(savedActivity.error);
    assert.equal(savedActivity.data.entity_ref, null);
    assert.equal(savedActivity.data.metadata.origin, "coach");
    assert.deepEqual(savedActivity.data.metadata._vision_coach_unresolved_origin, {
      type: "document", reference: "731", scope: "local_device_id", reason: "subject_not_found_locally",
    });
    const locallyAcknowledgedActivity = (await devices[0].listar("activity_items"))[0];
    assert.equal(locallyAcknowledgedActivity.sync_dirty, false);
    assert.equal(locallyAcknowledgedActivity.entity_id, null);

    globalThis.DB = devices[1];
    RemoteWorkspace.init = async () => coach.client;
    await devices[1].criar("sync_tombstones", { store: "seed", sync_id: "force-distinct-local-ids" });
    const pulled = await RemoteWorkspace._syncRecords(teamId, coach.user.id);
    assert.equal(pulled.pulled, 16);
    const activityPulled = await RemoteWorkspace._syncActivity(teamId, coach.user.id);
    assert.equal(activityPulled.pulled, 1);
    assert.equal(activityPulled.conflicts.length, 0);
    const phoneActivity = (await devices[1].listar("activity_items"))[0];
    assert.equal(phoneActivity.entity_id, null);
    assert.deepEqual(phoneActivity.metadata._vision_coach_unresolved_origin, savedActivity.data.metadata._vision_coach_unresolved_origin);
    const phonePlayer = (await devices[1].listar("jogadores")).find((row) => row.sync_id === refs.player);
    const phoneLive = (await devices[1].listar("jogos")).find((row) => row.sync_id === refs.liveMatch);
    const phoneEvidenceMatch = (await devices[1].listar("jogos")).find((row) => row.sync_id === refs.evidenceMatch);
    const phoneLegacyId = (await devices[1].listar("jogos")).find((row) => row.external_key === "local-sync-legacy-default-id");
    const phoneLegacyPlayerRef = (await devices[1].listar("jogos")).find((row) => row.external_key === "local-sync-legacy-player-ref");
    const phoneDeleted = (await devices[1].listar("jogos")).find((row) => row.sync_id === refs.deletedMatch);
    const phoneHistoryTraining = (await devices[1].listar("treinos")).find((row) => row.sync_id === refs.historyTraining);
    const phoneExercise = (await devices[1].listar("exercicios")).find((row) => row.sync_id === refs.exercise);
    const phoneProposal = (await devices[1].listar("workspace_documents")).find((row) => row.sync_id === refs.proposal);
    const phonePcDeletedProposal = (await devices[1].listar("workspace_documents")).find((row) => row.sync_id === refs.pcDeletedProposal);
    const phonePlayerArchive = (await devices[1].listar("workspace_documents")).find((row) => row.sync_id === refs.playerArchive);
    assert.notEqual(phonePlayer.id, playerId);
    assert.notEqual(phoneLive.id, liveId);
    assert.notEqual(phoneLegacyId.id, legacySyncId);
    assert.match(phoneLegacyId.sync_id, /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    assert.notEqual(phoneLegacyId.sync_id, "default");
    assert.deepEqual(phoneLegacyPlayerRef.callup.player_ids, [phonePlayer.sync_id]);
    assert.equal(phoneLegacyPlayerRef.lineup.goalkeeper_id, phonePlayer.sync_id);
    assert.notEqual(phoneDeleted.id, deletedId);
    assert.equal(phoneExercise.visual_storage_path, exerciseImagePath);
    assert.equal(phoneExercise.visual_image.sha256, approvedImageSha);
    assert.equal(phoneExercise.visual_url, undefined, "The phone receives only the private object identity, not a signed URL.");
    const publicExerciseImage = await fetch(`${url}/storage/v1/object/public/team-media/${exerciseImagePath}`);
    assert.equal(publicExerciseImage.ok, false, "Approved originals stay in the private team bucket.");
    const [pcExerciseImageUrl, phoneExerciseImageUrl] = await Promise.all([
      owner.client.storage.from("team-media").createSignedUrl(exerciseImagePath, 60),
      coach.client.storage.from("team-media").createSignedUrl(exerciseImagePath, 60),
    ]);
    assert.ifError(pcExerciseImageUrl.error);
    assert.ifError(phoneExerciseImageUrl.error);
    const [pcExerciseImage, phoneExerciseImage] = await Promise.all([
      fetch(pcExerciseImageUrl.data.signedUrl), fetch(phoneExerciseImageUrl.data.signedUrl),
    ]);
    assert.equal(pcExerciseImage.status, 200);
    assert.equal(phoneExerciseImage.status, 200);
    const [pcExerciseBytes, phoneExerciseBytes] = await Promise.all([pcExerciseImage.arrayBuffer(), phoneExerciseImage.arrayBuffer()]);
    assert.equal(crypto.createHash("sha256").update(Buffer.from(pcExerciseBytes)).digest("hex"), approvedImageSha);
    assert.equal(crypto.createHash("sha256").update(Buffer.from(phoneExerciseBytes)).digest("hex"), approvedImageSha);
    assert.equal(phoneHistoryTraining.blocos[0].exercise_ref, phoneExercise.sync_id);
    assert.equal(phoneHistoryTraining.session.blocks[0].exercise_ref, phoneExercise.sync_id);
    assert.equal(JSON.parse(phoneProposal.body).agent_proposal.status, "proposed");
    assert.equal(JSON.parse(phonePcDeletedProposal.body).agent_proposal.status, "proposed");
    assert.equal(phonePlayerArchive.type, "player_archive");
    assert.equal(phonePlayerArchive.status, "archived");
    assert.equal(JSON.parse(phonePlayerArchive.body).development_goals.items[0].history[0].status, "active");
    assert.equal(JSON.parse(phonePlayerArchive.body).development_goals.items[0].evidence_refs[0].id, refs.evidenceMatch);
    assert.equal(PlayerGoals.state(phonePlayer).items.length, 1, "O objetivo longitudinal do atleta deve sincronizar sem criar um segundo registo.");
    assert.equal(PlayerGoals.state(phonePlayer).items[0].id, refs.playerGoal);
    assert.equal(PlayerGoals.state(phonePlayer).items[0].exercise_refs[0], refs.exercise);
    const initialTeamGoal = TeamDevelopment.teamGoal(phoneProposal);
    assert.equal(initialTeamGoal.schema, TeamDevelopment.schemas.goal);
    assert.equal(initialTeamGoal.stage, "planned");
    assert.equal(initialTeamGoal.evidence.length, 0);
    assert.equal(initialTeamGoal.agent_proposal.status, "proposed");
    assert.equal(phoneLive.match_events.events[0].id, refs.lossEvent);
    assert.equal(phoneLive.match_events.events[0].note, "Passe interceptado no PC");
    assert.equal(phoneLive.visual_match.period, 2);
    assert.equal(phoneLive.visual_match.second_half_started_at_ms, 600_000);
    assert.equal(phoneLive.visual_match.status, "paused");
    assert.equal(MatchAnalysis.fromMatch(phoneEvidenceMatch).fields.summary, "Análise inicial no PC");
    assert.equal(MatchEvidence.state(phoneEvidenceMatch).moments.length, 2);
    assert.equal(MatchEvidence.state(phoneEvidenceMatch).moments[0].id, refs.videoMoment);
    const mcp = await import("../supabase/functions/vision-coach-mcp/player_goals.mjs");
    const participation = await mcp.executePlayerGoalTool(admin, { id: "local-head-coach", team_id: teamId, scopes: ["read"] }, "get_player_participation_history", { id: refs.player });
    assert.equal(participation.summary.training_records, 1);
    assert.equal(participation.summary.call_ups, 3);
    assert.equal(participation.summary.recorded_starts, 2);
    assert.equal(participation.summary.total_minutes_ms, 1_260_000);
    assert.equal(participation.match_records[0].positions_played.includes("Defesa"), true);
    assert.equal(participation.training_records[0].attendance, "present");

    await devices[1].atualizar("jogos", { ...phoneLive, nota_tatica: "Editado no telemóvel", sync_dirty: true });
    let editedEvidenceMatch = MatchEvidence.apply(phoneEvidenceMatch, { type: "edit", id: refs.videoMoment, expected_revision: 2, item: {
      seconds: 128, description: "Momento revisto no telemóvel",
    } }, { now: "2026-09-03T12:03:00.000Z" });
    editedEvidenceMatch = MatchEvidence.apply(editedEvidenceMatch, { type: "delete", id: refs.deletedVideoMoment, expected_revision: 3, confirmed: true }, { now: "2026-09-03T12:04:00.000Z" });
    editedEvidenceMatch = MatchAnalysis.save(editedEvidenceMatch, {
      fields: { ...MatchAnalysis.fromMatch(editedEvidenceMatch).fields, summary: "Análise revista no telemóvel" },
    }, { expected_revision: 1, actor: "Treinador", now: "2026-09-03T12:05:00.000Z" });
    await devices[1].atualizar("jogos", { ...editedEvidenceMatch, sync_dirty: true });
    const revisedTeamGoal = TeamDevelopment.saveGoal(phoneProposal, {
      ...initialTeamGoal, stage: "observed", worked_sessions: [{ type: "training", id: refs.historyTraining }],
      evidence: [{ type: "match", id: refs.liveMatch }],
      observations: "O apoio apareceu em parte do exercício; requer nova observação.",
      evaluation: "Evidência observada, ainda insuficiente para concluir melhoria.",
      coach_decision: "Continuar a observar no próximo jogo.",
    }, { expected_revision: initialTeamGoal.revision, now: "2026-09-03T12:03:00.000Z" });
    await devices[1].atualizar("workspace_documents", { ...phoneProposal, body: JSON.stringify(revisedTeamGoal), sync_dirty: true });
    const revisedPlayer = PlayerGoals.apply(phonePlayer, { type: "save", expected_revision: PlayerGoals.state(phonePlayer).revision, goal: {
      ...PlayerGoals.state(phonePlayer).items[0], notes: "Praticado na sessão; progresso ainda não avaliado.", status: "continue",
    } }, { now: "2026-09-03T12:03:00.000Z" });
    await devices[1].atualizar("jogadores", { ...revisedPlayer, sync_dirty: true });
    await devices[1].atualizar("treinos", { ...phoneHistoryTraining, session: { ...phoneHistoryTraining.session, attendance: [{ ...phoneHistoryTraining.session.attendance[0], status: "late" }] }, sync_dirty: true });
    const phonePush = await RemoteWorkspace._syncRecords(teamId, coach.user.id);
    assert.equal(phonePush.pushed, 5);
    globalThis.DB = devices[0];
    RemoteWorkspace.init = async () => owner.client;
    const stalePc = await devices[0].obter("jogos", liveId);
    await devices[0].atualizar("jogos", { ...stalePc, nota_tatica: "Edição antiga no PC", sync_dirty: true });
    const conflict = await RemoteWorkspace._syncRecords(teamId, owner.user.id);
    assert.equal(conflict.pushed, 0);
    assert.equal(conflict.conflicts.some((item) => item.sync_id === refs.liveMatch && item.reason === "version_mismatch"), true);
    assert.equal(conflict.pulled, 4, "As edições dos objetivos, presença, análise e evidências feitas no telemóvel devem regressar ao PC apesar do conflito noutro registo.");
    const pcProposal = (await devices[0].listar("workspace_documents")).find((row) => row.sync_id === refs.proposal);
    const pcTeamGoal = TeamDevelopment.teamGoal(pcProposal);
    assert.equal(pcTeamGoal.stage, "observed");
    assert.equal(pcTeamGoal.observations, "O apoio apareceu em parte do exercício; requer nova observação.");
    assert.equal(pcTeamGoal.worked_sessions[0].id, refs.historyTraining);
    assert.equal(pcTeamGoal.evidence[0].id, refs.liveMatch);
    assert.equal(pcTeamGoal.history.length, 2, "O histórico conserva o estado inicial e a etapa planeada antes da observação.");
    const pcPlayer = (await devices[0].listar("jogadores")).find((row) => row.sync_id === refs.player);
    assert.equal(PlayerGoals.state(pcPlayer).items.length, 1, "Editar um objetivo individual não deve duplicar o atleta nem o objetivo.");
    assert.equal(PlayerGoals.state(pcPlayer).items[0].id, refs.playerGoal);
    assert.equal(PlayerGoals.state(pcPlayer).items[0].status, "continue", "A sincronização não infere melhoria a partir de uma sessão trabalhada.");
    assert.equal(PlayerGoals.state(pcPlayer).items[0].notes, "Praticado na sessão; progresso ainda não avaliado.");
    assert.equal(PlayerGoals.state(pcPlayer).items[0].history.length, 1);
    const pcHistoryTraining = (await devices[0].listar("treinos")).find((row) => row.sync_id === refs.historyTraining);
    assert.equal(pcHistoryTraining.session.attendance[0].status, "late");
    const pcEvidenceMatch = (await devices[0].listar("jogos")).find((row) => row.sync_id === refs.evidenceMatch);
    assert.equal(MatchAnalysis.fromMatch(pcEvidenceMatch).fields.summary, "Análise revista no telemóvel");
    const pcVideoMoments = MatchEvidence.state(pcEvidenceMatch).moments;
    assert.equal(pcVideoMoments.length, 1, "A eliminação de um momento de vídeo deve sincronizar como edição do jogo, sem recriar o momento.");
    assert.equal(pcVideoMoments[0].id, refs.videoMoment);
    assert.equal(pcVideoMoments[0].seconds, 128);
    assert.equal(pcVideoMoments[0].description, "Momento revisto no telemóvel");
    const currentRemote = await admin.from("workspace_records").select("payload").eq("id", refs.liveMatch).single();
    assert.ifError(currentRemote.error);
    assert.equal(currentRemote.data.payload.nota_tatica, "Editado no telemóvel");
    assert.equal(currentRemote.data.payload.visual_match.period, 2);
    assert.equal(currentRemote.data.payload.visual_match.second_half_started_at_ms, 600_000);
    const remoteEvidenceMatch = await admin.from("workspace_records").select("payload").eq("id", refs.evidenceMatch).single();
    assert.ifError(remoteEvidenceMatch.error);
    assert.equal(MatchAnalysis.fromMatch(remoteEvidenceMatch.data.payload).fields.summary, "Análise revista no telemóvel");
    assert.equal(MatchEvidence.state(remoteEvidenceMatch.data.payload).moments.length, 1);

    globalThis.DB = devices[0];
    const photoData = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7RxycAAAAASUVORK5CYII=";
    await devices[0].criar("media_items", {
      team_id: "local-coach", subject_type: "player", subject_id: playerId, type: "photo",
      title: "Foto de perfil sintética", note: "Foto de perfil do atleta", file_name: "profile.png",
      mime_type: "image/png", data_url: photoData, sync_id: refs.photo, remote_team_id: teamId, sync_dirty: true,
    });
    const photoPush = await RemoteWorkspace._syncMedia(teamId, owner.user.id);
    assert.equal(photoPush.pushed, 1);
    const remoteMedia = await admin.from("media_assets").select("storage_path,subject_ref").eq("id", refs.photo).single();
    assert.ifError(remoteMedia.error);
    assert.equal(remoteMedia.data.subject_ref, refs.player);
    const privateObject = await fetch(`${url}/storage/v1/object/public/team-media/${remoteMedia.data.storage_path}`);
    assert.equal(privateObject.ok, false, "A fotografia não pode estar disponível pela rota pública.");
    const deniedSignedUrl = await outsider.client.storage.from("team-media").createSignedUrl(remoteMedia.data.storage_path, 60);
    assert.ok(deniedSignedUrl.error, "A conta de outra equipa não pode assinar a fotografia.");

    globalThis.DB = devices[1];
    const photoPull = await RemoteWorkspace._syncMedia(teamId, coach.user.id);
    assert.equal(photoPull.pulled, 1);
    const phonePhoto = (await devices[1].listar("media_items"))[0];
    assert.equal(phonePhoto.subject_id, String(phonePlayer.id));
    assert.equal(phonePhoto.data_url, undefined);
    assert.match(phonePhoto.url, /\/storage\/v1\/object\/sign\//);
    const signedImage = await fetch(phonePhoto.url);
    assert.equal(signedImage.status, 200);
    assert.equal(signedImage.headers.get("content-type"), "image/png");

    globalThis.DB = devices[1];
    const latestPhotoId = await devices[1].criar("media_items", {
      team_id: "local-coach", subject_type: "player", subject_id: phonePlayer.id, type: "photo",
      title: "Fotografia mais recente sintética", note: "Foto de perfil do atleta", file_name: "perfil-recente.png",
      mime_type: "image/png", data_url: photoData, sync_id: refs.latestPhoto, remote_team_id: teamId, sync_dirty: true,
    });
    const latestPhotoPush = await RemoteWorkspace._syncMedia(teamId, coach.user.id);
    assert.equal(latestPhotoPush.pushed, 1);
    const remoteLatestPhoto = await admin.from("media_assets").select("storage_path,subject_ref,deleted_at").eq("id", refs.latestPhoto).single();
    assert.ifError(remoteLatestPhoto.error);
    assert.equal(remoteLatestPhoto.data.subject_ref, refs.player);
    assert.equal(remoteLatestPhoto.data.deleted_at, null);
    assert.equal(remoteLatestPhoto.data.storage_path.startsWith(`${teamId}/${refs.latestPhoto}/`), true);

    globalThis.DB = devices[0];
    const latestPhotoPull = await RemoteWorkspace._syncMedia(teamId, owner.user.id);
    assert.equal(latestPhotoPull.pulled, 1, "o PC reutiliza a URL válida da foto anterior e importa apenas a nova foto");
    const pcLatestPhotoPlayer = await devices[0].obter("jogadores", playerId);
    assert.equal(pcLatestPhotoPlayer.profile_media_ref, refs.latestPhoto);
    assert.equal(pcLatestPhotoPlayer.foto, null, "O perfil não duplica os bytes da imagem; a origem é media_items.");
    const pcLatestPhotoMedia = (await devices[0].listar("media_items")).find((row) => row.sync_id === refs.latestPhoto);
    assert.match(pcLatestPhotoMedia.url, /\/storage\/v1\/object\/sign\//);

    globalThis.DB = devices[1];
    await devices[1].apagar("media_items", latestPhotoId);
    assert.equal((await devices[1].listar("media_items")).some((row) => row.sync_id === refs.latestPhoto), false, "A fotografia recente desaparece localmente antes de sincronizar a eliminação.");
    await devices[1].apagar("jogos", phoneDeleted.id);
    const proposalForDeletion = (await devices[1].listar("workspace_documents")).find((row) => row.sync_id === refs.proposal);
    await devices[1].apagar("workspace_documents", proposalForDeletion.id);
    assert.equal((await devices[1].listar("workspace_documents")).some((row) => row.sync_id === refs.proposal), false, "O documento apagado deve desaparecer localmente antes de reconectar.");
    const tombstonePush = await RemoteWorkspace._syncTombstones(teamId);
    assert.equal(tombstonePush.deleted, 3);
    const deletedRemoteLatestPhoto = await admin.from("media_assets").select("deleted_at").eq("id", refs.latestPhoto).single();
    assert.ifError(deletedRemoteLatestPhoto.error);
    assert.ok(deletedRemoteLatestPhoto.data.deleted_at, "A eliminação offline deve tombstonar a imagem recente no Storage privado.");
    globalThis.DB = devices[0];
    const deletePull = await RemoteWorkspace._syncRecords(teamId, owner.user.id);
    assert.equal(deletePull.deleted, 2);
    assert.equal(await devices[0].obter("jogos", deletedId), undefined);
    assert.equal((await devices[0].listar("workspace_documents")).some((row) => row.sync_id === refs.proposal), false);
    const remoteProposalDelete = await admin.from("workspace_records").select("deleted_at").eq("id", refs.proposal).single();
    assert.ifError(remoteProposalDelete.error);
    assert.ok(remoteProposalDelete.data.deleted_at, "O tombstone deve apagar a proposta no backend.");
    globalThis.DB = devices[1];
    const phoneSecondPull = await RemoteWorkspace._syncRecords(teamId, coach.user.id);
    assert.equal(phoneSecondPull.pulled, 0, "Uma nova sync não pode ressuscitar a proposta no dispositivo que a apagou.");
    assert.equal((await devices[1].listar("workspace_documents")).some((row) => row.sync_id === refs.proposal), false);
    globalThis.DB = devices[0];
    const pcSecondPull = await RemoteWorkspace._syncRecords(teamId, owner.user.id);
    assert.equal(pcSecondPull.pulled, 0);
    assert.equal((await devices[0].listar("workspace_documents")).some((row) => row.sync_id === refs.proposal), false);
    const pcPhotoDeletePull = await RemoteWorkspace._syncMedia(teamId, owner.user.id);
    assert.equal(pcPhotoDeletePull.deleted, 1);
    const pcPlayerAfterPhotoDelete = await devices[0].obter("jogadores", playerId);
    assert.equal(pcPlayerAfterPhotoDelete.profile_media_ref, refs.photo);
    assert.equal(pcPlayerAfterPhotoDelete.foto, null, "A foto anterior mantém-se na media sem duplicação no perfil.");
    const pcOlderPhoto = (await devices[0].listar("media_items")).find((row) => row.sync_id === refs.photo);
    assert.match(pcOlderPhoto.url, /\/storage\/v1\/object\/sign\//);
    const survivingRemotePhoto = await admin.from("media_assets").select("storage_path,deleted_at").eq("id", refs.photo).single();
    assert.ifError(survivingRemotePhoto.error);
    assert.equal(survivingRemotePhoto.data.deleted_at, null, "A fotografia anterior deve permanecer no Storage.");

    const pcProposalToDelete = (await devices[0].listar("workspace_documents")).find((row) => row.sync_id === refs.pcDeletedProposal);
    await devices[0].apagar("workspace_documents", pcProposalToDelete.id);
    const pcTombstonePush = await RemoteWorkspace._syncTombstones(teamId);
    assert.equal(pcTombstonePush.deleted, 1);
    globalThis.DB = devices[1];
    const phoneDeletePull = await RemoteWorkspace._syncRecords(teamId, coach.user.id);
    assert.equal(phoneDeletePull.deleted, 1);
    assert.equal((await devices[1].listar("workspace_documents")).some((row) => row.sync_id === refs.pcDeletedProposal), false);
    const phoneFinalPull = await RemoteWorkspace._syncRecords(teamId, coach.user.id);
    assert.equal(phoneFinalPull.pulled, 0, "Uma proposta apagada no PC não pode reaparecer no telemóvel após nova sync.");
    assert.equal((await devices[1].listar("workspace_documents")).some((row) => row.sync_id === refs.pcDeletedProposal), false);
    const phonePhotoDeletePull = await RemoteWorkspace._syncMedia(teamId, coach.user.id);
    assert.equal(phonePhotoDeletePull.deleted, 0);
    const phonePlayerAfterPhotoDelete = await devices[1].obter("jogadores", phonePlayer.id);
    assert.equal(phonePlayerAfterPhotoDelete.profile_media_ref, refs.photo);
    assert.equal(phonePlayerAfterPhotoDelete.foto, null);
    const phoneOlderPhoto = (await devices[1].listar("media_items")).find((row) => row.sync_id === refs.photo);
    assert.match(phoneOlderPhoto.url, /\/storage\/v1\/object\/sign\//);
    const survivingSignedPhoto = await fetch(phoneOlderPhoto.url);
    assert.equal(survivingSignedPhoto.status, 200);

    globalThis.DB = devices[0];
    const pcPhotoToDelete = (await devices[0].listar("media_items")).find((row) => row.sync_id === refs.photo);
    await devices[0].apagar("media_items", pcPhotoToDelete.id);
    assert.equal((await devices[0].listar("media_items")).some((row) => row.sync_id === refs.photo), false);
    const pcPhotoTombstone = await RemoteWorkspace._syncTombstones(teamId);
    assert.equal(pcPhotoTombstone.deleted, 1);
    const remoteOldPhotoDelete = await admin.from("media_assets").select("deleted_at").eq("id", refs.photo).single();
    assert.ifError(remoteOldPhotoDelete.error);
    assert.ok(remoteOldPhotoDelete.data.deleted_at);

    globalThis.DB = devices[1];
    const phoneOldPhotoDelete = await RemoteWorkspace._syncMedia(teamId, coach.user.id);
    assert.equal(phoneOldPhotoDelete.deleted, 1);
    assert.equal((await devices[1].listar("media_items")).length, 0);
    const phoneProfileCleared = await devices[1].obter("jogadores", phonePlayer.id);
    assert.equal(phoneProfileCleared.foto, null);
    assert.equal(phoneProfileCleared.profile_media_ref, undefined);
    const phonePhotoNoResurrection = await RemoteWorkspace._syncMedia(teamId, coach.user.id);
    assert.equal(phonePhotoNoResurrection.pulled, 0);
    assert.equal((await devices[1].listar("media_items")).length, 0);

    globalThis.DB = devices[0];
    await RemoteWorkspace._syncMedia(teamId, owner.user.id);
    const pcProfileCleared = await devices[0].obter("jogadores", playerId);
    assert.equal(pcProfileCleared.foto, null);
    assert.equal(pcProfileCleared.profile_media_ref, undefined);
    assert.equal((await devices[0].listar("media_items")).length, 0);

    const idAt = (group, index) => `${group}-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;
    const overflowRows = Array.from({ length: 1007 }, (_, index) => ({
      id: idAt("80000000", index), team_id: teamId, kind: "document",
      payload: { type: "note", title: `Histórico ${index + 1}`, body: "Registo sintético de paginação", external_key: `sync-page-${index + 1}` },
      actor_type: "human", actor_label: "Teste de integração", created_by: owner.user.id,
    }));
    for (let start = 0; start < overflowRows.length; start += 200) {
      const inserted = await admin.from("workspace_records").insert(overflowRows.slice(start, start + 200));
      assert.ifError(inserted.error);
    }
    globalThis.DB = devices[1];
    RemoteWorkspace.init = async () => coach.client;
    const paginatedSync = await RemoteWorkspace._syncRecords(teamId, coach.user.id);
    assert.equal(paginatedSync.pulled, overflowRows.length, "A leitura em páginas deve ultrapassar o max_rows da Data API sem perder documentos.");
    const phoneOverflowRows = (await devices[1].listar("workspace_documents")).filter((row) => row.external_key?.startsWith("sync-page-"));
    assert.equal(phoneOverflowRows.length, overflowRows.length);
    assert.equal(new Set(phoneOverflowRows.map((row) => row.sync_id)).size, overflowRows.length, "Páginas não podem gerar duplicados locais.");

    const overflowMedia = overflowRows.map((row, index) => ({
      id: idAt("83000000", index), team_id: teamId, subject_type: "team", subject_ref: teamId,
      media_type: "file", title: `Ficheiro ${index + 1}`, note: "Teste sintético de paginação",
      external_url: `https://example.test/sync-page/${index + 1}`, created_by: owner.user.id,
    }));
    for (let start = 0; start < overflowMedia.length; start += 200) {
      const inserted = await admin.from("media_assets").insert(overflowMedia.slice(start, start + 200));
      assert.ifError(inserted.error);
    }
    const paginatedMedia = await RemoteWorkspace._syncMedia(teamId, coach.user.id);
    assert.equal(paginatedMedia.pulled, overflowMedia.length, "A leitura de media deve ultrapassar o max_rows da Data API sem perder registos.");
    const phoneOverflowMedia = (await devices[1].listar("media_items")).filter((row) => row.title.startsWith("Ficheiro "));
    assert.equal(phoneOverflowMedia.length, overflowMedia.length);
    assert.equal(new Set(phoneOverflowMedia.map((row) => row.sync_id)).size, overflowMedia.length);

    const overflowActivity = overflowRows.map((row, index) => ({
      id: idAt("81000000", index), team_id: teamId, actor_type: "human", actor_label: "Teste de integração",
      action: "updated", summary: `Atividade sintética ${index + 1}`, created_by: owner.user.id,
    }));
    for (let start = 0; start < overflowActivity.length; start += 200) {
      const inserted = await admin.from("activity_log").insert(overflowActivity.slice(start, start + 200));
      assert.ifError(inserted.error);
    }
    const paginatedActivity = await RemoteWorkspace._syncActivity(teamId, coach.user.id);
    assert.equal(paginatedActivity.pulled, overflowActivity.length, "A leitura da atividade deve ultrapassar o max_rows da Data API sem perder registos.");
    const phoneOverflowActivity = (await devices[1].listar("activity_items"))
      .filter((row) => row.summary.startsWith("Atividade sintética "));
    assert.equal(phoneOverflowActivity.length, overflowActivity.length);
    assert.equal(new Set(phoneOverflowActivity.map((row) => row.sync_id)).size, overflowActivity.length);

    const consolidationOriginal = {
      db: globalThis.DB, team: globalThis.DEFAULT_TEAM_ID, init: RemoteWorkspace.init,
      getSession: RemoteWorkspace.getSession, ensureSelectedTeam: RemoteWorkspace.ensureSelectedTeam,
      syncNow: RemoteWorkspace.syncNow, navigator: Object.getOwnPropertyDescriptor(globalThis, "navigator"),
      localStorage: globalThis.localStorage,
    };
    const localPlayer = { id: 1, team_id: "local-coach", sync_id: overflowRows.at(-1).id,
      remote_team_id: teamId, remote_updated_at: "present", sync_dirty: false };
    const localMedia = { id: 2, team_id: "local-coach", sync_id: overflowMedia.at(-1).id,
      remote_team_id: teamId, remote_updated_at: "present", sync_dirty: false };
    globalThis.DB = {
      async listar(store) { return store === "jogadores" ? [{ ...localPlayer }] : store === "media_items" ? [{ ...localMedia }] : []; },
      async atualizar() { throw new Error("Consolidation must not mark paged remote records as missing."); },
    };
    globalThis.DEFAULT_TEAM_ID = "local-coach";
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: { onLine: true } });
    globalThis.localStorage = { setItem() {} };
    RemoteWorkspace.init = async () => owner.client;
    RemoteWorkspace.getSession = async () => ({ user: owner.user });
    RemoteWorkspace.ensureSelectedTeam = async () => teamId;
    RemoteWorkspace.syncNow = async () => ({ pushed: 0, pulled: 0, deleted: 0, conflicts: [] });
    try {
      const consolidated = await RemoteWorkspace.consolidateNow();
      assert.equal(consolidated.repaired, 0, "Consolidation must see late-page IDs in both remote tables.");
    } finally {
      globalThis.DB = consolidationOriginal.db;
      globalThis.DEFAULT_TEAM_ID = consolidationOriginal.team;
      if (consolidationOriginal.navigator) Object.defineProperty(globalThis, "navigator", consolidationOriginal.navigator);
      else delete globalThis.navigator;
      globalThis.localStorage = consolidationOriginal.localStorage;
      RemoteWorkspace.init = consolidationOriginal.init;
      RemoteWorkspace.getSession = consolidationOriginal.getSession;
      RemoteWorkspace.ensureSelectedTeam = consolidationOriginal.ensureSelectedTeam;
      RemoteWorkspace.syncNow = consolidationOriginal.syncNow;
    }
  } finally {
    RemoteWorkspace.init = original.init;
    globalThis.DB = original.db;
    globalThis.DEFAULT_TEAM_ID = original.team;
    globalThis.mediaSubjectKey = original.subjectKey;
    if (teamId) {
      if (viewerObjectPath) {
        const paths = [viewerObjectPath, viewerRejectedUploadPath].filter(Boolean);
        const removedViewerProbe = await admin.storage.from("team-media").remove(paths);
        assert.ifError(removedViewerProbe.error);
      }
      if (exerciseImagePath) {
        const removedExerciseImage = await admin.storage.from("team-media").remove([exerciseImagePath]);
        assert.ifError(removedExerciseImage.error);
      }
      const { data: mediaRows, error: mediaError } = await admin.from("media_assets").select("storage_path").eq("team_id", teamId);
      assert.ifError(mediaError);
      const paths = [...new Set((mediaRows || []).map((row) => row.storage_path).filter(Boolean))];
      if (paths.length) {
        const removed = await admin.storage.from("team-media").remove(paths);
        assert.ifError(removed.error);
      }
    }
    for (const id of users) await admin.auth.admin.deleteUser(id);
  }
});
