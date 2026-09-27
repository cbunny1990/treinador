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
test("barra de baixo numa só linha com Formação ligada (390px)",async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.addInitScript(()=>localStorage.setItem("vision.learning.enabled","1"));
  await page.goto("/#/formacao");
  const tops=await page.locator(".bottom-nav a:visible").evaluateAll(as=>as.map(a=>Math.round(a.getBoundingClientRect().top)));
  expect(tops.length).toBe(7);
  expect(new Set(tops).size).toBe(1);
});
