const {test,expect}=require('@playwright/test');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const bytes=fs.readFileSync(path.join(__dirname,'../../assets/exercises/approved-20260922/01_ativacao_conduzir_passar_dar_opcao.png'));
const sha256=crypto.createHash('sha256').update(bytes).digest('hex');
const team='845aceb7-3350-4e52-9b5e-5279132d3ae9';
const remoteId='a1318089-7586-4e9f-8f51-30d923d2b9f1';
test.use({serviceWorkers:'block'});
async function configure(page,seed=true,otherTeam=false){
  await page.evaluate(async({team,remoteId,sha256,seed,otherTeam})=>{
    RemoteWorkspace.scheduleSync=()=>{};
    RemoteWorkspace.init=async()=>({storage:{from(){return {createSignedUrl:async()=>({data:{signedUrl:location.origin+'/private-fixture.png'}})};}},auth:{onAuthStateChange(fn){window.privateAuthCallback=fn;}}});
    RemoteWorkspace.getSession=async()=>({user:{id:'image-workflow-test-user'}});
    RemoteWorkspace.getConfig=()=>({remoteTeamId:otherTeam?'different-team':team});
    RemoteWorkspace.status=async()=>({signedIn:false,remoteTeamId:null});
    if(seed){
      const id=await DB.criar('exercicios',{team_id:DEFAULT_TEAM_ID,workspace_v2:true,sync_id:remoteId,external_key:'exercise-ativacao-conduzir-passar-dar-opcao',nome:'Original privado E2E',objetivo:'Preservar a qualidade',series:1,duracao_serie_min:10,visual_storage_path:team+'/exercise-images/'+remoteId+'/original.png',visual_image:{sha256,width:1448,height:1086}},{remote:true});
      window.privateExerciseId=id;
      await DB.criar('treinos',{team_id:DEFAULT_TEAM_ID,data:'2026-09-24',hora:'19:15',status:'ready',blocos:[{exercise_ref:remoteId,duration_min:10,order:0,phase:'ativacao'}]},{remote:true});
    }
  },{team,remoteId,sha256,seed,otherTeam});
}
for(const viewport of [{width:390,height:844},{width:1440,height:900}]){
  test('private original library, consultation, viewer, offline and logout '+viewport.width,async({page,context})=>{
    await page.setViewportSize(viewport);let downloads=0;
    await page.route('**/private-fixture.png',route=>{downloads++;return route.fulfill({body:bytes,contentType:'image/png'});});
    await page.goto('/#/exercicios');await expect(page.getByRole('heading',{name:'Biblioteca de exercícios'})).toBeVisible();
    await configure(page);await page.evaluate(()=>router());
    const image=page.locator('[data-exercise-original]').first();await expect(image).toHaveAttribute('src',/^blob:/);
    await expect.poll(()=>image.evaluate(x=>x.naturalWidth)).toBe(1448);
    await page.evaluate(()=>go('#/consulta'));await expect(page.locator('.consult-exercise [data-exercise-original]')).toHaveAttribute('src',/^blob:/);
    await page.getByRole('button',{name:'Ampliar / tamanho original',exact:true}).click();
    await page.getByRole('button',{name:'Tamanho original',exact:true}).click();
    await expect(page.locator('.image-viewer-image')).toHaveCSS('width','1448px');
    await page.getByRole('button',{name:'Fechar',exact:true}).click();
    expect(downloads).toBe(1);
    // New document/memory, same private offline cache: no signed URL is stored in IndexedDB.
    await page.goto('/#/definicoes');await page.waitForFunction(()=>typeof DB!=='undefined'&&typeof RemoteWorkspace!=='undefined');
    await configure(page,false);await context.setOffline(true);await page.evaluate(()=>go('#/exercicios'));
    await expect(page.locator('[data-exercise-original]').first()).toHaveAttribute('src',/^blob:/);expect(downloads).toBe(1);
    const stored=await page.evaluate(()=>DB.listar('exercicios'));expect(JSON.stringify(stored)).not.toContain('signedUrl');expect(JSON.stringify(stored)).not.toContain('blob:');
    await page.evaluate(async()=>{await VisionExerciseImageStorage.clear();});
    expect(await page.evaluate(()=>caches.has('vision-coach-private-images-v1'))).toBe(false);
    await context.setOffline(false);
  });
}
test('wrong account team cannot display cached private original or old public fallback',async({page})=>{
  await page.goto('/#/exercicios');await expect(page.getByRole('heading',{name:'Biblioteca de exercícios'})).toBeVisible();
  await configure(page,true,true);await page.evaluate(()=>router());
  await expect(page.locator('[data-exercise-original]')).toHaveCount(0);
  await expect(page.getByText(/Imagem privada indisponível/)).toBeVisible();
});
