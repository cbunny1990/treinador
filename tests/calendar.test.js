"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const VisionCalendar = require("../js/calendar.js");

test("normaliza jogo sem perder dados existentes", () => {
  const row = VisionCalendar.normalizeMatch({
    adversario: "Aparecida",
    pre_game: { plano_jogo: "Abrir o campo" },
  });
  assert.equal(row.adversario, "Aparecida");
  assert.equal(row.pre_game.plano_jogo, "Abrir o campo");
  assert.equal(row.pre_game.status, "draft");
  assert.deepEqual(row.callup.player_ids, []);
  assert.equal(row.lineup.system, "1-2-1");
  assert.deepEqual(row.during.notes, []);
  assert.equal(row.post_game.status, "pending");
});

test("gera horário recorrente de segunda e quinta", () => {
  const team = {
    horarios: { estruturado: { treinos: [
      { dia_semana: 1, inicio: "19:15", fim: "20:30" },
      { dia_semana: 4, inicio: "19:15", fim: "20:30" },
    ] } },
  };
  const rows = VisionCalendar.plannedTrainings(team, "2026-09-21", 1);
  assert.deepEqual(rows.map((x) => x.date), ["2026-09-21", "2026-09-24"]);
  assert.equal(rows[0].time, "19:15");
  assert.equal(rows[0].end_time, "20:30");
});

test("calendário não duplica treino real no mesmo horário", () => {
  const snapshot = {
    team: { horarios: { estruturado: { treinos: [
      { dia_semana: 1, inicio: "19:15", fim: "20:30" },
    ] } } },
    trainings: [{ id: 7, data: "2026-09-21", hora: "19:15", escalao: "sub-8" }],
    matches: [{ id: 2, data: "2026-09-26", hora: "10:00", adversario: "S. Martinho" }],
  };
  const rows = VisionCalendar.events(snapshot, { from: "2026-09-21", weeks: 1 });
  assert.equal(rows.filter((x) => x.date === "2026-09-21").length, 1);
  assert.equal(rows[0].type, "training");
  assert.equal(rows[1].type, "match");
});

test("progresso reconhece plano, convocatória e alinhamento", () => {
  const progress = VisionCalendar.matchProgress({
    pre_game: { objetivo_principal: "Circular rápido" },
    callup: { player_ids: ["a"] },
    lineup: { goalkeeper_id: "a", starters: ["b", "c", "d", "e"] },
    post_game: { status: "pending" },
  });
  assert.equal(progress.pre_game, true);
  assert.equal(progress.callup, true);
  assert.equal(progress.lineup, true);
  assert.equal(progress.post_game, false);
});
