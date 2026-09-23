import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const visuals=require('../js/exercise_visuals.js');
const {chromium}=await import(process.env.VC_PLAYWRIGHT_MODULE||'playwright');
const base=(process.env.VC_TEST_URL||'http://127.0.0.1:8774/').replace(/\/?$/,'/');
const output=await fs.mkdtemp(path.join(os.tmpdir(),'vision-originals-check-'));
const names=['Ativação — conduzir, passar e dar opção','Passar, apoiar e terceiro homem','Saída curta — GR + 3 vs 3','Jogo condicionado — sair e acelerar','Jogo livre — observar a saída'];
const rows=visuals.approved.map((v,i)=>({id:7101+i,sync_id:'00000000-0000-4000-8000-'+String(i+1).padStart(12,'0'),external_key:v.key,nome:names[i],workspace_v2:true,status:'active',escalao:'Sub-8',duracao_total_min:[10,15,20,20,10][i],passos:['Consultar montagem.','Realizar o exercício.'],visual_data_url:'data:image/webp;base64,AAAA',sync_dirty:false}));
const browser=await chromium.launch({channel:'msedge',headless:true});
const results=[];
try{
  for(const viewport of [{width:390,height:844},{width:1440,height:900}]){
    const context=await browser.newContext({viewport,deviceScaleFactor:1,serviceWorkers:'allow'});
    await context.route(/\.supabase\.co\//,r=>r.abort());
    const page=await context.newPage(),errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.goto(base+'#/exercicios',{waitUntil:'domcontentloaded'});
    await page.evaluate(()=>navigator.serviceWorker.ready);
    await page.waitForFunction(()=>navigator.serviceWorker.controller!==null);
    await page.waitForTimeout(500);
    await page.waitForFunction(()=>typeof DB!=='undefined'&&typeof VisionExerciseVisuals!=='undefined');
    await page.evaluate(async data=>{
      for(const e of data) await DB.criar('exercicios',{...e,team_id:DEFAULT_TEAM_ID},{remote:true});
      await DB.criar('treinos',{id:8101,team_id:DEFAULT_TEAM_ID,data:'2026-09-24',hora:'19:15',objetivo:'Consultar imagens originais',status:'ready',blocos:data.map((e,i)=>({order:i,exercise_ref:e.sync_id,duration_min:e.duracao_total_min,phase:'principal'}))},{remote:true});
      await TrainingUI.viewExercises();
    },rows);
    await page.locator('.exercise-grid img').evaluateAll(images=>images.forEach(img=>{img.loading='eager';}));
    await page.waitForFunction(()=>document.querySelectorAll('.exercise-grid img').length===5&&[...document.querySelectorAll('.exercise-grid img')].every(img=>img.complete&&img.naturalWidth===1448&&img.naturalHeight===1086));
    const library=await page.locator('.exercise-grid img').evaluateAll(imgs=>imgs.map(img=>({src:img.getAttribute('src'),width:img.naturalWidth,height:img.naturalHeight,fit:getComputedStyle(img).objectFit})));
    assert.ok(library.every(img=>img.fit==='contain'));
    await page.screenshot({path:path.join(output,'library-'+viewport.width+'.png'),fullPage:true});
    for(let i=0;i<5;i++){
      await page.goto(base+'#/consulta/8101/'+i);
      await page.waitForFunction(src=>document.querySelector('.consult-exercise img')?.getAttribute('src')===src,visuals.approved[i].src);
      await page.waitForFunction(()=>document.querySelector('.consult-exercise img')?.naturalWidth===1448);
      assert.equal(await page.locator('.consult-exercise img').getAttribute('src'),visuals.approved[i].src);
    }
    await page.getByRole('button',{name:'Ampliar / tamanho original',exact:true}).click();
    await page.waitForSelector('#exercise-image-viewer[open]');
    await page.waitForFunction(()=>document.querySelector('#exercise-image-viewer img')?.naturalWidth===1448);
    await page.getByRole('button',{name:'Tamanho original',exact:true}).click();
    assert.equal(await page.locator('#exercise-image-viewer img').evaluate(img=>img.getBoundingClientRect().width),1448);
    await page.screenshot({path:path.join(output,'original-size-'+viewport.width+'.png')});
    await page.getByRole('button',{name:'Fechar',exact:true}).click();
    await page.waitForSelector('#exercise-image-viewer',{state:'detached'});
    const cached=await page.evaluate(async()=>{const cache=await caches.open('vision-coach-v102');return (await cache.keys()).filter(x=>x.url.includes('/approved-20260922/')).length;});
    assert.equal(cached,5);
    await context.setOffline(true);await page.reload({waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>document.querySelector('.consult-exercise img')?.naturalWidth===1448);
    assert.deepEqual(errors,[]);
    results.push({viewport,libraryImages:library.length,consultationImages:5,naturalResolution:'1448x1086',originalSizeViewer:true,offline:true,pageErrors:errors});
    await context.close();
  }
  console.log(JSON.stringify({ok:true,results,screenshots:output},null,2));
}finally{await browser.close();}
