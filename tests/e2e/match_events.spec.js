const {test,expect}=require('@playwright/test');
const path=require('node:path'),os=require('node:os');
test.use({serviceWorkers:'block'});
async function seed(page){await page.goto('/#/calendario');await page.waitForFunction(()=>typeof DB!=='undefined'&&typeof MatchVisualUI!=='undefined'&&typeof go==='function');return page.evaluate(async()=>{
 RemoteWorkspace.scheduleSync=()=>{};const ids=[],refs=[];
 for(let i=1;i<=7;i++){const ref=crypto.randomUUID();refs.push(ref);ids.push(await DB.criar('jogadores',{team_id:DEFAULT_TEAM_ID,sync_id:ref,nome:'Atleta '+i,numero:i,plantel_ativo:true,estado_disponibilidade:'disponivel'}));}
 const id=await DB.criar('jogos',{team_id:DEFAULT_TEAM_ID,sync_id:crypto.randomUUID(),data:'2026-09-26',adversario:'Adversário E2E',estado:'agendado',callup:{player_ids:refs},lineup:{system:'1-2-1',goalkeeper_id:refs[0],starters:refs.slice(1,5),substitutes:refs.slice(5)},post_game:{conclusoes:'Não alterar a análise'}});go('#/jogo-visual/'+id);return {id,ids,refs};
});}
async function start(page){page.on('dialog',d=>d.accept());await page.evaluate(()=>{window._matchTime=Date.now();Date.now=()=>window._matchTime;});await page.getByRole('button',{name:'Iniciar jogo e contar minutos',exact:true}).click();await expect(page.getByRole('button',{name:'Pausar / intervalo',exact:true})).toBeVisible();}
async function saved(page){await expect(page.locator('[data-event-feedback]')).toHaveText('Lance guardado neste dispositivo.');}
test('events blocked before start, quick record, counted stats and result notice',async({page})=>{
 await page.setViewportSize({width:390,height:844});const f=await seed(page);const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await expect(page.locator('[data-match-events]')).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
 await expect(page.locator('[data-match-events]')).not.toContainText('Resultado registado na ficha');
 await expect(page.getByText('Inicia primeiro a utilização e volta aqui',{exact:false})).toBeVisible();
 await page.evaluate(async id=>{await DB.modificar('jogos',id,row=>({...row,golos_favor:0,golos_contra:0}));await MatchVisualUI.view(id);},f.id);
 await start(page);const quick=page.locator('.match-event-quick');expect(await quick.evaluate(el=>getComputedStyle(el).gridTemplateColumns.split(' ').length)).toBe(2);expect(await quick.locator('button').first().evaluate(el=>el.getBoundingClientRect().height)).toBeGreaterThanOrEqual(48);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();await page.evaluate(()=>window._matchTime+=420000);
 await page.getByRole('button',{name:'Perda de bola',exact:true}).click();
 const form=page.locator('[data-event-form="record"]');
 await expect(form.locator('[name="type"]')).toHaveValue('loss');
 await expect(form.locator('[name="at_min"]')).toHaveValue('7');
 await form.locator('[name="player_ref"]').selectOption({label:'Atleta 2 · #2'});
 await form.locator('[name="zone"]').selectOption('def_c');
 await form.locator('[name="reason"]').selectOption('pass');
 await form.locator('[name="note"]').fill('Passe errado na saída');
 await form.getByRole('button',{name:'Registar lance',exact:true}).click();await saved(page);
 const raw=await page.evaluate(id=>DB.obter('jogos',id),f.id);
 expect(raw.match_events.events[0]).toMatchObject({type:'loss',at_ms:420000,zone:'def_c',reason:'pass'});
 expect(raw.visual_match.status).toBe('running');expect(raw.golos_favor).toBe(0);
 await page.screenshot({path:path.join(os.tmpdir(),'vision-match-events-390.png'),fullPage:true});
 await expect(page.getByText('07:00 · Perda de bola',{exact:false})).toBeVisible();
 await expect(page.locator('[data-match-events] table')).toContainText('Perdas de bola');
 await expect(page.locator('[data-match-events] table')).toContainText('Passe errado');
 await page.getByRole('button',{name:'Golo a favor',exact:true}).click();await page.evaluate(()=>window._matchTime+=60000);
 await form.getByRole('button',{name:'Registar lance',exact:true}).click();await saved(page);
 await expect(page.getByText('Golos contados nos lances: 1–0',{exact:false})).toBeVisible();
 expect(errors).toEqual([]);
});
test('offline recording, pause-gated edit and delete, possession provenance',async({page,context})=>{
 const f=await seed(page);await start(page);
 const form=page.locator('[data-event-form="record"]');
 await context.setOffline(true);
 await page.evaluate(()=>window._matchTime+=120000);
 await page.getByRole('button',{name:'Remate à baliza',exact:true}).click();
 await form.locator('[name="side"]').selectOption('propia');
 await form.getByRole('button',{name:'Registar lance',exact:true}).click();await saved(page);
 expect((await page.evaluate(id=>DB.obter('jogos',id),f.id)).sync_dirty).toBe(true);
 await page.getByRole('button',{name:'Pausar / intervalo',exact:true}).click();
 await expect(page.getByRole('button',{name:'Editar lance',exact:true})).toBeEnabled();
 await page.getByRole('button',{name:'Editar lance',exact:true}).click();
 await expect(form.locator('[name="type"]')).toBeDisabled();
 await form.locator('[name="zone"]').selectOption('ata_c');
 await form.getByRole('button',{name:'Registar lance',exact:true}).click();await saved(page);
 const edited=await page.evaluate(id=>DB.obter('jogos',id).then(r=>r.match_events.events[0]),f.id);
 expect(edited.zone).toBe('ata_c');expect(edited.edited_by).toBeTruthy();
 await page.getByRole('button',{name:'Apagar lance',exact:true}).click();
 await expect(page.locator('[data-event-feedback]')).toHaveText('Lance apagado neste dispositivo.');
 expect((await page.evaluate(id=>DB.obter('jogos',id),f.id)).match_events.events).toHaveLength(0);
 const poss=page.locator('[data-event-form="possession"]');
 await poss.locator('[name="kind"]').selectOption('estimated');
 await poss.locator('[name="value"]').fill('55');
 await poss.getByRole('button',{name:'Guardar posse',exact:true}).click();
 await expect(page.locator('[data-match-events]')).toContainText('Estimada (introduzida por ti)');
 await expect(context.request!==null).toBeTruthy();await context.setOffline(false);
});
test('sync refresh does not replace an event form with unsaved coach text',async({page})=>{
 await seed(page);await start(page);
 await page.getByRole('button',{name:'Perda de bola',exact:true}).click();
 const form=page.locator('[data-event-form="record"]');
 await form.locator('[name="note"]').fill('Pressão no corredor central');
 await page.evaluate(()=>window.dispatchEvent(new CustomEvent('visioncoach:sync-complete',{detail:{conflicts:[]}})));
 await expect(form.locator('[name="note"]')).toHaveValue('Pressão no corredor central');
 await expect(page.locator('[data-match-remote]')).toBeVisible();
 await page.setViewportSize({width:1440,height:900});
 await expect(page.locator('[data-match-events]')).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBeTruthy();
});
