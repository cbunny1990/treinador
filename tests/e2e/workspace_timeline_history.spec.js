"use strict";

const { test, expect } = require("@playwright/test");

test("Timeline mantém os 100 itens recentes sem carregar históricos completos", async ({ page }) => {
  await page.goto("/#/calendario");
  await expect(page.getByRole("heading", { name: "Calendário", exact: true })).toBeVisible();
  const fixture = await page.evaluate(async () => {
    RemoteWorkspace.scheduleSync = () => {};
    const payload = Array.from({ length: 80 }, (_, i) => ({ note: "payload de histórico não apresentado " + i }));
    let latestMatchId;
    const counts = {};
    for (let i = 0; i < 120; i++) {
      const date = new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10);
      const created = date + "T12:00:00.000Z";
      await DB.criar("activity_items", { team_id: DEFAULT_TEAM_ID, actor: "human", actor_label: "Treinador", action: "updated", summary: "Atividade " + i, entity_type: "match", entity_id: "match-" + i, metadata: { _vision_coach_unresolved_origin: { store: "jogos", sync_id: "match-" + i }, payload }, created_at: created });
      await DB.criar("workspace_documents", { team_id: DEFAULT_TEAM_ID, type: "training_plan", title: "Documento " + i, body: JSON.stringify(payload), status: "ready", created_at: created, updated_at: created });
      await DB.criar("memory_items", { team_id: DEFAULT_TEAM_ID, sync_id: crypto.randomUUID(), kind: "observation", title: "Observação " + i, content: JSON.stringify(payload), status: "active", occurred_at: date, created_at: created, source: { label: "Treinador" }, metadata: { actor: "human", actor_label: "Treinador", payload } });
      const matchId = await DB.criar("jogos", { team_id: DEFAULT_TEAM_ID, sync_id: crypto.randomUUID(), data: date, adversario: "Jogo " + i, notas: payload });
      await DB.criar("treinos", { team_id: DEFAULT_TEAM_ID, sync_id: crypto.randomUUID(), data: date, escalao: "sub-8", review: payload });
      if (i === 119) latestMatchId = matchId;
    }
    await DB.criar("workspace_documents", { team_id: DEFAULT_TEAM_ID, type: "legacy", title: "Documento sem estado", created_at: "2028-01-01T00:00:00.000Z", updated_at: "2028-01-01T00:00:00.000Z" });
    await DB.criar("workspace_documents", { team_id: DEFAULT_TEAM_ID, type: "legacy", title: "Documento com estado legado", status: "legacy_pending", created_at: "2027-12-31T00:00:00.000Z", updated_at: "2027-12-31T00:00:00.000Z" });
    await DB.criar("workspace_documents", { team_id: DEFAULT_TEAM_ID, type: "training_plan", title: "Documento arquivado", status: "archived", created_at: "2030-01-01T00:00:00.000Z", updated_at: "2030-01-01T00:00:00.000Z" });
    await DB.criar("memory_items", { team_id: DEFAULT_TEAM_ID, sync_id: crypto.randomUUID(), kind: "observation", title: "Memória arquivada", content: "não mostrar", status: "archived", occurred_at: "2030-01-01", created_at: "2030-01-01T00:00:00.000Z" });
    window.timelineCursorCounts = counts;
    const cursor = DB.percorrerIndice.bind(DB);
    DB.percorrerIndice = function (store, ...args) {
      if (["activity_items", "workspace_documents", "memory_items", "jogos", "treinos"].includes(store)) throw new Error("A Timeline percorreu o histórico completo: " + store);
      return cursor(store, ...args);
    };
    const recent = DB.percorrerEquipaMaisRecentes.bind(DB);
    DB.percorrerEquipaMaisRecentes = (store, team, limit, visit, status) => {
      const key = store + (status ? ":" + status : "");
      return recent(store, team, limit, visit, status).then((count) => { window.timelineCursorCounts[key] = count; return count; });
    };
    const read = DB.porIndice.bind(DB);
    DB.porIndice = function (store, ...args) {
      if (["activity_items", "workspace_documents", "memory_items", "jogos", "treinos"].includes(store)) throw new Error("A Timeline tentou materializar o histórico: " + store);
      return read(store, ...args);
    };
    WorkspaceStore.buildSnapshot = async () => { throw new Error("A Timeline não deve construir o snapshot global."); };
    location.hash = "#/timeline";
    return { latestMatchId };
  });

  await expect(page.getByRole("heading", { name: "Histórico do workspace", exact: true })).toBeVisible();
  await expect(page.locator(".timeline-item")).toHaveCount(100);
  await expect(page.getByText("Jogo · Jogo 119")).toBeVisible();
  await expect(page.getByText("Jogo · Jogo 99", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Documento arquivado")).toHaveCount(0);
  await expect(page.getByText("Documento sem estado", { exact: true })).toBeVisible();
  await expect(page.getByText("Documento com estado legado", { exact: true })).toBeVisible();
  await expect(page.getByText("Memória arquivada")).toHaveCount(0);
  await expect(page.getByText("payload de histórico não apresentado", { exact: false })).toHaveCount(0);
  await expect(page.locator('.timeline-item a[href="#/equipa/jogo/' + fixture.latestMatchId + '"]')).toBeVisible();
  const counts = await page.evaluate(() => window.timelineCursorCounts);
  expect(counts).toEqual({
    activity_items: 50,
    "workspace_documents:visible": 100,
    "memory_items:active": 100,
    jogos: 100,
    treinos: 100,
  });
});
