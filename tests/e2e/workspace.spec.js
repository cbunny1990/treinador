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

  expect(migrated.version).toBe(10);
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
  await page.getByRole("button", { name: "Guardar plano" }).click();
  await page.getByRole("link", { name: "Editar dados" }).click();
  await page.getByLabel("Local").fill("Campo Teste 2");
  await page.getByRole("button", { name: "Guardar jogo" }).click();

  const stored = await page.evaluate(async () => {
    const games = await DB.listar("jogos");
    return games.find((x) => x.adversario === "Teste E2E");
  });
  expect(stored.pre_game.objetivo_principal).toBe("Circular rápido e abrir o campo");
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


test("Planos sincroniza documentos remotos antes de renderizar", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(async () => {
    window.__remoteSyncCalls = 0;
    RemoteWorkspace.status = async () => ({
      configured: true,
      signedIn: true,
      remoteTeamId: "845aceb7-3350-4e52-9b5e-5279132d3ae9",
      lastSyncAt: null,
      conflicts: [],
    });
    RemoteWorkspace.syncNow = async () => {
      window.__remoteSyncCalls += 1;
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
      return { pushed: 0, pulled: 1, conflicts: [], deleted: 0 };
    };
    location.hash = "#/planos";
    await router();
  });

  await expect(page.getByText("Relatório remoto de teste")).toBeVisible();
  expect(await page.evaluate(() => window.__remoteSyncCalls)).toBeGreaterThan(0);
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
