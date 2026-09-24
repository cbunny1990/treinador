"use strict";

const { test, expect } = require("@playwright/test");

test("agenda percorre o histórico sem materializar registos fora das seis semanas", async ({ page }) => {
  await page.goto("/");
  await page.waitForFunction(() => typeof DB !== "undefined" && typeof VisionCalendar !== "undefined");
  const fixture = await page.evaluate(async () => {
    RemoteWorkspace.scheduleSync = () => {};
    const shift = (date, days) => {
      const result = new Date(date + "T12:00:00Z");
      result.setUTCDate(result.getUTCDate() + days);
      return result.toISOString().slice(0, 10);
    };
    const from = new Date().toISOString().slice(0, 10);
    const trainingDate = shift(from, 1);
    const beyond = shift(from, 43);
    const weekday = new Date(trainingDate + "T12:00:00Z").getUTCDay();
    await HeadCoachMemory.saveTeam({
      horarios: { texto: "Segunda e quinta", estruturado: { treinos: [{ dia_semana: weekday, inicio: "18:00", fim: "19:00" }] } },
    });
    const largePayload = Array.from({ length: 80 }, (_, i) => ({ note: "Histórico extenso " + i }));
    await DB.criar("treinos", { team_id: DEFAULT_TEAM_ID, sync_id: crypto.randomUUID(), data: shift(from, -10), hora: "18:00", escalao: "sub-8", notas: largePayload });
    await DB.criar("treinos", { team_id: DEFAULT_TEAM_ID, sync_id: crypto.randomUUID(), data: trainingDate, hora: "18:00", hora_fim: "19:00", escalao: "sub-8", notas: largePayload });
    await DB.criar("treinos", { team_id: DEFAULT_TEAM_ID, sync_id: crypto.randomUUID(), data: trainingDate, hora: "14:00", hora_fim: "15:00", escalao: "sub-8", notas: largePayload });
    await DB.criar("treinos", { team_id: DEFAULT_TEAM_ID, sync_id: crypto.randomUUID(), data: beyond, hora: "18:00", escalao: "sub-8", notas: largePayload });
    await DB.criar("jogos", { team_id: DEFAULT_TEAM_ID, sync_id: crypto.randomUUID(), data: shift(from, 2), hora: "10:30", adversario: "Adversário visível", local: "Campo central", hora_saida: "09:45", estado: "agendado", during: { events: largePayload } });
    await DB.criar("jogos", { team_id: DEFAULT_TEAM_ID, sync_id: crypto.randomUUID(), data: shift(from, -1), adversario: "Jogo histórico", during: { events: largePayload } });
    await DB.criar("jogos", { team_id: DEFAULT_TEAM_ID, sync_id: crypto.randomUUID(), data: beyond, adversario: "Jogo distante", during: { events: largePayload } });
    window.calendarCursorCounts = { treinos: 0, jogos: 0 };
    const cursor = DB.percorrerIndice.bind(DB);
    DB.percorrerIndice = function (store, ...args) {
      return cursor(store, ...args).then((count) => {
        if (store in window.calendarCursorCounts) window.calendarCursorCounts[store] = count;
        return count;
      });
    };
    const read = DB.porIndice.bind(DB);
    DB.porIndice = function (store, ...args) {
      if (store === "treinos" || store === "jogos") throw new Error("A agenda tentou carregar o histórico completo: " + store);
      return read(store, ...args);
    };
    location.hash = "#/calendario";
    return { trainingDate, from, beyond, trainingDateLabel: trainingDate.slice(8, 10) + "/" + trainingDate.slice(5, 7) + "/" + trainingDate.slice(0, 4) };
  });

  await expect(page.getByRole("heading", { name: "Calendário", exact: true })).toBeVisible();
  await expect(page.getByText("Jogo vs Adversário visível")).toBeVisible();
  await expect(page.getByText("Jogo vs Jogo histórico")).toHaveCount(0);
  await expect(page.getByText("Jogo vs Jogo distante")).toHaveCount(0);
  await expect(page.locator(".calendar-day").filter({ hasText: fixture.trainingDateLabel }).getByText("Treino previsto")).toHaveCount(0);
  await expect(page.locator('.calendar-day a[href^="#/consulta/"]')).toHaveCount(2);
  await expect(page.getByText("Histórico extenso", { exact: false })).toHaveCount(0);
  const counts = await page.evaluate(() => window.calendarCursorCounts);
  expect(counts.jogos).toBeGreaterThanOrEqual(3);
  expect(counts.treinos).toBeGreaterThanOrEqual(4);
  expect(fixture.beyond > fixture.from).toBeTruthy();
});
