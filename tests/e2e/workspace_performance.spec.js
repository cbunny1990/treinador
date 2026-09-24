"use strict";

const { test, expect } = require("@playwright/test");

test("resumo operacional do Workspace mantém consultas limitadas com 15 mil registos", async ({ page }) => {
  await page.goto("/");
  const cpu = await page.context().newCDPSession(page);
  await cpu.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  await page.waitForFunction(() => typeof WorkspaceStore !== "undefined" && typeof DB !== "undefined");
  const result = await page.evaluate(async () => {
    RemoteWorkspace.scheduleSync = () => {};
    const today = new Date().toISOString().slice(0, 10);
    const offset = (date, days) => {
      const value = new Date(date + "T12:00:00Z");
      value.setUTCDate(value.getUTCDate() + days);
      return value.toISOString().slice(0, 10);
    };
    const db = await abrirDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(["jogos", "treinos"], "readwrite");
      const matches = tx.objectStore("jogos"), trainings = tx.objectStore("treinos");
      for (let i = 0; i < 7500; i++) {
        const date = offset(today, -i - 1);
        matches.add({ team_id: DEFAULT_TEAM_ID, data: date, estado: "concluido", operational_proposal_status: null });
        trainings.add({ team_id: DEFAULT_TEAM_ID, data: date, status: "completed", review: { status: "done" }, operational_needs_review: "not_pending", operational_proposal_status: null });
      }
      matches.add({
        team_id: DEFAULT_TEAM_ID, sync_id: crypto.randomUUID(), data: offset(today, -1), estado: "concluido",
        post_game: { analysis: { revision: 0, fields: {}, agent_proposal: { status: "proposed", source_analysis_revision: 1, source_events_revision: 0, evidence_ids: [] } } },
        operational_proposal_status: "proposed",
      });
      matches.add({ team_id: DEFAULT_TEAM_ID, data: offset(today, 1), adversario: "Próximo jogo grande histórico", estado: "agendado", operational_proposal_status: null });
      trainings.add({ team_id: DEFAULT_TEAM_ID, data: offset(today, -1), status: "completed", review: { status: "pending" }, operational_needs_review: "pending", operational_proposal_status: null });
      trainings.add({ team_id: DEFAULT_TEAM_ID, data: offset(today, -2), status: "completed", review: { status: "done" }, continuity: { proposal: { status: "draft", objective: "Proposta histórica" } }, operational_needs_review: "not_pending", operational_proposal_status: "draft" });
      trainings.add({ team_id: DEFAULT_TEAM_ID, data: offset(today, 2), objetivo: "Próximo treino grande histórico", status: "ready", session: { status: "planned" }, operational_needs_review: "not_pending", operational_proposal_status: null });
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error("Não foi possível semear o teste de desempenho."));
    });
    const walk = DB.percorrerIndice.bind(DB);
    DB.percorrerIndice = (store, ...args) => {
      if (store === "jogos" || store === "treinos") throw new Error("O resumo não pode percorrer a coleção completa de " + store + ".");
      return walk(store, ...args);
    };
    const counts = {};
    const first = DB.primeiroIntervaloEquipa.bind(DB);
    DB.primeiroIntervaloEquipa = (store, team, from, predicate) => first(store, team, from, row => {
      const key = "next_" + store;
      counts[key] = (counts[key] || 0) + 1;
      return predicate(row);
    });
    const byValue = DB.percorrerValorEquipa.bind(DB);
    DB.percorrerValorEquipa = (store, index, team, value, visit) => byValue(store, index, team, value, row => {
      const key = store + "_" + index;
      counts[key] = (counts[key] || 0) + 1;
      visit(row);
    });
    const started = performance.now();
    const summary = await WorkspaceStore.summarizeOperationalRecords(DEFAULT_TEAM_ID, today);
    const summaryMs = performance.now() - started;
    const summaryCounts = { ...counts };
    Object.keys(counts).forEach(key => delete counts[key]);
    const snapshotStarted = performance.now();
    const snapshot = await WorkspaceStore.buildSnapshot(DEFAULT_TEAM_ID, {
      includeArchivedDocuments: true, countMediaOnly: true, includeTimeline: false, compactOperationalRecords: true,
    });
    return {
      summaryMs,
      snapshotMs: performance.now() - snapshotStarted,
      nextMatch: summary.next_match?.adversario,
      nextTraining: summary.next_training?.objetivo,
      snapshotNextMatch: snapshot.next_match?.adversario,
      snapshotNextTraining: snapshot.next_training?.objetivo,
      pendingReviews: summary.pending_reviews_count,
      pendingTrainingProposals: summary.pending_training_proposals.length,
      staleMatchProposals: summary.stale_match_proposals.length,
      counts: summaryCounts,
      snapshotCounts: counts,
    };
  });

  expect(result).toMatchObject({
    nextMatch: "Próximo jogo grande histórico",
    nextTraining: "Próximo treino grande histórico",
    snapshotNextMatch: "Próximo jogo grande histórico",
    snapshotNextTraining: "Próximo treino grande histórico",
    pendingReviews: 1,
    pendingTrainingProposals: 1,
    staleMatchProposals: 1,
    counts: {
      next_jogos: 1, next_treinos: 1, jogos_team_proposal_status: 1,
      treinos_team_completed_review: 1, treinos_team_proposal_status: 1,
    },
  });
  expect(result.snapshotCounts).toEqual(result.counts);
  console.log(`Workspace, 15,006 synthetic rows, CPU throttle 4×: summary ${result.summaryMs.toFixed(2)} ms; full compact snapshot ${result.snapshotMs.toFixed(2)} ms (browser-local measurements)`);
});
