"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const migrationDir = path.join(__dirname, "..", "supabase", "migrations");
const sql = fs.readdirSync(migrationDir)
  .filter((name) => name.endsWith(".sql"))
  .sort()
  .map((name) => fs.readFileSync(path.join(migrationDir, name), "utf8"))
  .join("\n");

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

test("hardening move helpers para schema privado", () => {
  assert.match(sql, /create schema if not exists private/i);
  assert.match(sql, /private\.is_team_member/i);
  assert.match(sql, /drop function if exists public\.is_team_member/i);
  assert.match(sql, /revoke execute on function public\.add_owner_membership/i);
});

test("foreign keys críticas têm índices dedicados", () => {
  for (const name of [
    "teams_owner_id_idx",
    "team_members_user_id_idx",
    "workspace_records_created_by_idx",
    "media_assets_created_by_idx",
    "activity_log_created_by_idx",
    "agent_authorizations_owner_id_idx",
  ]) assert.match(sql, new RegExp(name, "i"));
});
