const {test,expect}=require('@playwright/test');

test.use({serviceWorkers:'block'});

test('perfil da equipa mantém a identidade ao editar e o Workspace permite resolver o conflito',async({page})=>{
 await page.setViewportSize({width:390,height:844});
 await page.goto('/#/equipa');
 await page.waitForFunction(()=>typeof HeadCoachMemory!=='undefined'&&typeof RemoteWorkspace!=='undefined');
 const values=await page.evaluate(async()=>{
  RemoteWorkspace.scheduleSync=()=>{};
  const remoteTeamId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  await DB.atualizar('teams',{id:DEFAULT_TEAM_ID,nome:'Nome base',clube:'Clube base',
   created_at:'2026-09-01T10:00:00.000Z',updated_at:'2026-09-01T10:00:00.000Z',
   sync_id:remoteTeamId,sync_dirty:false,remote_updated_at:'v1',
   _sync_base:{nome:'Nome base',clube:'Clube base',created_at:'2026-09-01T10:00:00.000Z',updated_at:'2026-09-01T10:00:00.000Z'}},{remote:true});
  await HeadCoachMemory.saveTeam({nome:'Nome do treinador'});
  const pending=await DB.obter('teams',DEFAULT_TEAM_ID);
  const remote={id:remoteTeamId,name:'Nome remoto',metadata:{nome:'Nome remoto',clube:'Clube base',
   created_at:'2026-09-01T10:00:00.000Z',updated_at:'2026-09-02T10:00:00.000Z'},updated_at:'v2'};
  RemoteWorkspace.init=async()=>({from(table){if(table!=='teams')throw new Error('Tabela errada');return{
   select(){return this;},eq(key,value){if(key==='id'&&value!==remoteTeamId)throw new Error('Equipa errada');return this;},
   async single(){return{data:remote,error:null};}
  };}});
  const conflict={store:'teams',local_id:DEFAULT_TEAM_ID,sync_id:remoteTeamId,
   reason:'version_mismatch',expected_updated_at:'v1',remote_updated_at:'v2'};
  const config={remoteTeamId,conflicts:[conflict]};
  localStorage.setItem('treinador.remote.supabase.v1',JSON.stringify(config));
  RemoteWorkspace.status=async()=>({configured:true,signedIn:true,remoteTeamId,conflicts:config.conflicts});
  RemoteWorkspace.syncNow=async()=>({pushed:0,pulled:0,conflicts:config.conflicts});
  return{sync_id:pending.sync_id,remote_updated_at:pending.remote_updated_at,base:pending._sync_base?.nome};
 });
 expect(values).toEqual({sync_id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',remote_updated_at:'v1',base:'Nome base'});
 const dialogs=[];page.on('dialog',async dialog=>{dialogs.push(dialog.message());await dialog.accept();});
 await page.evaluate(()=>go('#/'));
 await page.getByRole('button',{name:'Abrir revisão'}).click();
 await page.getByRole('button',{name:'Comparar versões'}).click();
 expect(dialogs).toEqual([]);
 const review=page.locator('[data-conflict-review]');
 await expect(review).toBeVisible();
 await expect(review).toContainText('Nome do treinador');
 await expect(review).toContainText('Nome remoto');
 await page.getByRole('button',{name:'Usar versão do workspace remoto'}).click();
 const saved=await page.evaluate(async()=>{const team=await DB.obter('teams',DEFAULT_TEAM_ID);return{
  nome:team.nome,clube:team.clube,sync_id:team.sync_id,sync_dirty:team.sync_dirty,
  remote_updated_at:team.remote_updated_at,base:team._sync_base?.nome};});
 expect(saved).toEqual({nome:'Nome remoto',clube:'Clube base',sync_id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  sync_dirty:false,remote_updated_at:'v2',base:'Nome remoto'});
});

test('edição da equipa aberta não substitui uma versão sincronizada entretanto',async({page})=>{
 await page.goto('/#/equipa/editar');
 await page.waitForFunction(()=>typeof HeadCoachMemory!=='undefined');
 await page.evaluate(()=>{RemoteWorkspace.scheduleSync=()=>{};});
 const form=page.locator('form[data-form="team"]');
 await form.getByLabel('Nome da equipa').fill('Nome escrito no formulário');
 await page.evaluate(async()=>{
  await DB.modificar('teams',DEFAULT_TEAM_ID,(team)=>({
   ...team,nome:'Nome recebido do telemóvel',remote_updated_at:'remote-v2',updated_at:'2026-09-27T12:00:00.000Z'
  }),{remote:true});
 });
 await form.getByRole('button',{name:'Guardar alterações'}).click();
 await expect(form.locator('[data-team-feedback]')).toContainText('mudou enquanto editavas');
 await expect(form.getByLabel('Nome da equipa')).toHaveValue('Nome escrito no formulário');
 const stored=await page.evaluate(async()=>(await DB.obter('teams',DEFAULT_TEAM_ID)).nome);
 expect(stored).toBe('Nome recebido do telemóvel');
});
