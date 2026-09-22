"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const PlayerStatus = require("../js/player_status.js");

test("jogador é disponível por defeito", () => {
  assert.equal(PlayerStatus.normalize(null), "disponivel");
  assert.equal(PlayerStatus.label(null), "Disponível");
  assert.equal(PlayerStatus.isAvailable({}), true);
});

test("estados operacionais de disponibilidade são normalizados", () => {
  for (const key of ["disponivel","indisponivel","lesionado","castigado","ausente"]) {
    assert.equal(PlayerStatus.normalize(key), key);
  }
  assert.equal(PlayerStatus.normalize("desconhecido"), "disponivel");
});

test("jogador fora do plantel nunca é elegível", () => {
  assert.equal(PlayerStatus.inRoster({ plantel_ativo: false }), false);
  assert.equal(PlayerStatus.isAvailable({ plantel_ativo: false, estado_disponibilidade: "disponivel" }), false);
});
