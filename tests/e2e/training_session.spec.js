const {test,expect}=require('@playwright/test');
test.use({serviceWorkers:'block'});
async function seed(page){
  await page.goto('/#/treinos');await page.waitForFunction(()=>typeof go==='function');await expect(page.getByRole('heading',{name:'Planeador de treino'})).toBeVisible();
  const result=await page.evaluate(async()=>{
    RemoteWorkspace.scheduleSync=()=>{};
    const a=crypto.randomUUID(),b=crypto.randomUUID(),p=crypto.randomUUID();
    await DB.criar('exercicios',{team_id:DEFAULT_TEAM_ID,workspace_v2:true,sync_id:a,external_key:'exercise-ativacao-conduzir-passar-dar-opcao',nome:'Passe de teste',objetivo:'Dar apoio',series:1,duracao_serie_min:10,passos:['Passar e mudar de posição']});
    await DB.criar('exercicios',{team_id:DEFAULT_TEAM_ID,workspace_v2:true,sync_id:b,nome:'Jogo de teste',series:1,duracao_serie_min:15});
    const player=await DB.criar('jogadores',{team_id:DEFAULT_TEAM_ID,sync_id:p,nome:'Atleta de teste',plantel_ativo:true,estado_disponibilidade:'disponivel'});
    const id=await DB.criar('treinos',{team_id:DEFAULT_TEAM_ID,sync_id:crypto.randomUUID(),data:'2026-09-24',hora:'19:15',status:'ready',objetivo:'Continuidade',notas:'Plano original',blocos:[{order:0,block_id:'first',exercise_ref:a,exercise_name:'Passe de teste',duration_min:10,notes:'Nota original'},{order:1,block_id:'second',exercise_ref:b,exercise_name:'Jogo de teste',duration_min:15}]});
    go('#/sessao/'+id);return {id,player,p,a,b};
  });
  await expect(page.getByRole('button',{name:'Iniciar treino',exact:true})).toBeVisible();return result;
}
for(const viewport of [{width:390,height:844},{width:1440,height:900}]){
  test('session attendance, timer, reload, notes, finish and reset '+viewport.width,async({page,context})=>{
    await page.setViewportSize(viewport);const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
    const f=await seed(page);
    await expect(page.getByRole('button',{name:'Iniciar treino',exact:true})).toBeVisible();
    await expect(page.getByLabel('Presença de Atleta de teste')).toHaveValue('unknown');
    await page.getByLabel('Presença de Atleta de teste').selectOption('present');
    await expect.poll(()=>page.evaluate(id=>DB.obter('treinos',id).then(t=>t.session?.attendance?.[0]?.status),f.id)).toBe('present');
    await page.getByRole('button',{name:'Iniciar treino',exact:true}).click();
    await expect(page.getByRole('button',{name:'Pausar',exact:true})).toBeVisible();
    await page.evaluate(()=>{const old=Date.now;Date.now=()=>old()+65000;});
    await page.screenshot({path:require('node:path').join(require('node:os').tmpdir(),'vision-training-session-'+viewport.width+'.png'),fullPage:true});
    await page.getByRole('button',{name:'Pausar',exact:true}).click();
    await expect(page.getByRole('button',{name:'Retomar',exact:true})).toBeVisible();
    const paused=await page.evaluate(id=>DB.obter('treinos',id),f.id);expect(paused.session.blocks[0].elapsed_ms).toBeGreaterThanOrEqual(65000);
    await page.locator('[data-session-note-form] textarea').fill('Melhor apoio depois do passe');
    await page.getByRole('button',{name:'Guardar observação',exact:true}).click();
    await expect(page.locator('.session-observation p')).toHaveText('Melhor apoio depois do passe');
    await page.reload();await expect(page.getByRole('button',{name:'Retomar',exact:true})).toBeVisible();
    await expect(page.locator('.session-observation p')).toHaveText('Melhor apoio depois do passe');
    await page.getByRole('button',{name:'Editar',exact:true}).click();await page.locator('[data-session-note-form] textarea').fill('Apoio corrigido');
    await page.getByRole('button',{name:'Guardar observação',exact:true}).click();await expect(page.locator('.session-observation p')).toHaveText('Apoio corrigido');
    await page.getByRole('button',{name:'Retomar',exact:true}).click();await expect(page.getByRole('button',{name:'Pausar',exact:true})).toBeVisible();
    await page.getByRole('button',{name:'Exercício seguinte',exact:true}).click();await expect(page.locator('.session-active h2')).toHaveText('Jogo de teste');
    await context.setOffline(true);await page.getByRole('button',{name:'Terminar treino',exact:true}).click();
    await expect(page.getByRole('heading',{name:'Resumo do treino realizado'})).toBeVisible();
    await expect(page.locator('[data-session-sync]')).toContainText('envio pendente');
    const end=await page.evaluate(id=>DB.obter('treinos',id),f.id);expect(end.session.status).toBe('completed');expect(end.blocos[0].notes).toBe('Nota original');expect(end.blocos[0].duration_min).toBe(10);expect(end.sync_dirty).toBe(true);
    await page.getByRole('button',{name:'Apagar',exact:true}).click();await expect(page.locator('.session-observation')).toHaveCount(0);
    await page.getByRole('button',{name:'Apagar registo da sessão',exact:true}).click();await expect(page.getByRole('button',{name:'Iniciar treino',exact:true})).toBeVisible();
    expect((await page.evaluate(id=>DB.obter('treinos',id),f.id)).blocos).toEqual(end.blocos);expect(errors).toEqual([]);await context.setOffline(false);
  });
}
test('duplicate, reorder and save block notes without modifying original',async({page})=>{
  const f=await seed(page);await page.evaluate(id=>go('#/treinos/'+id),f.id);
  await page.getByRole('link',{name:'Duplicar treino',exact:true}).click();
  await page.locator('[data-session-duplicate] input[name="date"]').fill('2026-09-28');
  await page.getByRole('button',{name:'Criar cópia',exact:true}).click();
  await expect(page.getByRole('button',{name:'Guardar treino',exact:true})).toBeVisible();
  const cards=page.locator('.training-block-choice');await expect(cards).toHaveCount(2);
  await cards.first().getByRole('button',{name:'↓ Descer',exact:true}).click();
  await expect(cards.first().locator('strong')).toHaveText('Jogo de teste');
  await page.getByRole('button',{name:'Guardar treino',exact:true}).click();
  await expect(page.getByRole('link',{name:'Duplicar treino',exact:true})).toBeVisible();
  const rows=await page.evaluate(()=>DB.listar('treinos')),copy=rows.find(x=>x.id!==f.id),original=rows.find(x=>x.id===f.id);
  expect(copy.data).toBe('2026-09-28');expect(copy.session).toBeUndefined();expect(copy.blocos[0].exercise_name).toBe('Jogo de teste');expect(copy.blocos[1].notes).toBe('Nota original');expect(original.blocos[0].exercise_name).toBe('Passe de teste');expect(copy.source_training_ref).toBe(original.sync_id);
});
test('player attendance history; started plan cannot be edited',async({page})=>{
  const f=await seed(page);await page.getByLabel('Presença de Atleta de teste').selectOption('late');
  await expect.poll(()=>page.evaluate(id=>DB.obter('treinos',id).then(t=>t.session?.attendance[0].status),f.id)).toBe('late');
  await page.getByRole('button',{name:'Iniciar treino',exact:true}).click();await expect(page.getByRole('button',{name:'Pausar',exact:true})).toBeVisible();
  await page.evaluate(id=>go('#/treinos/'+id+'/editar'),f.id);await expect(page.getByText(/O plano fica preservado/)).toBeVisible();
  await page.evaluate(id=>go('#/equipa/jogador/'+id),f.player);await expect(page.getByRole('heading',{name:'Presenças em treinos'})).toBeVisible();await expect(page.getByText('Atrasado',{exact:true})).toBeVisible();
});
test('atomic local mutation rejects two stale writers and never recreates deleted training',async({page})=>{
  const f=await seed(page);
  const outcomes=await page.evaluate(async id=>{
    const update=()=>DB.modificar('treinos',id,row=>VisionTrainingSession.apply(row,{type:'start',expected_revision:0},{controller_id:'test'}));
    const attempts=await Promise.allSettled([update(),update()]);await DB.apagar('treinos',id);
    let deleted=false;try{await update();}catch(_){deleted=true;}
    return {states:attempts.map(x=>x.status),deleted,count:(await DB.listar('treinos')).length};
  },f.id);expect(outcomes.states.sort()).toEqual(['fulfilled','rejected']);expect(outcomes.deleted).toBe(true);expect(outcomes.count).toBe(0);
});
test('receiving another device session protects its timer and keeps unsubmitted notes',async({page})=>{
  const f=await seed(page);await page.getByRole('button',{name:'Iniciar treino',exact:true}).click();await expect(page.locator('[data-session-note-form]')).toBeVisible();
  await page.locator('[data-session-note-form] textarea').fill('Ainda não guardar');
  await page.evaluate(async id=>{
    const t=await DB.obter('treinos',id);t.session.controller_id='other-device';t.session.revision++;await DB.atualizar('treinos',t,{remote:true});window.dispatchEvent(new CustomEvent('visioncoach:sync-complete'));
  },f.id);
  await expect(page.locator('[data-session-remote]')).toBeVisible();await expect(page.locator('[data-session-note-form] textarea')).toHaveValue('Ainda não guardar');
  await page.getByRole('button',{name:'Guardar observação',exact:true}).click();await expect(page.locator('[data-session-feedback]')).toContainText('mudou');
  await expect(page.locator('[data-session-note-form] textarea')).toHaveValue('Ainda não guardar');
});

test('permanent player deletion removes record/tombstone but preserves recorded training attendance',async({page})=>{
  const f=await seed(page);await page.getByLabel('Presença de Atleta de teste').selectOption('present');
  await expect.poll(()=>page.evaluate(id=>DB.obter('treinos',id).then(t=>t.session?.attendance[0].status),f.id)).toBe('present');
  await page.evaluate(id=>go('#/equipa/jogador/'+id),f.player);
  page.on('dialog',d=>d.type()==='prompt'?d.accept('Atleta de teste'):d.accept());
  await page.getByRole('button',{name:'Retirar definitivamente',exact:true}).click();
  await expect.poll(()=>page.evaluate(id=>DB.obter('jogadores',id).then(p=>p??null),f.player)).toBe(null);
  const result=await page.evaluate(async f=>({attendance:(await DB.obter('treinos',f.id)).session.attendance,tombstones:(await DB.listar('sync_tombstones')).filter(t=>t.store==='jogadores'&&t.sync_id===f.p)}),f);
  expect(result.attendance[0].player_ref).toBe(f.p);expect(result.attendance[0].status).toBe('present');expect(result.tombstones).toHaveLength(1);
});
