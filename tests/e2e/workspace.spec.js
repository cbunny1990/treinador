"use strict";

const { test, expect } = require("@playwright/test");

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
        req.result.createObjectStore("jogadores", { keyPath: "id", autoIncrement: true });
      };
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction("jogadores", "readwrite");
        tx.objectStore("jogadores").add({ nome: "Jogador legado", escalao: "sub-8" });
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
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
    return {
      version: db.version,
      teamId: players[0].team_id,
      stores: Array.from(db.objectStoreNames),
    };
  });

  expect(migrated.version).toBe(9);
  expect(migrated.teamId).toBe("default");
  expect(migrated.stores).toContain("workspace_documents");
  expect(migrated.stores).toContain("activity_items");
  expect(migrated.stores).toContain("sync_tombstones");

  await page.locator('.bottom-nav a[href="#/equipa"]').click();
  await expect(page.getByText("Jogador legado")).toBeVisible();

  await page.evaluate(() => navigator.serviceWorker.ready);
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByText("Jogador legado")).toBeVisible();
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

test("cria plano partilhado e associa media", async ({ page }) => {
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
});

test("agente e humano escrevem no mesmo workspace com autoria separada", async ({ page }) => {
  await page.goto("/");
  const docId = await page.evaluate(async () => {
    return AgentWorkspaceAPI.createDocument({
      team_id: "default",
      type: "match_analysis",
      title: "Análise criada pelo agente",
      body: "Padrão observado: dificuldade em encontrar apoio exterior.",
      status: "ready",
      agent_label: "Head Coach",
    });
  });

  await page.goto("/#/planos/" + docId);
  await expect(page.locator("#app").getByRole("heading", { name: "Análise criada pelo agente" })).toBeVisible();
  await expect(page.getByText("Head Coach", { exact: true })).toBeVisible();

  await page.getByRole("link", { name: "Editar" }).click();
  await page.getByLabel("Conteúdo").fill("Padrão revisto pelo treinador: faltou apoio exterior e profundidade.");
  await page.getByRole("button", { name: "Guardar documento" }).click();
  await expect(page.getByText(/última alteração por Treinador/)).toBeVisible();

  await page.goto("/#/timeline");
  await expect(page.getByText(/Criou análise de jogo/)).toBeVisible();
  await expect(page.getByText(/Atualizou análise de jogo/)).toBeVisible();
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
  for (const href of ["#/", "#/equipa", "#/planos", "#/media", "#/timeline"]) {
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

test("alteração offline recebe UUID e eliminação cria tombstone", async ({ page }) => {
  await page.goto("/");
  const state = await page.evaluate(async () => {
    const id = await DB.criar("jogadores", {
      team_id: DEFAULT_TEAM_ID,
      nome: "Sync Offline",
      escalao: "sub-8",
    });
    const row = await DB.obter("jogadores", id);
    await DB.apagar("jogadores", id);
    const syncedId = await DB.criar("jogadores", {
      team_id: DEFAULT_TEAM_ID,
      nome: "Sync com versão",
      escalao: "sub-8",
      sync_id: "22222222-2222-4222-8222-222222222222",
      sync_dirty: false,
      remote_updated_at: "2026-09-21T12:00:00.000Z",
    }, { remote: true });
    await DB.apagar("jogadores", syncedId);
    return {
      syncId: row.sync_id,
      dirty: row.sync_dirty,
      tombstones: await DB.listar("sync_tombstones"),
    };
  });
  expect(state.syncId).toMatch(/^[0-9a-f-]{36}$/i);
  expect(state.dirty).toBe(true);
  expect(state.tombstones).toHaveLength(2);
  expect(state.tombstones[0].sync_id).toBe(state.syncId);
  expect(state.tombstones[1].expected_updated_at).toBe("2026-09-21T12:00:00.000Z");
});
