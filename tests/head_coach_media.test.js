"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  mediaSubjectKey,
  mediaSafeUrl,
  normalizarMediaItem,
} = require("../js/head_coach_media.js");

test("normaliza media ligado a jogo", () => {
  const item = normalizarMediaItem({
    team_id: "default", subject_type: "match", subject_id: 12,
    type: "video", title: "Saída de bola", url: "https://example.com/video",
  }, { now: "2026-09-21T00:00:00.000Z" });
  assert.equal(item.subject_key, "default|match|12");
  assert.equal(item.type, "video");
  assert.equal(item.created_at, "2026-09-21T00:00:00.000Z");
});

test("aceita ficheiro local em data URL", () => {
  const item = normalizarMediaItem({
    subject_type: "player", subject_id: 3, type: "photo",
    data_url: "data:image/jpeg;base64,AAAA", file_name: "foto.jpg",
  });
  assert.match(item.data_url, /^data:image\/jpeg/);
  assert.equal(mediaSubjectKey("default", "player", 3), "default|player|3");
});
test("rejeita protocolos inseguros", () => {
  assert.throws(() => mediaSafeUrl("javascript:alert(1)"), /http/);
});

test("exige associação e origem de media", () => {
  assert.throws(() => normalizarMediaItem({ type: "file", subject_type: "match", subject_id: 1 }), /link|ficheiro/i);
  assert.throws(() => normalizarMediaItem({ type: "file", url: "https://example.com/a" }), /entidade/i);
});


test("media pode ser associado a exercício Vision Coach", () => {
  const item = normalizarMediaItem({
    team_id: "default",
    subject_type: "exercise",
    subject_id: "7",
    type: "video",
    title: "Demonstração",
    url: "https://example.com/exercise.mp4",
  }, { now: "2026-09-21T21:00:00.000Z" });
  assert.equal(item.subject_type, "exercise");
  assert.equal(item.subject_key, "default|exercise|7");
});
