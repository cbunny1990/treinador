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

test("recorrência deduplica apenas o mesmo dia e hora, mantendo outros treinos do dia", () => {
  const snapshot = {
    team: { horarios: { estruturado: { treinos: [
      { dia_semana: 1, inicio: "09:00", fim: "10:00" },
      { dia_semana: 1, inicio: "18:00", fim: "19:00" },
      { dia_semana: 1, inicio: "18:00", fim: "19:30" },
    ] } } },
    trainings: [{ id: 11, data: "2026-09-21", hora: "09:00", escalao: "sub-8" }],
    matches: [],
  };
  const rows = VisionCalendar.events(snapshot, { from: "2026-09-21", weeks: 1 });
  assert.deepEqual(rows.map((row) => [row.type, row.time]), [
    ["training", "09:00"],
    ["training_schedule", "18:00"],
  ]);
});

test("calendário limita jogos e treinos registados ao horizonte pedido", () => {
  const rows = VisionCalendar.events({
    team: {},
    matches: [
      { id: 1, sync_id: "m1", data: "2026-09-21", adversario: "A" },
      { id: 2, sync_id: "m2", data: "2026-09-28", adversario: "B" },
    ],
    trainings: [
      { id: 3, data: "2026-09-27", hora: "10:00" },
      { id: 4, data: "2026-09-28", hora: "11:00" },
    ],
  }, { from: "2026-09-21", weeks: 1 });
  assert.deepEqual(rows.map((row) => row.id), [1, 3]);
});

test("não oculta jogos distintos com a mesma data, hora e adversário", () => {
  const rows = VisionCalendar.events({
    matches: [
      { id: 1, sync_id: "m1", data: "2026-09-21", hora: "10:00", adversario: "A" },
      { id: 2, sync_id: "m2", data: "2026-09-21", hora: "10:00", adversario: "A" },
      { id: 1, sync_id: "m1", data: "2026-09-21", hora: "10:00", adversario: "A" },
    ],
  }, { from: "2026-09-21", weeks: 1 });
  assert.deepEqual(rows.map((row) => row.id), [1, 2]);
});
