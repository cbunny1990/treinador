"use strict";

const { test, expect } = require("@playwright/test");

test("atividade sincronizada sem origem relacional apresenta a proveniência preservada", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(async () => {
    await DB.criar("activity_items", {
      team_id: DEFAULT_TEAM_ID, actor: "human", actor_label: "Treinador",
      action: "created_document", summary: "Criou nota histórica", entity_type: "document", entity_id: null,
      metadata: { _vision_coach_unresolved_origin: {
        type: "document", reference: "731", scope: "local_device_id", reason: "subject_not_found_locally",
      } }, created_at: "2026-09-22T10:00:00.000Z",
    });
  });
  await page.goto("/#/timeline");
  await expect(page.getByText("Origem preservada sem ligação · documento · referência original 731")).toBeVisible();
});

async function seedV3(page) {
  await page.goto("/nao-existe");
  await page.evaluate(async () => {
    await new Promise((resolve, reject) => {
      const del = indexedDB.deleteDatabase("treinador");
      del.onsuccess = resolve;
      del.onerror = () => reject(del.error);
      del.onblocked = resolve;
    });
    await new Promise((resolve, reject) => {
      const req = indexedDB.open("treinador", 3);
      req.onupgradeneeded = () => {
        const db = req.result;
        const tx = req.transaction;
        db.createObjectStore("jogadores", { keyPath: "id", autoIncrement: true });
        tx.objectStore("jogadores").add({ nome: "Jogador legado", escalao: "sub-8" });
        for (const store of ["treinos", "jogos", "memory_items", "workspace_documents", "activity_items"]) {
          db.createObjectStore(store, { keyPath: "id", autoIncrement: true });
        }
        tx.objectStore("treinos").add({ team_id: "default", data: "2026-09-18", escalao: "sub-8", status: "completed", review: {}, session: { status: "completed", review: { status: "done", conclusao: "Concluído na sessão" } } });
        tx.objectStore("jogos").add({ team_id: "default", data: "2026-09-19", adversario: "Jogo legado" });
        tx.objectStore("memory_items").add({ team_id: "default", status: "active", occurred_at: "2026-09-20T12:00:00.000Z", title: "Memória legada" });
        tx.objectStore("workspace_documents").add({ team_id: "default", status: "ready", updated_at: "2026-09-21T12:00:00.000Z", title: "Documento legado" });
        tx.objectStore("workspace_documents").add({ team_id: "default", created_at: "2026-09-22T12:00:00.000Z", updated_at: "2026-09-22T12:00:00.000Z", title: "Documento sem estado legado" });
        tx.objectStore("activity_items").add({ team_id: "default", created_at: "2026-09-22T12:00:00.000Z", summary: "Atividade legada" });
      };
      req.onsuccess = () => {
        const db = req.result;
        db.close();
        resolve();
      };
      req.onerror = () => reject(req.error);
    });
  });
}

test("migra dados antigos para o workspace e continua offline", async ({ page, context }) => {
  await seedV3(page);
  await page.goto("/");

  await expect(page.getByText("Human–AI Shared Workspace")).toBeVisible();
  const migrated = await page.evaluate(async () => {
    const db = await abrirDB();
    const players = await DB.listar("jogadores");
    const timelineRows = {};
    for (const [store, status] of [["treinos", null], ["jogos", null], ["memory_items", "active"], ["workspace_documents", "visible"], ["activity_items", null]]) {
      timelineRows[store] = [];
      await DB.percorrerEquipaMaisRecentes(store, "default", 10, (row) => timelineRows[store].push(row.title || row.summary || row.adversario || row.data), status);
    }
    const legacyDocument = (await DB.porIndice("workspace_documents", "team_id", "default")).find((row) => row.title === "Documento sem estado legado");
    const migratedTraining = (await DB.porIndice("treinos", "team_id", "default")).find((row) => row.data === "2026-09-18");
    return {
      version: db.version,
      trainingNeedsReview: migratedTraining?.operational_needs_review ?? null,
      teamId: players[0].team_id,
      timelineRows,
      legacyDocumentStatus: legacyDocument?.status ?? null,
      stores: Array.from(db.objectStoreNames),
      dateIndexes: ["jogos", "treinos"].every((store) => db.transaction(store).objectStore(store).indexNames.contains("team_data")),
      operationsIndexes: db.transaction("jogos").objectStore("jogos").indexNames.contains("team_proposal_status")
        && ["team_completed_review", "team_proposal_status"].every((index) => db.transaction("treinos").objectStore("treinos").indexNames.contains(index)),
      timelineIndexes: ["activity_items", "jogos", "treinos"].every((store) => db.transaction(store).objectStore(store).indexNames.contains("team_timeline"))
        && db.transaction("workspace_documents").objectStore("workspace_documents").indexNames.contains("team_timeline_status")
        && ["memory_items", "workspace_documents"].every((store) => db.transaction(store).objectStore(store).indexNames.contains("team_status_timeline")),
    };
  });

  expect(migrated.version).toBe(15);
  expect(migrated.trainingNeedsReview).toBe("not_pending");
  expect(migrated.teamId).toBe("default");
  expect(migrated.dateIndexes).toBeTruthy();
  expect(migrated.operationsIndexes).toBeTruthy();
  expect(migrated.timelineIndexes).toBeTruthy();
  expect(migrated.timelineRows).toEqual({
    treinos: ["2026-09-18"],
    jogos: ["Jogo legado"],
    memory_items: ["Memória legada"],
    workspace_documents: ["Documento sem estado legado", "Documento legado"],
    activity_items: ["Atividade legada"],
  });
  expect(migrated.legacyDocumentStatus).toBeNull();
  expect(migrated.stores).toContain("workspace_documents");
  expect(migrated.stores).toContain("activity_items");
  expect(migrated.stores).toContain("sync_tombstones");

  await page.locator('.bottom-nav a[href="#/equipa"]').click();
  await expect(page.getByText("Jogador legado")).toBeVisible();

  const queuedMatchRef = await page.evaluate(async () => {
    RemoteWorkspace.scheduleSync = () => {};
    const id = await DB.criar("jogos", {
      team_id: DEFAULT_TEAM_ID, sync_id: crypto.randomUUID(), data: "2026-09-23",
      adversario: "Registo pendente após reabrir", estado: "agendado",
    });
    return (await DB.obter("jogos", id)).sync_id;
  });
  await page.evaluate(() => navigator.serviceWorker.ready);
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByText("Jogador legado")).toBeVisible();
  const queuedAfterReload = await page.evaluate(async (syncId) => {
    const row = (await DB.listar("jogos")).find((item) => item.sync_id === syncId);
    return row && { sync_id: row.sync_id, adversario: row.adversario, sync_dirty: row.sync_dirty };
  }, queuedMatchRef);
  expect(queuedAfterReload).toEqual({ sync_id: queuedMatchRef, adversario: "Registo pendente após reabrir", sync_dirty: true });
  await context.setOffline(false);
});

test("perfil da equipa descreve corretamente a ligação do Head Coach por MCP", async ({ page }) => {
  await page.goto("/");
  await page.locator('.bottom-nav a[href="#/equipa"]').click();
  await expect(page.getByText(/A IA autorizada pode consultar os mesmos dados e preparar propostas através do MCP/)).toBeVisible();
  await expect(page.getByRole("link", { name: "Definições", exact: true })).toHaveAttribute("href", "#/definicoes");
  await expect(page.getByText(/As decisões e ações de jogo continuam a exigir confirmação do treinador/)).toBeVisible();
  await expect(page.getByText(/A ligação externa do agente ainda não está ativa/)).toHaveCount(0);
});

test("workspace indica falha de sincronização e limpa o aviso após recuperação", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(async () => {
    RemoteWorkspace.status = async () => ({ configured: true, signedIn: true, remoteTeamId: "team-test", lastSyncAt: null, conflicts: [] });
    RemoteWorkspace.syncNow = async () => { throw new Error("rede indisponível"); };
    await viewWorkspace();
  });
  const syncError = page.getByRole("status").filter({ hasText: "Não foi possível confirmar a sincronização." });
  await expect(syncError).toContainText("continuam guardadas neste dispositivo");

  await page.evaluate(async () => {
    RemoteWorkspace.syncNow = async () => {
      const result = { pushed: 0, pulled: 0, conflicts: [], deleted: 0 };
      window.dispatchEvent(new CustomEvent("visioncoach:sync-complete", { detail: result }));
      return result;
    };
    await RemoteWorkspace.syncNow();
  });
  await expect(page.getByRole("status").filter({ hasText: "Não foi possível confirmar a sincronização." })).toHaveCount(0);
});

test("falha da sincronização automática fica visível no telemóvel e desaparece quando recupera", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#/equipa/jogador/novo");
  await page.getByLabel("Notas factuais").fill("Texto por guardar durante uma falha de rede");
  await page.evaluate(() => {
    clearTimeout(RemoteWorkspace._syncTimer);
    clearTimeout(RemoteWorkspace._syncRetryTimer);
    RemoteWorkspace._scheduleSyncRetry = () => 2000;
    RemoteWorkspace.status = async () => ({ signedIn: true, remoteTeamId: "team-test" });
    RemoteWorkspace.syncNow = async () => { throw new Error("URL temporário secreto?token=nao-expor"); };
    RemoteWorkspace.scheduleSync(0);
  });
  const pending = page.getByRole("status").filter({ hasText: "Sincronização pendente" });
  await expect(pending).toBeVisible();
  await expect(pending).toHaveAttribute("aria-live", "polite");
  await expect(page.getByLabel("Notas factuais")).toHaveValue("Texto por guardar durante uma falha de rede");
  expect(await pending.textContent()).not.toContain("nao-expor");

  await page.evaluate(() => window.dispatchEvent(new CustomEvent("visioncoach:sync-complete", { detail: {} })));
  await expect(pending).toHaveCount(0);
  await expect(page.getByLabel("Notas factuais")).toHaveValue("Texto por guardar durante uma falha de rede");
});

test("Workspace lê o estado remoto e um único snapshot local em paralelo", async ({ page }) => {
  await page.goto("/#/calendario");
  await expect(page.getByRole("heading", { name: "Calendário" })).toBeVisible();
  await page.evaluate(() => {
    const started = [];
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    window.__workspaceReadStarted = started;
    window.__releaseWorkspaceReads = release;
    const read = (name, value) => { started.push(name); return gate.then(() => value); };
    RemoteWorkspace.status = () => read("remote-status", { configured: false, signedIn: false, remoteTeamId: null, conflicts: [] });
    WorkspaceStore.buildSnapshot = (teamId, options) => {
      window.__workspaceSnapshotOptions = { teamId, options };
      return read("local-snapshot", {
      team: { nome: "Equipa de teste" }, players: [], matches: [], trainings: [], memory: [],
      documents: [], documents_including_archived: [], media: [], media_count: 0, activity: [], next_match: null, next_training: null,
      priorities: [], recent_documents: [], recent_activity: [],
    });
    };
    WorkspaceStore.listDocuments = () => { throw new Error("O painel não deve carregar documentos à parte do snapshot."); };
    window.__workspaceRenderPromise = viewWorkspace();
  });
  await expect.poll(() => page.evaluate(() => [...window.__workspaceReadStarted].sort())).toEqual([
    "local-snapshot", "remote-status",
  ]);
  expect(await page.evaluate(() => window.__workspaceSnapshotOptions.teamId)).toBeTruthy();
  expect(await page.evaluate(() => window.__workspaceSnapshotOptions.options)).toEqual({
    includeArchivedDocuments: true, countMediaOnly: true, includeTimeline: false, compactOperationalRecords: true,
  });
  await page.evaluate(() => window.__releaseWorkspaceReads());
  await page.evaluate(async () => window.__workspaceRenderPromise);
  await expect(page.getByText("Human–AI Shared Workspace")).toBeVisible();
});

test("snapshot do Workspace conta media sem carregar payloads e omite timeline não usada", async ({ page }) => {
  await page.goto("/#/calendario");
  await expect(page.getByRole("heading", { name: "Calendário" })).toBeVisible();
  await page.evaluate(async () => {
    const listByIndex = DB.porIndice.bind(DB), countByIndex = DB.contarPorIndice.bind(DB), listAll = DB.listar.bind(DB);
    const calls = window.__workspaceSnapshotDbCalls = [];
    DB.porIndice = (store, index, value) => { if (store === "media_items" || store === "memory_items") calls.push(["index", store, index]); return listByIndex(store, index, value); };
    DB.contarPorIndice = (store, index, value) => { if (store === "media_items") calls.push(["count", store, index]); return countByIndex(store, index, value); };
    DB.listar = store => { if (store === "memory_items") calls.push(["all", store]); return listAll(store); };
    const build = WorkspaceStore.buildSnapshot.bind(WorkspaceStore);
    WorkspaceStore.buildSnapshot = async (...args) => { window.__workspaceOptimizedSnapshot = await build(...args); return window.__workspaceOptimizedSnapshot; };
    await WorkspaceStore.buildSnapshot(DEFAULT_TEAM_ID, { includeArchivedDocuments: true, countMediaOnly: true, includeTimeline: false });
  });
  expect(await page.evaluate(() => window.__workspaceSnapshotDbCalls)).toContainEqual(["count", "media_items", "team_id"]);
  expect(await page.evaluate(() => window.__workspaceSnapshotDbCalls)).toContainEqual(["index", "memory_items", "team_id"]);
  expect(await page.evaluate(() => window.__workspaceSnapshotDbCalls)).not.toContainEqual(["index", "media_items", "team_id"]);
  expect(await page.evaluate(() => window.__workspaceSnapshotDbCalls)).not.toContainEqual(["all", "memory_items"]);
  expect(await page.evaluate(() => ({ media: window.__workspaceOptimizedSnapshot.media, count: window.__workspaceOptimizedSnapshot.media_count, timeline: "timeline" in window.__workspaceOptimizedSnapshot }))).toEqual({ media: [], count: expect.any(Number), timeline: false });
});

test("snapshot compacto do Workspace percorre o histórico sem materializar jogos e treinos", async ({ page }) => {
  await page.goto("/");
  await page.waitForFunction(() => typeof WorkspaceStore !== "undefined" && typeof DB !== "undefined");
  await page.evaluate(async () => {
    RemoteWorkspace.scheduleSync = () => {};
    const start = Date.now();
    const date = offset => new Date(start + offset * 86400000).toISOString().slice(0, 10);
    const eventPayload = Array.from({ length: 40 }, (_, i) => ({ id: `event-${i}`, type: "note", note: "x".repeat(1200) }));
    for (let i = 0; i < 40; i++) {
      await DB.criar("jogos", {
        team_id: DEFAULT_TEAM_ID, sync_id: crypto.randomUUID(), data: date(i === 0 ? 1 : -i),
        adversario: i === 0 ? "Próximo adversário" : `Histórico ${i}`, estado: i === 0 ? "agendado" : "concluido",
        match_events: { revision: 0, events: eventPayload },
        post_game: { analysis: { revision: 0, fields: {}, agent_proposal: i > 0 && i % 2 === 0 ? {
          status: "proposed", source_analysis_revision: i % 4 === 0 ? 0 : 3, source_events_revision: 0, evidence_ids: [],
        } : null } },
      });
      await DB.criar("treinos", {
        team_id: DEFAULT_TEAM_ID, sync_id: crypto.randomUUID(), data: date(i === 0 ? 2 : -i),
        status: i === 0 ? "ready" : "completed", objetivo: i === 0 ? "Próximo treino" : `Histórico de treino ${i}`,
        session: { status: i === 0 ? "planned" : "completed", blocks: [{ notes: "x".repeat(1200) }] },
        review: { status: i === 0 || i % 3 === 0 ? "done" : "pending" },
        continuity: { proposal: i > 0 && i % 5 === 0 ? { status: "draft", objective: `Proposta ${i}` } : null },
      });
    }
    const fullRead = DB.porIndice.bind(DB);
    DB.porIndice = (store, ...args) => {
      if (store === "jogos" || store === "treinos") throw new Error(`Snapshot compacto materializou ${store}.`);
      return fullRead(store, ...args);
    };
    window.__compactScanCounts = {};
    DB.percorrerIndice = (store, ...args) => {
      if (store === "jogos" || store === "treinos") throw new Error(`Snapshot compacto percorreu o histórico completo de ${store}.`);
      return DB.percorrerIndice.bind(DB)(store, ...args);
    };
    const first = DB.primeiroIntervaloEquipa.bind(DB);
    DB.primeiroIntervaloEquipa = (store, teamId, from, predicate) => first(store, teamId, from, row => {
      const key = "next_" + store;
      window.__compactScanCounts[key] = (window.__compactScanCounts[key] || 0) + 1;
      return predicate(row);
    });
    const byValue = DB.percorrerValorEquipa.bind(DB);
    DB.percorrerValorEquipa = (store, index, teamId, value, visit) => byValue(store, index, teamId, value, row => {
      const key = store + "_" + index;
      window.__compactScanCounts[key] = (window.__compactScanCounts[key] || 0) + 1;
      visit(row);
    });
    window.__compactSnapshot = await WorkspaceStore.buildSnapshot(DEFAULT_TEAM_ID, {
      includeArchivedDocuments: true, countMediaOnly: true, includeTimeline: false, compactOperationalRecords: true,
    });
  });
  const snapshot = await page.evaluate(() => ({
    hasFullHistory: Object.hasOwn(window.__compactSnapshot, "matches") || Object.hasOwn(window.__compactSnapshot, "trainings"),
    nextMatch: window.__compactSnapshot.next_match?.adversario,
    nextTraining: window.__compactSnapshot.next_training?.objetivo,
    reviewCount: window.__compactSnapshot.pending_reviews_count,
    reviewSamples: window.__compactSnapshot.pending_reviews.length,
    trainingProposals: window.__compactSnapshot.pending_training_proposals.length,
    matchProposals: window.__compactSnapshot.pending_match_proposals.length,
    staleMatchProposals: window.__compactSnapshot.stale_match_proposals.length,
    scanned: window.__compactScanCounts,
  }));
  expect(snapshot).toEqual({
    hasFullHistory: false, nextMatch: "Próximo adversário", nextTraining: "Próximo treino",
    reviewCount: 26, reviewSamples: 4, trainingProposals: 7, matchProposals: 9, staleMatchProposals: 10,
    scanned: {
      next_jogos: 1, next_treinos: 1, jogos_team_proposal_status: 19,
      treinos_team_completed_review: 26, treinos_team_proposal_status: 7,
    },
  });
});

test("Workspace não reconstrói a página após sincronizações sem alterações recebidas", async ({ page }) => {
  await page.goto("/");
  await page.waitForFunction(() => typeof routerRunning === "boolean" && !routerRunning);
  await page.evaluate(() => {
    window.__snapshotBuilds = 0;
    window.__syncConflicts = [];
    RemoteWorkspace.status = async () => ({ configured: true, signedIn: true, remoteTeamId: "team-test", conflicts: window.__syncConflicts });
    document.querySelector("#app").style.minHeight = "2200px";
    const build = WorkspaceStore.buildSnapshot.bind(WorkspaceStore);
    WorkspaceStore.buildSnapshot = (...args) => { window.__snapshotBuilds++; return build(...args); };
  });
  await page.evaluate(() => window.scrollTo(0, 720));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(600);
  const initial = await page.evaluate(() => window.__snapshotBuilds);
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("visioncoach:sync-complete", {
    detail: { pushed: 3, pulled: 0, deleted: 0, conflicts: [] },
  })));
  await page.waitForTimeout(100);
  expect(await page.evaluate(() => window.__snapshotBuilds)).toBe(initial);

  await page.evaluate(() => window.dispatchEvent(new CustomEvent("visioncoach:sync-complete", {
    detail: { pushed: 0, pulled: 1, deleted: 0, conflicts: window.__syncConflicts },
  })));
  await expect.poll(() => page.evaluate(() => window.__snapshotBuilds)).toBe(initial + 1);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(600);

  await page.evaluate(() => {
    window.__syncConflicts = [{ sync_id: "conflict-e2e", reason: "version_mismatch" }];
    window.dispatchEvent(new CustomEvent("visioncoach:sync-complete", {
      detail: { pushed: 1, pulled: 0, deleted: 0, conflicts: window.__syncConflicts },
    }));
  });
  await expect.poll(() => page.evaluate(() => window.__snapshotBuilds)).toBe(initial + 2);
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("visioncoach:sync-complete", {
    detail: { pushed: 1, pulled: 0, deleted: 0, conflicts: window.__syncConflicts },
  })));
  await page.waitForTimeout(100);
  expect(await page.evaluate(() => window.__snapshotBuilds)).toBe(initial + 2);
});

test("Workspace restaura o scroll se o layout o ajustar durante uma atualização assíncrona", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.waitForFunction(() => typeof routerRunning === "boolean" && !routerRunning);
  await page.evaluate(() => {
    document.getElementById("app").style.minHeight = "2200px";
    window.scrollTo(0, 640);
  });
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(640);

  const positions = await page.evaluate(() => {
    const nativeRequestAnimationFrame = window.requestAnimationFrame;
    let pendingFrame;
    window.requestAnimationFrame = callback => { pendingFrame = callback; return 1; };
    setView("Workspace atualizado", '<div style="height:2200px">Conteúdo atualizado</div>');
    window.requestAnimationFrame = nativeRequestAnimationFrame;
    // Simulate the browser adjusting the viewport after synced content changes its layout.
    window.scrollTo(0, 820);
    const beforeRestore = window.scrollY;
    pendingFrame();
    return { beforeRestore, afterRestore: window.scrollY };
  });

  expect(positions.beforeRestore).toBe(820);
  expect(positions.afterRestore).toBe(640);

  const userScrollPosition = await page.evaluate(() => {
    window.scrollTo(0, 640);
    const nativeRequestAnimationFrame = window.requestAnimationFrame;
    let pendingFrame;
    window.requestAnimationFrame = callback => { pendingFrame = callback; return 1; };
    setView("Workspace atualizado outra vez", '<div style="height:2200px">Conteúdo atualizado</div>');
    window.requestAnimationFrame = nativeRequestAnimationFrame;
    window.dispatchEvent(new WheelEvent("wheel"));
    window.scrollTo(0, 900);
    pendingFrame();
    return window.scrollY;
  });
  expect(userScrollPosition).toBe(900);
});

test("sincronização preserva texto por guardar num formulário comum", async ({ page }) => {
  await page.goto("/#/equipa/jogador/novo");
  const form = page.locator('form[data-form="player"]');
  await expect(form).toBeVisible();
  await form.locator('[name="nome"]').fill("Nome ainda não guardado");

  await page.evaluate(() => window.dispatchEvent(new CustomEvent("visioncoach:sync-complete", {
    detail: { conflicts: [] },
  })));

  await expect(form.locator('[name="nome"]')).toHaveValue("Nome ainda não guardado");
  await expect(page.getByRole("heading", { name: "Novo jogador" })).toBeVisible();
});

test("Workspace surfaces ready training plans in the explicit approval queue", async ({ page }) => {
  await page.goto("/#/calendario");
  await page.waitForFunction(() => typeof DB !== "undefined");
  const id = await page.evaluate(() => DB.criar("workspace_documents", {
    team_id: DEFAULT_TEAM_ID, type: "training_plan", title: "Plano por aprovar E2E", body: "{}",
    status: "ready", target_date: "2026-09-27", sync_id: crypto.randomUUID(), external_key: "approval-queue-e2e",
  }).then(async id => { await DB.criar("workspace_documents", { team_id: DEFAULT_TEAM_ID, type: "training_plan", title: "Plano arquivado E2E", body: "{}", status: "archived", sync_id: crypto.randomUUID(), external_key: "approval-queue-archived-e2e" }); return id; }));
  await page.goto("/");
  const queue = page.getByRole("heading", { name: /Planos por aprovar/ }).locator("xpath=..");
  await expect(queue).toContainText("1");
  await expect(queue.getByRole("link", { name: /Plano por aprovar E2E/ })).toHaveAttribute("href", "#/planos/" + id);
  await expect(queue.getByRole("link", { name: /Plano arquivado E2E/ })).toHaveCount(0);
});

test("Workspace assessment queue respects top-level and session review records", async ({ page }) => {
  await page.goto("/#/calendario");
  await page.waitForFunction(() => typeof DB !== "undefined");
  await page.evaluate(async () => {
    const base = { team_id: DEFAULT_TEAM_ID, sync_id: crypto.randomUUID(), data: "2026-09-22", blocos: [] };
    await DB.criar("treinos", { ...base, status: "completed", objetivo: "Avaliação concluída no plano", review: { status: "done", conclusao: "Registada" } });
    await DB.criar("treinos", { ...base, sync_id: crypto.randomUUID(), status: "ready", objetivo: "Avaliação concluída na sessão", session: { status: "completed", review: { status: "done", conclusao: "Registada na sessão" } } });
    await DB.criar("treinos", { ...base, sync_id: crypto.randomUUID(), status: "ready", objetivo: "Sessão concluída com review vazio no plano", review: {}, session: { status: "completed", review: { status: "done", conclusao: "Registada na sessão" } } });
    await DB.criar("treinos", { ...base, sync_id: crypto.randomUUID(), status: "ready", objetivo: "Review pendente do plano prevalece", review: { status: "pending" }, session: { status: "completed", review: { status: "done", conclusao: "Registada na sessão" } } });
    await DB.criar("treinos", { ...base, sync_id: crypto.randomUUID(), status: "ready", objetivo: "Avaliação pendente na sessão", session: { status: "completed", review: { status: "pending" } } });
    await DB.criar("treinos", { ...base, sync_id: crypto.randomUUID(), status: "completed", objetivo: "Avaliação legada pendente" });
  });
  await page.goto("/");
  const queue = page.getByRole("heading", { name: "Avaliações por preencher · 3" }).locator("xpath=..");
  await expect(queue.getByText("Avaliação pendente na sessão")).toBeVisible();
  await expect(queue.getByText("Avaliação legada pendente")).toBeVisible();
  await expect(queue.getByText("Review pendente do plano prevalece")).toBeVisible();
  await expect(queue.getByText("Avaliação concluída no plano")).toHaveCount(0);
  await expect(queue.getByText("Avaliação concluída na sessão")).toHaveCount(0);
  await expect(queue.getByText("Sessão concluída com review vazio no plano")).toHaveCount(0);
});

test("Workspace includes Head Coach team priority proposals in the review queue", async ({ page }) => {
  await page.goto("/#/calendario");
  await page.waitForFunction(() => typeof DB !== "undefined");
  await page.evaluate(async () => { await DB.criar("workspace_documents", {
    team_id: DEFAULT_TEAM_ID, type: "team_goal", title: "Apoio após passe E2E",
    body: JSON.stringify({
      schema: "vision-team-goal@1", revision: 1, stage: "identified",
      title: "Apoio após passe", agent_proposal: {
        status: "proposed", rationale: "Evidências de jogo e treino para rever.",
        evidence_refs: [], prepared_by: "Head Coach",
      },
    }),
    status: "draft", sync_id: crypto.randomUUID(), external_key: "team-priority-queue-e2e",
  }); await DB.criar("workspace_documents", { team_id: DEFAULT_TEAM_ID, type: "team_goal", title: "Prioridade arquivada E2E", body: JSON.stringify({ schema: "vision-team-goal@1", revision: 1, stage: "identified", title: "Prioridade arquivada", agent_proposal: { status: "proposed", rationale: "Já arquivada", evidence_refs: [] } }), status: "archived", sync_id: crypto.randomUUID(), external_key: "team-priority-archived-e2e" }); });
  await page.goto("/");
  const queue = page.getByRole("heading", { name: /Propostas por rever/ }).locator("xpath=..");
  await expect(queue).toContainText("1");
  await expect(queue.getByRole("link", { name: /Apoio após passe/ })).toHaveAttribute("href", "#/evolucao");
  await expect(queue.getByRole("link", { name: /Prioridade arquivada E2E/ })).toHaveCount(0);
});

test("Workspace lists each match proposal once, opens Depois, and separates stale proposals", async ({ page }) => {
  await page.goto("/#/calendario");
  await page.waitForFunction(() => typeof DB !== "undefined" && typeof VisionMatchAnalysis !== "undefined");
  const seeded = await page.evaluate(async () => {
    const freshRef = crypto.randomUUID(), staleRef = crypto.randomUUID(), goalEvent = crypto.randomUUID();
    const freshProposal = {
      status: "proposed", prepared_by: "Head Coach", source_analysis_revision: 2, source_events_revision: 1,
      summary: "Rever o apoio na saída", hypotheses: [], next_priority: "Apoio após passe", evidence_ids: [goalEvent],
    };
    const matchFields = { schema: "vision-match-events@1", revision: 1, possession: { kind: "unknown", value: null }, events: [
      { id: goalEvent, type: "loss", at_ms: 60000, reason: "pass", zone: "def_c", note: "Passe intercetado" },
    ] };
    const analysis = (proposal, revision) => ({ schema: "vision-match-analysis@1", revision, status: "done", fields: { summary: "Facto do treinador" }, agent_proposal: proposal });
    const fresh = await DB.criar("jogos", { team_id: DEFAULT_TEAM_ID, sync_id: freshRef, data: "2026-09-27", adversario: "Rivais E2E", estado: "agendado", match_events: matchFields, post_game: { analysis: analysis(freshProposal, 2) } });
    const duplicate = await DB.criar("jogos", { team_id: DEFAULT_TEAM_ID, sync_id: freshRef, data: "2026-09-27", adversario: "Rivais duplicado", estado: "agendado", match_events: matchFields, post_game: { analysis: analysis(freshProposal, 2) } });
    const stale = await DB.criar("jogos", { team_id: DEFAULT_TEAM_ID, sync_id: staleRef, data: "2026-09-28", adversario: "Rivais stale E2E", estado: "agendado", post_game: { analysis: analysis({ ...freshProposal, source_analysis_revision: 1, source_events_revision: 0 }, 2) } });
    return { freshRef, staleRef, fresh, duplicate, stale, displayDate: fmtDate("2026-09-27") };
  });
  await page.goto("/");
  const queue = page.getByRole("heading", { name: "Propostas por rever · 1" }).locator("xpath=..");
  const freshLinks = queue.locator('[data-match-proposal-sync="' + seeded.freshRef + '"]');
  await expect(freshLinks).toHaveCount(1);
  await expect(freshLinks.first()).toContainText(seeded.displayDate);
  await expect(freshLinks.first()).toContainText("Rivais");
  await expect(freshLinks.first()).toHaveAttribute("href", "#/equipa/jogo/" + seeded.duplicate + "?focus=after");
  const stale = queue.locator('[data-match-proposal-stale="' + seeded.staleRef + '"]');
  await expect(queue).toContainText("Propostas de jogo desatualizadas · 1");
  await expect(stale).toContainText("Rivais stale E2E");
  await expect(stale).toContainText("Desatualizada");
  await stale.click();
  await expect(page).toHaveURL(/#\/equipa\/jogo\/\d+\?focus=after$/);
  await expect(page.locator("#match-after")).toBeVisible();
  await expect.poll(() => page.locator("#match-after").evaluate(element => element.getBoundingClientRect().top)).toBeLessThan(200);
});

test("Workspace sends training continuity proposals directly to their review screen", async ({ page }) => {
  await page.goto("/#/treinos");
  await page.waitForFunction(() => typeof DB !== "undefined");
  const trainingId = await page.evaluate(async () => {
    const id = await DB.criar("treinos", {
      team_id: DEFAULT_TEAM_ID, sync_id: crypto.randomUUID(), data: new Date().toISOString().slice(0, 10),
      status: "ready", objetivo: "Apoio após passe", blocos: [], review: { status: "done", continua: "Dar apoio depois do passe" },
      continuity: { revision: 1, proposal: {
        id: "workspace-proposal-e2e", status: "draft", target_ref: crypto.randomUUID(),
        source_ref: crypto.randomUUID(), source_key: "stale-source", objective: "Apoio após passe",
        rationale: "Proposta criada a partir da avaliação registada.", success_criterion: "", date: "", time: "", blocks: [], evidence: [],
      } },
    });
    return id;
  });
  await page.goto("/");
  const queue = page.getByRole("heading", { name: /Propostas por rever/ }).locator("xpath=..");
  const proposal = queue.getByRole("link", { name: /Apoio após passe/ });
  await expect(proposal).toHaveAttribute("href", "#/continuidade/" + trainingId);
  await proposal.click();
  await expect(page.locator("[data-continuity-form]")).toBeVisible();
  await expect(page.locator("[data-continuity-form] [name=objective]")).toHaveValue("Apoio após passe");
});

test("Workspace next events skip cancelled, completed matches and completed sessions", async ({ page }) => {
  await page.goto("/#/calendario");
  await page.waitForFunction(() => typeof DB !== "undefined");
  await page.evaluate(async () => {
    const day = (offset) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + offset); return d.toISOString().slice(0, 10); };
    await DB.criar("jogos", { team_id: DEFAULT_TEAM_ID, sync_id: crypto.randomUUID(), data: day(1), adversario: "Jogo cancelado", estado: "cancelado" });
    await DB.criar("jogos", { team_id: DEFAULT_TEAM_ID, sync_id: crypto.randomUUID(), data: day(2), adversario: "Jogo concluído", estado: "concluido" });
    await DB.criar("jogos", { team_id: DEFAULT_TEAM_ID, sync_id: crypto.randomUUID(), data: day(3), adversario: "Próximo jogo", estado: "agendado" });
    await DB.criar("treinos", { team_id: DEFAULT_TEAM_ID, sync_id: crypto.randomUUID(), data: day(1), objetivo: "Sessão terminada", session: { status: "completed" } });
    await DB.criar("treinos", { team_id: DEFAULT_TEAM_ID, sync_id: crypto.randomUUID(), data: day(2), objetivo: "Treino concluído legado", status: "completed" });
    await DB.criar("treinos", { team_id: DEFAULT_TEAM_ID, sync_id: crypto.randomUUID(), data: day(3), objetivo: "Próximo treino" });
  });
  await page.goto("/");
  const upcoming = page.locator(".hero-side").filter({ has: page.getByRole("heading", { name: "Próximos" }) });
  await expect(upcoming).toContainText("Próximo jogo");
  await expect(upcoming).toContainText("Próximo treino");
  await expect(upcoming).not.toContainText("Jogo cancelado");
  await expect(upcoming).not.toContainText("Jogo concluído");
  await expect(upcoming).not.toContainText("Sessão terminada");
  await expect(upcoming).not.toContainText("Treino concluído legado");
});

test("treinador regista observação e ela entra na atividade partilhada", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Registar observação" }).click();

  await page.getByLabel("Título").fill("Saída sob pressão");
  await page.getByRole("textbox", { name: "Observação", exact: true }).fill("Faltaram linhas de passe quando o adversário pressionou alto.");
  await page.getByRole("button", { name: "Guardar observação" }).click();

  await expect(page.getByText("Saída sob pressão")).toBeVisible();
  await expect(page.getByText(/Registou observação/)).toBeVisible();

  await page.getByRole("link", { name: "Timeline", exact: true }).first().click();
  await expect(page.getByText("Saída sob pressão", { exact: true })).toBeVisible();
  await expect(page.locator("#app .badge.human").first()).toHaveText("Treinador");
});

test("referência UUID de outro dispositivo não é usada como chave numérica da IndexedDB", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const playerRef = crypto.randomUUID(), teamRef = crypto.randomUUID();
    const id = await DB.criar("workspace_documents", {
      team_id: DEFAULT_TEAM_ID, type: "note", title: "Referência já remota",
      refs: [{ type: "player", id: playerRef }],
    }, { remote: true });
    const originalInit = RemoteWorkspace.init;
    RemoteWorkspace.init = async () => ({ from(table) {
      if (table !== "workspace_records") throw Error("wrong table");
      return { select() { return this; }, eq() { return this; }, is() { return this; },
        async maybeSingle() { return { data: { id: playerRef }, error: null }; } };
    } });
    try {
      const local = await DB.obter("workspace_documents", id);
      const payload = await RemoteWorkspace._payloadForRemote("workspace_documents", local, teamRef);
      return { original: local.refs[0].id, remote: payload.refs[0].id, saved: (await DB.obter("workspace_documents", id)).refs[0].id };
    } finally { RemoteWorkspace.init = originalInit; }
  });
  expect(result.remote).toBe(result.original);
  expect(result.saved).toBe(result.original);
});

test("confirmação de sync na IndexedDB preserva a revisão local e uma edição seguinte fica pendente", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const id = await DB.criar("jogos", {
      team_id: DEFAULT_TEAM_ID, sync_id: crypto.randomUUID(), adversario: "Original",
      sync_dirty: false, sync_local_updated_at: "seed", remote_updated_at: "remote-v1",
    }, { remote: true });
    await DB.modificar("jogos", id, current => ({ ...current, remote_updated_at: "remote-v2" }), { remote: true });
    const afterAck = await DB.obter("jogos", id);
    await DB.modificar("jogos", id, current => ({ ...current, adversario: "Editado pelo treinador" }));
    const afterEdit = await DB.obter("jogos", id);
    await DB.modificar("jogos", id, current => ({ ...current, adversario: "Texto escrito durante o envio" }));
    await RemoteWorkspace._ackPushedRecord("jogos", afterEdit, { updated_at: "remote-v3", actor_type: "human", actor_label: "Treinador" }, {}, crypto.randomUUID());
    const afterConcurrentEdit = await DB.obter("jogos", id);
    return { afterAck: { dirty: afterAck.sync_dirty, localRevision: afterAck.sync_local_updated_at, remoteRevision: afterAck.remote_updated_at }, afterEdit: { name: afterEdit.adversario, dirty: afterEdit.sync_dirty, localRevision: afterEdit.sync_local_updated_at }, afterConcurrentEdit: { name: afterConcurrentEdit.adversario, dirty: afterConcurrentEdit.sync_dirty, remoteRevision: afterConcurrentEdit.remote_updated_at } };
  });
  expect(result.afterAck).toEqual({ dirty: false, localRevision: "seed", remoteRevision: "remote-v2" });
  expect(result.afterEdit.name).toBe("Editado pelo treinador");
  expect(result.afterEdit.dirty).toBe(true);
  expect(result.afterEdit.localRevision).not.toBe("seed");
  expect(result.afterConcurrentEdit).toEqual({ name: "Texto escrito durante o envio", dirty: true, remoteRevision: "remote-v3" });
});

test("cria plano partilhado e associa media", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#/planos/novo");
  await page.getByLabel("Tipo").selectOption("training_plan");
  await page.getByLabel("Estado").selectOption("ready");
  await page.getByLabel("Título").fill("Treino de terça");
  await page.getByLabel("Conteúdo").fill("Objetivo: criar linhas de passe e largura na primeira fase.");
  await page.getByRole("button", { name: "Guardar documento" }).click();

  await expect(page.locator("#app").getByRole("heading", { name: "Treino de terça" })).toBeVisible();
  await expect(page.getByText("Pronto")).toBeVisible();

  await page.getByRole("link", { name: "Associar media" }).click();
  await page.getByLabel("Tipo").selectOption("video");
  await page.getByLabel("Título").fill("Exemplo de saída");
  await page.getByLabel("Link externo").fill("https://example.com/video");
  await page.getByRole("button", { name: "Guardar media" }).click();

  await expect(page.getByText("Exemplo de saída")).toBeVisible();

  const state = await page.evaluate(async () => ({
    docs: await DB.listar("workspace_documents"),
    media: await DB.listar("media_items"),
    activity: await DB.listar("activity_items"),
  }));
  expect(state.docs).toHaveLength(1);
  expect(state.docs[0].created_by).toBe("human");
  expect(state.docs[0].sync_id).toMatch(/^[0-9a-f-]{36}$/i);
  expect(state.docs[0].sync_dirty).toBe(true);
  expect(state.media).toHaveLength(1);
  expect(state.media[0].subject_type).toBe("document");
  expect(state.activity.some((x) => x.action === "created_document")).toBeTruthy();
  expect(state.activity.some((x) => x.action === "added_media")).toBeTruthy();

  await page.getByRole("link", { name: "Editar", exact: true }).click();
  await page.getByLabel("Título").fill("Saída de bola corrigida");
  await page.getByLabel("Link externo").fill("https://example.com/video-edited");
  await page.getByLabel("Nota / contexto").fill("Minuto 3 · apoio após passe");
  await page.getByRole("button", { name: "Guardar alterações" }).click();
  await expect(page.getByText("Saída de bola corrigida")).toBeVisible();
  const edited = await page.evaluate(async () => ({
    media: await DB.listar("media_items"),
    activity: await DB.listar("activity_items"),
  }));
  expect(edited.media).toHaveLength(1);
  expect(edited.media[0].id).toBe(state.media[0].id);
  expect(edited.media[0].sync_id).toBe(state.media[0].sync_id);
  expect(edited.media[0].title).toBe("Saída de bola corrigida");
  expect(edited.media[0].url).toBe("https://example.com/video-edited");
  expect(edited.media[0].note).toBe("Minuto 3 · apoio após passe");
  expect(edited.media[0].sync_dirty).toBe(true);
  expect(edited.activity.some((x) => x.action === "updated_media")).toBeTruthy();

  let removeNotice = "";
  page.on("dialog", async (dialog) => { removeNotice = dialog.message(); await dialog.accept(); });
  await page.getByRole("button", { name: "Remover", exact: true }).click();
  await expect.poll(() => removeNotice).toContain("ficheiro binário continua guardado no armazenamento privado");
  const removed = await page.evaluate(async () => ({
    media: await DB.listar("media_items"),
    tombstones: await DB.listar("sync_tombstones"),
  }));
  expect(removed.media).toHaveLength(0);
  expect(removed.tombstones).toHaveLength(1);
  expect(removed.tombstones[0].store).toBe("media_items");
});

test("agente e humano escrevem no mesmo workspace com autoria separada", async ({ page }) => {
  await page.goto("/");
  const agentState = await page.evaluate(async () => {
    let unsafeTypeRejected = false, unsafeStatusRejected = false, staleUpdateRejected = false, unconfirmedHypothesisRejected = false, inventedQuoteRejected = false, wrongTeamRejected = false;
    try { await AgentWorkspaceAPI.createDocument({ type: "training_plan", title: "Plano", body: "Plano sem aprovação" }); }
    catch (error) { unsafeTypeRejected = /operação MCP específica/.test(error.message); }
    try { await AgentWorkspaceAPI.createDocument({ type: "brief", title: "Brief não aprovado", status: "ready" }); }
    catch (error) { unsafeStatusRejected = /rascunho/.test(error.message); }
    const matchRef = crypto.randomUUID();
    await DB.criar("jogos", { team_id: DEFAULT_TEAM_ID, sync_id: matchRef, adversario: "Adversário de teste", during: { notes: ["Pressão alta recuperou a bola"] } });
    const hypothesis = { title: "Pressão coordenada", content: "A equipa pode recuperar mais bolas com pressão coordenada.", evidence: [{ type: "match", id: matchRef, quote: "Pressão alta recuperou a bola" }] };
    try { await AgentWorkspaceAPI.addHypothesis(hypothesis); }
    catch (error) { unconfirmedHypothesisRejected = /confirmação explícita/.test(error.message); }
    try { await AgentWorkspaceAPI.addHypothesis({ ...hypothesis, confirmed: true, evidence: [{ ...hypothesis.evidence[0], quote: "A equipa marcou três golos" }] }); }
    catch (error) { inventedQuoteRejected = /citação não corresponde/.test(error.message); }
    try { await AgentWorkspaceAPI.addHypothesis({ ...hypothesis, team_id: "equipa-errada", confirmed: true }); }
    catch (error) { wrongTeamRejected = /citação não corresponde/.test(error.message); }
    const memoryId = await AgentWorkspaceAPI.addHypothesis({ ...hypothesis, confirmed: true });
    const duplicateMemoryId = await AgentWorkspaceAPI.addHypothesis({ ...hypothesis, confirmed: true });
    const [memory] = await DB.listar("memory_items");
    const id = await AgentWorkspaceAPI.createDocument({
      team_id: "default",
      type: "brief",
      title: "Proposta criada pelo agente",
      body: "Hipótese para rever: dificuldade em encontrar apoio exterior.",
      agent_label: "Head Coach",
    });
    const before = await AgentWorkspaceAPI.getDocument(id);
    try { await AgentWorkspaceAPI.updateDocument(id, { body: "Edição sem leitura" }); }
    catch (error) { staleUpdateRejected = /Lê a versão atual/.test(error.message); }
    await AgentWorkspaceAPI.updateDocument(id, { body: "Hipótese revista pelo Head Coach.", expected_updated_at: before.updated_at });
    return { id, memoryId, duplicateMemoryId, memory, unconfirmedHypothesisRejected, inventedQuoteRejected, wrongTeamRejected, unsafeTypeRejected, unsafeStatusRejected, staleUpdateRejected, document: await AgentWorkspaceAPI.getDocument(id) };
  });

  expect(agentState.unsafeTypeRejected).toBe(true);
  expect(agentState.unsafeStatusRejected).toBe(true);
  expect(agentState.staleUpdateRejected).toBe(true);
  expect(agentState.unconfirmedHypothesisRejected).toBe(true);
  expect(agentState.inventedQuoteRejected).toBe(true);
  expect(agentState.wrongTeamRejected).toBe(true);
  expect(agentState.duplicateMemoryId).toBe(agentState.memoryId);
  expect(agentState.memory.kind).toBe("hypothesis");
  expect(agentState.memory.metadata.evidence_refs).toHaveLength(1);
  expect(agentState.document.status).toBe("draft");
  expect(agentState.document.updated_by).toBe("agent");
  expect(agentState.document.body).toBe("Hipótese revista pelo Head Coach.");

  await page.goto("/#/planos/" + agentState.id);
  await expect(page.locator("#app").getByRole("heading", { name: "Proposta criada pelo agente" })).toBeVisible();
  await expect(page.getByText("Head Coach", { exact: true })).toBeVisible();

  await page.getByRole("link", { name: "Editar" }).click();
  await page.getByLabel("Conteúdo").fill("Padrão revisto pelo treinador: faltou apoio exterior e profundidade.");
  await page.getByRole("button", { name: "Guardar documento" }).click();
  await expect(page.getByText(/última alteração por Treinador/)).toBeVisible();

  await page.goto("/#/timeline");
  await expect(page.getByText(/Criou briefing/).first()).toBeVisible();
  await expect(page.getByText(/Atualizou briefing/).first()).toBeVisible();
  await expect(page.getByText("Head Coach").first()).toBeVisible();

  const stored = await page.evaluate(async () => {
    const docs = await DB.listar("workspace_documents");
    const activity = await DB.listar("activity_items");
    return { doc: docs[0], activity };
  });
  expect(stored.doc.created_by).toBe("agent");
  expect(stored.doc.updated_by).toBe("human");
  expect(stored.activity.some((x) => x.actor === "agent" && x.action === "created_document")).toBeTruthy();
  expect(stored.activity.some((x) => x.actor === "human" && x.action === "updated_document")).toBeTruthy();
});

test("nova navegação não expõe chatbot nem gerador IA antigos", async ({ page }) => {
  await page.goto("/");
  for (const href of ["#/", "#/equipa", "#/calendario", "#/planos", "#/media", "#/timeline"]) {
    await expect(page.locator('.bottom-nav a[href="' + href + '"]')).toBeVisible();
  }
  await expect(page.getByText("Gerar treino por IA")).toHaveCount(0);
  await expect(page.getByText("Chat Head Coach")).toHaveCount(0);
  await expect(page.locator('script[src*="head_coach_chat"]')).toHaveCount(0);
  await expect(page.locator('script[src*="ia_treino"]')).toHaveCount(0);
});

test("definições expõem ligação remota sem secret key", async ({ page }) => {
  await page.goto("/#/definicoes");

  await expect(page.getByRole("heading", { name: "Supabase" })).toBeVisible();
  await expect(page.getByLabel("Project URL")).toBeVisible();
  await expect(page.getByLabel("Publishable key")).toBeVisible();
  await expect(page.locator('input[name="publishable_key"]')).toHaveAttribute("type", "password");
  await expect(page.locator('input[name*="secret"], input[name*="service"]')).toHaveCount(0);
  await expect(page.locator('script[src="vendor/supabase.min.js"]')).toHaveCount(1);
  await expect(page.locator('script[src="vendor/tus.min.js"]')).toHaveCount(1);
  await expect(page.locator('script[src="js/remote_workspace.js"]')).toHaveCount(1);

  const tusReady = await page.evaluate(() => typeof TusClient?.Upload === "function");
  expect(tusReady).toBe(true);

  const state = await page.evaluate(async () => RemoteWorkspace.status());
  expect(state.configured).toBe(true);
  expect(state.signedIn).toBe(false);
  expect(state.remoteTeamId).toBe(null);
});

test("definições distinguem Realtime degradado sem voltar a desenhar a página", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(async () => {
    const teamId = "845aceb7-3350-4e52-9b5e-5279132d3ae9";
    RemoteWorkspace._realtimeTeamId = teamId;
    RemoteWorkspace._realtimeStatus = "degraded";
    RemoteWorkspace.status = async () => ({
      configured: true, signedIn: true, email: "treinador@example.test", remoteTeamId: teamId,
      lastSyncAt: "2026-09-23T12:00:00.000Z", realtimeStatus: RemoteWorkspace._realtimeStatus, conflicts: [],
    });
    RemoteWorkspace.listTeams = async () => [{ id: teamId, name: "Sub-8 Teste" }];
    MCPConnectors.list = async () => ({ ok: true, connectors: [] });
    location.hash = "#/definicoes";
    await router();
  });

  const realtimeStatus = page.getByRole("status").filter({ hasText: "Atualizações em tempo real indisponíveis" });
  await expect(realtimeStatus).toBeVisible();
  await expect(page.locator("#remote-detail")).toHaveText("Tempo real indisponível · sincroniza ao regressar");

  await page.evaluate(() => {
    RemoteWorkspace._realtimeStatus = "connected";
    window.dispatchEvent(new CustomEvent("visioncoach:realtime-status", { detail: { status: "connected" } }));
  });
  await expect(page.getByRole("status").filter({ hasText: "Atualizações automáticas em tempo real ligadas." })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Definições" })).toBeVisible();
});

test("alteração offline recebe UUID e eliminação cria tombstone", async ({ page }) => {
  await page.goto("/");
  const state = await page.evaluate(async () => {
    const originRemoteTeamId = "55555555-5555-4555-8555-555555555555";
    localStorage.setItem("treinador.remote.supabase.v1", JSON.stringify({ remoteTeamId: originRemoteTeamId }));
    const id = await DB.criar("jogadores", {
      team_id: DEFAULT_TEAM_ID,
      nome: "Sync Offline",
      escalao: "sub-8",
      remote_team_id: originRemoteTeamId,
    });
    const row = await DB.obter("jogadores", id);
    const originalTransaction = IDBDatabase.prototype.transaction;
    const tombstoneTransactions = [];
    let captureTransactions = false;
    IDBDatabase.prototype.transaction = function (stores, mode, options) {
      const names = typeof stores === "string" ? [stores] : Array.from(stores);
      if (captureTransactions && mode === "readwrite") tombstoneTransactions.push(names);
      return originalTransaction.call(this, stores, mode, options);
    };
    captureTransactions = true;
    await DB.apagar("jogadores", id);
    captureTransactions = false;
    const syncedId = await DB.criar("jogadores", {
      team_id: DEFAULT_TEAM_ID,
      nome: "Sync com versão",
      escalao: "sub-8",
      sync_id: "22222222-2222-4222-8222-222222222222",
      sync_dirty: false,
      remote_updated_at: "2026-09-21T12:00:00.000Z",
    }, { remote: true });
    captureTransactions = true;
    await DB.apagar("jogadores", syncedId);
    captureTransactions = false;
    const remoteDeletedId = await DB.criar("jogadores", {
      team_id: DEFAULT_TEAM_ID,
      nome: "Eliminação recebida",
      sync_id: "33333333-3333-4333-8333-333333333333",
      sync_dirty: false,
      remote_updated_at: "2026-09-22T12:00:00.000Z",
    }, { remote: true });
    const remoteRow = await DB.obter("jogadores", remoteDeletedId);
    captureTransactions = true;
    await DB.apagar("jogadores", remoteDeletedId, { remote: true, expected: remoteRow });
    captureTransactions = false;
    IDBDatabase.prototype.transaction = originalTransaction;
    return {
      syncId: row.sync_id,
      dirty: row.sync_dirty,
      tombstones: await DB.listar("sync_tombstones"),
      tombstoneTransactions,
      remoteCopyExists: !!(await DB.obter("jogadores", remoteDeletedId)),
      originRemoteTeamId,
    };
  });
  expect(state.syncId).toMatch(/^[0-9a-f-]{36}$/i);
  expect(state.dirty).toBe(true);
  expect(state.tombstones).toHaveLength(2);
  expect(state.tombstones[0].sync_id).toBe(state.syncId);
  expect(state.tombstones[0].remote_team_id).toBe(state.originRemoteTeamId);
  expect(state.tombstones[1].expected_updated_at).toBe("2026-09-21T12:00:00.000Z");
  expect(state.remoteCopyExists).toBe(false);
  expect(state.tombstoneTransactions).toHaveLength(3);
  expect(state.tombstoneTransactions[0]).toEqual(expect.arrayContaining(["jogadores", "sync_tombstones"]));
  expect(state.tombstoneTransactions[1]).toEqual(expect.arrayContaining(["jogadores", "sync_tombstones"]));
  expect(state.tombstoneTransactions[2]).toEqual(["jogadores"]);
});

test("interface local mostra apenas dados do workspace remoto selecionado", async ({ page }) => {
  await page.goto("/");
  const visible = await page.evaluate(async () => {
    localStorage.setItem("treinador.remote.supabase.v1", JSON.stringify({ remoteTeamId: "team-b" }));
    const first = await DB.criar("jogadores", { team_id: DEFAULT_TEAM_ID, remote_team_id: "team-a", nome: "Atleta A" }, { remote: true });
    const second = await DB.criar("jogadores", { team_id: DEFAULT_TEAM_ID, remote_team_id: "team-b", nome: "Atleta B" }, { remote: true });
    const fresh = await DB.criar("jogadores", { team_id: DEFAULT_TEAM_ID, nome: "Atleta local" });
    let editError = "";
    try { await DB.modificar("jogadores", first, (row) => ({ ...row, nome: "Editado fora do workspace" })); }
    catch (error) { editError = error.message; }
    let deleteError = "";
    try { await DB.apagar("jogadores", first); }
    catch (error) { deleteError = error.message; }
    return {
      list: (await DB.porIndice("jogadores", "team_id", DEFAULT_TEAM_ID)).map((row) => row.nome),
      hidden: await DB.obter("jogadores", first),
      visible: (await DB.obter("jogadores", second))?.nome,
      freshTeam: (await DB.obter("jogadores", fresh))?.remote_team_id,
      editError,
      deleteError,
      rawStillThere: (await DB.listar("jogadores")).some((row) => row.id === first),
    };
  });
  expect(visible.list).toEqual(["Atleta B", "Atleta local"]);
  expect(visible.hidden).toBeUndefined();
  expect(visible.visible).toBe("Atleta B");
  expect(visible.freshTeam).toBe("team-b");
  expect(visible.editError).toContain("outro workspace remoto");
  expect(visible.deleteError).toContain("outro workspace remoto");
  expect(visible.rawStillThere).toBe(true);
});

test("editar documento remoto preserva identidade e versão de sincronização", async ({ page }) => {
  await page.goto("/");
  const state = await page.evaluate(async () => {
    const id = await DB.criar("workspace_documents", {
      team_id: DEFAULT_TEAM_ID,
      type: "brief",
      title: "Documento remoto",
      body: "Versão remota",
      status: "draft",
      refs: [],
      created_by: "agent",
      created_by_label: "Head Coach",
      updated_by: "agent",
      updated_by_label: "Head Coach",
      created_at: "2026-09-21T12:00:00.000Z",
      updated_at: "2026-09-21T12:00:00.000Z",
      sync_id: "33333333-3333-4333-8333-333333333333",
      sync_dirty: false,
      remote_updated_at: "2026-09-21T12:00:00.000Z",
      sync_actor_type: "agent",
      sync_actor_label: "Head Coach",
    }, { remote: true });

    await WorkspaceStore.saveDocument({
      id,
      body: "Versão humana",
      updated_by: "human",
      updated_by_label: "Treinador",
    });
    return DB.obter("workspace_documents", id);
  });

  expect(state.sync_id).toBe("33333333-3333-4333-8333-333333333333");
  expect(state.remote_updated_at).toBe("2026-09-21T12:00:00.000Z");
  expect(state.sync_dirty).toBe(true);
  expect(state.body).toBe("Versão humana");
});


test("calendário e página de jogo preservam preparação estruturada", async ({ page }) => {
  await page.goto("/#/equipa/jogo/novo");
  await page.getByLabel("Data").fill("2026-09-26");
  await page.getByLabel("Hora do jogo").fill("10:00");
  await page.getByLabel("Adversário").fill("Teste E2E");
  await page.getByLabel("Casa / Fora").selectOption("fora");
  await page.getByLabel("Local").fill("Campo Teste");
  await page.getByLabel("Hora de saída").fill("08:30");
  await page.getByLabel("Competição").fill("AF Porto");
  await page.getByRole("button", { name: "Guardar jogo" }).click();

  await expect(page.getByRole("heading", { name: "Antes do jogo" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Alinhamento 5v5" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Durante" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Depois" })).toBeVisible();

  await page.getByLabel("Objetivo principal").fill("Circular rápido e abrir o campo");
  await page.getByLabel("Sistema observado").fill("1-2-1");
  await page.getByLabel("Estilo observado").selectOption("pressao_alta");
  await page.getByLabel("Pontos fortes observados · um por linha").fill("Pressão coordenada\nAvançado rápido");
  await page.getByLabel("Vulnerabilidades observadas · um por linha").fill("Espaço nas costas");
  await page.getByRole("button", { name: "Guardar plano" }).click();
  await page.getByRole("link", { name: "Editar dados" }).click();
  await page.getByLabel("Local").fill("Campo Teste 2");
  await page.getByRole("button", { name: "Guardar jogo" }).click();

  const stored = await page.evaluate(async () => {
    const games = await DB.listar("jogos");
    return games.find((x) => x.adversario === "Teste E2E");
  });
  expect(stored.pre_game.objetivo_principal).toBe("Circular rápido e abrir o campo");
  expect(stored.pre_game.adversario_sistema).toBe("1-2-1");
  expect(stored.pre_game.adversario_estilo).toBe("pressao_alta");
  expect(stored.pre_game.adversario_pontos_fortes).toEqual(["Pressão coordenada", "Avançado rápido"]);
  expect(stored.pre_game.adversario_vulnerabilidades).toEqual(["Espaço nas costas"]);
  expect(stored.hora_saida).toBe("08:30");
  expect(stored.external_key).toContain("2026-09-26");

  await page.goto("/#/calendario");
  await expect(page.getByText("Jogo vs Teste E2E")).toBeVisible();
  await expect(page.getByText(/saída 08:30/)).toBeVisible();
});


test("telemóvel expõe acesso à ligação remota", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const settings = page.getByRole("link", { name: "Definições e ligação" });
  await expect(settings).toBeVisible();
  await settings.click();
  await expect(page.getByRole("heading", { name: "Supabase" })).toBeVisible();
  await expect(page.getByLabel("Project URL")).toBeVisible();
  await expect(page.getByLabel("Publishable key")).toBeVisible();
});


test("biblioteca cria exercício e planeador reutiliza-o em blocos", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(async () => {
    await DB.criar("exercicios", { nome: "Exercício legado invisível" }, { remote: true });
  });

  await page.goto("/#/exercicios");
  await expect(page.getByText("Exercício legado invisível")).toHaveCount(0);
  await page.getByRole("link", { name: "Novo exercício" }).click();
  await page.getByLabel("Nome").fill("Fechar e Cobrir E2E");
  await page.getByLabel("Objetivo").fill("Posicionamento defensivo");
  await page.getByLabel("Espaço").fill("20x15");
  await page.getByLabel("Séries").fill("3");
  await page.getByLabel("Minutos por série").fill("4");
  await page.getByLabel("Tags · separadas por vírgulas").fill("defesa, cobertura");
  await page.getByRole("button", { name: "Guardar exercício" }).click();

  await expect(page.locator("#app").getByRole("heading", { name: "Fechar e Cobrir E2E" })).toBeVisible();
  const exercise = await page.evaluate(async () => {
    const rows = await DB.listar("exercicios");
    return rows.find((x) => x.nome === "Fechar e Cobrir E2E");
  });
  expect(exercise.workspace_v2).toBe(true);
  expect(exercise.sync_id).toMatch(/^[0-9a-f-]{36}$/i);
  expect(exercise.duracao_total_min).toBe(12);

  await page.getByRole("link", { name: "Usar num treino" }).click();
  await page.getByLabel("Objetivo da sessão").fill("Melhorar organização defensiva");
  await page.getByRole("button", { name: "Guardar treino" }).click();

  await expect(page.getByText("Fechar e Cobrir E2E")).toBeVisible();
  await expect(page.getByText("12 min", { exact: true }).first()).toBeVisible();

  const training = await page.evaluate(async () => {
    const rows = await DB.listar("treinos");
    return rows.find((x) => x.objetivo === "Melhorar organização defensiva");
  });
  expect(training.blocos).toHaveLength(1);
  expect(training.blocos[0].exercise_ref).toBe(exercise.sync_id);
  expect(training.duracao_min).toBe(12);
});


test("definições expõem gestão MCP sem guardar token no browser", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(async () => {
    const teamId = "845aceb7-3350-4e52-9b5e-5279132d3ae9";
    RemoteWorkspace.status = async () => ({
      configured: true,
      signedIn: true,
      email: "treinador@example.test",
      remoteTeamId: teamId,
      lastSyncAt: null,
      conflicts: [],
    });
    RemoteWorkspace.listTeams = async () => [{ id: teamId, name: "Sub-8 Teste" }];
    MCPConnectors.list = async () => ({
      ok: true,
      mcp_url: "https://example.test/functions/v1/vision-coach-mcp",
      connectors: [{
        id: "11111111-1111-4111-8111-111111111111",
        label: "Claude portátil",
        scopes: ["read", "write"],
        token_prefix: "vcmcp_abcd1234",
        enabled: true,
        created_at: "2026-09-21T20:00:00Z",
        last_used_at: null,
        expires_at: "2027-09-21T20:00:00Z",
        revoked_at: null,
      }],
    });
    location.hash = "#/definicoes";
    await router();
  });

  await expect(page.getByRole("heading", { name: "Vision Coach MCP" })).toBeVisible();
  await expect(page.getByLabel("Nome da ligação")).toBeVisible();
  await expect(page.getByText("Claude portátil")).toBeVisible();
  await expect(page.getByText(/vcmcp_abcd1234/)).toBeVisible();
  await expect(page.locator('script[src="js/mcp_connectors.js"]')).toHaveCount(1);
  await expect(page.locator('input[value^="vcmcp_"]')).toHaveCount(0);
});


test("Planos mostra dados locais antes da sincronização e atualiza ao concluir", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(async () => {
    window.__remoteSyncCalls = 0;
    window.__releasePlansSync = null;
    RemoteWorkspace.status = async () => ({
      configured: true,
      signedIn: true,
      remoteTeamId: "845aceb7-3350-4e52-9b5e-5279132d3ae9",
      lastSyncAt: null,
      conflicts: [],
    });
    RemoteWorkspace.syncNow = () => new Promise((resolve) => {
      window.__remoteSyncCalls += 1;
      window.__releasePlansSync = async () => {
      const docs = await DB.listar("workspace_documents");
      if (!docs.some((doc) => doc.title === "Relatório remoto de teste")) {
        const now = new Date().toISOString();
        await DB.criar("workspace_documents", {
          team_id: "default",
          type: "match_analysis",
          title: "Relatório remoto de teste",
          body: "Documento recebido do Head Coach.",
          status: "ready",
          target_date: null,
          refs: [],
          created_by: "agent",
          created_by_label: "Head Coach IA",
          updated_by: "agent",
          updated_by_label: "Head Coach IA",
          created_at: now,
          updated_at: now,
          sync_id: "11111111-1111-4111-8111-111111111111",
          sync_dirty: false,
          remote_updated_at: now,
        }, { remote: true });
      }
      const result = { pushed: 0, pulled: 1, conflicts: [], deleted: 0 };
      window.dispatchEvent(new CustomEvent("visioncoach:sync-complete", { detail: result }));
      resolve(result);
      };
    });
    location.hash = "#/planos";
    await router();
  });

  await expect(page.getByText("Ainda não existem planos ou análises")).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__remoteSyncCalls)).toBe(1);
  await page.evaluate(() => window.__releasePlansSync());
  await expect(page.getByText("Relatório remoto de teste")).toBeVisible();
  expect(await page.evaluate(() => window.__remoteSyncCalls)).toBe(1);
});


test("sync remoto atualiza o ecrã aberto sem refresh manual", async ({ page }) => {
  await page.goto("/#/equipa");
  await expect(page.getByRole("heading", { name: /Equipa/i }).first()).toBeVisible();

  await page.evaluate(async () => {
    await DB.criar("jogadores", {
      team_id: DEFAULT_TEAM_ID,
      nome: "Jogador recebido do remoto",
      escalao: "sub-8",
      sync_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      sync_dirty: false,
      remote_updated_at: "2026-09-22T00:00:00.000Z",
    }, { remote: true });
    window.dispatchEvent(new CustomEvent("visioncoach:sync-complete", {
      detail: { pulled: 1, pushed: 0, conflicts: [], deleted: 0 }
    }));
  });

  await expect(page.getByText("Jogador recebido do remoto", { exact: true })).toBeVisible();
});

test("sync do Workspace corre em fundo, atualiza a vista uma vez e preserva o scroll", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByText("Human–AI Shared Workspace")).toBeVisible();
  // Let the initial auth event settle before spying on this explicit render.
  await page.waitForTimeout(350);
  await page.evaluate(() => {
    let releaseSync;
    const syncGate = new Promise(resolve => { releaseSync = resolve; });
    window.__releaseWorkspaceSync = releaseSync;
    window.__workspaceSyncCalls = 0;
    RemoteWorkspace.scheduleSync = () => {};
    RemoteWorkspace.status = async () => ({ configured: true, signedIn: true, remoteTeamId: "team-test", lastSyncAt: null, conflicts: [] });
    RemoteWorkspace.syncNow = async () => {
      window.__workspaceSyncCalls++;
      if (window.__workspaceSyncCalls === 1) {
        await syncGate;
        window.dispatchEvent(new CustomEvent("visioncoach:sync-complete", { detail: { pulled: 1, pushed: 0, conflicts: [], deleted: 0 } }));
      }
      return { pulled: 1, pushed: 0, conflicts: [], deleted: 0 };
    };
    document.getElementById("app").style.minHeight = "1800px";
    window.scrollTo(0, 640);
    window.__workspaceRender = viewWorkspace();
  });
  await page.evaluate(() => window.__workspaceRender);
  await expect.poll(() => page.evaluate(() => window.__workspaceSyncCalls)).toBe(1);
  await expect(page.getByText("Human–AI Shared Workspace")).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(640);
  await page.evaluate(() => window.__releaseWorkspaceSync());
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(640);
  await expect.poll(() => page.evaluate(() => window.__workspaceSyncCalls)).toBe(1);
  await expect(page.getByText("Human–AI Shared Workspace")).toBeVisible();
});

test("emblema do Sub-8 de Figueiró aparece na identidade da equipa", async ({ page }) => {
  await page.goto("/");
  await page.waitForFunction(() => typeof DB !== "undefined" && typeof router === "function");
  await page.evaluate(async () => {
    await DB.modificar("teams", DEFAULT_TEAM_ID, team => ({
      ...team, nome: "Sub-8 do 1.º de Maio de Figueiró", clube: "1.º de Maio de Figueiró", escalao: "sub-8",
    }), { remote: true });
    await router();
  });
  const crest = page.getByRole("img", { name: "Emblema do Sub-8 de Figueiró" });
  await expect(crest).toBeVisible();
  await expect(crest).toHaveAttribute("src", /assets\/teams\/14529_imgbank\.png$/);
  await expect.poll(() => crest.evaluate(image => image.naturalWidth)).toBeGreaterThan(0);
});

test("conflito de eliminação offline mostra versões e exige uma escolha explícita", async ({ page }) => {
  await page.goto("/");
  await page.waitForFunction(() => typeof RemoteWorkspace !== "undefined" && typeof router === "function");
  await page.evaluate(async () => {
    RemoteWorkspace.status = async () => ({ configured: true, signedIn: true, email: "treinador@example.test", remoteTeamId: "team-test", conflicts: [{ store: "jogadores", local_id: null, sync_id: "player-conflict", reason: "delete_version_mismatch", expected_updated_at: "v1", remote_updated_at: "v2" }, { store: "media_items", local_id: 9, sync_id: "media-conflict", reason: "remote_deleted_local_dirty", expected_updated_at: "v3", remote_updated_at: "v4" }, { store: "media_items", local_id: null, sync_id: "foreign-path", reason: "storage_path_team_mismatch" }, { store: "media_items", local_id: null, sync_id: "sign-failed", reason: "storage_signed_url_failed" }, { store: "jogos", local_id: 12, sync_id: "default", reason: "invalid_local_sync_id" }] });
    RemoteWorkspace.getConfig = () => ({ url: "https://example.supabase.co", publishableKey: "sb_publishable_test" });
    RemoteWorkspace.listTeams = async () => [{ id: "team-test", name: "Equipa de teste" }];
    MCPConnectors.list = async () => [];
    RemoteWorkspace.resolveDeleteConflict = async (id, resolution) => { window.__resolution = { id, resolution }; return { conflicts: [] }; };
    RemoteWorkspace.restoreLocallyEditedRecord = async id => { window.__restored = id; return { conflicts: [] }; };
    RemoteWorkspace.previewInvalidIdentityRecovery = async () => ({ status: "unique_match", store: "jogos", local_id: 12, local_updated_at: "local-v2", candidate: { id: "match-stable", updated_at: "v2", current_version: false, payload: { adversario: "Rivais" } }, local: { adversario: "Rivais" } });
    RemoteWorkspace.confirmInvalidIdentityRecovery = async (...args) => { window.__identityRecovery = args; return { conflicts: [{ reason: "version_mismatch" }] }; };
    go("#/definicoes");
  });
  await expect(page.getByText("Eliminação offline em conflito")).toBeVisible();
  await expect(page.getByText("Eliminação remota em conflito")).toBeVisible();
  await expect(page.getByText(/apagado no servidor, mas contém alterações locais pendentes/)).toBeVisible();
  await expect(page.getByText(/caminho do ficheiro pertence a outro workspace; não foi enviado nem assinado/)).toBeVisible();
  await expect(page.getByText(/não foi possível abrir uma ligação temporária. A sincronização tentará novamente/)).toBeVisible();
  await expect(page.getByText(/O identificador guardado neste dispositivo não é um UUID remoto/)).toBeVisible();
  await expect(page.getByText("5 ocorrências detetadas")).toBeVisible();
  await expect(page.getByText(/2 alterações requerem escolha do treinador · 2 registos aguardam correção · 1 falha temporária será repetida automaticamente/)).toBeVisible();
  await page.locator('[data-conflict-card="player-conflict"] details summary').click();
  await expect(page.getByText(/versão local vista: v1 · versão remota: v2/)).toBeVisible();
  await page.getByRole("button", { name: "Manter versão remota", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__resolution)).toEqual({ id: "player-conflict", resolution: "keep_remote" });
  page.on("dialog", dialog => dialog.accept());
  await page.getByRole("button", { name: "Restaurar edição local no remoto", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__restored)).toBe("media-conflict");
  await page.locator('[data-conflict-card="default"] [data-action="find-invalid-id-match"]').click();
  await expect(page.getByText("Correspondência única pela chave externa")).toBeVisible();
  await page.getByRole("button", { name: "Ligar estas identidades" }).click();
  await expect.poll(() => page.evaluate(() => window.__identityRecovery)).toEqual(["jogos", "12", "match-stable", "local-v2", "v2"]);
});

test("atalho do Workspace abre diretamente a fila de conflitos", async ({ page }) => {
  await page.goto("/");
  await page.waitForFunction(() => typeof RemoteWorkspace !== "undefined" && typeof router === "function" && typeof MCPConnectors !== "undefined");
  await page.evaluate(async () => {
    RemoteWorkspace.status = async () => ({ configured: true, signedIn: true, email: "treinador@example.test", remoteTeamId: "team-test", conflicts: [{ store: "jogos", local_id: null, sync_id: "match-conflict", reason: "version_mismatch", expected_updated_at: "v1", remote_updated_at: "v2" }] });
    RemoteWorkspace.getConfig = () => ({ url: "https://example.supabase.co", publishableKey: "sb_publishable_test" });
    RemoteWorkspace.listTeams = async () => [{ id: "team-test", name: "Equipa de teste" }];
    MCPConnectors.list = async () => [];
    await router();
  });
  await page.getByRole("link", { name: "Rever conflitos" }).click();
  await expect(page).toHaveURL(/#\/definicoes\?focus=conflitos$/);
  await expect(page.getByText("1 ocorrências detetadas")).toBeVisible();
  await expect.poll(() => page.locator("#remote-conflicts").evaluate(element => element.getBoundingClientRect().top)).toBeLessThan(140);
  const top = await page.locator("#remote-conflicts").evaluate(element => element.getBoundingClientRect().top);
  expect(top).toBeGreaterThanOrEqual(-8);
});

test("Definições carrega em paralelo e não lê os bytes de media para contar conflitos", async ({ page }) => {
  await page.goto("/#/definicoes");
  await page.waitForFunction(() => typeof router === "function" && typeof WorkspaceStore !== "undefined");
  await page.waitForFunction(() => typeof routerRunning === "boolean" && !routerRunning);
  await page.evaluate(() => {
    const status = { configured: true, signedIn: true, email: "treinador@example.test", remoteTeamId: "team-test", conflicts: [] };
    const countMedia = DB.contarPorIndice.bind(DB);
    const readIndex = DB.porIndice.bind(DB);
    const walkIndex = DB.percorrerIndice.bind(DB);
    let releaseStatus, releaseTeams;
    window.__settingsReads = { calls: [], mediaRead: false, mediaCounted: false, releaseStatus: null, releaseTeams: null };
    const statusGate = new Promise(resolve => { releaseStatus = resolve; });
    const teamsGate = new Promise(resolve => { releaseTeams = resolve; });
    window.__settingsReads.releaseStatus = releaseStatus;
    window.__settingsReads.releaseTeams = releaseTeams;
    WorkspaceStore.buildSnapshot = async () => { window.__settingsReads.calls.push("snapshot-used"); throw new Error("Definições não deve construir um snapshot global."); };
    DB.percorrerIndice = (store, ...args) => {
      if (["jogadores", "workspace_documents", "activity_items"].includes(store)) window.__settingsReads.calls.push(store + "-start");
      return walkIndex(store, ...args).then(count => {
        if (["jogadores", "workspace_documents", "activity_items"].includes(store)) window.__settingsReads.calls.push(store + "-done");
        return count;
      });
    };
    DB.porIndice = (...args) => {
      if (args[0] === "media_items") window.__settingsReads.mediaRead = true;
      return readIndex(...args);
    };
    DB.contarPorIndice = (...args) => {
      if (args[0] === "media_items") window.__settingsReads.mediaCounted = true;
      return countMedia(...args);
    };
    let firstStatus = true;
    RemoteWorkspace.status = async () => {
      window.__settingsReads.calls.push("status-start");
      if (firstStatus) { firstStatus = false; await statusGate; }
      return status;
    };
    RemoteWorkspace.listTeams = async () => {
      window.__settingsReads.calls.push("teams-start");
      await teamsGate;
      window.__settingsReads.calls.push("teams-done");
      return [];
    };
    MCPConnectors.list = async () => {
      window.__settingsReads.calls.push("connectors-start");
      return [];
    };
    window.__settingsRender = router();
  });
  await expect.poll(() => page.evaluate(() => ["jogadores-start", "workspace_documents-start", "activity_items-start", "status-start"].every(call => window.__settingsReads.calls.includes(call)))).toBe(true);
  expect(await page.evaluate(() => window.__settingsReads.calls.includes("snapshot-used"))).toBe(false);
  await page.evaluate(() => window.__settingsReads.releaseStatus());
  await expect.poll(() => page.evaluate(() => window.__settingsReads.calls.includes("teams-start") && window.__settingsReads.calls.includes("connectors-start"))).toBe(true);
  await page.evaluate(() => window.__settingsReads.releaseTeams());
  await page.evaluate(() => window.__settingsRender);
  await expect(page.getByText("Media", { exact: true }).last()).toBeVisible();
  expect(await page.evaluate(() => ({
    mediaRead: window.__settingsReads.mediaRead,
    mediaCounted: window.__settingsReads.mediaCounted,
  }))).toEqual({
    mediaRead: false,
    mediaCounted: true,
  });
});

test("conflito de edição compara as duas versões antes de permitir uma decisão", async ({ page }) => {
  await page.goto("/");
  await page.waitForFunction(() => typeof RemoteWorkspace !== "undefined" && typeof router === "function" && typeof MCPConnectors !== "undefined");
  await page.evaluate(() => {
    RemoteWorkspace.status = async () => ({ configured: true, signedIn: true, email: "treinador@example.test", remoteTeamId: "team-test", conflicts: [{ store: "jogos", local_id: 12, sync_id: "match-conflict", reason: "version_mismatch", expected_updated_at: "v1", remote_updated_at: "v2" }] });
    RemoteWorkspace.getConfig = () => ({ url: "https://example.supabase.co", publishableKey: "sb_publishable_test" });
    RemoteWorkspace.listTeams = async () => [{ id: "team-test", name: "Equipa de teste" }];
    MCPConnectors.list = async () => [];
    RemoteWorkspace.readVersionConflict = async (id, store) => ({ sync_id: id, store, local_updated_at: "local-v2", remote_updated_at: "v2", local: { nota_tatica: "Versão escrita no telemóvel" }, remote: { nota_tatica: "Versão atual do PC" }, merge_suggestion: null, merge_unavailable: "As duas versões alteraram os mesmos campos; a combinação automática ficou bloqueada." });
    RemoteWorkspace.resolveVersionConflict = async (...args) => { window.__versionResolution = args; return { conflicts: [] }; };
    go("#/definicoes");
  });
  await expect(page.getByText(/As duas versões estão preservadas/)).toBeVisible();
  await page.getByRole("button", { name: "Comparar versões" }).click();
  await expect(page.getByText('"nota_tatica": "Versão escrita no telemóvel"')).toBeVisible();
  await expect(page.getByText('"nota_tatica": "Versão atual do PC"')).toBeVisible();
  await expect(page.getByText("As duas versões alteraram os mesmos campos; a combinação automática ficou bloqueada.")).toBeVisible();
  page.on("dialog", dialog => dialog.accept());
  await page.getByRole("button", { name: "Manter versão deste dispositivo" }).click();
  await expect.poll(() => page.evaluate(() => window.__versionResolution)).toEqual(["match-conflict", "jogos", "keep_local", "v2", "local-v2", null]);
});

test("conflito com uma só versão alterada mostra a proposta antes de confirmar", async ({ page }) => {
  await page.goto("/");
  await page.waitForFunction(() => typeof RemoteWorkspace !== "undefined" && typeof router === "function" && typeof MCPConnectors !== "undefined");
  await page.evaluate(() => {
    RemoteWorkspace.status = async () => ({ configured: true, signedIn: true, email: "treinador@example.test", remoteTeamId: "team-test", conflicts: [{ store: "jogos", local_id: 12, sync_id: "match-one-sided", reason: "version_mismatch", expected_updated_at: "v1", remote_updated_at: "v2" }] });
    RemoteWorkspace.getConfig = () => ({ url: "https://example.supabase.co", publishableKey: "sb_publishable_test" });
    RemoteWorkspace.listTeams = async () => [{ id: "team-test", name: "Equipa de teste" }];
    MCPConnectors.list = async () => [];
    RemoteWorkspace.readVersionConflict = async (id, store) => ({
      sync_id: id, store, local_updated_at: "local-v2", remote_updated_at: "v2",
      local: { nota_tatica: "Base anterior" }, remote: { nota_tatica: "Apoio após perda" },
      merge_suggestion: null,
      single_change_suggestion: { resolution: "keep_remote", changed_side: "remote", changes: ["nota_tatica"] },
      merge_unavailable: "Só uma versão mudou desde a última base comum.",
    });
    RemoteWorkspace.resolveVersionConflict = async (...args) => { window.__singleResolution = args; return { conflicts: [] }; };
    go("#/definicoes");
  });
  await page.getByRole("button", { name: "Comparar versões" }).click();
  await expect(page.getByText("Uma única versão tem alterações")).toBeVisible();
  await page.getByText("Pré-visualizar a versão que será mantida").click();
  await expect(page.locator("details pre.conflict-preview")).toContainText("Apoio após perda");
  expect(await page.evaluate(() => window.__singleResolution)).toBeUndefined();
  page.on("dialog", dialog => dialog.accept());
  await page.getByRole("button", { name: "Manter a única versão alterada" }).click();
  await expect.poll(() => page.evaluate(() => window.__singleResolution)).toEqual(["match-one-sided", "jogos", "keep_remote", "v2", "local-v2", null]);
});

test("pré-visualização em lote deixa os conflitos sobrepostos para revisão e só grava após confirmação", async ({ page }) => {
  await page.goto("/");
  await page.waitForFunction(() => typeof RemoteWorkspace !== "undefined" && typeof router === "function" && typeof MCPConnectors !== "undefined");
  await page.evaluate(() => {
    const conflicts = ["m1", "m2", "m3", "m4"].map((id) => ({ store: "jogos", local_id: id, sync_id: id, reason: "version_mismatch", expected_updated_at: "v1", remote_updated_at: "v2" }));
    RemoteWorkspace.status = async () => ({ configured: true, signedIn: true, email: "treinador@example.test", remoteTeamId: "team-test", conflicts });
    RemoteWorkspace.getConfig = () => ({ url: "https://example.supabase.co", publishableKey: "sb_publishable_test" });
    RemoteWorkspace.listTeams = async () => [{ id: "team-test", name: "Equipa de teste" }];
    MCPConnectors.list = async () => [];
    RemoteWorkspace.previewIndependentConflictBatch = async () => {
      window.__batchWrites = 0;
      return { examined: 4, safe: [
        { sync_id: "m1", store: "jogos", display_name: "Jogo 1", mergeable: true, resolution: "merge_non_overlapping", expected_remote: "r1", expected_local: "l1", local_changes: ["resultado"], remote_changes: ["nota_tatica"], payload: { resultado: "2-1", nota_tatica: "Apoio" } },
        { sync_id: "m2", store: "jogos", display_name: "Jogo 2", mergeable: true, resolution: "merge_non_overlapping", expected_remote: "r2", expected_local: "l2", local_changes: ["local"], remote_changes: ["data"], payload: { local: "Campo A", data: "2026-10-04" } },
        { sync_id: "m3", store: "jogos", display_name: "Jogo 3", mergeable: true, resolution: "keep_remote", single_change: true, changed_side: "remote", expected_remote: "r3", expected_local: "l3", local_changes: [], remote_changes: ["nota_tatica"], payload: { nota_tatica: "Versão remota" } },
      ], needs_review: [{ sync_id: "m4", store: "jogos", display_name: "Jogo 4", mergeable: false, reason: "Os dois lados alteraram o mesmo campo." }] };
    };
    RemoteWorkspace.resolveIndependentConflictBatch = async (items) => {
      window.__batchWrites++;
      window.__batchItems = items;
      return { conflicts: [{ sync_id: "m3", reason: "version_mismatch" }] };
    };
    go("#/definicoes");
  });
  await page.getByRole("button", { name: "Analisar resoluções seguras (4)" }).click();
  await expect(page.getByText("3 resoluções seguras · 1 conflito para rever")).toBeVisible();
  await page.getByText("1 conflito(s) precisam de escolha campo a campo", { exact: true }).click();
  await expect(page.getByText("Os dois lados alteraram o mesmo campo.")).toBeVisible();
  await expect(page.getByText("Só workspace remoto alterou: Nota tática. Será mantida essa versão.")).toBeVisible();
  expect(await page.evaluate(() => window.__batchWrites)).toBe(0);
  let resultMessage = "";
  page.on("dialog", async dialog => { if (dialog.type() === "alert") resultMessage = dialog.message(); await dialog.accept(); });
  await page.getByRole("button", { name: "Aplicar e sincronizar 3 resoluções seguras" }).click();
  await expect.poll(() => page.evaluate(() => window.__batchItems?.length)).toBe(3);
  expect(await page.evaluate(() => window.__batchItems.map(item => item.sync_id))).toEqual(["m1", "m2", "m3"]);
  expect(resultMessage).toContain("1 conflito continua preservado");
});

test.describe("combinação explícita de conflitos", () => {
test.use({ serviceWorkers: "block" });
test("conflito com campos independentes mostra combinação antes da confirmação", async ({ page }) => {
  await page.goto("/");
  await page.waitForFunction(() => typeof RemoteWorkspace !== "undefined" && typeof router === "function" && typeof MCPConnectors !== "undefined");
  await page.evaluate(() => {
    RemoteWorkspace.status = async () => ({ configured: true, signedIn: true, email: "treinador@example.test", remoteTeamId: "team-test", conflicts: [{ store: "jogos", local_id: 12, sync_id: "match-merge", reason: "version_mismatch", expected_updated_at: "v1", remote_updated_at: "v2" }] });
    RemoteWorkspace.getConfig = () => ({ url: "https://example.supabase.co", publishableKey: "sb_publishable_test" });
    RemoteWorkspace.listTeams = async () => [{ id: "team-test", name: "Equipa de teste" }];
    MCPConnectors.list = async () => [];
    RemoteWorkspace.readVersionConflict = async (id, store) => ({
      sync_id: id, store, local_updated_at: "local-v2", remote_updated_at: "v2",
      local: { nota_tatica: "Apoio após passe" }, remote: { resultado: "2–1" },
      merge_suggestion: { payload: { nota_tatica: "Apoio após passe", resultado: "2–1" }, local_changes: ["nota_tatica"], remote_changes: ["resultado"] },
    });
    RemoteWorkspace.resolveVersionConflict = async (...args) => { window.__mergeResolution = args; return { conflicts: [] }; };
    go("#/definicoes");
  });
  await page.getByRole("button", { name: "Comparar versões" }).click();
  await expect(page.getByText("Combinação segura disponível")).toBeVisible();
  await page.getByText("Pré-visualizar a combinação").click();
  await expect(page.locator("details pre.conflict-preview")).toContainText('"resultado": "2–1"');
  page.on("dialog", dialog => dialog.accept());
  await page.getByRole("button", { name: "Combinar alterações independentes" }).click();
  await expect.poll(() => page.evaluate(() => window.__mergeResolution)).toEqual(["match-merge", "jogos", "merge_non_overlapping", "v2", "local-v2", null]);
});

test("sync concluída não repõe o scroll antigo se o treinador rolar durante a atualização", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.waitForFunction(() => typeof router === "function" && typeof WorkspaceStore !== "undefined");
  await page.evaluate(async () => {
    const buildSnapshot = WorkspaceStore.buildSnapshot.bind(WorkspaceStore);
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    window.__releaseWorkspaceRender = release;
    window.__workspaceRenderPending = false;
    WorkspaceStore.buildSnapshot = async (...args) => {
      if (!window.__workspaceRenderPending) {
        window.__workspaceRenderPending = true;
        await gate;
      }
      return buildSnapshot(...args);
    };
    document.getElementById("app").style.minHeight = "1800px";
    window.scrollTo(0, 640);
    window.dispatchEvent(new CustomEvent("visioncoach:sync-complete", { detail: { pulled: 1, pushed: 0, conflicts: [], deleted: 0 } }));
  });
  await expect.poll(() => page.evaluate(() => window.__workspaceRenderPending)).toBe(true);
  await page.evaluate(() => {
    window.scrollTo(0, 920);
    window.dispatchEvent(new WheelEvent("wheel", { deltaY: 280 }));
    window.__releaseWorkspaceRender();
  });
  await expect(page.getByText("Human–AI Shared Workspace")).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(920);
});

test("sync concluída respeita mudança da barra de scroll sem evento wheel", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.waitForFunction(() => typeof router === "function" && typeof WorkspaceStore !== "undefined");
  await page.evaluate(async () => {
    const buildSnapshot = WorkspaceStore.buildSnapshot.bind(WorkspaceStore);
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    window.__releaseWorkspaceRender = release;
    window.__workspaceRenderPending = false;
    WorkspaceStore.buildSnapshot = async (...args) => {
      if (!window.__workspaceRenderPending) {
        window.__workspaceRenderPending = true;
        await gate;
      }
      return buildSnapshot(...args);
    };
    document.getElementById("app").style.minHeight = "1800px";
    window.scrollTo(0, 640);
    window.dispatchEvent(new CustomEvent("visioncoach:sync-complete", { detail: { pulled: 1, pushed: 0, conflicts: [], deleted: 0 } }));
  });
  await expect.poll(() => page.evaluate(() => window.__workspaceRenderPending)).toBe(true);
  await page.evaluate(() => {
    window.dispatchEvent(new PointerEvent("pointerdown", { clientX: window.innerWidth - 1, clientY: 500, button: 0 }));
    window.scrollTo(0, 920);
    window.__releaseWorkspaceRender();
  });
  await expect(page.getByText("Human–AI Shared Workspace")).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(920);
});

test("sync concluída respeita touchmove recebido durante a atualização", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.waitForFunction(() => typeof router === "function" && typeof WorkspaceStore !== "undefined");
  await page.evaluate(async () => {
    const buildSnapshot = WorkspaceStore.buildSnapshot.bind(WorkspaceStore);
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    window.__releaseWorkspaceTouchRender = release;
    window.__workspaceTouchRenderPending = false;
    WorkspaceStore.buildSnapshot = async (...args) => {
      if (!window.__workspaceTouchRenderPending) {
        window.__workspaceTouchRenderPending = true;
        await gate;
      }
      return buildSnapshot(...args);
    };
    document.getElementById("app").style.minHeight = "1800px";
    window.scrollTo(0, 640);
    window.dispatchEvent(new CustomEvent("visioncoach:sync-complete", { detail: { pulled: 1, pushed: 0, conflicts: [], deleted: 0 } }));
  });
  await expect.poll(() => page.evaluate(() => window.__workspaceTouchRenderPending)).toBe(true);
  await page.evaluate(() => {
    window.scrollTo(0, 920);
    window.dispatchEvent(new Event("touchmove", { bubbles: true }));
    window.__releaseWorkspaceTouchRender();
  });
  await expect(page.getByText("Human–AI Shared Workspace")).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(920);
});

test("render do Workspace não repõe o scroll capturado se a barra mudar antes do frame", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.waitForFunction(() => typeof setView === "function");
  const finalScroll = await page.evaluate(() => {
    document.getElementById("app").style.minHeight = "1800px";
    const nativeFrame = window.requestAnimationFrame.bind(window);
    let queuedFrame;
    window.requestAnimationFrame = callback => { queuedFrame = callback; return 1; };
    window.scrollTo(0, 640);
    renderedViewRoute = location.hash || "#/";
    setView("Workspace", "<div style='height:1800px'>Workspace</div>");
    window.dispatchEvent(new PointerEvent("pointerdown", { clientX: window.innerWidth - 1, clientY: 500, button: 0 }));
    window.scrollTo(0, 920);
    window.requestAnimationFrame = nativeFrame;
    if (typeof queuedFrame !== "function") throw new Error("render frame was not queued");
    queuedFrame();
    return window.scrollY;
  });
  expect(finalScroll).toBe(920);
});

test("conflito antigo permite escolher valores por campo e bloqueia escolhas incompletas", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.waitForFunction(() => typeof RemoteWorkspace !== "undefined" && typeof router === "function" && typeof MCPConnectors !== "undefined");
  await page.evaluate(() => {
    RemoteWorkspace.status = async () => ({ configured: true, signedIn: true, email: "treinador@example.test", remoteTeamId: "team-test", conflicts: [{ store: "jogos", local_id: 12, sync_id: "match-manual", reason: "version_mismatch", expected_updated_at: "v1", remote_updated_at: "v2" }] });
    RemoteWorkspace.getConfig = () => ({ url: "https://example.supabase.co", publishableKey: "sb_publishable_test" });
    RemoteWorkspace.listTeams = async () => [{ id: "team-test", name: "Equipa de teste" }];
    MCPConnectors.list = async () => [];
    RemoteWorkspace.readVersionConflict = async (id, store) => ({
      sync_id: id, store, local_updated_at: "local-v2", remote_updated_at: "v2",
      local: { nota_tatica: "Versão PC", observacao: "Nota PC" },
      remote: { nota_tatica: "Versão telemóvel", observacao: "Nota telemóvel" },
      merge_unavailable: "Não existe versão comum guardada.",
      merge_suggestion: null,
      manual_merge_fields: [
        { key: "nota_tatica", local_present: true, remote_present: true, local_value: "Versão PC", remote_value: "Versão telemóvel" },
        { key: "observacao", local_present: true, remote_present: true, local_value: "Nota PC", remote_value: "Nota telemóvel" },
      ],
    });
    RemoteWorkspace.resolveVersionConflict = async (...args) => { window.__manualMergeResolution = args; return { conflicts: [] }; };
    go("#/definicoes");
  });
  await page.getByRole("button", { name: "Comparar versões" }).click();
  await expect(page.getByRole("heading", { name: "Escolher campo a campo" })).toBeVisible();
  await expect(page.locator("[data-manual-merge-field]")).toHaveCount(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  let alertMessage = "";
  page.once("dialog", async (dialog) => { alertMessage = dialog.message(); await dialog.accept(); });
  await page.getByRole("button", { name: "Aplicar escolhas e sincronizar" }).click();
  expect(alertMessage).toContain("Escolhe a versão para cada campo diferente");
  await page.locator('[data-manual-merge-field="nota_tatica"]').selectOption("local");
  await page.locator('[data-manual-merge-field="observacao"]').selectOption("remote");
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Aplicar escolhas e sincronizar" }).click();
  await expect.poll(() => page.evaluate(() => window.__manualMergeResolution)).toEqual([
    "match-manual", "jogos", "merge_manual_fields", "v2", "local-v2", { nota_tatica: "local", observacao: "remote" },
  ]);
});
});

test("IndexedDB recusa eliminação remota quando a ficha local mudou", async ({ page }) => {
  await page.goto("/");
  const outcome = await page.evaluate(async () => {
    const id = await DB.criar("jogos", {
      team_id: DEFAULT_TEAM_ID, adversario: "Rivais", data: "2026-10-06",
      sync_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", sync_dirty: false,
      remote_updated_at: "v1",
    }, { remote: true });
    const seen = await DB.obter("jogos", id);
    await DB.atualizar("jogos", { ...seen, nota_tatica: "Texto escrito durante o pull" });
    let errorCode = null;
    try { await DB.apagar("jogos", id, { remote: true, expected: seen }); }
    catch (error) { errorCode = error.code; }
    const retained = await DB.obter("jogos", id);
    return { errorCode, note: retained?.nota_tatica, dirty: retained?.sync_dirty };
  });
  expect(outcome).toEqual({
    errorCode: "LOCAL_DELETE_CHANGED", note: "Texto escrito durante o pull", dirty: true,
  });
});

test("service worker não recarrega enquanto existe formulário ou sessão em utilização", async ({ page }) => {
  await page.goto("/");
  await page.waitForFunction(() => typeof RemoteWorkspace !== "undefined");
  await page.waitForFunction(() => !!navigator.serviceWorker?.controller);
  await page.evaluate(() => {
    sessionStorage.setItem("vision-sw-reloaded-v95", "1");
    document.body.replaceChildren();
    const session = document.createElement("main");
    session.dataset.trainingSession = "42";
    const form = document.createElement("form");
    const field = document.createElement("textarea"); field.value = "texto por guardar"; form.append(field);
    session.append(form); document.body.append(session);
    navigator.serviceWorker.dispatchEvent(new Event("controllerchange"));
    navigator.serviceWorker.dispatchEvent(new Event("controllerchange"));
  });
  await expect(page.getByText(/Atualização disponível\. Termina ou guarda o trabalho em curso/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Atualizar app" })).toBeDisabled();
  await expect(page.locator("textarea")).toHaveValue("texto por guardar");
  expect(await page.evaluate(() => sessionStorage.getItem("vision-sw-reloaded-v167"))).toBeNull();
});

test("service worker update after an older cached reload does not stay suppressed", async ({ page }) => {
  await page.goto("/");
  await page.waitForFunction(() => !!navigator.serviceWorker?.controller);
  const reloaded = page.waitForEvent("framenavigated");
  void page.evaluate(() => {
    sessionStorage.setItem("vision-sw-reloaded-v95", "1");
    navigator.serviceWorker.dispatchEvent(new Event("controllerchange"));
  }).catch(() => {});
  await reloaded;
  await page.waitForLoadState("domcontentloaded");
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem("vision-sw-reloaded-v167"))).toBe("1");
});

test("estado do jogador condiciona convocatória e saída do plantel preserva registo", async ({ page }) => {
  await page.goto("/#/equipa/jogador/novo");
  await page.getByLabel("Nome").fill("Jogador Estado E2E");
  await page.getByLabel("Disponibilidade").selectOption("lesionado");
  await page.getByRole("button", { name: "Guardar", exact: true }).click();

  await expect(page.getByText("Lesionado", { exact: true })).toBeVisible();

  const ids = await page.evaluate(async () => {
    const player = (await DB.listar("jogadores")).find((row) => row.nome === "Jogador Estado E2E");
    const ref = stablePlayerRef(player);
    const matchId = await DB.criar("jogos", {
      team_id: DEFAULT_TEAM_ID,
      data: "2026-10-20",
      adversario: "Adversário E2E",
      estado: "agendado",
      callup: { status: "ready", player_ids: [ref], notes: null },
      lineup: { status: "draft", system: "1-2-1", goalkeeper_id: null, starters: [], substitutes: [ref] },
    });
    return { playerId: player.id, playerRef: ref, matchId };
  });

  await page.goto("/#/equipa/jogo/" + ids.matchId);
  await expect(page.getByText("Lesionado · não convocável", { exact: true })).toBeVisible();
  await expect(page.locator('input[name="player_ids"][disabled]')).toHaveCount(1);
  await expect(page.getByText(/deixaram de estar disponíveis/)).toBeVisible();

  await page.goto("/#/equipa/jogador/" + ids.playerId);
  page.on("dialog", async (dialog) => {
    if (dialog.type() === "prompt") await dialog.accept("Jogador Estado E2E");
    else await dialog.accept();
  });
  // Retirement preserves a record; permanent deletion is tested separately.
  await page.getByRole("button", { name: "Retirar do plantel", exact: true }).click();
  await expect.poll(() => page.evaluate(id => DB.obter("jogadores", id).then(p => p?.plantel_ativo), ids.playerId)).toBe(false);

  const stored = await page.evaluate(async ({ playerId, matchId, playerRef }) => {
    const player = await DB.obter("jogadores", playerId);
    const match = await DB.obter("jogos", matchId);
    return {
      inRoster: player.plantel_ativo !== false,
      retiredAt: player.retirado_em,
      stillCalled: (match.callup?.player_ids || []).map(String).includes(String(playerRef)),
      stillSubstitute: (match.lineup?.substitutes || []).map(String).includes(String(playerRef)),
    };
  }, ids);
  expect(stored.inRoster).toBe(false);
  expect(stored.retiredAt).toBeTruthy();
  expect(stored.stillCalled).toBe(false);
  expect(stored.stillSubstitute).toBe(false);
});

test("foto do atleta persiste na fila local antes de iniciar a sincronização remota", async ({ page }) => {
  await page.goto("/#/equipa/jogador/novo");
  await page.evaluate(() => {
    window.__photoSyncDelays = [];
    RemoteWorkspace.scheduleSync = (delay = 1400) => window.__photoSyncDelays.push(delay);
  });
  await page.getByLabel("Nome").fill("Foto Upload Recuperação E2E");
  await page.locator('input[name="foto_file"]').setInputFiles({
    name: "atleta.png",
    mimeType: "image/png",
    buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"),
  });
  await page.getByRole("button", { name: "Guardar", exact: true }).click();
  await expect(page).toHaveURL(/#\/equipa\/jogador\/\d+$/);
  await expect(page.locator("[data-player-photo-sync-status]")).toHaveAttribute("data-state", "pending");
  await expect(page.locator("[data-player-photo-sync-message]")).toHaveText("Fotografia guardada neste dispositivo; sincronização pendente.");
  await expect(page.locator("[data-player-photo-sync-link]")).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("visioncoach:sync-failed", { detail: { attempt: 1 } })));
  await expect(page.locator("[data-player-photo-sync-message]")).toHaveText("A fotografia continua guardada neste dispositivo. A sincronização falhou; consulta Definições.");
  const saved = await page.evaluate(async () => {
    const player = (await DB.listar("jogadores")).find((row) => row.nome === "Foto Upload Recuperação E2E");
    const media = await HeadCoachMedia.listForSubject("player", player.id);
    const displayed = (await applyPlayerProfilePhotos([player]))[0];
    return { photo: player.foto, displayedPhoto: displayed.foto, ref: player.profile_media_ref, media: media.find((item) => item.note === "Foto de perfil do atleta"), syncDelays: window.__photoSyncDelays };
  });
  expect(saved.photo).toBeNull();
  expect(saved.displayedPhoto).toMatch(/^data:image\/png;base64,/);
  await expect(page.locator(".hero-main .avatar img")).toHaveAttribute("src", /^data:image\/png;base64,/);
  expect(saved.media.data_url).toMatch(/^data:image\/png;base64,/);
  expect(saved.media.sync_dirty).toBe(true);
  expect(saved.ref).toBe(saved.media.sync_id);
  expect(saved.syncDelays).toContain(0);
});

test("editar atleta guarda e sincroniza foto grande de telemóvel sem duplicar em submissão repetida", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#/equipa");
  const playerId = await page.evaluate(async () => DB.criar("jogadores", {
    team_id: DEFAULT_TEAM_ID, nome: "Atleta Foto Telemóvel", numero: 8,
    estado_disponibilidade: "disponivel",
  }));
  await page.goto("/#/equipa/jogador/" + playerId + "/editar");
  await page.evaluate(() => {
    window.__photoSyncDelays = [];
    RemoteWorkspace.scheduleSync = (delay = 1400) => window.__photoSyncDelays.push(delay);
  });
  const largePhoto = await page.evaluate(() => new Promise((resolve, reject) => {
    const canvas = document.createElement("canvas");
    canvas.width = 1900; canvas.height = 1400;
    const context = canvas.getContext("2d"), pixels = context.createImageData(canvas.width, canvas.height);
    let seed = 123456789;
    for (let i = 0; i < pixels.data.length; i += 4) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      pixels.data[i] = seed & 255; pixels.data[i + 1] = (seed >>> 8) & 255;
      pixels.data[i + 2] = (seed >>> 16) & 255; pixels.data[i + 3] = 255;
    }
    context.putImageData(pixels, 0, 0);
    canvas.toBlob((blob) => {
      if (!blob) return reject(new Error("Falhou a criação da fotografia grande de teste."));
      const reader = new FileReader();
      reader.onload = () => resolve({ dataUrl: reader.result, size: blob.size });
      reader.onerror = () => reject(new Error("Falhou a leitura da fotografia de teste."));
      reader.readAsDataURL(blob);
    }, "image/png");
  }));
  expect(largePhoto.size).toBeGreaterThan(5 * 1024 * 1024);
  await page.locator('input[name="foto_file"]').setInputFiles({
    name: "foto-telemovel.png", mimeType: "image/png",
    buffer: Buffer.from(largePhoto.dataUrl.split(",")[1], "base64"),
  });
  await page.evaluate(() => {
    const form = document.querySelector('form[data-form="player"]');
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  await expect(page).toHaveURL(new RegExp("#/equipa/jogador/" + playerId + "$"));
  const saved = await page.evaluate(async (id) => {
    const player = await DB.obter("jogadores", id);
    const media = await HeadCoachMedia.listForSubject("player", id);
    const displayed = (await applyPlayerProfilePhotos([player]))[0];
    return { player, displayedPhoto: displayed.foto, media: media.find((item) => item.note === "Foto de perfil do atleta"), profilePhotoCount: media.filter((item) => item.note === "Foto de perfil do atleta").length, syncDelays: window.__photoSyncDelays };
  }, playerId);
  expect(saved.player.foto).toBeNull();
  expect(saved.displayedPhoto, JSON.stringify({ player: saved.player, media: saved.media && { mime_type: saved.media.mime_type, size: saved.media.size, dirty: saved.media.sync_dirty }, delays: saved.syncDelays })).toMatch(/^data:image\/jpeg;base64,/);
  expect(saved.player.sync_dirty).toBe(true);
  expect(saved.media.data_url).toMatch(/^data:image\/jpeg;base64,/);
  expect(saved.media.size).toBeLessThan(5 * 1024 * 1024);
  expect(saved.media.sync_dirty).toBe(true);
  expect(saved.profilePhotoCount).toBe(1);
  expect(saved.player.profile_media_ref).toBe(saved.media.sync_id);
  expect(saved.syncDelays).toContain(0);
});

test("foto grande guarda em telemóvel sem createImageBitmap e fica abaixo do limite sincronizável", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#/equipa/jogador/novo");
  await page.evaluate(() => Object.defineProperty(window, "createImageBitmap", { configurable: true, value: undefined }));
  await page.getByLabel("Nome").fill("Foto Sem Bitmap E2E");
  const largePhoto = await page.evaluate(() => new Promise((resolve, reject) => {
    const canvas = document.createElement("canvas"); canvas.width = 1900; canvas.height = 1400;
    const context = canvas.getContext("2d"), pixels = context.createImageData(canvas.width, canvas.height);
    let seed = 987654321;
    for (let i = 0; i < pixels.data.length; i += 4) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      pixels.data[i] = seed & 255; pixels.data[i + 1] = (seed >>> 8) & 255;
      pixels.data[i + 2] = (seed >>> 16) & 255; pixels.data[i + 3] = 255;
    }
    context.putImageData(pixels, 0, 0);
    canvas.toBlob(blob => {
      if (!blob) return reject(new Error("Falhou a imagem de teste."));
      const reader = new FileReader(); reader.onload = () => resolve({ dataUrl: reader.result, size: blob.size });
      reader.onerror = () => reject(new Error("Falhou a leitura da imagem de teste.")); reader.readAsDataURL(blob);
    }, "image/png");
  }));
  expect(largePhoto.size).toBeGreaterThan(5 * 1024 * 1024);
  await page.locator('input[name="foto_file"]').setInputFiles({
    name: "foto-sem-bitmap.png", mimeType: "image/png", buffer: Buffer.from(largePhoto.dataUrl.split(",")[1], "base64"),
  });
  await page.getByRole("button", { name: "Guardar", exact: true }).click();
  await expect(page).toHaveURL(/#\/equipa\/jogador\/\d+$/);
  const saved = await page.evaluate(async () => {
    const player = (await DB.listar("jogadores")).find(row => row.nome === "Foto Sem Bitmap E2E");
    const media = await HeadCoachMedia.listForSubject("player", player.id);
    const photo = media.find(item => item.note === "Foto de perfil do atleta");
    const displayed = (await applyPlayerProfilePhotos([player]))[0];
    return { player, displayedPhoto: displayed.foto, photo };
  });
  expect(saved.player.foto).toBeNull();
  expect(saved.displayedPhoto).toMatch(/^data:image\/jpeg;base64,/);
  await expect(page.locator(".hero-main .avatar img")).toHaveAttribute("src", /^data:image\/jpeg;base64,/);
  expect(saved.photo.size).toBeLessThan(5 * 1024 * 1024);
  expect(saved.photo.sync_dirty).toBe(true);
});
