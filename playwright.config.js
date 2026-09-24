"use strict";

const { defineConfig } = require("@playwright/test");

module.exports = defineConfig({
  testDir: "./tests/e2e",
  timeout: 30000,
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:18765",
    channel: "chrome",
    viewport: { width: 390, height: 844 },
    serviceWorkers: "allow",
  },
  webServer: {
    command: "node scripts/test-server.mjs",
    url: "http://127.0.0.1:18765",
    cwd: __dirname,
    reuseExistingServer: false,
  },
});
