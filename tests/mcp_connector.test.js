"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const migrations = fs.readdirSync(path.join(root, "supabase", "migrations"))
  .filter((name) => name.endsWith(".sql"))
  .sort()
  .map((name) => fs.readFileSync(path.join(root, "supabase", "migrations", name), "utf8"))
  .join("\n");
const manager = fs.readFileSync(path.join(root, "supabase", "functions", "vision-coach-connectors", "index.ts"), "utf8");
const mcp = fs.readFileSync(path.join(root, "supabase", "functions", "vision-coach-mcp", "index.ts"), "utf8");
const config = fs.readFileSync(path.join(root, "supabase", "config.toml"), "utf8");
const browser = fs.readFileSync(path.join(root, "js", "mcp_connectors.js"), "utf8");

test("tokens MCP ficam em schema privado e só como hash", () => {
  assert.match(migrations, /private\.mcp_connector_tokens/i);
  assert.match(migrations, /token_hash\s+text\s+not null\s+unique/i);
  assert.match(migrations, /revoke all on private\.mcp_connector_tokens from public, anon, authenticated/i);
  assert.doesNotMatch(migrations, /token_value|raw_token/i);
});

test("RPCs de conector são exclusivas de service_role", () => {
  for (const name of ["mcp_connector_create", "mcp_connector_list", "mcp_connector_revoke", "mcp_connector_lookup"]) {
    assert.match(migrations, new RegExp("revoke all on function public\\." + name + "[\\s\\S]*from public, anon, authenticated", "i"));
    assert.match(migrations, new RegExp("grant execute on function public\\." + name + "[\\s\\S]*to service_role", "i"));
  }
});

test("gestor exige JWT e MCP usa autenticação própria", () => {
  assert.match(config, /\[functions\.vision-coach-connectors\][\s\S]*verify_jwt\s*=\s*true/i);
  assert.match(config, /\[functions\.vision-coach-mcp\][\s\S]*verify_jwt\s*=\s*false/i);
  assert.match(manager, /auth\.getUser\(accessToken\)/);
  assert.match(manager, /team_owner_required/);
  assert.match(mcp, /token\.startsWith\("vcmcp_"\)/);
  assert.match(mcp, /mcp_connector_lookup/);
  assert.match(mcp, /connector_scope_/);
});

test("MCP expõe ferramentas Vision Coach essenciais", () => {
  for (const tool of [
    "workspace_summary", "search_workspace", "list_matches", "get_match",
    "list_exercises", "list_trainings", "create_exercise", "create_training",
    "update_match_pre_game", "add_external_media",
  ]) assert.match(mcp, new RegExp('name: "' + tool + '"'));
  assert.match(mcp, /2026-07-28/);
  assert.match(mcp, /2025-11-25/);
});

test("browser não persiste token MCP", () => {
  assert.doesNotMatch(browser, /localStorage|sessionStorage|indexedDB|DB\./);
  assert.match(browser, /_mcpLastCredential/);
  assert.match(browser, /clearCredential/);
});

test("Edge Functions não contêm credenciais privadas hardcoded", () => {
  assert.doesNotMatch(manager, /sb_secret_[A-Za-z0-9_-]+/);
  assert.doesNotMatch(mcp, /sb_secret_[A-Za-z0-9_-]+/);
  assert.match(manager, /Deno\.env\.get\("SUPABASE_SERVICE_ROLE_KEY"\)/);
  assert.match(mcp, /Deno\.env\.get\("SUPABASE_SERVICE_ROLE_KEY"\)/);
});
