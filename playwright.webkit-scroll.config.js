"use strict";

const { defineConfig } = require("@playwright/test");

module.exports = defineConfig({
  testDir: "./tests/e2e",
  testMatch: "workspace.spec.js",
  grep: /sync do Workspace corre em fundo, atualiza a vista uma vez e preserva o scroll|sync concluída não repõe o scroll antigo se o treinador rolar durante a atualização/,
  timeout: 30000,
  workers: 1,
  use: {
    browserName: "webkit",
    baseURL: "http://127.0.0.1:18767",
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    serviceWorkers: "allow",
  },
  webServer: {
    command: "node scripts/test-server.mjs",
    url: "http://127.0.0.1:18767",
    cwd: __dirname,
    reuseExistingServer: false,
    env: { VISION_TEST_PORT: "18767" },
  },
});
