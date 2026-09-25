"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { parseMigrationList, migrationHistoryDrift, migrationDriftMessage, migrationDeploymentPlan, migrationDeploymentMessage } = require("../scripts/supabase-migration-preflight.mjs");

const runner = fs.readFileSync(path.join(__dirname, "..", "scripts", "test-supabase-local.mjs"), "utf8");
const remoteAudit = fs.readFileSync(path.join(__dirname, "..", "scripts", "audit-supabase-linked-migrations.mjs"), "utf8");
const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"));

test("Supabase local test runner bounds a stalled CLI status check", () => {
  assert.match(runner, /timeout:\s*15_000/);
  assert.match(runner, /status\.error\?\.code === "ETIMEDOUT"/);
  assert.match(runner, /excedeu 15 segundos a consultar a stack local/);
});

test("Supabase local runner uses the project's pinned Playwright CLI under Node", () => {
  assert.match(runner, /spawnSync\(process\.execPath, \["\.\/node_modules\/@playwright\/test\/cli\.js"/);
  assert.doesNotMatch(runner, /spawnSync\(npx, \["playwright"/);
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

test("Supabase remote deployment audit blocks when a later migration is applied before earlier pending migrations", () => {
  const rows = [
    { local: "20260923120000", remote: "" },
    { local: "20260923120100", remote: "" },
    { local: "20260923145609", remote: "" },
    { local: "20260924100000", remote: "" },
    { local: "20260924100001", remote: "" },
    { local: "20260924101056", remote: "" },
    { local: "20260924110000", remote: "" },
    { local: "20260924120000", remote: "" },
    { local: "20260924144849", remote: "20260924144849" },
  ];
  const plan = migrationDeploymentPlan(rows);
  assert.equal(plan.ready, false);
  assert.equal(plan.latestApplied, "20260924144849");
  assert.equal(plan.appliedOutOfOrder.length, 8);
  assert.deepEqual(plan.unapplied, rows.slice(0, 8).map(row => row.local));
  assert.match(migrationDeploymentMessage(plan), /não aplicou migrations nem alterou dados/);
  assert.match(migrationDeploymentMessage(plan), /Revê a sequência/);
});

test("linked migration audit is read-only and refuses to guess the target project", () => {
  assert.equal(packageJson.scripts["audit:supabase-migrations"], "node scripts/audit-supabase-linked-migrations.mjs");
  assert.match(remoteAudit, /VISION_COACH_SUPABASE_PROJECT_REF/);
  assert.match(remoteAudit, /migration", "list"/);
  assert.doesNotMatch(remoteAudit, /db", "push|migration", "repair|db", "reset|apply_migration/);
});
