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
  }));
  await page.goto("/");
  const queue = page.getByRole("heading", { name: /Planos por aprovar/ }).locator("xpath=..");
  await expect(queue).toContainText("1");
  await expect(queue.getByRole("link", { name: /Plano por aprovar E2E/ })).toHaveAttribute("href", "#/planos/" + id);
});

test("Workspace includes Head Coach team priority proposals in the review queue", async ({ page }) => {
  await page.goto("/#/calendario");
  await page.waitForFunction(() => typeof DB !== "undefined");
  await page.evaluate(() => DB.criar("workspace_documents", {
    team_id: DEFAULT_TEAM_ID, type: "team_goal", title: "Apoio após passe E2E",
    body: JSON.stringify({
      schema: "vision-team-goal@1", revision: 1, stage: "identified",
      title: "Apoio após passe", agent_proposal: {
        status: "proposed", rationale: "Evidências de jogo e treino para rever.",
        evidence_refs: [], prepared_by: "Head Coach",
      },
    }),
    status: "draft", sync_id: crypto.randomUUID(), external_key: "team-priority-queue-e2e",
  }));
  await page.goto("/");
  const queue = page.getByRole("heading", { name: /Propostas por rever/ }).locator("xpath=..");
  await expect(queue).toContainText("1");
  await expect(queue.getByRole("link", { name: /Apoio após passe/ })).toHaveAttribute("href", "#/evolucao");
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

test("sync do Workspace corre em fundo, atualiza a vista uma vez e preserva o scroll", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByText("Human–AI Shared Workspace")).toBeVisible();
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
});

test("conflito de edição compara as duas versões antes de permitir uma decisão", async ({ page }) => {
  await page.goto("/");
  await page.waitForFunction(() => typeof RemoteWorkspace !== "undefined" && typeof router === "function");
  await page.evaluate(() => {
    RemoteWorkspace.status = async () => ({ configured: true, signedIn: true, email: "treinador@example.test", remoteTeamId: "team-test", conflicts: [{ store: "jogos", local_id: 12, sync_id: "match-conflict", reason: "version_mismatch", expected_updated_at: "v1", remote_updated_at: "v2" }] });
    RemoteWorkspace.getConfig = () => ({ url: "https://example.supabase.co", publishableKey: "sb_publishable_test" });
    RemoteWorkspace.listTeams = async () => [{ id: "team-test", name: "Equipa de teste" }];
    MCPConnectors.list = async () => [];
    RemoteWorkspace.readVersionConflict = async (id, store) => ({ sync_id: id, store, local_updated_at: "local-v2", remote_updated_at: "v2", local: { nota_tatica: "Versão escrita no telemóvel" }, remote: { nota_tatica: "Versão atual do PC" } });
    RemoteWorkspace.resolveVersionConflict = async (...args) => { window.__versionResolution = args; return { conflicts: [] }; };
    go("#/definicoes");
  });
  await expect(page.getByText(/As duas versões estão preservadas/)).toBeVisible();
  await page.getByRole("button", { name: "Comparar versões" }).click();
  await expect(page.getByText('"nota_tatica": "Versão escrita no telemóvel"')).toBeVisible();
  await expect(page.getByText('"nota_tatica": "Versão atual do PC"')).toBeVisible();
  page.on("dialog", dialog => dialog.accept());
  await page.getByRole("button", { name: "Manter versão deste dispositivo" }).click();
  await expect.poll(() => page.evaluate(() => window.__versionResolution)).toEqual(["match-conflict", "jogos", "keep_local", "v2", "local-v2"]);
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
  await expect(page.getByText(/Atualização disponível\. Guarda o que estás a fazer/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Atualizar app" })).toBeVisible();
  await expect(page.locator("textarea")).toHaveValue("texto por guardar");
  expect(await page.evaluate(() => sessionStorage.getItem("vision-sw-reloaded-v120"))).toBeNull();
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
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem("vision-sw-reloaded-v120"))).toBe("1");
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

test("falha do upload remoto preserva a foto na fila local", async ({ page }) => {
  await page.goto("/#/equipa/jogador/novo");
  await page.evaluate(() => {
    RemoteWorkspace.canUpload = async () => true;
    RemoteWorkspace.uploadFileMedia = async () => { throw new Error("rede interrompida"); };
  });
  let fallbackNotice = "";
  page.on("dialog", async (dialog) => { fallbackNotice = dialog.message(); await dialog.accept(); });
  await page.getByLabel("Nome").fill("Foto Upload Recuperação E2E");
  await page.locator('input[name="foto_file"]').setInputFiles({
    name: "atleta.png",
    mimeType: "image/png",
    buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"),
  });
  await page.getByRole("button", { name: "Guardar", exact: true }).click();
  await expect.poll(() => fallbackNotice).toContain("guardada neste dispositivo");
  await expect(page).toHaveURL(/#\/equipa\/jogador\/\d+$/);
  const saved = await page.evaluate(async () => {
    const player = (await DB.listar("jogadores")).find((row) => row.nome === "Foto Upload Recuperação E2E");
    const media = await HeadCoachMedia.listForSubject("player", player.id);
    return { photo: player.foto, media: media.find((item) => item.note === "Foto de perfil do atleta") };
  });
  expect(saved.photo).toMatch(/^data:image\/png;base64,/);
  expect(saved.media.data_url).toMatch(/^data:image\/png;base64,/);
  expect(saved.media.sync_dirty).toBe(true);
});
