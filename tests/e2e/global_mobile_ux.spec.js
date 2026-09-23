"use strict";

const { test, expect } = require("@playwright/test");

test("navegação e controlos comuns respeitam alvos de toque em ecrã estreito", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto("/#/calendario");
  await expect(page.getByRole("heading", { name: "Calendário", exact: true })).toBeVisible();
  await expect(page.locator(".calendar-list")).toHaveCount(1);

  const layout = await page.evaluate(() => {
    const targets = Array.from(document.querySelectorAll("button, a, input:not([type=checkbox]):not([type=radio]):not([type=hidden]), select, textarea"))
      .filter((element) => element.getClientRects().length > 0)
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          label: element.getAttribute("aria-label") || element.innerText?.trim() || element.tagName.toLowerCase(),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        };
      });
    return { viewport: innerWidth, content: document.documentElement.scrollWidth, targets };
  });

  expect(layout.content).toBeLessThanOrEqual(layout.viewport);
  expect(layout.targets.filter((target) => target.width < 44 || target.height < 44)).toEqual([]);
});

test("calendário mantém uma única lista e não cria overflow em desktop", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/#/calendario");
  await expect(page.getByRole("heading", { name: "Calendário", exact: true })).toBeVisible();
  const layout = await page.evaluate(() => ({ width: innerWidth, content: document.documentElement.scrollWidth }));
  expect(layout.content).toBeLessThanOrEqual(layout.width);
  await expect(page.locator(".calendar-list")).toHaveCount(1);
});

test("sincronização mantém a posição de leitura quando a página atualiza", async ({ page }) => {
  await page.goto("/#/calendario");
  await page.waitForFunction(() => typeof routerRunning === "boolean" && !routerRunning);
  await page.locator("#app").evaluate(element => { element.style.minHeight = "2000px"; });
  await page.evaluate(() => window.scrollTo(0, 720));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(600);
  const before = await page.evaluate(() => window.scrollY);
  await page.evaluate(async () => {
    const originalRouteOnce = routeOnce;
    routeOnce = async () => {
      await new Promise(resolve => setTimeout(resolve, 80));
      return originalRouteOnce();
    };
    try {
      const inFlightRoute = router();
      setTimeout(() => window.dispatchEvent(new CustomEvent("visioncoach:sync-complete", { detail: { conflicts: [] } })), 10);
      await inFlightRoute;
    } finally {
      routeOnce = originalRouteOnce;
    }
  });
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThanOrEqual(before - 4);
  await expect(page.getByRole("heading", { name: "Calendário", exact: true })).toBeVisible();
});

test("aviso do PWA é anunciado e fica acessível acima da navegação móvel", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#/equipa/jogador/novo");
  const nameField = page.locator('form[data-form="player"] [name="nome"]');
  await nameField.fill("texto por guardar");
  await page.waitForFunction(() => !!navigator.serviceWorker?.controller);
  await page.evaluate(() => {
    navigator.serviceWorker.dispatchEvent(new Event("controllerchange"));
    navigator.serviceWorker.dispatchEvent(new Event("controllerchange"));
  });
  const notice = page.getByRole("status").filter({ hasText: "Atualização disponível" });
  await expect(notice).toBeVisible();
  await expect(page.getByRole("button", { name: "Atualizar app" })).toBeVisible();
  await expect(nameField).toHaveValue("texto por guardar");
  expect(await page.evaluate(() => sessionStorage.getItem("vision-sw-reloaded-v122"))).toBeNull();
  const position = await notice.evaluate(element => {
    const rect = element.getBoundingClientRect();
    return { fixed: getComputedStyle(element).position, bottom: rect.bottom, navTop: document.querySelector(".bottom-nav").getBoundingClientRect().top };
  });
  expect(position.fixed).toBe("fixed");
  expect(position.bottom).toBeLessThan(position.navTop);
});
