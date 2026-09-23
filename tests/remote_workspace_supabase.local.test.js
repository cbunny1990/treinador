"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { createClient } = require("@supabase/supabase-js");
const { RemoteWorkspace } = require("../js/remote_workspace.js");
const MatchVisual = require("../js/match_visual.js");

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

    const inaccessible = await outsider.client.from("workspace_records").select("id").eq("team_id", teamId);
    assert.ifError(inaccessible.error);
    assert.deepEqual(inaccessible.data, []);
    const forbiddenInsert = await outsider.client.from("workspace_records").insert({
      id: crypto.randomUUID(), team_id: teamId, kind: "match", payload: { external_key: "foreign-team-write" },
    }).select("id");
    assert.ok(forbiddenInsert.error, "RLS must reject a write to another team's workspace.");

    const refs = { player: crypto.randomUUID(), liveMatch: crypto.randomUUID(), deletedMatch: crypto.randomUUID(), historyMatch: crypto.randomUUID(), historyTraining: crypto.randomUUID(), exercise: crypto.randomUUID(), proposal: crypto.randomUUID(), pcDeletedProposal: crypto.randomUUID(), photo: crypto.randomUUID(), latestPhoto: crypto.randomUUID(), lossEvent: crypto.randomUUID() };
    globalThis.DEFAULT_TEAM_ID = "local-coach";
    globalThis.mediaSubjectKey = (team, type, id) => `${team}|${type}|${id}`;
    globalThis.DB = devices[0];
    RemoteWorkspace.init = async () => owner.client;
    const playerId = await devices[0].criar("jogadores", {
      team_id: "local-coach", sync_id: refs.player, remote_team_id: teamId, sync_dirty: true,
      nome: "Atleta sintético", plantel_ativo: true,
    });
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
    const exerciseId = await devices[0].criar("exercicios", {
      team_id: "local-coach", sync_id: refs.exercise, remote_team_id: teamId, sync_dirty: true,
      workspace_v2: true, external_key: "local-sync-passe-apoio", nome: "Passe + apoio",
    });
    await devices[0].criar("treinos", {
      team_id: "local-coach", sync_id: refs.historyTraining, remote_team_id: teamId, sync_dirty: true,
      external_key: "local-player-history-training", data: "2026-09-02", objetivo: "Passe + apoio",
      blocos: [{ exercise_ref: String(exerciseId), duration_min: 12 }],
      session: { attendance: [{ player_ref: refs.player, name: "Atleta sintético", status: "present" }], blocks: [{ exercise_ref: String(exerciseId), planned_min: 12, elapsed_ms: 60_000 }] },
    });
    const proposalBody = { objective: "Apoio após passe", agent_proposal: { status: "proposed", rationale: "Proposta para revisão do treinador", evidence: [{ type: "match", id: refs.liveMatch }, { type: "training", id: refs.historyTraining }] } };
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
    const firstPush = await RemoteWorkspace._syncRecords(teamId, owner.user.id);
    assert.equal(firstPush.pushed, 14);
    const pcLegacyPlayerRef = (await devices[0].listar("jogos")).find((row) => row.external_key === "local-sync-legacy-player-ref");
    assert.deepEqual(pcLegacyPlayerRef.callup.player_ids, [refs.player]);
    assert.equal(pcLegacyPlayerRef.lineup.goalkeeper_id, refs.player);
    const pcHistoryTrainingAfterPush = (await devices[0].listar("treinos")).find((row) => row.sync_id === refs.historyTraining);
    assert.equal(pcHistoryTrainingAfterPush.blocos[0].exercise_ref, refs.exercise);
    assert.equal(pcHistoryTrainingAfterPush.session.blocks[0].exercise_ref, refs.exercise);

    globalThis.DB = devices[1];
    RemoteWorkspace.init = async () => coach.client;
    await devices[1].criar("sync_tombstones", { store: "seed", sync_id: "force-distinct-local-ids" });
    const pulled = await RemoteWorkspace._syncRecords(teamId, coach.user.id);
    assert.equal(pulled.pulled, 14);
    const phonePlayer = (await devices[1].listar("jogadores")).find((row) => row.sync_id === refs.player);
    const phoneLive = (await devices[1].listar("jogos")).find((row) => row.sync_id === refs.liveMatch);
    const phoneLegacyId = (await devices[1].listar("jogos")).find((row) => row.external_key === "local-sync-legacy-default-id");
    const phoneLegacyPlayerRef = (await devices[1].listar("jogos")).find((row) => row.external_key === "local-sync-legacy-player-ref");
    const phoneDeleted = (await devices[1].listar("jogos")).find((row) => row.sync_id === refs.deletedMatch);
    const phoneHistoryTraining = (await devices[1].listar("treinos")).find((row) => row.sync_id === refs.historyTraining);
    const phoneExercise = (await devices[1].listar("exercicios")).find((row) => row.sync_id === refs.exercise);
    const phoneProposal = (await devices[1].listar("workspace_documents")).find((row) => row.sync_id === refs.proposal);
    const phonePcDeletedProposal = (await devices[1].listar("workspace_documents")).find((row) => row.sync_id === refs.pcDeletedProposal);
    assert.notEqual(phonePlayer.id, playerId);
    assert.notEqual(phoneLive.id, liveId);
    assert.notEqual(phoneLegacyId.id, legacySyncId);
    assert.match(phoneLegacyId.sync_id, /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    assert.notEqual(phoneLegacyId.sync_id, "default");
    assert.deepEqual(phoneLegacyPlayerRef.callup.player_ids, [phonePlayer.sync_id]);
    assert.equal(phoneLegacyPlayerRef.lineup.goalkeeper_id, phonePlayer.sync_id);
    assert.notEqual(phoneDeleted.id, deletedId);
    assert.equal(phoneHistoryTraining.blocos[0].exercise_ref, phoneExercise.sync_id);
    assert.equal(phoneHistoryTraining.session.blocks[0].exercise_ref, phoneExercise.sync_id);
    assert.equal(JSON.parse(phoneProposal.body).agent_proposal.status, "proposed");
    assert.equal(JSON.parse(phonePcDeletedProposal.body).agent_proposal.status, "proposed");
    assert.equal(phoneLive.match_events.events[0].id, refs.lossEvent);
    assert.equal(phoneLive.match_events.events[0].note, "Passe interceptado no PC");
    assert.equal(phoneLive.visual_match.period, 2);
    assert.equal(phoneLive.visual_match.second_half_started_at_ms, 600_000);
    assert.equal(phoneLive.visual_match.status, "paused");
    const mcp = await import("../supabase/functions/vision-coach-mcp/player_goals.mjs");
    const participation = await mcp.executePlayerGoalTool(admin, { id: "local-head-coach", team_id: teamId, scopes: ["read"] }, "get_player_participation_history", { id: refs.player });
    assert.equal(participation.summary.training_records, 1);
    assert.equal(participation.summary.call_ups, 3);
    assert.equal(participation.summary.recorded_starts, 2);
    assert.equal(participation.summary.total_minutes_ms, 1_260_000);
    assert.equal(participation.match_records[0].positions_played.includes("Defesa"), true);
    assert.equal(participation.training_records[0].attendance, "present");

    await devices[1].atualizar("jogos", { ...phoneLive, nota_tatica: "Editado no telemóvel", sync_dirty: true });
    await devices[1].atualizar("workspace_documents", { ...phoneProposal, body: JSON.stringify({ ...JSON.parse(phoneProposal.body), coach_review: "Rever apoio no próximo treino" }), sync_dirty: true });
    await devices[1].atualizar("treinos", { ...phoneHistoryTraining, session: { ...phoneHistoryTraining.session, attendance: [{ ...phoneHistoryTraining.session.attendance[0], status: "late" }] }, sync_dirty: true });
    const phonePush = await RemoteWorkspace._syncRecords(teamId, coach.user.id);
    assert.equal(phonePush.pushed, 3);
    globalThis.DB = devices[0];
    RemoteWorkspace.init = async () => owner.client;
    const stalePc = await devices[0].obter("jogos", liveId);
    await devices[0].atualizar("jogos", { ...stalePc, nota_tatica: "Edição antiga no PC", sync_dirty: true });
    const conflict = await RemoteWorkspace._syncRecords(teamId, owner.user.id);
    assert.equal(conflict.pushed, 0);
    assert.equal(conflict.conflicts.some((item) => item.sync_id === refs.liveMatch && item.reason === "version_mismatch"), true);
    assert.equal(conflict.pulled, 2, "As edições da proposta e da presença feitas no telemóvel devem regressar ao PC apesar do conflito noutro registo.");
    const pcProposal = (await devices[0].listar("workspace_documents")).find((row) => row.sync_id === refs.proposal);
    assert.equal(JSON.parse(pcProposal.body).coach_review, "Rever apoio no próximo treino");
    const pcHistoryTraining = (await devices[0].listar("treinos")).find((row) => row.sync_id === refs.historyTraining);
    assert.equal(pcHistoryTraining.session.attendance[0].status, "late");
    const currentRemote = await admin.from("workspace_records").select("payload").eq("id", refs.liveMatch).single();
    assert.ifError(currentRemote.error);
    assert.equal(currentRemote.data.payload.nota_tatica, "Editado no telemóvel");
    assert.equal(currentRemote.data.payload.visual_match.period, 2);
    assert.equal(currentRemote.data.payload.visual_match.second_half_started_at_ms, 600_000);

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
    assert.equal(latestPhotoPull.pulled, 2, "O PC refresca a URL assinada da foto anterior e recebe a nova foto.");
    const pcLatestPhotoPlayer = await devices[0].obter("jogadores", playerId);
    assert.equal(pcLatestPhotoPlayer.profile_media_ref, refs.latestPhoto);
    assert.match(pcLatestPhotoPlayer.foto, /\/storage\/v1\/object\/sign\//);

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
    assert.equal(pcPlayerAfterPhotoDelete.foto, photoData, "O PC deve voltar à foto anterior que ainda existe localmente.");
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
    assert.match(phonePlayerAfterPhotoDelete.foto, /\/storage\/v1\/object\/sign\//);
    const survivingSignedPhoto = await fetch(phonePlayerAfterPhotoDelete.foto);
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
  } finally {
    RemoteWorkspace.init = original.init;
    globalThis.DB = original.db;
    globalThis.DEFAULT_TEAM_ID = original.team;
    globalThis.mediaSubjectKey = original.subjectKey;
    for (const id of users) await admin.auth.admin.deleteUser(id);
  }
});
