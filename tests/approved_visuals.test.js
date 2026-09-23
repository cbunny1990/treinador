const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const visuals=require('../js/exercise_visuals.js');
const root=path.join(__dirname,'..');
test('cinco originais aprovados mantêm bytes, resolução e associação exata',()=>{
  assert.equal(visuals.approved.length,5);
  assert.equal(new Set(visuals.approved.map(x=>x.key)).size,5);
  for(const item of visuals.approved){
    const data=fs.readFileSync(path.join(root,item.src));
    assert.equal(data.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
    assert.equal(data.readUInt32BE(16),1448);assert.equal(data.readUInt32BE(20),1086);
    assert.equal(data.length,item.bytes);
    assert.equal(crypto.createHash('sha256').update(data).digest('hex'),item.sha256);
    assert.equal(visuals.source({external_key:item.key,visual_data_url:'data:image/webp;base64,AAAA'}).src,item.src);
  }
});
test('não escolhe ilustração pelo nome ou palavras-chave',()=>{
  assert.equal(visuals.source({nome:'Saída curta e pressão',external_key:'outra-sessao'}),null);
});
test('URL explícito válido tem prioridade, imagem removida não regressa',()=>{
  const exercise={external_key:visuals.approved[0].key,visual_url:'https://example.org/original.png'};
  assert.equal(visuals.source(exercise).src,exercise.visual_url);
  assert.equal(visuals.source({...exercise,visual_removed:true}),null);
});
test('render mantém proporção e acesso ao original sem atalhos aninhados',()=>{
  const exercise={external_key:visuals.approved[0].key,nome:'Teste <script>'};
  const compact=visuals.render(exercise,true),full=visuals.render(exercise,false);
  assert.match(compact,/width="1448" height="1086"/);assert.doesNotMatch(compact,/<a /);
  assert.match(full,/Ampliar \/ tamanho original/);assert.match(full,/data-action="exercise-visual-open"/);
  assert.match(full,/&lt;script&gt;/);assert.doesNotMatch(full,/<script>/);
});
test('fontes inseguras são recusadas',()=>{
  for(const value of ['javascript:alert(1)','http://example.org/a.png','//example.org/a.png','data:image/svg+xml;base64,AAAA','assets/exercises/../../secret','https://name:password@example.org/a.png']) assert.equal(visuals.safeSource(value),null);
});
test('PWA inclui todos os originais e o módulo antes da interface',()=>{
  const sw=fs.readFileSync(path.join(root,'sw.js'),'utf8');
  const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
  for(const item of visuals.approved) assert.ok(sw.includes('./'+item.src));
  assert.ok(html.indexOf('js/exercise_visuals.js')<html.indexOf('js/training_ui.js'));
  assert.ok(html.indexOf('js/team_development.js')<html.indexOf('js/app.js'));
  assert.ok(sw.includes('./js/team_development.js'));
  assert.match(sw,/vision-coach-v103/);
  const index=fs.readFileSync(path.join(__dirname,"..","index.html"),"utf8");
  assert.match(index,/const serviceWorkerVersion = 103;/);
});
