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
 await form.locator('[name="field_summary"]').fill('Resumo com texto local por guardar');await page.evaluate(()=>window.dispatchEvent(new CustomEvent('visioncoach:sync-complete',{detail:{conflicts:[]}})));await expect(form.locator('[name="field_summary"]')).toHaveValue('Resumo com texto local por guardar');
 await context.setOffline(false);
});
test('analysis labels the saved score as manually entered',async({page})=>{
 await page.goto('/#/calendario');await page.waitForFunction(()=>typeof VisionMatchAnalysis!=='undefined'&&typeof go==='function');
 const id=await page.evaluate(()=>DB.criar('jogos',{team_id:DEFAULT_TEAM_ID,sync_id:crypto.randomUUID(),data:'2026-09-26',adversario:'Resultado manual',estado:'concluido',golos_favor:2,golos_contra:1}));
 await page.evaluate(id=>{go('#/equipa/jogo/'+id);return viewMatch(id);},id);
 await expect(page.locator('section.panel.match-form').first()).toContainText('Resultado introduzido manualmente pelo treinador: 2–1');
 await page.evaluate(id=>{go('#/jogo-visual/'+id);return MatchVisualUI.view(id);},id);
 await expect(page.locator('[data-match-events]')).toContainText('Resultado registado manualmente na ficha');
});
test('video evidence stores a timestamp and edits or deletes only the selected moment',async({page,context})=>{
 await page.goto('/#/calendario');await expect(page.getByRole('heading',{name:'Calendário',exact:true})).toBeVisible();await page.waitForFunction(()=>typeof VisionMatchEvidence!=='undefined'&&typeof go==='function');
 const fixture=await page.evaluate(async()=>{RemoteWorkspace.scheduleSync=()=>{};const sync_id=crypto.randomUUID(),id=await DB.criar('jogos',{team_id:DEFAULT_TEAM_ID,sync_id,data:'2026-09-26',adversario:'Vídeo E2E',estado:'agendado'}),memoryId=await WorkspaceStore.captureObservation({team_id:DEFAULT_TEAM_ID,title:'Observação do jogo',content:'A equipa recuperou e acelerou a transição.',occurred_at:'2026-09-26',refs:[{type:'match',id:sync_id}]});return{id,sync_id,memory:(await HeadCoachMemory.get(memoryId)).sync_id};});const id=fixture.id;await page.evaluate(id=>{go('#/equipa/jogo/'+id);return viewMatch(id);},id);await page.setViewportSize({width:390,height:844});
 const form=page.locator('form[data-form="match-evidence"]');await context.setOffline(true);await form.locator('[name="url"]').fill('https://example.com/game.mp4?t=8s');await form.locator('[name="minutes"]').fill('1');await form.locator('[name="seconds"]').fill('30');await form.locator('[name="category"]').selectOption('transition');await form.locator('[name="description"]').fill('Transição para o ataque');await form.locator('[name="relation_type"]').selectOption('observation');await form.locator('[name="relation_ref"]').selectOption(fixture.memory);await form.getByRole('button',{name:'Guardar momento'}).click();
 await expect.poll(async()=>page.evaluate(id=>DB.obter('jogos',id).then(r=>VisionMatchEvidence.state(r).moments.length),id)).toBe(1);await expect(page.getByRole('link',{name:'Abrir momento'})).toHaveAttribute('href',/t=90s/);expect((await page.evaluate(id=>DB.obter('jogos',id).then(r=>VisionMatchEvidence.state(r).moments[0]),id)).relation_ref).toBe(fixture.memory);await page.getByRole('link',{name:/Observação: Observação do jogo/}).click();await expect(page.getByText('A equipa recuperou e acelerou a transição.')).toBeVisible();await page.goto('/#/equipa/jogo/'+id);const editForm=page.locator('form[data-form="match-evidence"]');
 await page.getByRole('button',{name:'Editar',exact:true}).click();await expect(editForm.locator('[name="evidence_id"]')).not.toHaveValue('');await editForm.locator('[name="description"]').fill('Transição corrigida');await editForm.getByRole('button',{name:'Guardar momento'}).click();await expect.poll(async()=>page.evaluate(id=>DB.obter('jogos',id).then(r=>VisionMatchEvidence.state(r).moments[0].description),id)).toBe('Transição corrigida');
 page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'Apagar',exact:true}).click();await expect.poll(async()=>page.evaluate(id=>DB.obter('jogos',id).then(r=>VisionMatchEvidence.state(r).moments.length),id)).toBe(0);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();await context.setOffline(false);
});
