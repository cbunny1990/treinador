const {test,expect}=require("@playwright/test");
test.use({serviceWorkers:"block"});
test("interruptor desligado: sem link e rota explica",async({page})=>{
  await page.goto("/#/formacao");
  await expect(page.locator('[data-tab="formacao"]').first()).toBeHidden();
  await expect(page.getByText("A secção Formação está desligada",{exact:false})).toBeVisible();
});
test("interruptor ligado nas Definições mostra o link",async({page})=>{
  await page.goto("/#/definicoes");
  await page.locator("#learning-toggle").check();
  await expect(page.locator('[data-tab="formacao"]:visible')).toHaveCount(1);
  await page.goto("/#/formacao");
  await expect(page.getByText(/Inicia sessão|Sub-8/)).toBeVisible();
});
