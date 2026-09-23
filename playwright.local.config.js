"use strict";

const base = require("./playwright.config");

module.exports = {
  ...base,
  testDir: "./tests/e2e-local",
};
