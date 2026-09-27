# Formação — Treinos v2 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mostrar cada treino-exemplo com nível de progressão, material, preparação, passo a passo e um desenho automático do exercício.

**Architecture:** Migração aditiva de 1 coluna (`progression`). Novo módulo puro `js/learning_diagram.js` que transforma o objeto `diagrama` numa string SVG. `js/learning_ui.js` usa-o em `renderSession` e mostra os campos novos; exercícios antigos continuam a funcionar.

**Tech Stack:** igual às fases anteriores.

**Spec:** `docs/superpowers/specs/2026-09-27-formacao-treinos-v2-design.md`

## Global Constraints

- Tudo o que os planos `2026-09-26-formacao-fase1-fundacao.md` e `2026-09-27-formacao-epoca-sub8.md` impõem continua a valer.
- Novo ficheiro `js/learning_diagram.js`: `<script>` em `index.html` antes de `js/learning_ui.js`, entrada em `sw.js` `ASSETS`, entrada no `check` do `package.json`.
- `sw.js` `CACHE` e `index.html` `serviceWorkerVersion` sobem 172 → 173.
- SVG gerado sem `<script>`, sem `href` externos, texto escapado.
- Linha de base: `npm run check`, `npm test` (esperado 420 / 414 pass / 6 skipped), `npm run test:e2e` (esperado 165).

---

### Task 1: Migração `progression`

**Files:** Create `supabase/migrations/20260927140000_learning_sessions_progression.sql`; Modify `tests/supabase_schema.test.js`.

- [ ] Asserção no teste de esquema: `assert.match(sql,/add column if not exists progression text/)`.
- [ ] Migração: `alter table public.learning_sessions add column if not exists progression text;`
- [ ] `npm run check && npm test`; commit `feat(formacao): progressão dos treinos-exemplo`.

---

### Task 2: Desenho — `js/learning_diagram.js`

**Produces:** global `LearningDiagram = {render(diagrama, {title}) : string, TYPES}`.

- [ ] Testes `tests/learning_diagram.test.js`:

```js
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
```

- [ ] Implementação (IIFE como os outros módulos):
  - Área de desenho: largura fixa 320 unidades, altura = `320 * comprimento/largura` limitada a [200, 480]; `viewBox` com margem de 10 e espaço de 28 em baixo para a legenda; fundo `#3f9b4a`, linha branca a 2 unidades da borda.
  - Coordenadas: `clamp(v,0,100)` → pixel dentro do retângulo; valores não numéricos → elemento/seta ignorado.
  - Elementos (cada um com `data-el="<tipo>"`): `cone` triângulo `#f97316`; `jogador_a` círculo r=7 `#2563eb`; `jogador_b` círculo r=7 branco com contorno `#dc2626`; `bola` círculo r=3.5 branco com contorno preto; `baliza` retângulo 36×6 branco; `mini_baliza` 18×5 branco; `treinador` quadrado 12×12 `#111827` com "T" branco. `rotulo` escapado num `<text>` pequeno ao lado.
  - Setas (`data-arrow="<tipo>"`, `marker-end` com marcador definido em `<defs>` com id fixo): `conducao` contínua `#fde047` 2px; `passe` `stroke-dasharray="6 4"` branca 2px; `corrida` `stroke-dasharray="2 4"` branca 1.5px; `remate` contínua `#facc15` 3.5px.
  - Setas com `passo` numérico: círculo branco r=8 com o número a preto no ponto médio da seta (`data-step="N"`), para ligar a imagem ao "Passo a passo".
  - Legenda (pedido explícito: intuitiva, sem precisar de ler mais nada): sempre visível por baixo do campo, cada entrada com `data-legend="<tipo>"`, o **símbolo desenhado igual ao do campo** (mini-forma ou mini-seta com o mesmo estilo) + nome; se houver passos numerados, entrada extra "① = passo do Passo a passo". Nomes pt-PT `Cone, Equipa A, Equipa B, Bola, Baliza, Mini-baliza, Treinador, Condução, Passe, Corrida, Remate`.
  - `aria-label`: `"<title>: N cones, N jogadores, N setas"` (title escapado).
  - Sem `diagrama` ou sem `elementos` com itens válidos → `''`.
- [ ] Registar em `index.html` (antes de `learning_ui.js`), `sw.js` ASSETS e `check`. Commit `feat(formacao): desenho automático dos exercícios`.

---

### Task 3: Treino-exemplo com passo a passo, material e desenho

**Files:** Modify `js/learning.js` (função `aggregateMaterial`), `js/learning_ui.js` (`renderSession`, `renderLibrary`), `css/styles.css`, `tests/learning.test.js`, `tests/learning_ui.test.js`, `sw.js`, `index.html`.

- [ ] `Learning.aggregateMaterial(exercises)` → `[{item,qtd}]`, uma entrada por `item` (comparação sem maiúsculas/espaços extra), `qtd` = maior quantidade num exercício, ordem da primeira ocorrência. Teste:

```js
test('material agregado usa a maior quantidade por item',()=>{
  const m=L.aggregateMaterial([{material:[{item:'cones',qtd:8},{item:'bolas',qtd:6}]},{material:[{item:'Cones ',qtd:12},{item:'coletes',qtd:4}]},{}]);
  assert.deepEqual(m,[{item:'cones',qtd:12},{item:'bolas',qtd:6},{item:'coletes',qtd:4}]);
});
```

- [ ] `renderSession`: topo com `Nível ${n} de 30` (n = número de `library_code`, ex.: T07 → 7; sem código → não mostrar), `progression`, "Material para o treino" (`aggregateMaterial`). Para cada exercício com campos novos: `LearningDiagram.render(ex.diagrama,{title:ex.fase})` seguido de `<p class="learning-diagram-caption">` com `ex.diagrama.legenda` (escapado; texto normal fora do SVG), linha "Espaço · Jogadores · Duração", "Material", `<ol>` "Como preparar", `<ol>` "Passo a passo", depois pontos de ensino, erros comuns, variantes. Exercícios sem campos novos → render atual.
- [ ] Teste:

```js
test('treino v2: nível, material, preparação, passo a passo e desenho',()=>{
  global.LearningDiagram=require('../js/learning_diagram.js');
  const h=UI.renderSession({library_code:'T07',title:'Condução',objective:'o',progression:'Prepara o 1x1',pillars:['tecnica'],why:'w',
    exercises:[{fase:'Aquecimento',espaco:'15 x 15 m',jogadores:'8',duracao_min:10,material:[{item:'cones',qtd:8}],
      preparacao:['Marca um quadrado com 4 cones'],passos:['Cada um com bola','Ao apito muda de direção'],
      diagrama:{campo:{largura:15,comprimento:15},elementos:[{tipo:'cone',x:0,y:0}],setas:[],legenda:'Todos conduzem dentro do quadrado.'},pontos_ensino:['Cabeça levantada'],erros_comuns:['Bola longe']}]});
  assert.match(h,/Nível 7 de 30/); assert.match(h,/Prepara o 1x1/);
  assert.match(h,/Material para o treino[\s\S]*cones[\s\S]*8/);
  assert.match(h,/Como preparar[\s\S]*<ol>[\s\S]*Marca um quadrado/);
  assert.match(h,/Passo a passo[\s\S]*<ol>[\s\S]*Ao apito/);
  assert.match(h,/<svg/);
  assert.match(h,/learning-diagram-caption[^>]*>Todos conduzem dentro do quadrado\./);
});
```

- [ ] `renderLibrary`: mostrar "Nível N" e ordenar por nível. CSS: `.learning-diagram svg{width:100%;height:auto;max-width:420px}` e listas numeradas legíveis no telemóvel.
- [ ] `sw.js` CACHE `vision-coach-v173`; `serviceWorkerVersion = 173`.
- [ ] `npm run check && npm test && npm run test:e2e`; commit `feat(formacao): treino passo a passo com material e desenho`.

---

### Task 4: Documentação

- [ ] `docs/learning.md`: secção "Treinos v2" com o formato do exercício (campos e exemplo de `diagrama`) para quem gera conteúdo. Commit `docs(formacao): formato dos treinos v2`.
