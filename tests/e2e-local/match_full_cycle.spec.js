"use strict";

const { test, expect } = require("@playwright/test");
const crypto = require("node:crypto");
const { createClient } = require("@supabase/supabase-js");

const url = process.env.VISION_COACH_SUPABASE_LOCAL_URL || "";
const anonKey = process.env.VISION_COACH_SUPABASE_LOCAL_ANON_KEY || "";
const serviceKey = process.env.VISION_COACH_SUPABASE_LOCAL_SERVICE_KEY || "";
const enabled = !!(url && anonKey && serviceKey);

test("jogo visual e lances percorrem duas PWA e alimentam minutos, estatísticas e relatório", {
  skip: !enabled && "requer apenas a stack Supabase local; nunca usar credenciais de produção",
  timeout: 60_000,
}, async ({ page, browser }) => {
  const parsed = new URL(url);
  expect(["localhost", "127.0.0.1", "::1"]).toContain(parsed.hostname);
  const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const email = `match-cycle-${crypto.randomUUID()}@vision-coach.local`;
  const password = crypto.randomBytes(24).toString("base64url");
  let userId;
  let teamId;
  let phoneContext;

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

    const seed = await page.evaluate(async () => {
      const players = [];
      const ids = [];
      for (let i = 1; i <= 6; i++) {
        const syncId = crypto.randomUUID();
        players.push(syncId);
        ids.push(await DB.criar("jogadores", {
          team_id: DEFAULT_TEAM_ID, sync_id: syncId, nome: `Ciclo ${i}`, numero: i,
          plantel_ativo: true, estado_disponibilidade: "disponivel",
        }));
      }
      const gameSyncId = crypto.randomUUID();
      const gameId = await DB.criar("jogos", {
        team_id: DEFAULT_TEAM_ID, sync_id: gameSyncId, data: new Date().toISOString().slice(0, 10),
        adversario: "Ciclo de sincronização local", estado: "agendado",
        callup: { player_ids: players },
        lineup: { system: "1-2-1", goalkeeper_id: players[0], starters: players.slice(1, 5), substitutes: [players[5]] },
        golos_favor: 1, golos_contra: 0,
      });
      return { players, ids, gameId, gameSyncId };
    });
    const pushedPlayers = await page.evaluate(async () => RemoteWorkspace.syncNow());
    expect(pushedPlayers.conflicts).toEqual([]);

    const baseMs = Date.UTC(2026, 8, 26, 12, 0, 0);
    const desktopInitial = await page.evaluate(async ({ gameId, players, baseMs }) => {
      const rows = await DB.listar("jogadores");
      let match = await DB.obter("jogos", gameId);
      match = VisionMatchVisual.apply(match, { type: "save_lineup", system: "1-2-1", slots: {
        gr: players[0], def: players[1], left: players[2], right: players[3], front: players[4],
      }, expected_revision: VisionMatchVisual.state(match).revision }, { now: baseMs, players: rows });
      await DB.modificar("jogos", gameId, () => match);
      const result = await RemoteWorkspace.syncNow();
      return { conflicts: result.conflicts, lineup: (await DB.obter("jogos", gameId)).lineup };
    }, { gameId: seed.gameId, players: seed.players, baseMs });
    expect(desktopInitial.conflicts).toEqual([]);
    expect(desktopInitial.lineup.positions).toEqual({ gr: seed.players[0], def: seed.players[1], left: seed.players[2], right: seed.players[3], front: seed.players[4] });

    phoneContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const phone = await phoneContext.newPage();
    await phone.addInitScript(({ localUrl, publishableKey, remoteTeamId }) => {
      localStorage.setItem("treinador.remote.supabase.v1", JSON.stringify({ url: localUrl, publishableKey, remoteTeamId }));
      localStorage.setItem("treinador.workspace.consolidated.v1", new Date().toISOString());
    }, { localUrl: url, publishableKey: anonKey, remoteTeamId: teamId });
    await phone.goto("/");
    await expect.poll(() => phone.evaluate(() => typeof DB !== "undefined"), { timeout: 15000 }).toBe(true);
    await phone.evaluate(async ({ email, password }) => {
      const client = await RemoteWorkspace.init();
      const { error } = await client.auth.signInWithPassword({ email, password });
      if (error) throw error;
      RemoteWorkspace.scheduleSync = () => {};
    }, { email, password });
    const pulled = await phone.evaluate(async (syncId) => {
      const result = await RemoteWorkspace.syncNow();
      const match = (await DB.listar("jogos")).find(row => row.sync_id === syncId);
      return { conflicts: result.conflicts, id: match?.id, positions: match?.lineup?.positions };
    }, seed.gameSyncId);
    expect(pulled.conflicts).toEqual([]);
    expect(pulled.positions).toEqual(desktopInitial.lineup.positions);

    const mobileRecorded = await phone.evaluate(async ({ gameId, players, baseMs }) => {
      const rows = await DB.listar("jogadores");
      let match = await DB.obter("jogos", gameId);
      const controller = "mobile-test-controller";
      match = VisionMatchVisual.apply(match, { type: "start", confirmed: true, controller_id: controller,
        expected_revision: VisionMatchVisual.state(match).revision,
        expected_plan_key: VisionMatchVisual.planKey(match) }, { now: baseMs, controller_id: controller, players: rows });
      await DB.modificar("jogos", gameId, () => match);
      const startedPush = await RemoteWorkspace.syncNow();
      if (startedPush.conflicts.length) throw new Error(JSON.stringify(startedPush.conflicts));
      return { gameId, players, baseMs, controller };
    }, { gameId: pulled.id, players: seed.players, baseMs });
    expect(mobileRecorded).toMatchObject({ gameId: pulled.id, baseMs });
    const phoneSnapshot = await phone.evaluate(async (syncId) => {
      const result = await RemoteWorkspace.syncNow();
      const row = (await DB.listar("jogos")).find(item => item.sync_id === syncId);
      return { conflicts: result.conflicts, status: row?.visual_match?.status };
    }, seed.gameSyncId);
    expect(phoneSnapshot).toEqual({ conflicts: [], status: "running" });
    const mobileOutcome = await phone.evaluate(async ({ gameId, players, baseMs, controller }) => {
      const rows = await DB.listar("jogadores");
      let match = await DB.obter("jogos", gameId);
      match = VisionMatchVisual.apply(match, { type: "substitute", confirmed: true, id: crypto.randomUUID(),
        out_ref: players[1], in_ref: players[5], note: "Entrada confirmada no teste",
        expected_revision: VisionMatchVisual.state(match).revision }, { now: baseMs + 120000, controller_id: controller, players: rows });
      const eventId = crypto.randomUUID();
      match = VisionMatchEvents.apply(match, { type: "record", event_type: "goal_for", id: eventId,
        at_ms: 120000, player_ref: players[5], note: "Golo confirmado no teste",
        expected_revision: VisionMatchEvents.state(match).revision }, { now: baseMs + 120000, players: rows });
      match = VisionMatchVisual.apply(match, { type: "pause", expected_revision: VisionMatchVisual.state(match).revision },
        { now: baseMs + 300000, controller_id: controller, players: rows });
      await DB.modificar("jogos", gameId, () => match);
      const pushed = await RemoteWorkspace.syncNow();
      const local = await DB.obter("jogos", gameId);
      return { conflicts: pushed.conflicts, dirty: local.sync_dirty,
        movement: local.visual_match.events.map(({ type, at_ms, out_ref, in_ref }) => ({ type, at_ms, out_ref, in_ref })),
        statistics: VisionMatchEvents.stats(local), minutes: VisionMatchVisual.replay(local).players.map(p => ({ ref: p.ref, ms: p.elapsed_ms })) };
    }, mobileRecorded);
    expect(mobileOutcome.conflicts).toEqual([]);
    expect(mobileOutcome.dirty).toBe(false);
    expect(mobileOutcome.movement).toEqual([{ type: "substitute", at_ms: 120000, out_ref: seed.players[1], in_ref: seed.players[5] }]);
    expect(mobileOutcome.statistics).toMatchObject({ event_count: 1, goals: { for: 1, against: 0 }, recorded_result: { for: 1, against: 0 } });
    expect(mobileOutcome.minutes.find(p => p.ref === seed.players[1]).ms).toBe(120000);
    expect(mobileOutcome.minutes.find(p => p.ref === seed.players[5]).ms).toBe(180000);

    const desktopPulled = await page.evaluate(async (syncId) => {
      const result = await RemoteWorkspace.syncNow();
      const match = (await DB.listar("jogos")).find(row => row.sync_id === syncId);
      const replay = VisionMatchVisual.replay(match);
      const stats = VisionMatchEvents.stats(match);
      const report = await ReportExporter.render("match-report", match.id);
      const matchSheet = await ReportExporter.render("match-sheet", match.id);
      return { conflicts: result.conflicts, dirty: match.sync_dirty, total: replay.total_ms,
        minutes: Object.fromEntries(replay.players.map(p => [p.name, p.elapsed_ms])), goals: stats.goals,
        reportHasLineup: matchSheet.includes("Alinhamento inicial") && matchSheet.includes("Ciclo 1"),
        reportHasMovement: report.includes("2:00 · sai Ciclo 2 · entra Ciclo 6"),
        reportHasMinutes: report.includes("02:00 · GR 00:00"),
        reportHasStats: report.includes("Golos contados 1–0") && report.includes("Estatísticas contadas"),
        reportHasEvent: report.includes("2:00 · Golo a favor · Ciclo 6") };
    }, seed.gameSyncId);
    expect(desktopPulled).toMatchObject({ conflicts: [], dirty: false, total: 300000,
      minutes: { "Ciclo 2": 120000, "Ciclo 6": 180000 }, goals: { for: 1, against: 0 },
      reportHasLineup: true, reportHasMovement: true, reportHasMinutes: true, reportHasStats: true, reportHasEvent: true });

    await phoneContext.setOffline(true);
    const offlineEdit = await phone.evaluate(async (syncId) => {
      const row = (await DB.listar("jogos")).find(item => item.sync_id === syncId);
      await DB.modificar("jogos", row.id, current => ({ ...current, adversario: "Edição offline do ciclo" }));
      return (await DB.obter("jogos", row.id)).sync_dirty;
    }, seed.gameSyncId);
    expect(offlineEdit).toBe(true);
    await phoneContext.setOffline(false);
    const offlinePushed = await phone.evaluate(async (syncId) => {
      const result = await RemoteWorkspace.syncNow();
      const row = (await DB.listar("jogos")).find(item => item.sync_id === syncId);
      return { conflicts: result.conflicts, dirty: row?.sync_dirty, adversario: row?.adversario };
    }, seed.gameSyncId);
    expect(offlinePushed).toEqual({ conflicts: [], dirty: false, adversario: "Edição offline do ciclo" });
    const desktopEditPulled = await page.evaluate(async (syncId) => {
      const result = await RemoteWorkspace.syncNow();
      const row = (await DB.listar("jogos")).find(item => item.sync_id === syncId);
      return { conflicts: result.conflicts, adversario: row?.adversario };
    }, seed.gameSyncId);
    expect(desktopEditPulled).toEqual({ conflicts: [], adversario: "Edição offline do ciclo" });

    await phoneContext.setOffline(true);
    const tombstone = await phone.evaluate(async (syncId) => {
      const row = (await DB.listar("jogos")).find(item => item.sync_id === syncId);
      await DB.apagar("jogos", row.id, { expected: row });
      return (await DB.listar("sync_tombstones")).some(item => item.sync_id === syncId && item.store === "jogos");
    }, seed.gameSyncId);
    expect(tombstone).toBe(true);
    await phoneContext.setOffline(false);
    const removed = await phone.evaluate(async (syncId) => {
      const result = await RemoteWorkspace.syncNow();
      return { conflicts: result.conflicts.filter(item => item.sync_id === syncId) };
    }, seed.gameSyncId);
    expect(removed.conflicts).toEqual([]);
    const desktopRemoval = await page.evaluate(async syncId => {
      const result = await RemoteWorkspace.syncNow();
      const row = (await DB.listar("jogos")).find(item => item.sync_id === syncId);
      const remote = await (await RemoteWorkspace.init()).from("workspace_records").select("deleted_at").eq("id", syncId).maybeSingle();
      if (remote.error) throw remote.error;
      return { conflicts: result.conflicts.filter(item => item.sync_id === syncId), localExists: !!row, deleted: !!remote.data?.deleted_at };
    }, seed.gameSyncId);
    expect(desktopRemoval).toEqual({ conflicts: [], localExists: false, deleted: true });
  } finally {
    await phoneContext?.setOffline(false).catch(() => {});
    await phoneContext?.close().catch(() => {});
    if (teamId) await admin.from("teams").delete().eq("id", teamId);
    if (userId) await admin.auth.admin.deleteUser(userId);
  }
});
