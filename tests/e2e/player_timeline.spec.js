"use strict";

const { test, expect } = require("@playwright/test");
test.use({ serviceWorkers: "block" });

test("ficha do atleta percorre jogos e treinos por cursor sem carregar os históricos completos",async({page})=>{
  await page.goto("/");await page.waitForFunction(()=>typeof router==="function");
  const fixture=await page.evaluate(async()=>{RemoteWorkspace.scheduleSync=()=>{};const ref=crypto.randomUUID(),playerId=await DB.criar("jogadores",{team_id:DEFAULT_TEAM_ID,sync_id:ref,nome:"Atleta histórico extenso",estado_disponibilidade:"disponivel"}),payload=Array.from({length:80},(_,i)=>({minute:i,note:"large player history payload ".repeat(4)}));let selectedMatchId=null,selectedTrainingId=null;for(let i=0;i<40;i++){const date=new Date(Date.UTC(2035,0,1+i)).toISOString().slice(0,10),match=await DB.criar("jogos",{team_id:DEFAULT_TEAM_ID,sync_id:crypto.randomUUID(),data:date,adversario:"Histórico jogo "+i,notas:JSON.stringify(payload),visual_match:{events:payload,roster:i===39?[{ref}]:[]},callup:{player_ids:i===39?[ref]:[]}}),training=await DB.criar("treinos",{team_id:DEFAULT_TEAM_ID,sync_id:crypto.randomUUID(),data:date,objetivo:"Histórico treino "+i,blocos:payload,session:{notes:payload,attendance:i===39?[{player_ref:ref,status:"present"}]:[]}});if(i===39){selectedMatchId=match;selectedTrainingId=training;}}window.playerHistoryCursorCalls={matches:0,trainings:0};const cursor=DB.percorrerIndice.bind(DB);DB.percorrerIndice=function(store,...args){if(store==="jogos")window.playerHistoryCursorCalls.matches++;if(store==="treinos")window.playerHistoryCursorCalls.trainings++;return cursor(store,...args);};const read=DB.porIndice.bind(DB);DB.porIndice=function(store,...args){if(store==="jogos"||store==="treinos")throw new Error("A ficha tentou materializar o histórico inteiro: "+store);return read(store,...args);};location.hash="#/equipa/jogador/"+playerId;return{playerId,selectedMatchId,selectedTrainingId};});
  await expect(page.locator("#app").getByRole("heading",{name:"Atleta histórico extenso"})).toBeVisible();await expect(page.locator("#player-timeline")).toContainText("Histórico jogo 39");await expect(page.locator("#player-timeline")).toContainText("Histórico treino 39");await expect(page.locator("#player-timeline a[href='#/equipa/jogo/"+fixture.selectedMatchId+"']")).toBeVisible();await expect(page.locator("#player-timeline a[href='#/sessao/"+fixture.selectedTrainingId+"']")).toBeVisible();await expect(page.locator('#player-goals input[name="evidence_refs"][value^="match:"]')).toHaveCount(40);await expect(page.locator('#player-goals input[name="evidence_refs"][value^="training:"]')).toHaveCount(40);const calls=await page.evaluate(()=>window.playerHistoryCursorCalls);expect(calls.matches).toBeGreaterThanOrEqual(3);expect(calls.trainings).toBeGreaterThanOrEqual(3);await expect(page.locator("#app")).not.toContainText("large player history payload");
});

test("ficha do atleta reúne participação e evolução numa cronologia com ligações", async ({ page }) => {
  await page.goto("/#/equipa");
  await page.waitForFunction(() => typeof PlayerGoals !== "undefined" && typeof VisionMatchVisual !== "undefined");
  const fixture = await page.evaluate(async () => {
    RemoteWorkspace.scheduleSync = () => {};
    const refs = Array.from({ length: 6 }, () => crypto.randomUUID());
    const playerId = await DB.criar("jogadores", { team_id: DEFAULT_TEAM_ID, sync_id: refs[0], nome: "Atleta Linha Temporal", estado_disponibilidade: "disponivel" });
    const players = refs.map((sync_id, i) => ({ sync_id, nome: i ? "Colega " + i : "Atleta Linha Temporal", numero: i + 1, estado_disponibilidade: "disponivel" }));
    let match = {
      team_id: DEFAULT_TEAM_ID, sync_id: crypto.randomUUID(), data: "2026-09-12", adversario: "Jogo cronológico", estado: "agendado",
      callup: { player_ids: refs },
      lineup: { goalkeeper_id: refs[1], starters: [refs[0], refs[2], refs[3], refs[4]], system: "1-2-1" },
    };
    const start = Date.parse("2026-09-12T18:00:00.000Z");
    match = VisionMatchVisual.apply(match, { type: "start", confirmed: true, expected_revision: 0 }, { controller_id: "timeline-test", players, now: start });
    match = VisionMatchVisual.apply(match, { type: "substitute", id: crypto.randomUUID(), confirmed: true, out_ref: refs[0], in_ref: refs[5], expected_revision: 1 }, { controller_id: "timeline-test", players, now: start + 600000 });
    match = VisionMatchVisual.apply(match, { type: "finish", confirmed: true, expected_revision: 2 }, { controller_id: "timeline-test", players, now: start + 900000 });
    const matchId = await DB.criar("jogos", match);
    const trainingId = await DB.criar("treinos", {
      team_id: DEFAULT_TEAM_ID, sync_id: crypto.randomUUID(), data: "2026-09-14", objetivo: "Apoio após passe",
      session: { attendance: [{ player_ref: refs[0], status: "present" }] },
    });
    const exerciseId = await DB.criar("exercicios", { team_id: DEFAULT_TEAM_ID, sync_id: crypto.randomUUID(), nome: "Passe e apoio" });
    const memory = await HeadCoachMemory.create({
      team_id: DEFAULT_TEAM_ID, kind: "observation", title: "Observação cronológica", content: "Apoio após passe observado.", occurred_at: "2026-09-17",
      source: { type: "player", label: "Ficha do atleta", ref_type: "player", ref_id: refs[0] },
      subject_refs: [{ type: "player", id: String(playerId), relation: "about" }],
    });
    let player = await DB.obter("jogadores", playerId);
    const goalId = crypto.randomUUID();
    const training = await DB.obter("treinos", trainingId), matchRow = await DB.obter("jogos", matchId), exercise = await DB.obter("exercicios", exerciseId);
    player = PlayerGoals.apply(player, { type: "save", expected_revision: 0, goal: { id: goalId, title: "Apoio depois do passe", started_at: "2026-09-10", status: "active", evidence_refs: [{ type: "training", id: training.sync_id }], exercise_refs: [exercise.sync_id], notes: "Criar apoio próximo." } }, { now: "2026-09-10T12:00:00.000Z" });
    player = PlayerGoals.apply(player, { type: "save", expected_revision: 1, goal: { id: goalId, title: "Apoio depois do passe", started_at: "2026-09-10", status: "improved", evidence_refs: [{ type: "match", id: matchRow.sync_id }], exercise_refs: [exercise.sync_id], notes: "O apoio foi observado no jogo." } }, { now: "2026-09-19T12:00:00.000Z" });
    await DB.atualizar("jogadores", player);
    return { playerId, matchId, trainingId, memoryId: memory.id, goalId };
  });

  await page.evaluate(async id => { go("#/equipa/jogador/" + id); await router(); }, fixture.playerId);
  await expect(page).toHaveURL(new RegExp("#/equipa/jogador/" + fixture.playerId + "$"));
  const timeline = page.locator("#player-timeline");
  await expect(timeline.getByRole("heading", { name: "Histórico cronológico" })).toBeVisible();
  await expect(timeline).toContainText("Estado atual · Apoio depois do passe");
  await expect(timeline).toContainText("Observação cronológica");
  await expect(timeline).toContainText("Presença: Presente");
  await expect(timeline).toContainText("Jogo · Jogo cronológico");
  await expect(timeline).toContainText("Evidência ligada · Treino · Apoio após passe");
  await expect(timeline).toContainText("Evidência ligada · Jogo · Jogo cronológico");
  await expect(timeline).toContainText("esta associação não confirma que foi trabalhado");
  await expect(timeline).toContainText("Saiu aos 10 min");
  await expect(timeline).toContainText("Utilização registada: 10:00");
  const dates = await timeline.locator("time").evaluateAll(nodes => nodes.map(node => node.dateTime));
  expect(dates).toEqual([...dates].sort((a, b) => b.localeCompare(a)));
  await expect(timeline.getByRole("link", { name: "Abrir origem" })).toHaveCount(3);
  await expect(timeline.getByRole("link", { name: "Abrir evidência" })).toHaveCount(2);
  await expect(timeline.getByRole("link", { name: "Abrir exercício" })).toHaveCount(1);
  await timeline.getByRole("button", { name: "Ver objetivo" }).first().click();
  await expect(page.locator("#player-goal-" + fixture.goalId)).toBeInViewport();
  const goal = page.locator("#player-goal-" + fixture.goalId);
  await expect(goal.getByRole("link", { name: "Jogo · Jogo cronológico" })).toHaveCount(1);
  await expect(goal.getByRole("link", { name: "Treino · Apoio após passe" })).toHaveCount(1);
  await expect(goal.getByRole("link", { name: "Exercício · Passe e apoio" })).toHaveCount(2);
  await expect(goal).toContainText("Histórico de alterações");
  await expect(goal).toContainText("Criar apoio próximo.");
});
