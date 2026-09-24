"use strict";

const { test, expect } = require("@playwright/test");

test("controlos principais têm nomes acessíveis e campos com rótulos", async ({ page }) => {
  await page.goto("/#/workspace");
  const fixture = await page.evaluate(async () => {
    RemoteWorkspace.scheduleSync = () => {};
    const players = []; let firstPlayerId = null;
    for (let number = 1; number <= 5; number++) {
      const sync_id = crypto.randomUUID(); players.push(sync_id);
      const playerId = await DB.criar("jogadores", { team_id: DEFAULT_TEAM_ID, sync_id, nome: `Teste acessibilidade ${number}`, numero: number, estado_disponibilidade: "disponivel" });
      if (number === 1) firstPlayerId = playerId;
    }
    const training = await DB.criar("treinos", {
      team_id: DEFAULT_TEAM_ID, sync_id: crypto.randomUUID(), data: "2026-09-25", objetivo: "Passe e apoio", duracao_min: 20,
      blocos: [{ order: 0, block_id: "accessibility-block", exercise_ref: crypto.randomUUID(), exercise_name: "Passe e apoio", duration_min: 20 }],
    });
    const match = await DB.criar("jogos", {
      team_id: DEFAULT_TEAM_ID, sync_id: crypto.randomUUID(), data: "2026-09-26", adversario: "Teste acessibilidade", estado: "agendado",
      callup: { status: "ready", player_ids: players, notes: null },
      lineup: { status: "ready", system: "1-2-1", goalkeeper_id: players[0], starters: players.slice(1), substitutes: [], positions: {} },
    });
    return { player: firstPlayerId, training, match };
  });
  const routes = [
    ["Workspace", "/#/workspace"],
    ["Equipa", "/#/equipa"],
    ["Editar equipa", "/#/equipa/editar"],
    ["Novo jogador", "/#/equipa/jogador/novo"],
    ["Editar jogador", "/#/equipa/jogador/" + fixture.player + "/editar"],
    ["Novo jogo", "/#/equipa/jogo/novo"],
    ["Preparar jogo", "/#/equipa/jogo/" + fixture.match + "/editar"],
    ["Ficha do jogo", "/#/equipa/jogo/" + fixture.match],
    ["Jogo visual", "/#/jogo-visual/" + fixture.match],
    ["Treinos", "/#/treinos"],
    ["Novo treino", "/#/treinos/novo"],
    ["Editar treino", "/#/treinos/" + fixture.training + "/editar"],
    ["Ficha do treino", "/#/treinos/" + fixture.training],
    ["Treino em campo", "/#/sessao/" + fixture.training],
    ["Consulta do treino", "/#/consulta/" + fixture.training],
    ["Exercícios", "/#/exercicios"],
    ["Novo exercício", "/#/exercicios/novo"],
    ["Novo documento", "/#/planos/novo"],
    ["Nova media", "/#/media/novo"],
    ["Nova observação", "/#/capturar"],
    ["Calendário", "/#/calendario"],
    ["Evolução da equipa", "/#/evolucao"],
    ["Épocas", "/#/epocas"],
    ["Pesquisa", "/#/pesquisa"],
    ["Timeline", "/#/timeline"],
    ["Planos", "/#/planos"],
    ["Media", "/#/media"],
    ["Definições", "/#/definicoes"],
  ];

  for (const [routeName, route] of routes) {
    await page.goto(route);
    const unlabeled = await page.evaluate(() => Array.from(document.querySelectorAll(
      'button, a[href], input:not([type="hidden"]), select, textarea'
    )).filter((element) => {
      if (!element.getClientRects().length || element.closest('[aria-hidden="true"]')) return false;
      const explicit = element.getAttribute("aria-label") || element.getAttribute("aria-labelledby") || element.title;
      if (explicit?.trim()) return false;
      if (element.matches("input, select, textarea")) return !element.labels?.length;
      const text = element.innerText?.trim();
      const imageAlt = Array.from(element.querySelectorAll("img[alt]"))
        .map((image) => image.alt.trim()).filter(Boolean).join(" ");
      const svgTitle = Array.from(element.querySelectorAll("svg title"))
        .map((title) => title.textContent.trim()).filter(Boolean).join(" ");
      return !text && !imageAlt && !svgTitle;
    }).map((element) => ({
      tag: element.tagName.toLowerCase(),
      type: element.getAttribute("type"),
      name: element.getAttribute("name"),
      id: element.id,
      html: element.outerHTML.slice(0, 180),
    })));

    expect(unlabeled, `${routeName}: controlos sem nome acessível`).toEqual([]);
  }
});

test("teclado alcança os campos e a ação principal da ficha de jogador", async ({ page }) => {
  await page.goto("/#/equipa/jogador/novo");
  const focusOrder = [];
  for (let index = 0; index < 40; index++) {
    await page.keyboard.press("Tab");
    const focused = await page.evaluate(() => {
      const element = document.activeElement;
      return {
        name: element?.getAttribute("name") || "",
        type: element?.getAttribute("type") || "",
        text: element?.innerText?.trim() || "",
        tag: element?.tagName?.toLowerCase() || "",
      };
    });
    focusOrder.push(focused);
    if (focused.tag === "button" && focused.type === "submit") break;
  }

  const nameIndex = focusOrder.findIndex((item) => item.name === "nome");
  const saveIndex = focusOrder.findIndex((item) => item.tag === "button" && item.type === "submit");
  expect(nameIndex).toBeGreaterThanOrEqual(0);
  expect(saveIndex).toBeGreaterThan(nameIndex);
});
