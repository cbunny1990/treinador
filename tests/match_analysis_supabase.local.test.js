"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { createClient } = require("@supabase/supabase-js");
const { executeMatchAnalysisTool } = require("../supabase/functions/vision-coach-mcp/match_analysis.mjs");

const url = process.env.VISION_COACH_SUPABASE_LOCAL_URL || "";
const serviceKey = process.env.VISION_COACH_SUPABASE_LOCAL_SERVICE_KEY || "";
const enabled = !!(url && serviceKey);
const isLoopback = (value) => ["localhost", "127.0.0.1", "::1"].includes(new URL(value).hostname);

test("PostgREST orders recurring match evidence by game date and reports partial history", {
  skip: !enabled && "requer URL e service key de uma stack Supabase local; nunca usar produção",
  timeout: 60_000,
}, async () => {
  assert.ok(isLoopback(url), "Este teste aceita apenas Supabase em localhost.");
  const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const userId = crypto.randomUUID();
  const recordIds = Array.from({ length: 5 }, () => crypto.randomUUID());
  const teamIds = [crypto.randomUUID(), crypto.randomUUID()];
  const email = `match-analysis-${crypto.randomUUID()}@vision-coach.local`;
  const createdUser = await admin.auth.admin.createUser({ id: userId, email, password: crypto.randomBytes(24).toString("base64url"), email_confirm: true });
  assert.ifError(createdUser.error);

  try {
    const teams = await admin.from("teams").insert(teamIds.map((id, i) => ({ id, owner_id: userId, name: `Equipa MCP sintética ${i + 1}` })));
    assert.ifError(teams.error);
    const matchRows = [
      { id: recordIds[0], team_id: teamIds[0], kind: "match", updated_at: "2026-09-25T10:00:00.000Z", payload: { data: "2026-09-01", adversario: "Jogo antigo", match_events: { events: [{ id: "loss-old", type: "loss", at_ms: 60_000, reason: "pass", zone: "def_c" }] } } },
      { id: recordIds[1], team_id: teamIds[0], kind: "match", updated_at: "2026-09-21T10:00:00.000Z", payload: { data: "2026-09-03", adversario: "Jogo intermédio", match_events: { events: [{ id: "loss-mid", type: "loss", at_ms: 60_000, reason: "pass", zone: "def_c" }] } } },
      { id: recordIds[2], team_id: teamIds[0], kind: "match", updated_at: "2026-09-23T10:00:00.000Z", payload: { data: "2026-09-04", adversario: "Jogo recente", match_events: { events: [{ id: "loss-new", type: "loss", at_ms: 60_000, reason: "pass", zone: "def_c" }] } } },
      { id: recordIds[3], team_id: teamIds[0], kind: "match", updated_at: "2026-09-24T10:00:00.000Z", payload: { data: null, adversario: "Jogo sem data", match_events: { events: [{ id: "loss-undated", type: "loss", at_ms: 60_000, reason: "pass", zone: "def_c" }] } } },
      { id: recordIds[4], team_id: teamIds[1], kind: "match", updated_at: "2026-09-25T12:00:00.000Z", payload: { data: "2026-09-05", adversario: "Outra equipa", match_events: { events: [{ id: "loss-foreign", type: "loss", at_ms: 60_000, reason: "pass", zone: "def_c" }] } } },
    ];
    const inserted = await admin.from("workspace_records").insert(matchRows);
    assert.ifError(inserted.error);

    const connector = { id: "synthetic-read", team_id: teamIds[0], scopes: ["read"] };
    const partial = await executeMatchAnalysisTool(admin, connector, "get_recurring_match_patterns", { limit: 2 });
    assert.equal(partial.matches_examined, 2);
    assert.equal(partial.match_limit, 2);
    assert.equal(partial.additional_match_records_unexamined, true);
    assert.match(partial.coverage, /Resultado parcial/);
    const recentPattern = partial.patterns.find((item) => item.reason === "pass" && item.zone === "def_c");
    assert.equal(recentPattern.event_count, 2);
    assert.deepEqual(recentPattern.matches.map((item) => item.opponent), ["Jogo recente", "Jogo intermédio"]);
    assert.equal(JSON.stringify(partial).includes("Outra equipa"), false);

    const allReturned = await executeMatchAnalysisTool(admin, connector, "get_recurring_match_patterns", { limit: 10 });
    assert.equal(allReturned.matches_examined, 4);
    assert.equal(allReturned.additional_match_records_unexamined, false);
    assert.deepEqual(allReturned.patterns.find((item) => item.reason === "pass" && item.zone === "def_c").matches.map((item) => item.opponent), ["Jogo recente", "Jogo intermédio", "Jogo antigo", "Jogo sem data"]);
  } finally {
    const removedRecords = await admin.from("workspace_records").delete().in("id", recordIds);
    assert.ifError(removedRecords.error);
    const removedTeams = await admin.from("teams").delete().in("id", teamIds);
    assert.ifError(removedTeams.error);
    const removedUser = await admin.auth.admin.deleteUser(userId);
    assert.ifError(removedUser.error);
  }
});
