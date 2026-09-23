"use strict";

const { test, expect } = require("@playwright/test");
const crypto = require("node:crypto");
const { createClient } = require("@supabase/supabase-js");

const url = process.env.VISION_COACH_SUPABASE_LOCAL_URL || "";
const anonKey = process.env.VISION_COACH_SUPABASE_LOCAL_ANON_KEY || "";
const serviceKey = process.env.VISION_COACH_SUPABASE_LOCAL_SERVICE_KEY || "";
const enabled = !!(url && anonKey && serviceKey);

test("duas PWA sincronizam ida e volta após trabalho offline, sem conflitos ou ressurreição", {
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
      if (result.conflicts.length) throw new Error(JSON.stringify(result.conflicts));
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
    await phone.evaluate(async () => {
      const removal = await RemoteWorkspace.syncNow();
      if (removal.conflicts.length) throw new Error(JSON.stringify(removal.conflicts));
    });
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
