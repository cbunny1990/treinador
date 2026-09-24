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
const mcpSource = fs.readFileSync(path.join(__dirname, "..", "supabase", "functions", "vision-coach-mcp", "index.ts"), "utf8");
const supabaseConfig = fs.readFileSync(path.join(__dirname, "..", "supabase", "config.toml"), "utf8");

test("schema remoto ativa RLS nas tabelas privadas", () => {
  for (const table of ["teams","team_members","workspace_records","media_assets","activity_log","agent_authorizations"]) {
    assert.match(sql, new RegExp("alter table public\\." + table + " enable row level security", "i"));
  }
});

test("tabelas internas revogam grants da API normal e ativam RLS", () => {
  const internalTables = fs.readFileSync(
    path.join(migrationDir, "20260923140620_enable_private_internal_table_rls.sql"),
    "utf8"
  );
  assert.match(internalTables, /revoke all on table private\.agent_request_log, private\.mcp_connector_tokens\s+from public, anon, authenticated/i);
  for (const table of ["agent_request_log", "mcp_connector_tokens"]) {
    assert.match(internalTables, new RegExp(`alter table private\\.${table} enable row level security`, "i"));
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

test("RAG guarda chunks em schema privado e RPC exige scope server-side", () => {
  assert.match(sql, /create extension if not exists vector with schema extensions/i);
  assert.match(sql, /private\.team_knowledge_chunks[\s\S]*embedding extensions\.vector\(1536\)/i);
  assert.match(sql, /private\.team_knowledge_jobs[\s\S]*source_updated_at/i);
  assert.match(sql, /join public\.workspace_records r[\s\S]*r\.updated_at = k\.source_updated_at[\s\S]*r\.deleted_at is null/i);
  assert.match(sql, /function public\.search_team_knowledge_chunks[\s\S]*if auth\.role\(\) <> 'service_role'/i);
  assert.match(sql, /set_config\('hnsw\.iterative_scan', 'strict_order', true\)/i);
  assert.match(sql, /p_from is null or k\.source_date is null or k\.source_date >= p_from/i);
  assert.match(sql, /p_to is null or k\.source_date is null or k\.source_date <= p_to/i);
  assert.match(sql, /revoke all on function public\.search_team_knowledge_chunks[\s\S]*from public, anon, authenticated/i);
  assert.match(sql, /grant execute on function public\.search_team_knowledge_chunks[\s\S]*to service_role/i);
  assert.match(sql, /workspace_records_queue_team_knowledge[\s\S]*after insert or update of kind, payload, updated_at, deleted_at, team_id or delete on public\.workspace_records/i);
  assert.match(sql, /teams_queue_team_knowledge_age_group[\s\S]*after update of metadata on public\.teams/i);
  assert.match(sql, /queue_team_knowledge_on_team_age_group_change[\s\S]*metadata->>'escalao'[\s\S]*metadata->>'age_group'[\s\S]*on conflict \(team_id, source_id\) do update/i);
  assert.match(mcpSource, /import \{ TEAM_KNOWLEDGE_TOOLS, executeTeamKnowledgeTool \} from "\.\/team_knowledge\.mjs"/);
  assert.match(mcpSource, /\.\.\.TEAM_KNOWLEDGE_TOOLS/);
  assert.match(mcpSource, /executeTeamKnowledgeTool\(admin,connector,name,args\)/);
});

test("RAG tem overload limitado para pesquisar vários jogos numa só consulta", () => {
  const migration = fs.readFileSync(path.join(migrationDir, "20260924100001_team_knowledge_multi_match_filter.sql"), "utf8");
  assert.match(migration, /p_match_refs uuid\[\]/i);
  assert.match(migration, /cardinality\(p_match_refs\) > 10/i);
  assert.match(migration, /cardinality\(p_match_refs\) < 1/i);
  assert.match(migration, /k\.match_ref = any\(p_match_refs\)/i);
  assert.match(migration, /p_from is null or k\.source_date is null or k\.source_date >= p_from/i);
  assert.match(migration, /p_to is null or k\.source_date is null or k\.source_date <= p_to/i);
  assert.match(migration, /revoke all on function public\.search_team_knowledge_chunks[\s\S]*from public, anon, authenticated/i);
  assert.match(migration, /grant execute on function public\.search_team_knowledge_chunks[\s\S]*to service_role/i);
});

test("RAG pode equilibrar excertos entre jogos e limita esse modo a filtros explícitos", () => {
  const migration = fs.readFileSync(path.join(migrationDir, "20260924110000_team_knowledge_per_match_limit.sql"), "utf8");
  assert.match(migration, /p_per_match_limit integer/i);
  assert.match(migration, /p_match_refs is null or p_per_match_limit < 1 or p_per_match_limit > 4/i);
  assert.match(migration, /semantic_by_match as \([\s\S]*from unnest\(p_match_refs\) requested\(match_ref\)[\s\S]*cross join lateral \([\s\S]*where e\.match_ref = requested\.match_ref[\s\S]*order by e\.embedding <=> p_embedding[\s\S]*limit 48/i);
  assert.match(migration, /lexical_by_match as \([\s\S]*from unnest\(p_match_refs\) requested\(match_ref\)[\s\S]*cross join lateral \([\s\S]*where e\.match_ref = requested\.match_ref[\s\S]*content_tsv @@ plainto_tsquery[\s\S]*limit 48/i);
  assert.match(migration, /partition by e\.match_ref order by f\.rrf desc/i);
  assert.match(migration, /r\.match_rank <= p_per_match_limit/i);
  assert.match(migration, /revoke all on function public\.search_team_knowledge_chunks[\s\S]*from public, anon, authenticated/i);
  assert.match(migration, /grant execute on function public\.search_team_knowledge_chunks[\s\S]*to service_role/i);
});
