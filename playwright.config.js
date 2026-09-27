"use strict";

const { defineConfig } = require("@playwright/test");
const testPort = process.env.VISION_TEST_PORT || "18765";

module.exports = defineConfig({
  testDir: "./tests/e2e",
  testIgnore: ["tests/e2e/static_subpath.spec.js"],
  timeout: 30000,
  workers: 1,
  use: {
    baseURL: `http://127.0.0.1:${testPort}`,
    channel: "chrome",
    viewport: { width: 390, height: 844 },
    serviceWorkers: "allow",
  },
  webServer: {
    command: "node scripts/test-server.mjs",
    url: `http://127.0.0.1:${testPort}`,
    cwd: __dirname,
    reuseExistingServer: false,
  },
});
