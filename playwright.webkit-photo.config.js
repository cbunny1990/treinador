"use strict";

const { defineConfig } = require("@playwright/test");

module.exports = defineConfig({
  testDir: "./tests/e2e",
  testMatch: "workspace.spec.js",
  grep: /foto do atleta persiste na fila|foto grande de telemóvel|foto grande guarda em telemóvel/,
  timeout: 30000,
  workers: 1,
  use: {
    browserName: "webkit",
    baseURL: "http://127.0.0.1:18766",
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    serviceWorkers: "allow",
  },
  webServer: {
    command: "node scripts/test-server.mjs",
    url: "http://127.0.0.1:18766",
    cwd: __dirname,
    reuseExistingServer: false,
    env: { VISION_TEST_PORT: "18766" },
  },
});
