"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const sql = fs.readFileSync(path.join(__dirname, "..", "supabase", "migrations", "001_workspace.sql"), "utf8");

test("schema remoto ativa RLS nas tabelas privadas", () => {
  for (const table of ["teams","team_members","workspace_records","media_assets","activity_log","agent_authorizations"]) {
    assert.match(sql, new RegExp("alter table public\\." + table + " enable row level security", "i"));
  }
});

test("storage de media é privado", () => {
  assert.match(sql, /values \('team-media', 'team-media', false\)/i);
  assert.match(sql, /team_media_select[\s\S]*is_team_member/i);
  assert.match(sql, /team_media_insert[\s\S]*is_team_member/i);
});

test("workspace exige membership para ler e escrever", () => {
  assert.match(sql, /records_select[\s\S]*is_team_member/i);
  assert.match(sql, /records_insert[\s\S]*is_team_member/i);
  assert.match(sql, /records_update[\s\S]*is_team_member/i);
});

test("migração não contém credenciais privadas", () => {
  assert.doesNotMatch(sql, /service[_ -]?role/i);
  assert.doesNotMatch(sql, /sb_secret_/i);
});
