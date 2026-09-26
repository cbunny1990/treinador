"use strict";

const { defineConfig } = require("@playwright/test");

module.exports = defineConfig({
  testDir: "./tests/e2e",
  testMatch: "static_subpath.spec.js",
  timeout: 30000,
  workers: 1,
  use: {
    channel: "chrome",
    baseURL: "http://127.0.0.1:18771/treinador/",
    viewport: { width: 390, height: 844 },
    serviceWorkers: "allow",
  },
  webServer: {
    command: "node scripts/test-server.mjs",
    url: "http://127.0.0.1:18771/treinador/",
    cwd: __dirname,
    reuseExistingServer: false,
    env: { VISION_TEST_PORT: "18771", VISION_TEST_BASE_PATH: "/treinador" },
  },
});
