const {test,expect}=require('@playwright/test');
const path=require('node:path'),os=require('node:os');
test.use({serviceWorkers:'block'});
async function seed(page){await page.goto('/#/calendario');await page.waitForFunction(()=>typeof DB!=='undefined'&&typeof MatchVisualUI!=='undefined');return page.evaluate(async()=>{
 RemoteWorkspace.scheduleSync=()=>{};const ids=[],refs=[];
 for(let i=1;i<=7;i++){const ref=crypto.randomUUID();refs.push(ref);ids.push(await DB.criar('jogadores',{team_id:DEFAULT_TEAM_ID,sync_id:ref,nome:'Atleta '+i,numero:i,plantel_ativo:true,estado_disponibilidade:'disponivel'}));}
 const id=await DB.criar('jogos',{team_id:DEFAULT_TEAM_ID,sync_id:crypto.randomUUID(),data:'2026-09-26',adversario:'Adversário E2E',estado:'agendado',callup:{player_ids:refs},lineup:{system:'1-2-1',goalkeeper_id:refs[0],starters:refs.slice(1,5),substitutes:refs.slice(5)},post_game:{conclusoes:'Não alterar a análise'},golos_favor:2});go('#/jogo-visual/'+id);return {id,ids,refs};
});}
async function start(page){page.on('dialog',d=>d.accept());await page.evaluate(()=>{window._matchTime=Date.now();Date.now=()=>window._matchTime;});await page.getByRole('button',{name:'Iniciar jogo e contar minutos',exact:true}).click();await expect(page.getByRole('button',{name:'Pausar / intervalo',exact:true})).toBeVisible();}
async function saved(page){await expect(page.locator('[data-match-feedback]')).toHaveText('Alteração guardada neste dispositivo.');await expect(page.getByRole('button',{name:'Repor posições no campo',exact:true})).toBeEnabled();}
for(const viewport of [{width:390,height:844},{width:1440,height:900}])test('5v5 board, timed substitutions, undo, reload, offline and finish '+viewport.width,async({page,context})=>{
 await page.setViewportSize(viewport);const errors=[];page.on('pageerror',e=>errors.push(e.message));const f=await seed(page);await expect(page.locator('[data-pitch-role]')).toHaveCount(5);
 await page.locator('[data-pitch-role="def"]').click();const box=await page.locator('[data-match-pitch]').boundingBox();await page.mouse.click(box.x+box.width*.5,box.y+box.height*.5);await saved(page);
 expect(await page.evaluate(id=>DB.obter('jogos',id).then(r=>r.visual_match.layout.def.y),f.id)).toBeCloseTo(.5,1);
 const lineup=page.locator('[data-match-form="lineup"]');await lineup.locator('[name="front"]').selectOption(f.refs[5]);await lineup.getByRole('button',{name:'Guardar alinhamento visual',exact:true}).click();await saved(page);
 await start(page);await page.evaluate(()=>window._matchTime+=300000);const sub=page.locator('[data-match-form="substitution"]');await sub.locator('[name="out_ref"]').selectOption(f.refs[1]);await sub.locator('[name="in_ref"]').selectOption(f.refs[6]);await sub.getByRole('button',{name:'Registar substituição',exact:true}).click();await saved(page);
 await page.evaluate(()=>window._matchTime+=120000);await page.getByRole('button',{name:'Pausar / intervalo',exact:true}).click();await expect(page.getByRole('button',{name:'Retomar jogo',exact:true})).toBeEnabled();
 let snap=await page.evaluate(async id=>VisionMatchVisual.replay(await DB.obter('jogos',id)),f.id);expect(snap.total_ms).toBe(420000);expect(snap.players.find(p=>p.ref===f.refs[1]).elapsed_ms).toBe(300000);expect(snap.players.find(p=>p.ref===f.refs[6]).elapsed_ms).toBe(120000);expect(snap.players.find(p=>p.ref===f.refs[4]).elapsed_ms).toBe(0);
 await page.screenshot({path:path.join(os.tmpdir(),'vision-match-visual-'+viewport.width+'.png'),fullPage:true});await page.reload();await expect(page.getByRole('button',{name:'Retomar jogo',exact:true})).toBeEnabled();await expect(page.locator('[data-match-clock]')).toHaveText('07:00');
 await page.getByRole('button',{name:'Anular último movimento',exact:true}).click();await saved(page);snap=await page.evaluate(async id=>VisionMatchVisual.replay(await DB.obter('jogos',id)),f.id);expect(snap.players.find(p=>p.ref===f.refs[6]).elapsed_ms).toBe(0);expect(snap.players.find(p=>p.ref===f.refs[1]).elapsed_ms).toBe(420000);
 await context.setOffline(true);await page.getByRole('button',{name:'Terminar utilização',exact:true}).click();await saved(page);const raw=await page.evaluate(id=>DB.obter('jogos',id),f.id);expect(raw.visual_match.status).toBe('completed');expect(raw.golos_favor).toBe(2);expect(raw.post_game.conclusoes).toBe('Não alterar a análise');expect(raw.sync_dirty).toBe(true);
 await page.getByRole('button',{name:'Apagar registo de utilização',exact:true}).click();await expect(page.getByRole('button',{name:'Iniciar jogo e contar minutos',exact:true})).toBeVisible();expect((await page.evaluate(id=>DB.obter('jogos',id),f.id)).lineup).toEqual(raw.lineup);expect(errors).toEqual([]);await context.setOffline(false);
});
test('rotations can be edited, applied at actual time, and unexecuted plans deleted',async({page})=>{
 const f=await seed(page);const form=page.locator('[data-match-form="rotation"]');await form.locator('[name="out_ref"]').selectOption(f.refs[1]);await form.locator('[name="in_ref"]').selectOption(f.refs[5]);await form.getByRole('button',{name:'Guardar rotação',exact:true}).click();await saved(page);
 await page.getByRole('button',{name:'Editar rotação',exact:true}).click();await form.locator('[name="at_min"]').fill('6');await form.getByRole('button',{name:'Guardar rotação',exact:true}).click();await saved(page);
 await start(page);await page.evaluate(()=>window._matchTime+=660000);await expect(page.locator('[data-rotation-due]')).toBeVisible();await page.getByRole('button',{name:'Realizar agora',exact:true}).click();await saved(page);
 const r=await page.evaluate(id=>DB.obter('jogos',id),f.id);expect(r.visual_match.events[0].at_ms).toBe(660000);expect(r.visual_match.rotations[0].at_min).toBe(6);await expect(page.getByText('Realizada',{exact:true})).toBeVisible();
});
test('keeper swap affects GR minutes, not total utilization or lineup history',async({page})=>{
 const f=await seed(page);await start(page);await page.evaluate(()=>window._matchTime+=60000);const form=page.locator('[data-match-form="swap"]');await form.getByRole('button',{name:'Trocar posições agora',exact:true}).click();await saved(page);await page.evaluate(()=>window._matchTime+=60000);await page.getByRole('button',{name:'Pausar / intervalo',exact:true}).click();await saved(page);
 const s=await page.evaluate(async id=>VisionMatchVisual.replay(await DB.obter('jogos',id)),f.id);expect(s.players[0].keeper_ms).toBe(60000);expect(s.players[1].keeper_ms).toBe(60000);expect(s.slots.gr).toBe(f.refs[1]);
 await page.evaluate(id=>go('#/equipa/jogador/'+id),f.ids[0]);await expect(page.getByRole('heading',{name:'Utilização em jogos',exact:true})).toBeVisible();await expect(page.getByText('02:00 · parcial',{exact:true})).toBeVisible();
});
test('unsaved rotation survives remote data; stale mutation cannot overwrite',async({page})=>{
 const f=await seed(page);const form=page.locator('[data-match-form="rotation"]');await form.locator('[name="out_ref"]').selectOption(f.refs[1]);await form.locator('[name="in_ref"]').selectOption(f.refs[5]);await form.locator('[name="note"]').fill('Ainda não guardar');
 await page.evaluate(async id=>{await DB.modificar('jogos',id,r=>VisionMatchVisual.apply(r,{type:'position',expected_revision:VisionMatchVisual.state(r).revision,role:'def',x:.5,y:.7}));window.dispatchEvent(new CustomEvent('visioncoach:sync-complete'));},f.id);await expect(page.locator('[data-match-remote]')).toBeVisible();await expect(form.locator('[name="note"]')).toHaveValue('Ainda não guardar');await form.getByRole('button',{name:'Guardar rotação',exact:true}).click();await expect(page.locator('[data-match-feedback]')).toContainText('mudou');await expect(form.locator('[name="note"]')).toHaveValue('Ainda não guardar');
});
test('legacy forms cannot reset initial roster after start; independent notes retain latest movements',async({page})=>{
 const f=await seed(page);await start(page);const initial=await page.evaluate(id=>DB.obter('jogos',id).then(r=>r.lineup),f.id);await page.evaluate(id=>go('#/equipa/jogo/'+id),f.id);await page.getByRole('button',{name:'Guardar alinhamento',exact:true}).click();expect((await page.evaluate(id=>DB.obter('jogos',id),f.id)).lineup).toEqual(initial);
 await page.locator('[data-form="match-during"] [name="notes"]').fill('Nota independente');await page.locator('[data-form="match-during"] [type="submit"]').click();await expect.poll(()=>page.evaluate(id=>DB.obter('jogos',id).then(r=>r.during?.notes?.[0]),f.id)).toBe('Nota independente');expect((await page.evaluate(id=>DB.obter('jogos',id),f.id)).visual_match.started_at).toBeTruthy();
});
test('deleted match is not recreated; another controller cannot run same clock',async({page})=>{
 const f=await seed(page);await start(page);await page.evaluate(async id=>{await DB.modificar('jogos',id,r=>({...r,visual_match:{...r.visual_match,controller_id:'other-device',revision:r.visual_match.revision+1}}));await MatchVisualUI.view(id);},f.id);await expect(page.getByRole('button',{name:'Pausar / intervalo',exact:true})).toBeDisabled();
 await page.evaluate(id=>DB.apagar('jogos',id),f.id);await page.getByRole('button',{name:'Repor posições no campo',exact:true}).click();await expect(page.locator('[data-match-feedback]')).toContainText('apagado');expect(await page.evaluate(id=>DB.obter('jogos',id).then(x=>x??null),f.id)).toBeNull();
});

test('planned rotation deletion, lineup clearing and keyboard positioning stay explicit',async({page})=>{
 const f=await seed(page);page.on('dialog',d=>d.accept());const form=page.locator('[data-match-form="rotation"]');
 await form.locator('[name="out_ref"]').selectOption(f.refs[1]);await form.locator('[name="in_ref"]').selectOption(f.refs[5]);await form.getByRole('button',{name:'Guardar rotação',exact:true}).click();await saved(page);
 await page.getByRole('button',{name:'Apagar rotação',exact:true}).click();await expect(page.getByRole('button',{name:'Editar rotação',exact:true})).toHaveCount(0);
 const pawn=page.locator('[data-pitch-role="gr"]');await pawn.focus();await pawn.press('ArrowLeft');await saved(page);expect(await page.evaluate(id=>DB.obter('jogos',id).then(r=>r.visual_match.layout.gr.x),f.id)).toBeCloseTo(.46);
 await page.getByRole('button',{name:'Apagar alinhamento',exact:true}).click();await saved(page);await expect(page.getByRole('button',{name:'Iniciar jogo e contar minutos',exact:true})).toBeDisabled();
 const match=await page.evaluate(id=>DB.obter('jogos',id),f.id);expect(match.lineup.starters).toHaveLength(0);expect(match.callup.player_ids).toHaveLength(7);expect(match.visual_match.events).toHaveLength(0);
});
