"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  mediaSubjectKey,
  mediaSafeUrl,
  normalizarMediaItem,
  HeadCoachMedia,
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

test("editar media atualiza metadados com revisão e mantém identidade sincronizada", async () => {
  const originalDB = globalThis.DB;
  const rows = [{
    id: 7, team_id: "default", subject_type: "match", subject_id: "12",
    subject_key: "default|match|12", type: "video", title: "Título antigo",
    url: "https://example.com/old", note: "Nota antiga", data_url: null,
    storage_path: null, sync_id: "media-stable-id", updated_at: "v1", sync_dirty: false,
  }];
  globalThis.DB = {
    async obter(_store, id) { return rows.find((row) => row.id === id) || null; },
    async modificar(_store, id, transform) {
      const index = rows.findIndex((row) => row.id === id);
      rows[index] = { ...transform({ ...rows[index] }), sync_dirty: true };
      return rows[index];
    },
  };
  try {
    await HeadCoachMedia.update(7, {
      type: "video", title: "Título corrigido", note: "Nota nova",
      url: "https://example.com/new",
    }, { expectedUpdatedAt: "v1" });
    assert.deepEqual(rows[0], {
      id: 7, team_id: "default", subject_type: "match", subject_id: "12",
      subject_key: "default|match|12", type: "video", title: "Título corrigido",
      url: "https://example.com/new", note: "Nota nova", data_url: null,
      storage_path: null, sync_id: "media-stable-id", updated_at: rows[0].updated_at,
      sync_dirty: true,
    });
    assert.notEqual(rows[0].updated_at, "v1");
    await assert.rejects(() => HeadCoachMedia.update(7, { title: "Stale" }, { expectedUpdatedAt: "v1" }), /mudou noutro dispositivo/);
  } finally { globalThis.DB = originalDB; }
});

test("editar metadados de ficheiro privado preserva caminho e bytes locais", async () => {
  const originalDB = globalThis.DB;
  let row = {
    id: 3, team_id: "default", subject_type: "player", subject_id: "5",
    subject_key: "default|player|5", type: "photo", title: "Foto",
    url: "https://signed.example/old?token=temporary", data_url: "data:image/png;base64,AA==",
    storage_path: "team-uuid/media-uuid/asset.png", file_name: "asset.png",
    mime_type: "image/png", size: 1, note: "Perfil", sync_id: "media-uuid",
    updated_at: "v1", sync_dirty: false,
  };
  globalThis.DB = {
    async obter() { return { ...row }; },
    async modificar(_store, _id, transform) { row = { ...transform({ ...row }), sync_dirty: true }; return row; },
  };
  try {
    await HeadCoachMedia.update(3, { title: "Foto corrigida", note: "Perfil corrigido" }, { expectedUpdatedAt: "v1" });
    assert.equal(row.title, "Foto corrigida");
    assert.equal(row.note, "Perfil corrigido");
    assert.equal(row.storage_path, "team-uuid/media-uuid/asset.png");
    assert.equal(row.data_url, "data:image/png;base64,AA==");
    assert.equal(row.sync_id, "media-uuid");
    assert.equal(row.url, "https://signed.example/old?token=temporary");
    assert.equal(row.sync_dirty, true);
  } finally { globalThis.DB = originalDB; }
});
