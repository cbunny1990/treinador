"use strict";

const { test, expect } = require("@playwright/test");

test("Definições calcula métricas sem construir um snapshot dos históricos", async ({ page }) => {
  await page.goto("/");
  await page.waitForFunction(() => typeof DB !== "undefined" && typeof WorkspaceStore !== "undefined");
  await page.evaluate(async () => {
    RemoteWorkspace.scheduleSync = () => {};
    for (const [name, active] of [["Ativo A", true], ["Ativo B", true], ["Retirado", false]]) {
      await DB.criar("jogadores", { team_id: DEFAULT_TEAM_ID, sync_id: crypto.randomUUID(), nome: name, plantel_ativo: active });
    }
    for (const [title, status] of [["Plano A", "ready"], ["Plano B", "draft"], ["Arquivo", "archived"]]) {
      await DB.criar("workspace_documents", { team_id: DEFAULT_TEAM_ID, sync_id: crypto.randomUUID(), type: "training_plan", title, body: "{}", status });
    }
    for (let i = 0; i < 3; i++) await DB.criar("media_items", { team_id: DEFAULT_TEAM_ID, sync_id: crypto.randomUUID(), type: "photo", title: "Media " + i });
    for (let i = 0; i < 55; i++) await DB.criar("activity_items", { team_id: DEFAULT_TEAM_ID, actor: "human", actor_label: "Treinador", action: "updated", summary: "Atividade " + i });
    window.settingsCursorCounts = { jogadores: 0, workspace_documents: 0, activity_items: 0 };
    const cursor = DB.percorrerIndice.bind(DB);
    DB.percorrerIndice = function (store, ...args) {
      return cursor(store, ...args).then((count) => { if (store in window.settingsCursorCounts) window.settingsCursorCounts[store] = count; return count; });
    };
    const read = DB.porIndice.bind(DB);
    DB.porIndice = function (store, ...args) {
      if (["jogos", "treinos", "memory_items"].includes(store)) throw new Error("Definições tentou carregar o histórico: " + store);
      return read(store, ...args);
    };
    WorkspaceStore.buildSnapshot = async () => { throw new Error("Definições não deve construir um snapshot global."); };
    location.hash = "#/definicoes";
  });

  await expect(page.getByRole("heading", { name: "Definições", exact: true })).toBeVisible();
  const metricValue = label => page.locator(".metric").filter({ hasText: label }).locator(".metric-value");
  await expect(metricValue("Jogadores")).toHaveText("2");
  await expect(metricValue("Documentos")).toHaveText("2");
  await expect(metricValue("Media")).toHaveText("3");
  await expect(metricValue("Atividade")).toHaveText("50");
  const counts = await page.evaluate(() => window.settingsCursorCounts);
  expect(counts.jogadores).toBe(3);
  expect(counts.workspace_documents).toBe(3);
  expect(counts.activity_items).toBe(55);
});
