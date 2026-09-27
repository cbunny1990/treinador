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
  assert.match(s,/data-legend="step"[\s\S]*N.º = passo/);
});

test('amostras da legenda têm fundo verde e o texto cabe no viewBox em duas colunas',()=>{
  const elements=Object.keys(D.TYPES).filter(type=>D.TYPES[type].kind==='element').map((tipo,index)=>({tipo,x:10+index*10,y:20}));
  const arrows=Object.keys(D.TYPES).filter(type=>D.TYPES[type].kind==='arrow').map((tipo,index)=>({tipo,de:[10,20],para:[30+index*5,40],passo:index+1}));
  const s=D.render({campo:{largura:20,comprimento:20},elementos:elements,setas:arrows},{title:'t'});
  for(const type of [...Object.keys(D.TYPES).filter(t=>D.TYPES[t].kind==='arrow'),'step']){
    const entry=s.match(new RegExp(`<g data-legend="${type}">([\\s\\S]*?)<\\/g>`));
    assert.ok(entry,`legenda ${type} existe`);
    assert.match(entry[1],/<rect[^>]*fill="#3f9b4a"/,`legenda ${type} tem amostra verde`);
  }
  const labelPattern=/<text data-legend-label="[^"]+" x="([\d.]+)" y="[\d.]+" font-size="10"[^>]*>([^<]+)<\/text>/g;
  const labels=[...s.matchAll(labelPattern)];
  assert.equal(labels.length,Object.keys(D.TYPES).length+1);
  for(const [,rawX,label] of labels){
    const estimatedWidth=label.length*6;
    assert.ok(Number(rawX)+estimatedWidth<=340,`${label} termina dentro do viewBox`);
  }
  assert.match(s,/N.º = passo/);
  assert.doesNotMatch(s,/N.º = passo a passo/);
});

test('rótulos longos ficam legíveis e preservam o nome completo no aria-label',()=>{
  const full='Guarda-redes adversário';
  const s=D.render({campo:{largura:20,comprimento:20},elementos:[{tipo:'jogador_a',x:50,y:50,rotulo:full},{tipo:'jogador_b',x:60,y:50,rotulo:'Defesa B'}],setas:[]},{title:'t'});
  assert.match(s,/font-size="10"[^>]*stroke="#3f9b4a" stroke-width="3"[^>]*paint-order="stroke" aria-label="Guarda-redes adversário"/);
  assert.match(s,/>Guarda-rede…<\/text>/);
  assert.doesNotMatch(s,/>Guarda-redes adversário<\/text>/);
  assert.match(s,/text-anchor="end" font-size="10"[^>]*aria-label="Defesa B"/);
});

test('círculo do passo fica deslocado dez unidades na perpendicular à seta',()=>{
  const s=D.render({campo:{largura:20,comprimento:20},elementos:[{tipo:'jogador_a',x:10,y:10}],setas:[{tipo:'passe',de:[10,10],para:[90,90],passo:4}]},{title:'t'});
  const arrow=s.match(/data-arrow="passe"[^>]*d="M ([\d.]+) ([\d.]+) L ([\d.]+) ([\d.]+)"/);
  const step=s.match(/<g data-step="4"><circle cx="([\d.]+)" cy="([\d.]+)"/);
  assert.ok(arrow&&step);
  const [,x1,y1,x2,y2]=arrow.map(Number),[,sx,sy]=step.map(Number);
  const dx=x2-x1,dy=y2-y1,length=Math.hypot(dx,dy),mx=(x1+x2)/2,my=(y1+y2)/2;
  const distance=Math.hypot(sx-mx,sy-my);
  const dot=(sx-mx)*dx+(sy-my)*dy;
  assert.ok(Math.abs(distance-10)<0.001);
  assert.ok(Math.abs(dot)<0.001);
});
test('legenda só com tipos usados; sem diagrama → vazio',()=>{
  const s=D.render({campo:{largura:10,comprimento:10},elementos:[{tipo:'cone',x:1,y:1}],setas:[]},{title:'t'});
  assert.match(s,/Cone/); assert.doesNotMatch(s,/Equipa B|Passe/);
  assert.equal(D.render(null,{title:'t'}),'');
  assert.equal(D.render({elementos:[]},{title:'t'}),'');
});
