"use strict";

const { defineConfig } = require("@playwright/test");

module.exports = defineConfig({
  testDir: "./tests/e2e",
  testMatch: "match_visual.spec.js",
  grep: /5v5 board, timed substitutions, undo, reload, offline and finish 390|mobile tactical board has touch-sized targets and no horizontal overflow/,
  timeout: 30000,
  workers: 1,
  use: {
    browserName: "webkit",
    baseURL: "http://127.0.0.1:18769",
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    serviceWorkers: "allow",
  },
  webServer: {
    command: "node scripts/test-server.mjs",
    url: "http://127.0.0.1:18769",
    cwd: __dirname,
    reuseExistingServer: false,
    env: { VISION_TEST_PORT: "18769" },
  },
});
