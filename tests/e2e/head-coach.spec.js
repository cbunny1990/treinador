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
  expect(migrated).toEqual({ version: 7, teamId: "default" });

  await page.getByRole("link", { name: /Memória da equipa/ }).click();
  await expect(page.getByRole("heading", { name: "Head Coach" })).toBeVisible();
  await page.getByRole("link", { name: "Memória", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Memória da equipa" })).toBeVisible();
  await page.getByRole("link", { name: "+ Registar" }).click();
  await page.getByLabel("Título").fill("Saída da zona defensiva");
  await page.getByLabel("Conteúdo *").fill("A equipa acumulou jogadores junto do guarda-redes.");
  await page.getByLabel("Prioridade do Head Coach").selectOption("1");
  await page.getByRole("button", { name: "Guardar", exact: true }).click();
  await expect(page.getByText("A equipa acumulou jogadores junto do guarda-redes.")).toBeVisible();
  await expect(page.getByText("Observação", { exact: true }).first()).toBeVisible();

  await page.getByRole("link", { name: "Rever", exact: true }).click();
  await page.getByLabel("Conteúdo *").fill("A equipa acumulou quatro jogadores junto do guarda-redes.");
  await page.getByRole("button", { name: "Guardar revisão" }).click();
  await expect(page.getByText("A equipa acumulou quatro jogadores junto do guarda-redes.")).toBeVisible();
  const revisions = await page.evaluate(async () => (await DB.listar("memory_items")).map((x) => x.status).sort());
  expect(revisions).toEqual(["active", "superseded"]);

  await page.goto("/#/head-coach");
  await page.evaluate(() => navigator.serviceWorker.ready);
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Head Coach" })).toBeVisible();
  await expect(page.getByText("Saída da zona defensiva").first()).toBeVisible();
  await expect(page.getByText("Prioridade definida")).toBeVisible();
});

test("importa pacote privado sintético por merge", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: /Memória da equipa/ }).click();
  await page.getByRole("link", { name: "Memória", exact: true }).click();
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
  await page.goto("/#/head-coach");
  await expect(page.getByRole("heading", { name: "Head Coach" })).toBeVisible();
  await expect(page.getByText("Equipa sintética")).toBeVisible();
  await expect(page.getByText("Jogador sintético")).toBeVisible();
});

test("fecha ciclo de aprendizagem pela interface", async ({ page }) => {
  await page.goto("/#/head-coach/memoria/novo");
  await page.getByLabel("Título").fill("Pressão na saída");
  await page.getByLabel("Conteúdo *").fill("A equipa perde referências quando é pressionada.");
  await page.getByRole("button", { name: "Guardar", exact: true }).click();

  await page.getByRole("link", { name: /Diagnóstico/ }).click();
  await expect(page.getByLabel("Classificação *")).toHaveValue("diagnosis");
  await expect(page.locator('input[name="evidence_ids"]:checked')).toHaveCount(1);
  await page.getByLabel("Título").fill("Dificuldade de saída sob pressão");
  await page.getByLabel("Conteúdo *").fill("A equipa não cria linhas de passe suficientes.");
  await page.getByRole("button", { name: "Guardar", exact: true }).click();

  await page.getByRole("link", { name: /Decisão/ }).click();
  await page.getByLabel("Título").fill("Trabalhar largura e apoios");
  await page.getByLabel("Conteúdo *").fill("Priorizar saída apoiada no próximo treino.");
  await page.getByRole("button", { name: "Guardar", exact: true }).click();

  await page.getByRole("link", { name: /Intervenção/ }).click();
  await page.getByLabel("Título").fill("Exercício 3x2");
  await page.getByLabel("Conteúdo *").fill("Executado exercício 3x2 com largura.");
  await page.getByRole("button", { name: "Guardar", exact: true }).click();

  await page.getByRole("link", { name: /Resultado/ }).click();
  await page.getByLabel("Título").fill("Melhoria na saída");
  await page.getByLabel("Conteúdo *").fill("A equipa saiu com sucesso em 8 de 10 tentativas.");
  await page.getByRole("button", { name: "Guardar", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Resultado" })).toBeVisible();

  await page.goto("/#/head-coach/ciclos");
  await expect(page.getByRole("heading", { name: "Ciclos de aprendizagem" })).toBeVisible();
  await expect(page.getByText("Concluído")).toBeVisible();
  await expect(page.getByText("A equipa saiu com sucesso em 8 de 10 tentativas.")).toBeVisible();
});

test("associa vídeo por link a um jogo", async ({ page }) => {
  await page.goto("/");
  const jogoId = await page.evaluate(async () => DB.criar("jogos", {
    team_id: "default", data: "2026-09-20", escalao: "sub-8",
    adversario: "Teste Media", casa_fora: "casa", golos_favor: 2, golos_contra: 1,
  }));
  await page.goto("/#/jogos/" + jogoId);
  await page.getByRole("link", { name: "+ Associar" }).click();
  await page.getByLabel("Tipo *").selectOption("video");
  await page.getByLabel("Título").fill("Lance da saída");
  await page.locator('input[name="url"]').fill("https://example.com/video-teste");
  await page.getByLabel("Nota").fill("Rever ocupação da largura.");
  await page.getByRole("button", { name: "Guardar media" }).click();
  await expect(page.getByText("Lance da saída")).toBeVisible();
  const media = await page.evaluate(async () => DB.listar("media_items"));
  expect(media).toHaveLength(1);
  expect(media[0].subject_type).toBe("match");
  expect(media[0].type).toBe("video");
});
