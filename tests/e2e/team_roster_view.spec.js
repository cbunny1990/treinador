"use strict";

const { test, expect } = require("@playwright/test");

test("página da equipa lê o perfil e plantel sem construir snapshots do histórico", async ({ page }) => {
  await page.goto("/");
  await page.waitForFunction(() => typeof DB !== "undefined" && typeof WorkspaceStore !== "undefined");
  await page.evaluate(async () => {
    RemoteWorkspace.scheduleSync = () => {};
    await HeadCoachMemory.saveTeam({ nome: "Sub-8 Figueirense", clube: "Figueiro", escalao: "sub-8", formato: "5v5" });
    await DB.criar("jogadores", { team_id: DEFAULT_TEAM_ID, sync_id: crypto.randomUUID(), nome: "Atleta do plantel", numero: 8, plantel_ativo: true, estado_disponibilidade: "disponivel" });
    window.teamViewSnapshotCalls = 0;
    WorkspaceStore.buildSnapshot = async () => { window.teamViewSnapshotCalls++; throw new Error("A página da equipa não deve carregar o snapshot global."); };
    const read = DB.porIndice.bind(DB);
    DB.porIndice = function (store, ...args) {
      if (["jogos", "treinos", "memory_items", "workspace_documents"].includes(store)) throw new Error("A página da equipa tentou ler histórico: " + store);
      return read(store, ...args);
    };
    location.hash = "#/equipa";
  });

  await expect(page.locator(".hero-main h2")).toHaveText("Sub-8 Figueirense");
  await expect(page.getByRole("heading", { name: "Plantel", exact: true })).toBeVisible();
  await expect(page.getByText("Atleta do plantel")).toBeVisible();
  expect(await page.evaluate(() => window.teamViewSnapshotCalls)).toBe(0);
});
