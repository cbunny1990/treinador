"use strict";

const { test, expect } = require("@playwright/test");
const crypto = require("node:crypto");
const { createClient } = require("@supabase/supabase-js");

const url = process.env.VISION_COACH_SUPABASE_LOCAL_URL || "";
const anonKey = process.env.VISION_COACH_SUPABASE_LOCAL_ANON_KEY || "";
const serviceKey = process.env.VISION_COACH_SUPABASE_LOCAL_SERVICE_KEY || "";
const enabled = !!(url && anonKey && serviceKey);

test("duas PWA sincronizam trabalho offline, expõem conflito concorrente e não ressuscitam eliminados", {
  skip: !enabled && "requer apenas a stack Supabase local; nunca usar credenciais de produção",
  timeout: 120_000,
}, async ({ page, context, browser }) => {
  const parsed = new URL(url);
  expect(["localhost", "127.0.0.1", "::1"]).toContain(parsed.hostname);
  const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const email = `pwa-reload-${crypto.randomUUID()}@vision-coach.local`;
  const password = crypto.randomBytes(24).toString("base64url");
  let userId;
  let teamId;
  let gameSyncId;
  let mobileContext;

  try {
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    expect(created.error).toBeNull();
    userId = created.data.user.id;

    await page.addInitScript(({ localUrl, publishableKey }) => {
      localStorage.setItem("treinador.remote.supabase.v1", JSON.stringify({ url: localUrl, publishableKey }));
      localStorage.setItem("treinador.workspace.consolidated.v1", new Date().toISOString());
    }, { localUrl: url, publishableKey: anonKey });
    await page.goto("/");
    await expect.poll(() => page.evaluate(() => typeof RemoteWorkspace !== "undefined"), { timeout: 15000 }).toBe(true);
    teamId = await page.evaluate(async ({ email, password }) => {
      const client = await RemoteWorkspace.init();
      const { error } = await client.auth.signInWithPassword({ email, password });
      if (error) throw error;
      RemoteWorkspace.scheduleSync = () => {};
      const team = await RemoteWorkspace.createTeamFromLocal();
      await RemoteWorkspace.syncNow();
      return team.id;
    }, { email, password });

    await page.evaluate(() => navigator.serviceWorker.ready);
    await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller), { timeout: 15000 }).toBe(true);
    gameSyncId = crypto.randomUUID();
    const queued = await page.evaluate(async (syncId) => {
      const id = await DB.criar("jogos", {
        team_id: DEFAULT_TEAM_ID,
        sync_id: syncId,
        data: "2026-09-23",
        adversario: "Jogo de sincronização após reload",
        estado: "agendado",
      });
      const row = await DB.obter("jogos", id);
      return { sync_id: row.sync_id, sync_dirty: row.sync_dirty };
    }, gameSyncId);
    expect(queued).toEqual({ sync_id: gameSyncId, sync_dirty: true });

    await context.setOffline(true);
    await page.reload();
    await expect.poll(() => page.evaluate(() => typeof DB !== "undefined"), { timeout: 15000 }).toBe(true);
    const afterReload = await page.evaluate(async (syncId) => {
      const row = (await DB.listar("jogos")).find((item) => item.sync_id === syncId);
      return row && { sync_id: row.sync_id, adversario: row.adversario, sync_dirty: row.sync_dirty };
    }, gameSyncId);
    expect(afterReload).toEqual({
      sync_id: gameSyncId,
      adversario: "Jogo de sincronização após reload",
      sync_dirty: true,
    });

    await context.setOffline(false);
    await expect.poll(async () => page.evaluate(async (syncId) => {
      const local = (await DB.listar("jogos")).find((item) => item.sync_id === syncId);
      const client = await RemoteWorkspace.init();
      const { data, error } = await client.from("workspace_records").select("id,team_id,kind,payload")
        .eq("id", syncId).eq("team_id", localStorage && JSON.parse(localStorage.getItem("treinador.remote.supabase.v1")).remoteTeamId);
      return error
        ? { dirty: local?.sync_dirty, queryError: `${error.code || ""} ${error.message || error}`.trim() }
        : { dirty: local?.sync_dirty, count: data.length, id: data[0]?.id, kind: data[0]?.kind, payload: data[0]?.payload };
    }, gameSyncId), { timeout: 25000 }).toMatchObject({
      dirty: false,
      count: 1,
      id: gameSyncId,
      kind: "match",
      payload: { adversario: "Jogo de sincronização após reload" },
    });

    await page.evaluate(() => RemoteWorkspace.syncNow());
    const idempotent = await page.evaluate(async (syncId) => {
      const { data, error } = await (await RemoteWorkspace.init()).from("workspace_records")
        .select("id").eq("id", syncId);
      if (error) throw error;
      return data.length;
    }, gameSyncId);
    expect(idempotent).toBe(1);

    mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const phone = await mobileContext.newPage();
    await phone.addInitScript(({ localUrl, publishableKey, remoteTeamId }) => {
      localStorage.setItem("treinador.remote.supabase.v1", JSON.stringify({ url: localUrl, publishableKey, remoteTeamId }));
      localStorage.setItem("treinador.workspace.consolidated.v1", new Date().toISOString());
    }, { localUrl: url, publishableKey: anonKey, remoteTeamId: teamId });
    await phone.goto("/");
    await expect.poll(() => phone.evaluate(() => typeof DB !== "undefined"), { timeout: 15000 }).toBe(true);
    const phonePull = await phone.evaluate(async ({ email, password }) => {
      const client = await RemoteWorkspace.init();
      const { error } = await client.auth.signInWithPassword({ email, password });
      if (error) throw error;
      return RemoteWorkspace.syncNow();
    }, { email, password });
    expect(phonePull.conflicts).toEqual([]);
    const phoneMatch = await phone.evaluate(async (syncId) => {
      const rows = await DB.listar("jogos");
      const row = rows.find((item) => item.sync_id === syncId);
      return row && { id: row.id, adversario: row.adversario, sync_dirty: row.sync_dirty };
    }, gameSyncId);
    expect(phoneMatch).toMatchObject({ adversario: "Jogo de sincronização após reload", sync_dirty: false });

    await mobileContext.setOffline(true);
    await phone.evaluate(async (id) => {
      await DB.modificar("jogos", id, (row) => ({ ...row, adversario: "Editado offline no telemóvel" }));
    }, phoneMatch.id);
    await mobileContext.setOffline(false);
    await phone.evaluate(async () => {
      const result = await RemoteWorkspace.syncNow();
      if (result.conflicts.length) throw new Error(JSON.stringify(result.conflicts));
    });
    const desktopUpdate = await page.evaluate(async (syncId) => {
      const result = await RemoteWorkspace.syncNow();
      const row = (await DB.listar("jogos")).find((item) => item.sync_id === syncId);
      return { conflicts: result.conflicts, adversario: row?.adversario, dirty: row?.sync_dirty };
    }, gameSyncId);
    expect(desktopUpdate).toEqual({ conflicts: [], adversario: "Editado offline no telemóvel", dirty: false });

    await page.waitForFunction(() => typeof VisionMatchAnalysis !== "undefined" && typeof VisionMatchEvidence !== "undefined");
    const evidenceSyncId = crypto.randomUUID();
    const momentToKeep = crypto.randomUUID();
    const momentToDelete = crypto.randomUUID();
    await page.evaluate(async ({ syncId, keepId, deleteId }) => {
      const id = await DB.criar("jogos", {
        team_id: DEFAULT_TEAM_ID, sync_id: syncId, data: "2026-09-24",
        adversario: "Análise e evidências offline", estado: "concluido",
      });
      await DB.modificar("jogos", id, (row) => VisionMatchAnalysis.save(row, {
        fields: { summary: "Resumo inicial no PC" },
      }, { expected_revision: 0, actor: "Treinador" }));
      await DB.modificar("jogos", id, (row) => VisionMatchEvidence.apply(row, {
        type: "add", expected_revision: 0,
        item: { id: keepId, url: "https://example.test/jogo.mp4", seconds: 90, category: "goal", description: "Momento a manter", relation_type: "none" },
      }));
      await DB.modificar("jogos", id, (row) => VisionMatchEvidence.apply(row, {
        type: "add", expected_revision: 1,
        item: { id: deleteId, url: "https://example.test/jogo.mp4", seconds: 150, category: "chance", description: "Momento a remover", relation_type: "none" },
      }));
      const result = await RemoteWorkspace.syncNow();
      if (result.conflicts.length) throw new Error(JSON.stringify(result.conflicts));
    }, { syncId: evidenceSyncId, keepId: momentToKeep, deleteId: momentToDelete });
    await phone.evaluate(async (syncId) => {
      const result = await RemoteWorkspace.syncNow();
      if (result.conflicts.length) throw new Error(JSON.stringify(result.conflicts));
      const row = (await DB.listar("jogos")).find((item) => item.sync_id === syncId);
      if (!row || VisionMatchAnalysis.fromMatch(row).fields.summary !== "Resumo inicial no PC" || VisionMatchEvidence.state(row).moments.length !== 2) {
        throw new Error("A análise inicial e os dois momentos não chegaram ao telemóvel.");
      }
    }, evidenceSyncId);

    await mobileContext.setOffline(true);
    await phone.evaluate(async ({ syncId, keepId, deleteId }) => {
      const row = (await DB.listar("jogos")).find((item) => item.sync_id === syncId);
      if (!row) throw new Error("Jogo com análise não encontrado no telemóvel.");
      let changed = VisionMatchEvidence.apply(row, {
        type: "edit", id: keepId, expected_revision: 2,
        item: { seconds: 95, description: "Momento revisto offline" },
      });
      changed = VisionMatchEvidence.apply(changed, {
        type: "delete", id: deleteId, expected_revision: 3, confirmed: true,
      });
      changed = VisionMatchAnalysis.save(changed, {
        fields: { ...VisionMatchAnalysis.fromMatch(changed).fields, summary: "Resumo revisto offline no telemóvel" },
      }, { expected_revision: 1, actor: "Treinador" });
      await DB.modificar("jogos", row.id, () => ({ ...changed, sync_dirty: true }));
    }, { syncId: evidenceSyncId, keepId: momentToKeep, deleteId: momentToDelete });
    const beforeEvidenceReconnect = await admin.from("workspace_records").select("payload").eq("id", evidenceSyncId).single();
    expect(beforeEvidenceReconnect.error).toBeNull();
    expect(beforeEvidenceReconnect.data.payload.post_game.analysis.fields.summary).toBe("Resumo inicial no PC");
    expect(beforeEvidenceReconnect.data.payload.match_evidence.moments).toHaveLength(2);

    await mobileContext.setOffline(false);
    const evidencePhonePush = await phone.evaluate(async () => RemoteWorkspace.syncNow());
    expect(evidencePhonePush.conflicts).toEqual([]);
    const evidenceDesktopPull = await page.evaluate(async (syncId) => {
      const result = await RemoteWorkspace.syncNow();
      const row = (await DB.listar("jogos")).find((item) => item.sync_id === syncId);
      return { conflicts: result.conflicts, summary: VisionMatchAnalysis.fromMatch(row).fields.summary, moments: VisionMatchEvidence.state(row).moments };
    }, evidenceSyncId);
    expect(evidenceDesktopPull.conflicts).toEqual([]);
    expect(evidenceDesktopPull.summary).toBe("Resumo revisto offline no telemóvel");
    expect(evidenceDesktopPull.moments).toHaveLength(1);
    expect(evidenceDesktopPull.moments[0]).toMatchObject({ id: momentToKeep, seconds: 95, description: "Momento revisto offline" });
    await phone.evaluate(() => RemoteWorkspace.syncNow());
    await page.evaluate(() => RemoteWorkspace.syncNow());
    const evidenceAfterReplay = await admin.from("workspace_records").select("id,payload").eq("id", evidenceSyncId);
    expect(evidenceAfterReplay.error).toBeNull();
    expect(evidenceAfterReplay.data).toHaveLength(1);
    expect(evidenceAfterReplay.data[0].payload.match_evidence.moments).toHaveLength(1);
    expect(evidenceAfterReplay.data[0].payload.match_evidence.moments[0].id).toBe(momentToKeep);

    await context.setOffline(true);
    await page.evaluate(async (syncId) => {
      const row = (await DB.listar("jogos")).find((item) => item.sync_id === syncId);
      await DB.apagar("jogos", row.id, { expected: row });
    }, gameSyncId);
    await context.setOffline(false);
    await page.evaluate(async () => {
      const result = await RemoteWorkspace.syncNow();
      if (result.conflicts.length) throw new Error(JSON.stringify(result.conflicts));
    });
    const phoneAfterDelete = await phone.evaluate(async (syncId) => {
      const result = await RemoteWorkspace.syncNow();
      const rows = await DB.listar("jogos");
      const remote = await (await RemoteWorkspace.init()).from("workspace_records").select("id,deleted_at").eq("id", syncId).maybeSingle();
      if (remote.error) throw remote.error;
      return { conflicts: result.conflicts, localCopies: rows.filter((item) => item.sync_id === syncId).length, deletedAt: remote.data?.deleted_at || null };
    }, gameSyncId);
    expect(phoneAfterDelete.conflicts).toEqual([]);
    expect(phoneAfterDelete.localCopies).toBe(0);
    expect(phoneAfterDelete.deletedAt).not.toBeNull();
    await phone.evaluate((syncId) => RemoteWorkspace.syncNow(), gameSyncId);
    const noResurrection = await phone.evaluate(async (syncId) => (await DB.listar("jogos")).filter((item) => item.sync_id === syncId).length, gameSyncId);
    expect(noResurrection).toBe(0);

    const conflictedSyncId = crypto.randomUUID();
    await page.evaluate(async (syncId) => {
      await DB.criar("jogos", {
        team_id: DEFAULT_TEAM_ID, sync_id: syncId, data: "2026-09-24",
        adversario: "Base para edição concorrente", estado: "agendado",
      });
      const result = await RemoteWorkspace.syncNow();
      if (result.conflicts.length) throw new Error(JSON.stringify(result.conflicts));
    }, conflictedSyncId);
    await phone.evaluate(async (syncId) => {
      const result = await RemoteWorkspace.syncNow();
      if (result.conflicts.length) throw new Error(JSON.stringify(result.conflicts));
    }, conflictedSyncId);
    const conflictPhoneId = await phone.evaluate(async (syncId) =>
      (await DB.listar("jogos")).find((item) => item.sync_id === syncId)?.id, conflictedSyncId);
    const conflictDesktopId = await page.evaluate(async (syncId) =>
      (await DB.listar("jogos")).find((item) => item.sync_id === syncId)?.id, conflictedSyncId);
    expect(conflictPhoneId).toBeTruthy();
    expect(conflictDesktopId).toBeTruthy();

    await context.setOffline(true);
    await mobileContext.setOffline(true);
    await page.evaluate((id) => DB.modificar("jogos", id, (row) => ({ ...row, adversario: "Edição offline no PC" })), conflictDesktopId);
    await phone.evaluate((id) => DB.modificar("jogos", id, (row) => ({ ...row, adversario: "Edição offline no telemóvel" })), conflictPhoneId);
    await context.setOffline(false);
    const desktopWrite = await page.evaluate(() => RemoteWorkspace.syncNow());
    expect(desktopWrite.conflicts).toEqual([]);
    await mobileContext.setOffline(false);
    const mobileConflict = await phone.evaluate(async (syncId) => {
      const result = await RemoteWorkspace.syncNow();
      const local = (await DB.listar("jogos")).find((item) => item.sync_id === syncId);
      const remote = await (await RemoteWorkspace.init()).from("workspace_records")
        .select("payload,updated_at").eq("id", syncId).maybeSingle();
      if (remote.error) throw remote.error;
      const status = await RemoteWorkspace.status();
      return { conflicts: result.conflicts, statusConflicts: status.conflicts, local: local && { adversario: local.adversario, sync_dirty: local.sync_dirty }, remote: remote.data?.payload?.adversario };
    }, conflictedSyncId);
    expect(mobileConflict.conflicts.some((item) => item.sync_id === conflictedSyncId && item.reason === "version_mismatch")).toBe(true);
    expect(mobileConflict.statusConflicts.some((item) => item.sync_id === conflictedSyncId && item.reason === "version_mismatch")).toBe(true);
    expect(mobileConflict.local).toEqual({ adversario: "Edição offline no telemóvel", sync_dirty: true });
    expect(mobileConflict.remote).toBe("Edição offline no PC");

    const photoPlayerSyncId = crypto.randomUUID();
    const profilePhotoSyncId = crypto.randomUUID();
    const profilePhotoBytes = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7RxycAAAAASUVORK5CYII=";
    const photoPlayerId = await page.evaluate(async (syncId) => {
      const id = await DB.criar("jogadores", {
        team_id: DEFAULT_TEAM_ID, sync_id: syncId, nome: "Atleta de foto PWA", plantel_ativo: true,
      });
      const result = await RemoteWorkspace.syncNow();
      if (result.conflicts.some((item) => item.sync_id === syncId)) throw new Error(JSON.stringify(result.conflicts));
      return id;
    }, photoPlayerSyncId);
    await context.setOffline(true);
    const localPhotoId = await page.evaluate(({ playerId, syncId, bytes }) => DB.criar("media_items", {
      team_id: DEFAULT_TEAM_ID, subject_type: "player", subject_id: playerId,
      sync_id: syncId, type: "photo", title: "Foto de perfil original",
      note: "Foto de perfil do atleta", file_name: "perfil.png", mime_type: "image/png", data_url: bytes,
    }), { playerId: photoPlayerId, syncId: profilePhotoSyncId, bytes: profilePhotoBytes });
    await context.setOffline(false);
    const photoPush = await page.evaluate(async ({ syncId, localId }) => {
      const result = await RemoteWorkspace.syncNow();
      return { conflicts: result.conflicts.filter((item) => item.sync_id === syncId), local: await DB.obter("media_items", localId) };
    }, { syncId: profilePhotoSyncId, localId: localPhotoId });
    expect(photoPush.conflicts).toEqual([]);
    expect(photoPush.local.sync_dirty).toBe(false);
    const remotePhoto = await admin.from("media_assets").select("storage_path,title,deleted_at,subject_ref").eq("id", profilePhotoSyncId).single();
    expect(remotePhoto.error).toBeNull();
    expect(remotePhoto.data.subject_ref).toBe(photoPlayerSyncId);
    expect(remotePhoto.data.deleted_at).toBeNull();
    expect(remotePhoto.data.storage_path).toMatch(new RegExp(`^${teamId}/${profilePhotoSyncId}/[a-f0-9]{64}-perfil\\.png$`));
    const publicPhoto = await fetch(`${url}/storage/v1/object/public/team-media/${remotePhoto.data.storage_path}`);
    expect(publicPhoto.ok).toBe(false);

    const phonePhotoState = await phone.evaluate(async ({ syncId, playerSyncId }) => {
      const result = await RemoteWorkspace.syncNow();
      const media = (await DB.listar("media_items")).find((item) => item.sync_id === syncId);
      const player = (await DB.listar("jogadores")).find((item) => item.sync_id === playerSyncId);
      const mediaConflicts = result.conflicts.filter((item) => item.sync_id === syncId);
      return { mediaConflicts, title: media?.title, dataUrl: media?.data_url, url: media?.url, playerPhoto: player?.foto, storagePath: media?.storage_path };
    }, { syncId: profilePhotoSyncId, playerSyncId: photoPlayerSyncId });
    expect(phonePhotoState.mediaConflicts).toEqual([]);
    expect(phonePhotoState.title).toBe("Foto de perfil original");
    expect(phonePhotoState.dataUrl).toBeUndefined();
    expect(phonePhotoState.url).toMatch(/\/storage\/v1\/object\/sign\/team-media\//);
    expect(phonePhotoState.playerPhoto).toMatch(/\/storage\/v1\/object\/sign\/team-media\//);
    expect(phonePhotoState.storagePath).toBe(remotePhoto.data.storage_path);

    await mobileContext.setOffline(true);
    const phonePhotoLocalId = await phone.evaluate(async (syncId) => (await DB.listar("media_items")).find((item) => item.sync_id === syncId)?.id, profilePhotoSyncId);
    expect(phonePhotoLocalId).toBeTruthy();
    await phone.evaluate(async ({ id, syncId }) => {
      await DB.modificar("media_items", id, (row) => ({ ...row, title: "Foto editada offline no telemóvel" }));
    }, { id: phonePhotoLocalId, syncId: profilePhotoSyncId });
    await mobileContext.setOffline(false);
    const phonePhotoEdit = await phone.evaluate(async (syncId) => {
      const result = await RemoteWorkspace.syncNow();
      return result.conflicts.filter((item) => item.sync_id === syncId);
    }, profilePhotoSyncId);
    expect(phonePhotoEdit).toEqual([]);
    const editedRemotePhoto = await admin.from("media_assets").select("storage_path,title").eq("id", profilePhotoSyncId).single();
    expect(editedRemotePhoto.error).toBeNull();
    expect(editedRemotePhoto.data.title).toBe("Foto editada offline no telemóvel");
    expect(editedRemotePhoto.data.storage_path).toBe(remotePhoto.data.storage_path);
    const desktopPhotoEdit = await page.evaluate(async (syncId) => {
      const result = await RemoteWorkspace.syncNow();
      const row = (await DB.listar("media_items")).find((item) => item.sync_id === syncId);
      return { conflicts: result.conflicts.filter((item) => item.sync_id === syncId), title: row?.title, dirty: row?.sync_dirty };
    }, profilePhotoSyncId);
    expect(desktopPhotoEdit).toEqual({ conflicts: [], title: "Foto editada offline no telemóvel", dirty: false });

    await mobileContext.setOffline(true);
    const phonePhotoDelete = await phone.evaluate(async (syncId) => {
      const row = (await DB.listar("media_items")).find((item) => item.sync_id === syncId);
      if (!row) throw new Error("A fotografia do telemóvel deixou de existir antes de apagar.");
      await DB.apagar("media_items", row.id, { expected: row });
      return (await DB.listar("sync_tombstones")).some((item) => item.sync_id === syncId && item.store === "media_items");
    }, profilePhotoSyncId);
    expect(phonePhotoDelete).toBe(true);
    await mobileContext.setOffline(false);
    const phonePhotoRemoval = await phone.evaluate(async (syncId) => {
      const result = await RemoteWorkspace.syncNow();
      return result.conflicts.filter((item) => item.sync_id === syncId);
    }, profilePhotoSyncId);
    expect(phonePhotoRemoval).toEqual([]);
    const deletedRemotePhoto = await admin.from("media_assets").select("deleted_at").eq("id", profilePhotoSyncId).single();
    expect(deletedRemotePhoto.error).toBeNull();
    expect(deletedRemotePhoto.data.deleted_at).not.toBeNull();
    const desktopPhotoRemoval = await page.evaluate(async (syncId) => {
      const result = await RemoteWorkspace.syncNow();
      const row = (await DB.listar("media_items")).find((item) => item.sync_id === syncId);
      return { conflicts: result.conflicts.filter((item) => item.sync_id === syncId), hasLocalCopy: !!row };
    }, profilePhotoSyncId);
    expect(desktopPhotoRemoval).toEqual({ conflicts: [], hasLocalCopy: false });

    const phoneDeletedSyncId = crypto.randomUUID();
    await page.evaluate(async (syncId) => {
      await DB.criar("jogos", {
        team_id: DEFAULT_TEAM_ID, sync_id: syncId, data: "2026-09-24",
        adversario: "Criado no PC, apagado no telemóvel", estado: "agendado",
      });
      const result = await RemoteWorkspace.syncNow();
      if (result.conflicts.length) throw new Error(JSON.stringify(result.conflicts));
    }, phoneDeletedSyncId);
    await phone.evaluate(async (syncId) => {
      const result = await RemoteWorkspace.syncNow();
      if (result.conflicts.some((item) => item.sync_id === syncId)) throw new Error(JSON.stringify(result.conflicts));
      const row = (await DB.listar("jogos")).find((item) => item.sync_id === syncId);
      if (!row) throw new Error("O telemóvel não recebeu o jogo de teste.");
    }, phoneDeletedSyncId);
    await mobileContext.setOffline(true);
    const phoneLocalDelete = await phone.evaluate(async (syncId) => {
      const row = (await DB.listar("jogos")).find((item) => item.sync_id === syncId);
      if (!row) throw new Error("O jogo recebido no telemóvel deixou de existir.");
      await DB.apagar("jogos", row.id, { expected: row });
      return (await DB.listar("sync_tombstones")).some((item) => item.sync_id === syncId);
    }, phoneDeletedSyncId);
    expect(phoneLocalDelete).toBe(true);
    await mobileContext.setOffline(false);
    await phone.evaluate(async (syncId) => {
      const removal = await RemoteWorkspace.syncNow();
      if (removal.conflicts.some((item) => item.sync_id === syncId)) throw new Error(JSON.stringify(removal.conflicts));
    }, phoneDeletedSyncId);
    const desktopAfterPhoneDelete = await page.evaluate(async (syncId) => {
      const result = await RemoteWorkspace.syncNow();
      const localCopies = (await DB.listar("jogos")).filter((item) => item.sync_id === syncId).length;
      const remote = await (await RemoteWorkspace.init()).from("workspace_records")
        .select("deleted_at").eq("id", syncId).maybeSingle();
      if (remote.error) throw remote.error;
      return { conflicts: result.conflicts, localCopies, deletedAt: remote.data?.deleted_at || null };
    }, phoneDeletedSyncId);
    expect(desktopAfterPhoneDelete.conflicts).toEqual([]);
    expect(desktopAfterPhoneDelete.localCopies).toBe(0);
    expect(desktopAfterPhoneDelete.deletedAt).not.toBeNull();
  } finally {
    await context.setOffline(false).catch(() => {});
    await mobileContext?.close().catch(() => {});
    if (teamId) await admin.from("teams").delete().eq("id", teamId);
    if (userId) await admin.auth.admin.deleteUser(userId);
  }
});
