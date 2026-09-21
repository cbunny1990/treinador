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
const pwaSyncSql = fs.readFileSync(
  path.join(migrationDir, "20260921134843_vision_coach_pwa_bidirectional_sync.sql"),
  "utf8"
);
const functionSource = fs.readFileSync(
  path.join(__dirname, "..", "supabase", "functions", "head-coach-gateway", "index.ts"),
  "utf8"
);
const supabaseConfig = fs.readFileSync(path.join(__dirname, "..", "supabase", "config.toml"), "utf8");

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

test("migrações e Edge Function não contêm credenciais privadas", () => {
  assert.doesNotMatch(sql, /sb_secret_/i);
  assert.doesNotMatch(sql, /SUPABASE_SERVICE_ROLE_KEY\s*[:=]\s*['"][^'"]+/i);
  assert.doesNotMatch(functionSource, /sb_secret_/i);
  assert.match(functionSource, /Deno\.env\.get\("SUPABASE_SERVICE_ROLE_KEY"\)/);
});

test("gateway versionado mantém JWT e acesso exclusivo de service_role", () => {
  assert.match(supabaseConfig, /\[functions\.head-coach-gateway\][\s\S]*verify_jwt\s*=\s*true/i);
  assert.match(functionSource, /jwt\.role\s*!==\s*"service_role"/i);
  assert.match(sql, /grant execute on function[\s\S]*to service_role/i);
});

test("PWA pode ler tombstones apenas como membro da equipa", () => {
  assert.match(pwaSyncSql, /records_select[\s\S]*to authenticated[\s\S]*private\.is_team_member\(team_id\)/i);
  assert.match(pwaSyncSql, /media_select[\s\S]*to authenticated[\s\S]*private\.is_team_member\(team_id\)/i);
  assert.doesNotMatch(pwaSyncSql, /to anon/i);
  assert.doesNotMatch(pwaSyncSql, /deleted_at is null/i);
});

test("gateway suporta conflitos, idempotência e validação de media", () => {
  assert.match(sql, /p_expected_updated_at/i);
  assert.match(sql, /agent_request_log/i);
  assert.match(sql, /media_subject_not_in_team|media_subject_not_found/i);
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


test("exercise é record kind oficial do gateway e suporta media", () => {
  assert.match(sql, /workspace_records_kind_check[\s\S]*exercise/i);
  assert.match(sql, /record_kinds[\s\S]*exercise/i);
  assert.match(sql, /p_kind not in[\s\S]*exercise/i);
  assert.match(sql, /p_subject_type in[\s\S]*exercise/i);
});
