const test=require('node:test'),assert=require('node:assert/strict');
const D=require('../js/learning_diagram.js');
const d={campo:{largura:20,comprimento:30},
  elementos:[{tipo:'cone',x:0,y:0},{tipo:'cone',x:100,y:0},{tipo:'jogador_a',x:50,y:50,rotulo:'<b>1</b>'},{tipo:'jogador_b',x:60,y:50},{tipo:'bola',x:52,y:52},{tipo:'mini_baliza',x:50,y:100},{tipo:'foguetão',x:1,y:1}],
  setas:[{tipo:'passe',de:[50,50],para:[80,20]},{tipo:'conducao',de:[10,10],para:[150,-20]}]};

test('desenha cada tipo e ignora desconhecidos',()=>{
  const s=D.render(d,{title:'Rondo'});
  assert.match(s,/^<svg[^>]*role="img"[^>]*aria-label="Rondo/);
  assert.equal((s.match(/data-el="cone"/g)||[]).length,2);
  assert.equal((s.match(/data-el="jogador_a"/g)||[]).length,1);
  assert.equal((s.match(/data-el="jogador_b"/g)||[]).length,1);
  assert.equal((s.match(/data-el="bola"/g)||[]).length,1);
  assert.equal((s.match(/data-el="mini_baliza"/g)||[]).length,1);
  assert.doesNotMatch(s,/foguet/);
});
test('setas com estilo por tipo e coordenadas limitadas a 0–100',()=>{
  const s=D.render(d,{title:'x'});
  assert.match(s,/data-arrow="passe"[^>]*stroke-dasharray/);
  assert.match(s,/data-arrow="conducao"/);
  assert.doesNotMatch(s,/NaN|-\d/);
});
test('escape e sem conteúdo ativo',()=>{
  const s=D.render(d,{title:'"><script>'});
  assert.match(s,/&lt;b&gt;1&lt;\/b&gt;/);
  assert.doesNotMatch(s,/<script|href=|on\w+=/i);
});
test('setas com passo mostram número; legenda com símbolo e nome',()=>{
  const s=D.render({campo:{largura:20,comprimento:20},elementos:[{tipo:'jogador_a',x:10,y:10}],setas:[{tipo:'passe',de:[10,10],para:[90,90],passo:2}]},{title:'t'});
  assert.match(s,/data-step="2"[\s\S]*>2</);
  assert.match(s,/data-legend="jogador_a"[\s\S]*Equipa A/);
  assert.match(s,/data-legend="passe"[\s\S]*Passe/);
});
test('legenda só com tipos usados; sem diagrama → vazio',()=>{
  const s=D.render({campo:{largura:10,comprimento:10},elementos:[{tipo:'cone',x:1,y:1}],setas:[]},{title:'t'});
  assert.match(s,/Cone/); assert.doesNotMatch(s,/Equipa B|Passe/);
  assert.equal(D.render(null,{title:'t'}),'');
  assert.equal(D.render({elementos:[]},{title:'t'}),'');
});
