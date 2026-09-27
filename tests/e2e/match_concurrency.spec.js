const {test,expect}=require('@playwright/test');

test.use({serviceWorkers:'block'});

for(const width of [390,1440])test(`formulários do jogo não substituem edições concorrentes · ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:844});
 await page.goto('/#/calendario');
 await page.waitForFunction(()=>typeof DB!=='undefined'&&typeof go==='function');
 const {id,refs}=await page.evaluate(async()=>{
  RemoteWorkspace.scheduleSync=()=>{};
  const refs=[];
  for(let i=0;i<2;i++){const ref=crypto.randomUUID();refs.push(ref);await DB.criar('jogadores',{team_id:DEFAULT_TEAM_ID,sync_id:ref,nome:'Convocado '+(i+1),plantel_ativo:true,estado_disponibilidade:'disponivel'});}
  const id=await DB.criar('jogos',{team_id:DEFAULT_TEAM_ID,sync_id:crypto.randomUUID(),data:'2026-09-27',adversario:'Edições concorrentes',estado:'concluido',golos_favor:1,golos_contra:1,notas:'Inicial',pre_game:{plano_jogo:'Plano inicial',pontos_observar:[]},callup:{player_ids:refs,notes:'Nota inicial'},lineup:{goalkeeper_id:refs[0],starters:[refs[1]],substitutes:[]},during:{halftime_score:'1-0',notes:['Nota inicial']}});
  go('#/equipa/jogo/'+id);return{id,refs};
 });
 const dialogs=[];
 page.on('dialog',async dialog=>{dialogs.push(dialog.message());await dialog.accept();});

 const pre=page.locator('form[data-form="match-pre"]');
 await expect(pre).toBeVisible();
 await pre.locator('[name="plano_jogo"]').fill('Plano escrito neste dispositivo');
 await page.evaluate(id=>DB.modificar('jogos',id,row=>({...row,pre_game:{...row.pre_game,plano_jogo:'Plano do outro dispositivo'}})),id);
 await pre.getByRole('button',{name:'Guardar plano'}).click();
 await expect.poll(()=>dialogs.length).toBe(1);
 expect(dialogs[0]).toContain('plano pré-jogo mudou');
 await expect(pre.locator('[name="plano_jogo"]')).toHaveValue('Plano escrito neste dispositivo');
 expect(await page.evaluate(id=>DB.obter('jogos',id).then(row=>row.pre_game.plano_jogo),id)).toBe('Plano do outro dispositivo');

 await page.reload();
 await expect(pre).toBeVisible();
 await pre.locator('[name="plano_jogo"]').fill('Plano revisto pelo treinador');
 await page.evaluate(id=>DB.modificar('jogos',id,row=>({...row,pre_game:{...row.pre_game,objetivo_principal:'Objetivo do outro dispositivo',adversario_notas:'Texto histórico preservado'}})),id);
 await pre.getByRole('button',{name:'Guardar plano'}).click();
 await expect.poll(()=>page.evaluate(id=>DB.obter('jogos',id).then(row=>row.pre_game.plano_jogo),id)).toBe('Plano revisto pelo treinador');
 expect(await page.evaluate(id=>DB.obter('jogos',id).then(row=>row.pre_game.objetivo_principal),id)).toBe('Objetivo do outro dispositivo');
 expect(await page.evaluate(id=>DB.obter('jogos',id).then(row=>row.pre_game.adversario_notas),id)).toBe('Texto histórico preservado');
 expect(dialogs).toHaveLength(1);

 await page.reload();
 const callup=page.locator('form[data-form="match-callup"]');
 await expect(callup).toBeVisible();
 await callup.locator('[name="notes"]').fill('Convocatória local');
 await page.evaluate(id=>DB.modificar('jogos',id,row=>({...row,callup:{...row.callup,notes:'Convocatória remota'}})),id);
 await callup.getByRole('button',{name:'Guardar convocatória'}).click();
 await expect.poll(()=>dialogs.length).toBe(2);
 expect(dialogs[1]).toContain('convocatória mudou');
 await expect(callup.locator('[name="notes"]')).toHaveValue('Convocatória local');
 expect(await page.evaluate(id=>DB.obter('jogos',id).then(row=>row.callup.notes),id)).toBe('Convocatória remota');

 await page.reload();
 await expect(callup).toBeVisible();
 await callup.locator('label.player-choice').filter({hasText:'Convocado 1'}).click();
 await expect(callup.locator(`[name="player_ids"][value="${refs[0]}"]`)).not.toBeChecked();
 await page.evaluate(([id,ref])=>DB.modificar('jogos',id,row=>({...row,lineup:{...row.lineup,goalkeeper_id:ref}})),[id,refs[1]]);
 await callup.getByRole('button',{name:'Guardar convocatória'}).click();
 await expect.poll(()=>dialogs.length).toBe(3);
 expect(dialogs[2]).toContain('alinhamento mudou');
 expect(await page.evaluate(id=>DB.obter('jogos',id).then(row=>row.callup.player_ids),id)).toEqual(refs);

 await page.reload();
 await expect(callup).toBeVisible();
 await callup.locator('[name="notes"]').fill('Nota atualizada sem mexer nos convocados');
 await page.evaluate(id=>DB.modificar('jogos',id,row=>({...row,lineup:{...row.lineup,positions:{goalkeeper:row.lineup.goalkeeper_id}}})),id);
 await callup.getByRole('button',{name:'Guardar convocatória'}).click();
 await expect.poll(()=>page.evaluate(id=>DB.obter('jogos',id).then(row=>row.callup.notes),id)).toBe('Nota atualizada sem mexer nos convocados');
 expect(await page.evaluate(id=>DB.obter('jogos',id).then(row=>row.lineup.positions.goalkeeper),id)).toBe(refs[1]);
 expect(dialogs).toHaveLength(3);

 await page.reload();
 const notes=page.locator('form[data-form="match-during"]');
 await expect(notes).toBeAttached();
 await page.locator('details:has(form[data-form="match-during"]) summary').click();
 await notes.locator('[name="notes"]').fill('Nota local');
 await page.evaluate(id=>DB.modificar('jogos',id,row=>({...row,during:{...row.during,notes:['Nota remota']}})),id);
 await notes.getByRole('button',{name:'Guardar notas do jogo'}).click();
 await expect.poll(()=>dialogs.length).toBe(4);
 expect(dialogs[3]).toContain('notas do jogo mudaram');
 await expect(notes.locator('[name="notes"]')).toHaveValue('Nota local');
 expect(await page.evaluate(id=>DB.obter('jogos',id).then(row=>row.during.notes),id)).toEqual(['Nota remota']);

 await page.goto('/#/equipa/jogo/'+id+'/editar');
 const details=page.locator('form[data-form="match"]');
 await expect(details).toBeVisible();
 await details.locator('[name="adversario"]').fill('Adversário local');
 await page.evaluate(id=>DB.modificar('jogos',id,row=>({...row,adversario:'Adversário remoto'})),id);
 await details.getByRole('button',{name:'Guardar jogo'}).click();
 await expect.poll(()=>dialogs.length).toBe(5);
 expect(dialogs[4]).toContain('dados do jogo mudaram');
 await expect(details.locator('[name="adversario"]')).toHaveValue('Adversário local');
 expect(await page.evaluate(id=>DB.obter('jogos',id).then(row=>row.adversario),id)).toBe('Adversário remoto');

 await page.reload();
 await expect(details.locator('[name="adversario"]')).toHaveValue('Adversário remoto');
 await details.locator('[name="local"]').fill('Campo novo');
 await page.evaluate(id=>DB.modificar('jogos',id,row=>({...row,notas:'Notas gerais do outro dispositivo',post_game:{...row.post_game,conclusoes:'Outra secção atualizada'}})),id);
 await details.getByRole('button',{name:'Guardar jogo'}).click();
 await expect.poll(()=>page.evaluate(id=>DB.obter('jogos',id).then(row=>row.local),id)).toBe('Campo novo');
 expect(await page.evaluate(id=>DB.obter('jogos',id).then(row=>row.notas),id)).toBe('Notas gerais do outro dispositivo');
 expect(await page.evaluate(id=>DB.obter('jogos',id).then(row=>row.post_game.conclusoes),id)).toBe('Outra secção atualizada');
 expect(dialogs).toHaveLength(5);
});

test('jogo de outra equipa não abre nem pode ser alterado ou apagado pelo ID local',async({page})=>{
 await page.goto('/#/calendario');
 await page.waitForFunction(()=>typeof DB!=='undefined'&&typeof go==='function');
 const id=await page.evaluate(async()=>{
  RemoteWorkspace.scheduleSync=()=>{};
  return DB.criar('jogos',{team_id:'outra-equipa',sync_id:crypto.randomUUID(),data:'2026-09-27',adversario:'Jogo privado',estado:'concluido'});
 });
 const access=await page.evaluate(async id=>{
  let changeError='',deleteError='';
  try{await DB.modificar('jogos',id,row=>({...row,adversario:'Alterado'}));}catch(error){changeError=error.message;}
  try{await DB.apagar('jogos',id);}catch(error){deleteError=error.message;}
  return {read:await DB.obter('jogos',id),changeError,deleteError,raw:(await DB.listar('jogos')).find(row=>row.id===id)};
 },id);
 expect(access.read).toBeUndefined();
 expect(access.changeError).toContain('outra equipa');
 expect(access.deleteError).toContain('outra equipa');
 expect(access.raw.adversario).toBe('Jogo privado');
 await page.goto('/#/equipa/jogo/'+id);
 await expect(page).toHaveURL(/#\/equipa$/);
 await page.goto('/#/equipa/jogo/'+id+'/editar');
 await expect(page).toHaveURL(/#\/calendario$/);
 await page.goto('/#/jogo-visual/'+id);
 await expect(page.getByRole('heading',{name:'Jogo indisponível'})).toBeVisible();
 await expect(page.getByText('Jogo privado')).toHaveCount(0);
});
