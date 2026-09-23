const {test,expect}=require('@playwright/test');
const path=require('node:path'),os=require('node:os');
test.use({serviceWorkers:'block'});
async function seed(page){await page.goto('/#/calendario');await page.waitForFunction(()=>typeof DB!=='undefined'&&typeof MatchVisualUI!=='undefined'&&typeof RemoteWorkspace!=='undefined'&&typeof go==='function');return page.evaluate(async()=>{
 RemoteWorkspace.scheduleSync=()=>{};const ids=[],refs=[];
 for(let i=1;i<=7;i++){const ref=crypto.randomUUID();refs.push(ref);ids.push(await DB.criar('jogadores',{team_id:DEFAULT_TEAM_ID,sync_id:ref,nome:'Atleta '+i,numero:i,plantel_ativo:true,estado_disponibilidade:'disponivel'}));}
 const id=await DB.criar('jogos',{team_id:DEFAULT_TEAM_ID,sync_id:crypto.randomUUID(),data:'2026-09-26',adversario:'Adversário E2E',estado:'agendado',callup:{player_ids:refs},lineup:{system:'1-2-1',goalkeeper_id:refs[0],starters:refs.slice(1,5),substitutes:refs.slice(5)},post_game:{conclusoes:'Não alterar a análise'},golos_favor:2});go('#/jogo-visual/'+id);return {id,ids,refs};
});}
async function start(page){page.on('dialog',d=>d.accept());await page.evaluate(()=>{window._matchTime=Date.now();Date.now=()=>window._matchTime;});await page.getByRole('button',{name:'Iniciar jogo e contar minutos',exact:true}).click();await expect(page.getByRole('button',{name:'Pausar / intervalo',exact:true})).toBeVisible();}
async function saved(page){await expect(page.locator('[data-match-feedback]')).toHaveText('Alteração guardada neste dispositivo.');await expect(page.getByRole('button',{name:'Repor posições no campo',exact:true})).toBeEnabled();}
test('interval pauses without counting break and second half starts explicitly once',async({page})=>{
 const f=await seed(page);await start(page);await page.evaluate(()=>window._matchTime+=25*60000);await page.getByRole('button',{name:'Pausar / intervalo',exact:true}).click();await saved(page);await expect(page.locator('[data-match-period]')).toHaveText('Parte 1.ª');await expect(page.getByRole('button',{name:'Retomar 1.ª parte',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Iniciar 2.ª parte',exact:true})).toBeVisible();await page.getByRole('button',{name:'Retomar 1.ª parte',exact:true}).click();await saved(page);await page.evaluate(()=>window._matchTime+=10*60000);await page.getByRole('button',{name:'Pausar / intervalo',exact:true}).click();await saved(page);await page.getByRole('button',{name:'Iniciar 2.ª parte',exact:true}).click();await saved(page);await expect(page.locator('[data-match-period]')).toHaveText('Parte 2.ª');let snap=await page.evaluate(async id=>({raw:await DB.obter('jogos',id),view:VisionMatchVisual.replay(await DB.obter('jogos',id))}),f.id);expect(snap.raw.visual_match.second_half_started_at_ms).toBe(35*60000);expect(snap.view.total_ms).toBe(35*60000);expect(snap.view.period).toBe(2);await page.evaluate(()=>window._matchTime+=60000);await expect(page.locator('[data-match-clock]')).toHaveText('36:00');await page.getByRole('button',{name:'Pausar / intervalo',exact:true}).click();await saved(page);await page.reload();await expect(page.locator('[data-match-period]')).toHaveText('Parte 2.ª');await expect(page.getByRole('button',{name:'Retomar 2.ª parte',exact:true})).toBeVisible();snap=await page.evaluate(async id=>VisionMatchVisual.replay(await DB.obter('jogos',id)),f.id);expect(snap.total_ms).toBe(36*60000);
});
for(const viewport of [{width:390,height:844},{width:1440,height:900}])test('5v5 board, timed substitutions, undo, reload, offline and finish '+viewport.width,async({page,context})=>{
 await page.setViewportSize(viewport);const errors=[];page.on('pageerror',e=>errors.push(e.message));const f=await seed(page);await expect(page.locator('[data-pitch-role]')).toHaveCount(5);
 await page.locator('[data-pitch-role="def"]').click();const box=await page.locator('[data-match-pitch]').boundingBox();await page.mouse.click(box.x+box.width*.5,box.y+box.height*.5);await saved(page);
 expect(await page.evaluate(id=>DB.obter('jogos',id).then(r=>r.visual_match.layout.def.y),f.id)).toBeCloseTo(.5,1);
 const lineup=page.locator('[data-match-form="lineup"]');await lineup.locator('[name="front"]').selectOption(f.refs[5]);await lineup.getByRole('button',{name:'Guardar alinhamento visual',exact:true}).click();await saved(page);
 await start(page);await page.evaluate(()=>window._matchTime+=300000);const sub=page.locator('[data-match-form="substitution"]');await sub.locator('[name="out_ref"]').selectOption(f.refs[1]);await sub.locator('[name="in_ref"]').selectOption(f.refs[6]);await sub.getByRole('button',{name:'Registar substituição',exact:true}).click();await saved(page);
 await page.evaluate(()=>window._matchTime+=120000);await page.getByRole('button',{name:'Pausar / intervalo',exact:true}).click();await expect(page.getByRole('button',{name:'Retomar 1.ª parte',exact:true})).toBeEnabled();await expect(page.locator('[data-usage-equity]')).toContainText('Diferença entre maior e menor tempo registado');await expect(page.locator('[data-usage-equity]')).toContainText('Atleta 7');
 let snap=await page.evaluate(async id=>VisionMatchVisual.replay(await DB.obter('jogos',id)),f.id);expect(snap.total_ms).toBe(420000);expect(snap.players.find(p=>p.ref===f.refs[1]).elapsed_ms).toBe(300000);expect(snap.players.find(p=>p.ref===f.refs[6]).elapsed_ms).toBe(120000);expect(snap.players.find(p=>p.ref===f.refs[4]).elapsed_ms).toBe(0);
 await page.screenshot({path:path.join(os.tmpdir(),'vision-match-visual-'+viewport.width+'.png'),fullPage:true});await page.reload();await expect(page.getByRole('button',{name:'Retomar 1.ª parte',exact:true})).toBeEnabled();await expect(page.locator('[data-match-clock]')).toHaveText('07:00');
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
 await page.evaluate(id=>go('#/equipa/jogador/'+id),f.ids[0]);await expect(page.getByRole('heading',{name:'Histórico de jogos',exact:true})).toBeVisible();await expect(page.getByText('02:00 · Guarda-redes, Defesa',{exact:true})).toBeVisible();await expect(page.getByText('Convocações',{exact:true})).toBeVisible();await expect(page.getByText('Titularidades',{exact:true})).toBeVisible();
});
test('unsaved rotation survives remote data; stale mutation cannot overwrite',async({page})=>{
 const f=await seed(page);const form=page.locator('[data-match-form="rotation"]');await form.locator('[name="out_ref"]').selectOption(f.refs[1]);await form.locator('[name="in_ref"]').selectOption(f.refs[5]);await form.locator('[name="note"]').fill('Ainda não guardar');
 await page.evaluate(async id=>{await DB.modificar('jogos',id,r=>VisionMatchVisual.apply(r,{type:'position',expected_revision:VisionMatchVisual.state(r).revision,role:'def',x:.5,y:.7}));window.dispatchEvent(new CustomEvent('visioncoach:sync-complete'));},f.id);await expect(page.locator('[data-match-remote]')).toBeVisible();await expect(form.locator('[name="note"]')).toHaveValue('Ainda não guardar');await form.getByRole('button',{name:'Guardar rotação',exact:true}).click();await expect(page.locator('[data-match-feedback]')).toContainText('mudou');await expect(form.locator('[name="note"]')).toHaveValue('Ainda não guardar');
});
test('match detail uses visual lineup as its single source; independent notes retain latest movements',async({page})=>{
 const f=await seed(page);await start(page);const initial=await page.evaluate(id=>DB.obter('jogos',id).then(r=>r.lineup),f.id);await page.evaluate(id=>go('#/equipa/jogo/'+id),f.id);await expect(page.locator('[data-form="match-lineup"]')).toHaveCount(0);await expect(page.locator('[data-match-lineup-summary]')).toContainText('Sistema 1-2-1');await expect(page.getByRole('link',{name:'Ver jogo visual'})).toBeVisible();expect((await page.evaluate(id=>DB.obter('jogos',id),f.id)).lineup).toEqual(initial);
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

test('mobile tactical board has touch-sized targets and no horizontal overflow',async({page})=>{
 await page.setViewportSize({width:390,height:844});await seed(page);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
 const pawn=page.locator('[data-pitch-role]').first(),pawnBox=await pawn.boundingBox();expect(pawnBox.width).toBeGreaterThanOrEqual(44);expect(pawnBox.height).toBeGreaterThanOrEqual(44);
 const lineup=page.locator('[data-match-form="lineup"]'),rotation=page.locator('[data-match-form="rotation"]');
 expect(await lineup.locator('select').first().evaluate(el=>el.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
 expect(await rotation.locator('select').first().evaluate(el=>el.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
 expect(await rotation.getByRole('button',{name:'Guardar rotação'}).evaluate(el=>el.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
});
test('visual player positions expose the same field zones used by match events',async({page})=>{
 const f=await seed(page),pitch=page.locator('[data-match-pitch]'),box=await pitch.boundingBox();
 await page.locator('[data-pitch-role="gr"]').click();
 await pitch.click({position:{x:box.width*.1,y:box.height*.1}});await saved(page);
 const keeper=page.locator('[data-pitch-role="gr"]');
 await expect(keeper).toHaveAttribute('data-field-zone','ata_e');
 await expect(keeper).toHaveAttribute('aria-label',/Ataque · esquerda/);
 await expect(pitch.locator('.pitch-zone-grid span')).toHaveCount(9);
 const row=await page.evaluate(id=>DB.obter('jogos',id),f.id);
 expect(row.visual_match.layout.gr).toMatchObject({x:expect.any(Number),y:expect.any(Number)});
});
test('pre-match tactical system selection persists, updates the pitch and survives reload',async({page})=>{
 const f=await seed(page);let form=page.locator('[data-match-form="lineup"]');
 await form.locator('[name="system"]').selectOption('3-1');
 await form.locator('[name="front"]').selectOption(f.refs[5]);
 await form.getByRole('button',{name:'Guardar alinhamento visual',exact:true}).click();await saved(page);
 let row=await page.evaluate(id=>DB.obter('jogos',id),f.id);
 const expectedLayout=await page.evaluate(()=>VisionMatchVisual.systemLayout('3-1'));expect(row.lineup.system).toBe('3-1');expect(row.visual_match.layout).toEqual(expectedLayout);
 await page.reload();form=page.locator('[data-match-form="lineup"]');await expect(form.locator('[name="system"]')).toHaveValue('3-1');
 expect(await page.locator('[data-pitch-role="front"]').evaluate(el=>parseFloat(el.style.top))).toBeCloseTo(28);
 row=await page.evaluate(id=>DB.obter('jogos',id),f.id);expect(row.lineup.system).toBe('3-1');expect(row.lineup.positions.front).toBe(f.refs[5]);
});
test('match detail summarizes all tactical systems and preserves legacy lineup positions',async({page})=>{
 const f=await seed(page),form=page.locator('[data-match-form="lineup"]');
 await form.locator('[name="system"]').selectOption('2-2');
 await form.locator('[name="left"]').selectOption(f.refs[2]);
 await form.getByRole('button',{name:'Guardar alinhamento visual',exact:true}).click();await saved(page);
 const before=await page.evaluate(id=>DB.obter('jogos',id),f.id);await page.evaluate(id=>go('#/equipa/jogo/'+id),f.id);
 await expect(page.locator('[data-match-lineup-summary]')).toContainText('Sistema 2-2');
 await expect(page.locator('[data-match-lineup-summary]')).toContainText('Ala esquerda: Atleta 3');
 await expect(page.locator('[data-form="match-lineup"]')).toHaveCount(0);
 expect(await page.evaluate(id=>DB.obter('jogos',id),f.id)).toEqual(before);
});
test('paused timeline can edit or void a non-last movement and recalculates usage on mobile',async({page})=>{
 await page.setViewportSize({width:390,height:844});const f=await seed(page);await start(page);await page.evaluate(()=>window._matchTime+=60000);let form=page.locator('[data-match-form="substitution"]');await form.locator('[name="out_ref"]').selectOption(f.refs[1]);await form.locator('[name="in_ref"]').selectOption(f.refs[5]);await form.getByRole('button',{name:'Registar substituição',exact:true}).click();await saved(page);await page.evaluate(()=>window._matchTime+=60000);form=page.locator('[data-match-form="substitution"]');await form.locator('[name="out_ref"]').selectOption(f.refs[5]);await form.locator('[name="in_ref"]').selectOption(f.refs[6]);await form.getByRole('button',{name:'Registar substituição',exact:true}).click();await saved(page);await page.getByRole('button',{name:'Pausar / intervalo',exact:true}).click();await saved(page);
 const rows=page.locator('.list-item').filter({hasText:'Sai Atleta 2'});await rows.getByRole('button',{name:'Editar movimento'}).click();const edit=rows.locator('form[data-movement-form]');await edit.locator('[name="at_min"]').fill('0.5');await edit.locator('[name="note"]').fill('Hora corrigida');await edit.getByRole('button',{name:'Guardar correção'}).click();await saved(page);let snap=await page.evaluate(async id=>VisionMatchVisual.replay(await DB.obter('jogos',id)),f.id);expect(snap.events[0].at_ms).toBe(30000);expect(snap.players.find(p=>p.ref===f.refs[1]).elapsed_ms).toBe(30000);expect(snap.players.find(p=>p.ref===f.refs[5]).elapsed_ms).toBe(90000);expect(snap.players.find(p=>p.ref===f.refs[6]).elapsed_ms).toBe(0);
 const last=page.locator('.list-item').filter({hasText:'Sai Atleta 6'});await last.getByRole('button',{name:'Apagar movimento'}).click();await saved(page);snap=await page.evaluate(async id=>VisionMatchVisual.replay(await DB.obter('jogos',id)),f.id);expect(snap.players.find(p=>p.ref===f.refs[6]).elapsed_ms).toBe(0);expect((await page.evaluate(id=>DB.obter('jogos',id),f.id)).visual_match.events.filter(e=>e.voided_at)).toHaveLength(1);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
});
test('tactical cones and arrows save on the shared match without changing lineup or minutes',async({page})=>{
 await page.setViewportSize({width:390,height:844});const f=await seed(page);const before=await page.evaluate(id=>DB.obter('jogos',id),f.id);let box=await page.locator('[data-match-pitch]').boundingBox();
 await page.getByRole('button',{name:'Colocar cone',exact:true}).click();await page.locator('[data-match-pitch]').click({position:{x:box.width*.1,y:box.height*.08}});await saved(page);
 await page.getByRole('button',{name:'Desenhar seta',exact:true}).click();box=await page.locator('[data-match-pitch]').boundingBox();await page.locator('[data-match-pitch]').click({position:{x:box.width*.08,y:box.height*.55}});await expect(page.locator('[data-match-feedback]')).toContainText('Origem da seta marcada');await page.locator('[data-match-pitch]').click({position:{x:box.width*.92,y:box.height*.55}});await saved(page);
 let row=await page.evaluate(id=>DB.obter('jogos',id),f.id);expect(row.visual_match.markings.map(m=>m.shape)).toEqual(['cone','arrow']);expect(row.lineup).toEqual(before.lineup);expect(row.visual_match.events).toEqual(before.visual_match?.events||[]);await expect(page.locator('.tactical-cone')).toHaveCount(1);await expect(page.locator('.pitch-markings line')).toHaveCount(1);
 page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'Apagar marcações',exact:true}).click();await saved(page);row=await page.evaluate(id=>DB.obter('jogos',id),f.id);expect(row.visual_match.markings).toEqual([]);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
});
