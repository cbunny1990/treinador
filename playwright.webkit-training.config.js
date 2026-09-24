"use strict";

const { defineConfig } = require("@playwright/test");

module.exports = defineConfig({
  testDir: "./tests/e2e",
  testMatch: "training_session.spec.js",
  grep: /session attendance, timer, reload, notes, finish and reset 390/,
  timeout: 30000,
  workers: 1,
  use: {
    browserName: "webkit",
    baseURL: "http://127.0.0.1:18770",
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    serviceWorkers: "allow",
  },
  webServer: {
    command: "node scripts/test-server.mjs",
    url: "http://127.0.0.1:18770",
    cwd: __dirname,
    reuseExistingServer: false,
    env: { VISION_TEST_PORT: "18770" },
  },
});
