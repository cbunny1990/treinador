const {test,expect}=require('@playwright/test');
test.use({serviceWorkers:'block'});
test('analysis labels unknown facts, saves offline and only updates memory on explicit choice',async({page,context})=>{
 await page.goto('/#/calendario');await expect(page.getByRole('heading',{name:'Calendário',exact:true})).toBeVisible();await page.waitForFunction(()=>typeof MatchAnalysisStore!=='undefined'&&typeof go==='function');
 const id=await page.evaluate(async()=>{RemoteWorkspace.scheduleSync=()=>{};return DB.criar('jogos',{team_id:DEFAULT_TEAM_ID,sync_id:crypto.randomUUID(),data:'2026-09-26',adversario:'Análise E2E',estado:'agendado',post_game:{correu_bem:'texto antigo'}});});
 await page.evaluate(id=>{go('#/equipa/jogo/'+id);return viewMatch(id);},id);
 const form=page.locator('form[data-form="match-analysis"]');await expect(form).toBeVisible();await expect(page.getByText('Resultado: ainda não registado')).toBeVisible();
 await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();expect(await form.getByRole('button',{name:'Guardar análise',exact:true}).evaluate(el=>el.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
 const evidenceForm=page.locator('form[data-form="match-evidence"]');expect(await evidenceForm.getByRole('button',{name:'Guardar momento'}).evaluate(el=>el.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);expect(await evidenceForm.locator('[name="category"]').evaluate(el=>el.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
 await context.setOffline(true);await form.locator('[name="field_observations"]').fill('Registei apoio tardio no segundo tempo.');await form.locator('[name="field_hypotheses"]').fill('Hipótese por confirmar.');
 await form.getByRole('button',{name:'Guardar análise',exact:true}).click();
 await expect.poll(async()=>page.evaluate(id=>DB.obter('jogos',id).then(r=>r.post_game.analysis?.fields?.observations),id)).toMatch(/apoio tardio/);
 let row=await page.evaluate(id=>DB.obter('jogos',id),id);expect(row.post_game.correu_bem).toBe('texto antigo');expect(row.post_game.analysis.agent_proposal).toBeFalsy();
 await form.locator('[name="field_next_priority"]').fill('Apoio após passe');await form.getByRole('button',{name:'Guardar análise e atualizar memória',exact:true}).click();
 await expect.poll(async()=>page.evaluate(id=>DB.obter('jogos',id).then(r=>r.post_game.analysis?.memory_ref),id)).toBeTruthy();
 row=await page.evaluate(id=>DB.obter('jogos',id),id);const memories=await page.evaluate(()=>DB.porIndice('memory_items','team_id',DEFAULT_TEAM_ID));expect(memories.filter(m=>m.metadata?.managed_by==='match_analysis_v1')).toHaveLength(1);
 const repeat=await page.evaluate(async id=>{const match=await DB.obter('jogos',id),original=IDBObjectStore.prototype.getAll;IDBObjectStore.prototype.getAll=function(){if(['jogos','memory_items','sync_tombstones'].includes(this.name))throw new Error('Varrimento completo de '+this.name);return original.apply(this,arguments);};try{return await MatchAnalysisStore.commit(id,{fields:match.post_game.analysis.fields,goals_conceded:match.post_game.analysis.goals_conceded},{expected_revision:match.post_game.analysis.revision,save_memory:true});}finally{IDBObjectStore.prototype.getAll=original;}},id);
 expect(repeat.memory_created).toBe(false);expect(repeat.memory_updated).toBe(true);expect(await page.evaluate(()=>DB.porIndice('memory_items','team_id',DEFAULT_TEAM_ID).then(rows=>rows.filter(m=>m.metadata?.managed_by==='match_analysis_v1').length))).toBe(1);
 await form.locator('[name="field_summary"]').fill('Resumo com texto local por guardar');await page.evaluate(()=>window.dispatchEvent(new CustomEvent('visioncoach:sync-complete',{detail:{conflicts:[]}})));await expect(form.locator('[name="field_summary"]')).toHaveValue('Resumo com texto local por guardar');
 await context.setOffline(false);
});
test('IndexedDB v15 upgrade adds the memory UUID index without losing a saved memory',async({page})=>{
 await page.addInitScript(()=>{const open=IDBFactory.prototype.open,cursor=IDBObjectStore.prototype.openCursor;IDBFactory.prototype.open=function(name,version){return open.call(this,name,name==='treinador'&&!localStorage.getItem('vision-coach-test-db16')?15:version);};IDBObjectStore.prototype.openCursor=function(){if(this.transaction.mode==='versionchange'&&localStorage.getItem('vision-coach-test-db16'))throw new Error('A migração v15 fez um varrimento completo de '+this.name);return cursor.apply(this,arguments);};});
 await page.goto('/');await page.waitForFunction(()=>typeof DB!=='undefined'&&typeof abrirDB==='function');
 const before=await page.evaluate(async()=>{const id=await DB.criar('memory_items',{team_id:DEFAULT_TEAM_ID,sync_id:crypto.randomUUID(),external_key:'test-v15-memory',kind:'observation',title:'Memória anterior à migração',content:'texto sintético',status:'active'}),db=await abrirDB();return{version:db.version,hasSyncIndex:db.transaction('memory_items').objectStore('memory_items').indexNames.contains('sync_id'),id};});
 expect(before.version).toBe(15);expect(before.hasSyncIndex).toBe(false);await page.evaluate(()=>localStorage.setItem('vision-coach-test-db16','1'));await page.reload();await page.waitForFunction(()=>typeof DB!=='undefined'&&typeof abrirDB==='function');
 const after=await page.evaluate(async id=>{const db=await abrirDB();return{version:db.version,hasSyncIndex:db.transaction('memory_items').objectStore('memory_items').indexNames.contains('sync_id'),row:await DB.obter('memory_items',id)};},before.id);
 expect(after.version).toBe(16);expect(after.hasSyncIndex).toBe(true);expect(after.row.title).toBe('Memória anterior à migração');expect(after.row.content).toBe('texto sintético');
});
test('analysis-only save locks the match; deleted memories abort the combined save',async({page})=>{
 await page.goto('/#/calendario');await page.waitForFunction(()=>typeof MatchAnalysisStore!=='undefined');
 const result=await page.evaluate(async()=>{
  RemoteWorkspace.scheduleSync=()=>{};
  const matchRef=crypto.randomUUID(),matchId=await DB.criar('jogos',{team_id:DEFAULT_TEAM_ID,sync_id:matchRef,data:'2026-09-26',adversario:'Memória apagada'});
  const original=IDBDatabase.prototype.transaction,writeStores=[];
  IDBDatabase.prototype.transaction=function(names,mode){if(mode==='readwrite'&&Array.isArray(names)&&names.includes('jogos'))writeStores.push(names.slice());return original.apply(this,arguments);};
  try{await MatchAnalysisStore.commit(matchId,{fields:{summary:'Resumo guardado sem memória'}},{expected_revision:0,save_memory:false});}finally{IDBDatabase.prototype.transaction=original;}
  const memoryId=await MatchAnalysisStore.stableId('vision-match-analysis:'+matchRef);
  await DB.criar('sync_tombstones',{store:'memory_items',sync_id:memoryId});
  let deletedError='';try{await MatchAnalysisStore.commit(matchId,{fields:{summary:'Não recriar memória'}},{expected_revision:1,save_memory:true});}catch(error){deletedError=error.message;}
  const afterDeleted=await DB.obter('jogos',matchId);
  const legacyRef=crypto.randomUUID(),legacyMatchId=await DB.criar('jogos',{team_id:DEFAULT_TEAM_ID,sync_id:legacyRef,data:'2026-09-27',adversario:'Memória legada'}),legacySyncId=crypto.randomUUID();
  const legacyMemoryId=await DB.criar('memory_items',{team_id:DEFAULT_TEAM_ID,sync_id:legacySyncId,external_key:'match-analysis-'+legacyRef,kind:'observation',title:'Memória legada',content:'Conteúdo preservado',status:'active',metadata:{managed_by:'match_analysis_v1'}});
  await DB.criar('sync_tombstones',{store:'memory_items',sync_id:legacySyncId});
  let legacyError='';try{await MatchAnalysisStore.commit(legacyMatchId,{fields:{summary:'Não substituir memória legada apagada'}},{expected_revision:0,save_memory:true});}catch(error){legacyError=error.message;}
  const afterLegacy=await DB.obter('jogos',legacyMatchId),legacyMemory=await DB.obter('memory_items',legacyMemoryId);
  return{writeStores,deletedError,deletedRevision:afterDeleted.post_game.analysis.revision,deletedSummary:afterDeleted.post_game.analysis.fields.summary,legacyError,legacyRevision:afterLegacy.post_game?.analysis?.revision??0,legacyMemoryContent:legacyMemory.content};
 });
 expect(result.writeStores).toEqual([['jogos']]);expect(result.deletedError).toMatch(/memória.*apagada/i);expect(result.deletedRevision).toBe(1);expect(result.deletedSummary).toBe('Resumo guardado sem memória');expect(result.legacyError).toMatch(/memória.*apagada/i);expect(result.legacyRevision).toBe(0);expect(result.legacyMemoryContent).toBe('Conteúdo preservado');
});
test('analysis labels the saved score as manually entered',async({page})=>{
 await page.goto('/#/calendario');await page.waitForFunction(()=>typeof VisionMatchAnalysis!=='undefined'&&typeof go==='function');
 const id=await page.evaluate(()=>DB.criar('jogos',{team_id:DEFAULT_TEAM_ID,sync_id:crypto.randomUUID(),data:'2026-09-26',adversario:'Resultado manual',estado:'concluido',golos_favor:2,golos_contra:1}));
 await page.evaluate(id=>{go('#/equipa/jogo/'+id);return viewMatch(id);},id);
 await expect(page.locator('section.panel.match-form').first()).toContainText('Resultado introduzido manualmente pelo treinador: 2–1');
 await page.evaluate(id=>{go('#/jogo-visual/'+id);return MatchVisualUI.view(id);},id);
 await expect(page.locator('[data-match-events]')).toContainText('O resultado foi introduzido manualmente.');
});
test('partial manual score stays visible and is labelled incomplete',async({page})=>{
 await page.goto('/#/calendario');await page.waitForFunction(()=>typeof VisionMatchAnalysis!=='undefined'&&typeof go==='function');
 const id=await page.evaluate(()=>DB.criar('jogos',{team_id:DEFAULT_TEAM_ID,sync_id:crypto.randomUUID(),data:'2026-09-26',adversario:'Resultado parcial',estado:'concluido',golos_favor:2}));
 await page.evaluate(id=>{go('#/equipa/jogo/'+id);return viewMatch(id);},id);
 await expect(page.locator('.hero-main .metric-value')).toHaveText('2–? · Parcial');
 await expect(page.locator('section.panel.match-form').first()).toContainText('Resultado parcial introduzido manualmente pelo treinador: 2–?');
});
test('post-match analysis timeline shows recorded side and opponent athlete name',async({page})=>{await page.goto('/#/calendario');await page.waitForFunction(()=>typeof VisionMatchAnalysis!=='undefined'&&typeof go==='function');const id=await page.evaluate(()=>DB.criar('jogos',{team_id:DEFAULT_TEAM_ID,sync_id:crypto.randomUUID(),data:'2026-09-26',adversario:'Linha do tempo',estado:'concluido',match_events:{schema:'vision-match-events@1',revision:1,possession:{kind:'unknown',value:null},events:[{id:crypto.randomUUID(),type:'shot_on',at_ms:125000,side:'adversaria',opponent_player_name:'Adversário 9'}]}}));await page.evaluate(id=>{go('#/equipa/jogo/'+id);return viewMatch(id);},id);const panel=page.locator('section.panel.match-form').filter({hasText:'Factos registados'});await expect(panel).toContainText('Do adversário');await expect(panel).toContainText('Adversário 9');});
test('coach reviews and accepts a current Head Coach proposal without creating a training',async({page})=>{
 await page.goto('/#/calendario');await page.waitForFunction(()=>typeof VisionMatchAnalysis!=='undefined'&&typeof go==='function');
 const fixture=await page.evaluate(async()=>{RemoteWorkspace.scheduleSync=()=>{};const eventId=crypto.randomUUID(),id=await DB.criar('jogos',{team_id:DEFAULT_TEAM_ID,sync_id:crypto.randomUUID(),data:'2026-09-26',adversario:'Proposta E2E',estado:'concluido',match_events:{schema:'vision-match-events@1',revision:1,possession:{kind:'unknown',value:null},events:[{id:eventId,type:'loss',at_ms:125000,reason:'pass',zone:'def_c',note:'Passe intercetado'}]},post_game:{analysis:{schema:'vision-match-analysis@1',revision:1,status:'done',fields:{summary:'Análise do treinador',next_priority:'',decisions:''},agent_proposal:{status:'proposed',prepared_by:'Head Coach',prepared_at:'2026-09-26T12:00:00.000Z',source_analysis_revision:1,source_events_revision:1,summary:'Rever a saída de bola',hypotheses:['O apoio pode estar distante'],next_priority:'Melhorar passe e apoio',evidence_ids:[eventId]}}}});return{id,eventId};});
 await page.evaluate(id=>{go('#/equipa/jogo/'+id);return viewMatch(id);},fixture.id);
 await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();const proposal=page.locator('[data-match-agent-proposal]');await expect(proposal).toContainText('Proposta do Head Coach · Por rever pelo treinador');await expect(proposal).toContainText('2:05 · Perda de bola');await expect(proposal).toContainText('Passe intercetado');expect(await proposal.getByRole('button',{name:'Aceitar proposta'}).evaluate(el=>el.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
 const prior=page.locator('form[data-form="match-analysis"]');await proposal.getByRole('button',{name:'Copiar prioridade para o campo editável'}).click();await expect(prior.locator('[name="field_next_priority"]')).toHaveValue('Melhorar passe e apoio');await expect(proposal).toContainText('ainda não foi aprovada nem criado um treino');
 await prior.locator('[name="field_decisions"]').fill('Aceito trabalhar o apoio após passe.');page.once('dialog',dialog=>dialog.accept());await proposal.getByRole('button',{name:'Aceitar proposta'}).click();
 await expect.poll(async()=>page.evaluate(id=>DB.obter('jogos',id).then(row=>row.post_game.analysis.agent_proposal.status),fixture.id)).toBe('accepted');
 const saved=await page.evaluate(id=>DB.obter('jogos',id),fixture.id);expect(saved.post_game.analysis.fields.next_priority).toBe('Melhorar passe e apoio');expect(saved.post_game.analysis.fields.decisions).toBe('Aceito trabalhar o apoio após passe.');expect(saved.post_game.analysis.agent_proposal.coach_decision).toBe('Aceito trabalhar o apoio após passe.');expect(saved.post_game.analysis.memory_ref).toBeFalsy();expect((await page.evaluate(()=>DB.porIndice('treinos','team_id',DEFAULT_TEAM_ID))).some(row=>row.sync_id===saved.sync_id)).toBe(false);
});
test('proposal without cited evidence is stale and cannot be approved',async({page})=>{
 await page.goto('/#/calendario');await page.waitForFunction(()=>typeof VisionMatchAnalysis!=='undefined'&&typeof go==='function');
 const matchId=await page.evaluate(()=>DB.criar('jogos',{team_id:DEFAULT_TEAM_ID,sync_id:crypto.randomUUID(),data:'2026-09-26',adversario:'Proposta sem fontes',estado:'concluido',match_events:{schema:'vision-match-events@1',revision:0,events:[]},post_game:{analysis:{schema:'vision-match-analysis@1',revision:1,status:'done',fields:{summary:'Rever desempenho'},agent_proposal:{status:'proposed',prepared_by:'Head Coach',prepared_at:'2026-09-26T12:00:00.000Z',source_analysis_revision:1,source_events_revision:0,summary:'Trabalhar apoio',hypotheses:['Apoio pode estar distante'],next_priority:'Apoio após passe',evidence_ids:[]}}}}));
 await page.evaluate(id=>{go('#/equipa/jogo/'+id);return viewMatch(id);},matchId);const proposal=page.locator('[data-match-agent-proposal]');await expect(proposal).toContainText('Proposta do Head Coach · Por rever pelo treinador');await expect(proposal).toContainText('não pode ser aprovada');await expect(proposal.getByRole('button',{name:'Aceitar proposta'})).toHaveCount(0);await expect(proposal).toContainText('Sem lances associados como evidência.');
});
test('post-match proposal with changed source revisions cannot be approved',async({page})=>{
 await page.goto('/#/calendario');await page.waitForFunction(()=>typeof VisionMatchAnalysis!=='undefined'&&typeof go==='function');
 const id=await page.evaluate(()=>DB.criar('jogos',{team_id:DEFAULT_TEAM_ID,sync_id:crypto.randomUUID(),data:'2026-09-26',adversario:'Proposta desatualizada',estado:'concluido',match_events:{schema:'vision-match-events@1',revision:2,possession:{kind:'unknown',value:null},events:[{id:crypto.randomUUID(),type:'recovery',at_ms:60000}]},post_game:{analysis:{schema:'vision-match-analysis@1',revision:3,status:'done',fields:{summary:'Registo do treinador'},agent_proposal:{status:'proposed',prepared_by:'Head Coach',source_analysis_revision:2,source_events_revision:1,summary:'Proposta antiga',hypotheses:[],next_priority:'Prioridade antiga',evidence_ids:[]}}}}));
 await page.evaluate(id=>{go('#/equipa/jogo/'+id);return viewMatch(id);},id);const proposal=page.locator('[data-match-agent-proposal]');await expect(proposal).toContainText('A origem mudou ou não pode ser verificada');await expect(proposal.getByRole('button',{name:'Aceitar proposta'})).toHaveCount(0);await expect(proposal.getByRole('button',{name:'Copiar prioridade para o campo editável'})).toHaveCount(0);await expect(proposal.getByRole('button',{name:'Rejeitar proposta desatualizada'})).toBeVisible();expect((await page.evaluate(id=>DB.obter('jogos',id),id)).post_game.analysis.agent_proposal.status).toBe('proposed');page.once('dialog',dialog=>dialog.accept());await proposal.getByRole('button',{name:'Rejeitar proposta desatualizada'}).click();await expect.poll(async()=>page.evaluate(id=>DB.obter('jogos',id).then(row=>row.post_game.analysis.agent_proposal.status),id)).toBe('dismissed');
});
test('match analysis opens an editable training draft and creates it only after coach saves',async({page})=>{
 await page.goto('/#/calendario');await page.waitForFunction(()=>typeof TrainingUI!=='undefined'&&typeof go==='function');
 const fixture=await page.evaluate(async()=>{
  RemoteWorkspace.scheduleSync=()=>{};
  const matchSyncId=crypto.randomUUID();
  const matchId=await DB.criar('jogos',{team_id:DEFAULT_TEAM_ID,sync_id:matchSyncId,data:'2026-09-26',adversario:'Treino a partir do jogo',estado:'concluido',post_game:{status:'done',analysis:{schema:'vision-match-analysis@1',revision:1,status:'done',fields:{summary:'Apoio tardio sob pressão',next_priority:'Melhorar passe e apoio',decisions:'Manter o princípio e aumentar oposição.'}}}});
  const exercise=TrainingPlanner.normalizeExercise({team_id:DEFAULT_TEAM_ID,sync_id:crypto.randomUUID(),workspace_v2:true,nome:'Exercício de apoio E2E',escalao:'Sub-8',objetivo:'Passe e apoio',series:1,duracao_serie_min:8});
  await DB.criar('exercicios',exercise);
  return{matchId,matchSyncId,exerciseRef:exercise.sync_id};
 });
 await page.evaluate(id=>{go('#/equipa/jogo/'+id);return viewMatch(id);},fixture.matchId);
 await page.getByRole('link',{name:'Preparar treino desta análise'}).click();
 const form=page.locator('form[data-form="training-plan"]');await expect(form).toBeVisible();
 await expect(form.locator('[name="objetivo"]')).toHaveValue('Melhorar passe e apoio');
 await expect(form.locator('[name="notas"]')).toContainText('Manter o princípio e aumentar oposição.');
 await expect(form.locator('[name="source_match_ref"]')).toHaveValue(fixture.matchSyncId);
 expect(await page.evaluate(()=>DB.porIndice('treinos','team_id',DEFAULT_TEAM_ID).then(rows=>rows.length))).toBe(0);
 await form.locator('[name="exercise_refs"]').check();
 await form.locator('[name="objetivo"]').fill('Passe, apoio e oposição progressiva');
 await form.getByRole('button',{name:'Guardar treino'}).click();
 await expect(page.getByText(/Ligado ao jogo de/)).toBeVisible();
 const saved=await page.evaluate(async({matchSyncId,exerciseRef})=>{
  const rows=await DB.porIndice('treinos','team_id',DEFAULT_TEAM_ID);
  return{count:rows.length,training:rows[0]&&TrainingPlanner.normalizeTraining(rows[0]),matchSyncId,exerciseRef};
 },fixture);
 expect(saved.count).toBe(1);
 expect(saved.training).toMatchObject({objetivo:'Passe, apoio e oposição progressiva',source_match_ref:fixture.matchSyncId,status:'ready'});
 expect(saved.training.blocos).toHaveLength(1);
 expect(saved.training.blocos[0].exercise_ref).toBe(fixture.exerciseRef);
});
test('video evidence stores a timestamp and edits or deletes only the selected moment',async({page,context})=>{
 await page.goto('/#/calendario');await expect(page.getByRole('heading',{name:'Calendário',exact:true})).toBeVisible();await page.waitForFunction(()=>typeof VisionMatchEvidence!=='undefined'&&typeof go==='function');
 const fixture=await page.evaluate(async()=>{RemoteWorkspace.scheduleSync=()=>{};const sync_id=crypto.randomUUID(),id=await DB.criar('jogos',{team_id:DEFAULT_TEAM_ID,sync_id,data:'2026-09-26',adversario:'Vídeo E2E',estado:'agendado'}),player=crypto.randomUUID();await DB.criar('jogadores',{team_id:DEFAULT_TEAM_ID,sync_id:player,nome:'Atleta do momento',numero:7,plantel_ativo:true,estado_disponibilidade:'disponivel'});const memoryId=await WorkspaceStore.captureObservation({team_id:DEFAULT_TEAM_ID,title:'Observação do jogo',content:'A equipa recuperou e acelerou a transição.',occurred_at:'2026-09-26',refs:[{type:'match',id:sync_id}]});return{id,sync_id,player,memory:(await HeadCoachMemory.get(memoryId)).sync_id};});const id=fixture.id;await page.evaluate(id=>{go('#/equipa/jogo/'+id);return viewMatch(id);},id);await page.setViewportSize({width:390,height:844});
 const form=page.locator('form[data-form="match-evidence"]');expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();await context.setOffline(true);await form.locator('[name="url"]').fill('https://example.com/game.mp4?t=8s');await form.locator('[name="minutes"]').fill('1');await form.locator('[name="seconds"]').fill('30');await form.locator('[name="category"]').selectOption('transition');await form.locator('[name="player_ref"]').selectOption(fixture.player);await form.locator('[name="description"]').fill('Transição para o ataque');await form.locator('[name="relation_type"]').selectOption('observation');await form.locator('[name="relation_ref"]').selectOption(fixture.memory);await form.getByRole('button',{name:'Guardar momento'}).click();
 await expect.poll(async()=>page.evaluate(id=>DB.obter('jogos',id).then(r=>VisionMatchEvidence.state(r).moments.length),id)).toBe(1);await expect(page.getByRole('link',{name:'Abrir momento'})).toHaveAttribute('href',/t=90s/);await expect(page.locator('section.match-form').filter({hasText:'Vídeo e evidências'})).toContainText('Atleta do momento');const savedMoment=await page.evaluate(id=>DB.obter('jogos',id).then(r=>VisionMatchEvidence.state(r).moments[0]),id);expect(savedMoment.player_ref).toBe(fixture.player);expect(savedMoment.relation_ref).toBe(fixture.memory);await page.getByRole('link',{name:/Observação: Observação do jogo/}).click();await expect(page.getByText('A equipa recuperou e acelerou a transição.')).toBeVisible();await page.goto('/#/equipa/jogo/'+id);const editForm=page.locator('form[data-form="match-evidence"]');
 await page.getByRole('button',{name:'Editar',exact:true}).click();await expect(editForm.locator('[name="evidence_id"]')).not.toHaveValue('');await editForm.locator('[name="description"]').fill('Transição corrigida');await editForm.getByRole('button',{name:'Guardar momento'}).click();await expect.poll(async()=>page.evaluate(id=>DB.obter('jogos',id).then(r=>VisionMatchEvidence.state(r).moments[0].description),id)).toBe('Transição corrigida');
 page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'Apagar',exact:true}).click();await expect.poll(async()=>page.evaluate(id=>DB.obter('jogos',id).then(r=>VisionMatchEvidence.state(r).moments.length),id)).toBe(0);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();await context.setOffline(false);
});
test('video evidence can link to a counted statistic and opens at the saved second',async({page})=>{
 await page.goto('/#/calendario');await page.waitForFunction(()=>typeof VisionMatchEvidence!=='undefined'&&typeof go==='function');
 const id=await page.evaluate(()=>DB.criar('jogos',{team_id:DEFAULT_TEAM_ID,sync_id:crypto.randomUUID(),data:'2026-09-26',adversario:'Estatística em vídeo',estado:'concluido',match_events:{schema:'vision-match-events@1',revision:0,possession:{kind:'unknown',value:null},events:[{id:crypto.randomUUID(),type:'goal_for',at_ms:125000,note:'Golo registado'}]}}));
 await page.evaluate(id=>{go('#/equipa/jogo/'+id);return viewMatch(id);},id);const form=page.locator('form[data-form="match-evidence"]');await form.locator('[name="url"]').fill('https://example.com/game.mp4?t=8s');await form.locator('[name="minutes"]').fill('2');await form.locator('[name="seconds"]').fill('5');await form.locator('[name="category"]').selectOption('goal');await form.locator('[name="description"]').fill('Golo após cruzamento');await form.locator('[name="relation_type"]').selectOption('statistic');await form.locator('[name="relation_ref"]').selectOption('goals.for');await form.getByRole('button',{name:'Guardar momento'}).click();
 const card=page.locator('section.match-form').filter({hasText:'Vídeo e evidências'});await expect(card).toContainText('Estatística: Golos marcados');await expect(card.getByRole('link',{name:'Abrir momento'})).toHaveAttribute('href',/t=125s/);expect(await page.evaluate(id=>DB.obter('jogos',id).then(row=>VisionMatchEvidence.state(row).moments[0].relation_ref),id)).toBe('goals.for');
});
test('editing analysis preserves and allows editing a historically linked video moment',async({page})=>{
 await page.goto('/#/calendario');await page.waitForFunction(()=>typeof VisionMatchEvidence!=='undefined'&&typeof go==='function');
 const id=await page.evaluate(async()=>{RemoteWorkspace.scheduleSync=()=>{};const id=await DB.criar('jogos',{team_id:DEFAULT_TEAM_ID,sync_id:crypto.randomUUID(),data:'2026-09-26',adversario:'Evidência histórica',estado:'concluido',post_game:{analysis:{fields:{problems:'Cobertura irregular'}}}});await DB.modificar('jogos',id,current=>VisionMatchEvidence.apply(current,{type:'add',expected_revision:0,item:{id:crypto.randomUUID(),url:'https://example.com/video',seconds:65,category:'defense',description:'Cobertura no segundo poste',relation_type:'problem',relation_ref:'problems'}}));await DB.modificar('jogos',id,current=>VisionMatchAnalysis.save(current,{fields:{problems:''}},{expected_revision:0}));return id;});
 await page.evaluate(id=>{go('#/equipa/jogo/'+id);return viewMatch(id);},id);const card=page.locator('section.match-form').filter({hasText:'Vídeo e evidências'});await expect(card).toContainText('Problema · análise alterada: Problemas');await expect(card.getByRole('link',{name:'Abrir momento'})).toHaveAttribute('href',/t=65s/);
 await card.getByRole('button',{name:'Editar',exact:true}).click();const form=page.locator('form[data-form="match-evidence"]');await expect(form.locator('[name="relation_type"]')).toHaveValue('problem');await expect(form.locator('[name="relation_ref"]')).toHaveValue('problems');await form.locator('[name="description"]').fill('Cobertura revista no vídeo');await form.getByRole('button',{name:'Guardar momento'}).click();await expect.poll(async()=>page.evaluate(id=>DB.obter('jogos',id).then(row=>VisionMatchEvidence.state(row).moments[0].description),id)).toBe('Cobertura revista no vídeo');
});
test('video evidence rejects an athlete UUID that belongs to another team',async({page})=>{
 await page.goto('/#/calendario');await page.waitForFunction(()=>typeof VisionMatchEvidence!=='undefined'&&typeof go==='function');
 const foreign=await page.evaluate(async()=>{RemoteWorkspace.scheduleSync=()=>{};const id=await DB.criar('jogos',{team_id:DEFAULT_TEAM_ID,sync_id:crypto.randomUUID(),data:'2026-09-26',adversario:'Vídeo equipa errada'});return{id,player:crypto.randomUUID()};});await page.evaluate(x=>{go('#/equipa/jogo/'+x.id);return viewMatch(x.id);},foreign);
 const form=page.locator('form[data-form="match-evidence"]');await form.locator('[name="url"]').fill('https://example.com/game.mp4');await form.locator('[name="description"]').fill('Momento com referência inválida');await form.locator('[name="player_ref"]').evaluate((select,value)=>{const option=document.createElement('option');option.value=value;option.textContent='Atleta de outra equipa';select.append(option);select.value=value;},foreign.player);await form.getByRole('button',{name:'Guardar momento'}).click();
 await expect(form.locator('[data-evidence-feedback]')).toContainText('pertencente a esta equipa');expect(await page.evaluate(id=>DB.obter('jogos',id).then(row=>VisionMatchEvidence.state(row).moments.length),foreign.id)).toBe(0);
});
