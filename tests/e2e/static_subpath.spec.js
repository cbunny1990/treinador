const { test, expect } = require("@playwright/test");

test("app and assets load from a static-host subdirectory", async ({ page, baseURL }) => {
  const failedSameOrigin = [];
  page.on("requestfailed", request => {
    if (request.url().startsWith(baseURL)) failedSameOrigin.push(request.url());
  });

  await page.goto(baseURL);
  await expect(page.getByRole("heading", { name: "Equipa principal" })).toBeVisible();
  await page.goto(`${baseURL}#/definicoes`);
  await expect(page.locator("#titulo")).toContainText("Definições");

  const hosting = await page.evaluate(async () => {
    const manifestResponse = await fetch(document.querySelector('link[rel="manifest"]').href);
    const manifest = await manifestResponse.json();
    const registration = await navigator.serviceWorker.ready;
    return {
      manifestOk: manifestResponse.ok,
      startUrl: new URL(manifest.start_url, location.href).pathname,
      manifestScope: new URL(manifest.scope, location.href).pathname,
      workerScope: new URL(registration.scope).pathname,
      indexCached: !!(await caches.match(new URL("index.html", registration.scope))),
    };
  });

  expect(hosting).toEqual({
    manifestOk: true,
    startUrl: "/treinador/index.html",
    manifestScope: "/treinador/",
    workerScope: "/treinador/",
    indexCached: true,
  });
  expect(failedSameOrigin).toEqual([]);
});
