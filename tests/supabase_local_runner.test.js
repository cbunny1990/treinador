"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { parseMigrationList, migrationHistoryDrift, migrationDriftMessage } = require("../scripts/supabase-migration-preflight.mjs");

const runner = fs.readFileSync(path.join(__dirname, "..", "scripts", "test-supabase-local.mjs"), "utf8");

test("Supabase local test runner bounds a stalled CLI status check", () => {
  assert.match(runner, /timeout:\s*15_000/);
  assert.match(runner, /status\.error\?\.code === "ETIMEDOUT"/);
  assert.match(runner, /excedeu 15 segundos a consultar a stack local/);
});

test("Supabase migration preflight accepts an exact current history", () => {
  const rows = parseMigrationList('Connecting to local database...\n{"migrations":[{"local":"20260924100000","remote":"20260924100000"}]}');
  assert.deepEqual(migrationHistoryDrift(rows), { unapplied: [], unknownApplied: [], mismatched: [] });
});

test("Supabase migration preflight reports drift without applying or resetting", () => {
  const drift = migrationHistoryDrift([
    { local: "20260924100000", remote: "" },
    { local: "", remote: "20260924100001" },
    { local: "20260924100002", remote: "20260924100003" },
  ]);
  assert.deepEqual(drift, {
    unapplied: ["20260924100000"],
    unknownApplied: ["20260924100001"],
    mismatched: [{ local: "20260924100002", remote: "20260924100003" }],
  });
  const message = migrationDriftMessage(drift);
  assert.match(message, /interrompidos sem aplicar migrations nem fazer reset/);
  assert.match(message, /20260924100000/);
  assert.match(message, /20260924100001/);
  assert.match(message, /20260924100002 \/ 20260924100003/);
});
