"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const runner = fs.readFileSync(path.join(__dirname, "..", "scripts", "test-supabase-local.mjs"), "utf8");

test("Supabase local test runner bounds a stalled CLI status check", () => {
  assert.match(runner, /timeout:\s*15_000/);
  assert.match(runner, /status\.error\?\.code === "ETIMEDOUT"/);
  assert.match(runner, /excedeu 15 segundos a consultar a stack local/);
});
