"use strict";

const { test, expect } = require("@playwright/test");

async function seedV3(page) {
  await page.goto("/nao-existe");
  await page.evaluate(async () => {
    await new Promise((resolve, reject) => {
      const del = indexedDB.deleteDatabase("treinador");
      del.onsuccess = resolve; del.onerror = () => reject(del.error); del.onblocked = resolve;
    });
    await new Promise((resolve, reject) => {
      const req = indexedDB.open("treinador", 3);
      req.onupgradeneeded = () => req.result.createObjectStore("jogadores", { keyPath: "id", autoIncrement: true });
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction("jogadores", "readwrite");
        tx.objectStore("jogadores").add({ nome: "Jogador de teste", escalao: "sub-8" });
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
      };
      req.onerror = () => reject(req.error);
    });
  });
}

test("migra v3, gere memória e continua offline", async ({ page, context }) => {
  await seedV3(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Início" })).toBeVisible();

  const migrated = await page.evaluate(async () => {
    const players = await DB.listar("jogadores");
    return { version: (await abrirDB()).version, teamId: players[0].team_id };
  });
  expect(migrated).toEqual({ version: 4, teamId: "default" });

  await page.getByRole("link", { name: /Memória da equipa/ }).click();
  await expect(page.getByRole("heading", { name: "Memória da equipa" })).toBeVisible();
  await page.getByRole("link", { name: "+ Registar" }).click();
  await page.getByLabel("Título").fill("Saída da zona defensiva");
  await page.getByLabel("Conteúdo *").fill("A equipa acumulou jogadores junto do guarda-redes.");
  await page.getByRole("button", { name: "Guardar", exact: true }).click();
  await expect(page.getByText("A equipa acumulou jogadores junto do guarda-redes.")).toBeVisible();
  await expect(page.getByText("Observação", { exact: true }).first()).toBeVisible();

  await page.getByRole("link", { name: "Criar revisão" }).click();
  await page.getByLabel("Conteúdo *").fill("A equipa acumulou quatro jogadores junto do guarda-redes.");
  await page.getByRole("button", { name: "Guardar revisão" }).click();
  await expect(page.getByText("A equipa acumulou quatro jogadores junto do guarda-redes.")).toBeVisible();
  const revisions = await page.evaluate(async () => (await DB.listar("memory_items")).map((x) => x.status).sort());
  expect(revisions).toEqual(["active", "superseded"]);

  await page.goto("/#/head-coach");
  await page.evaluate(() => navigator.serviceWorker.ready);
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Memória da equipa" })).toBeVisible();
  await expect(page.getByText("Saída da zona defensiva")).toBeVisible();
});

test("importa pacote privado sintético por merge", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: /Memória da equipa/ }).click();
  await expect(page.getByRole("heading", { name: "Memória da equipa" })).toBeVisible();
  page.on("dialog", (dialog) => dialog.accept());
  const pack = {
    schema: "treinador-team-memory@1",
    team: { id: "default", nome: "Equipa sintética", escalao: "sub-8" },
    players: [{ external_key: "teste-1", nome: "Jogador sintético", escalao: "sub-8" }],
    memory_items: [{ external_key: "obs-teste-1", content: "Observação sintética.", subject_refs: [{ type: "player", id: "teste-1" }] }],
  };
  await page.locator('input[data-action="importar-equipa"]').setInputFiles({
    name: "equipa.private.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(pack)),
  });
  await expect(page.getByText("Equipa sintética")).toBeVisible();
  await expect(page.getByText("Observação sintética.")).toBeVisible();
});
