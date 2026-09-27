# Formação — Biblioteca e plano da época Sub-8 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Biblioteca de treinos filtrável e plano da época semana a semana para o Sub-8, mais a correção da barra de navegação móvel.

**Architecture:** Migração aditiva (3 colunas em `learning_sessions`, tabelas `learning_season_plans` e `learning_plan_weeks` com RLS por dono). Funções puras novas em `js/learning.js`, consultas novas em `js/learning_store.js`, renders e rotas novas em `js/learning_ui.js`. Sem ficheiros JS novos.

**Tech Stack:** igual à fase 1 (JS IIFE sem bundler, Supabase, node:test, PGlite, Playwright).

**Spec:** `docs/superpowers/specs/2026-09-27-formacao-epoca-sub8-design.md` (e a da fase 1).

## Global Constraints

- Tudo o que a fase 1 impõe (ver `docs/superpowers/plans/2026-09-26-formacao-fase1-fundacao.md`, secção Global Constraints) continua a valer.
- Migração nova só aditiva: `alter table … add column if not exists`, tabelas novas; não alterar políticas existentes.
- `sw.js` `CACHE` e `index.html` `serviceWorkerVersion` sobem 171 → 172 (uma vez).
- Rotas novas: `#/formacao/plano/<code>` e `#/formacao/biblioteca/<code>` (não colidem com slugs de módulos).
- Linha de base a registar antes da Tarefa 1: `npm run check`, `npm test` (esperado 410 / 404 pass / 6 skipped), `npm run test:e2e` (esperado 164 pass).

---

### Task 1: Migração + testes PGlite

**Files:** Create `supabase/migrations/20260927100000_learning_season_plan.sql`, Modify `tests/learning_migrations.pglite.test.js`, Modify `tests/supabase_schema.test.js`.

- [ ] Testes (acrescentar ao ficheiro PGlite existente, reutilizando `withDb`/`asUser`):

```js
test('biblioteca: library_code único por dono', async()=>withDb(async db=>{
  await asUser(db,A);
  const mod=(await db.query(`select id from public.learning_modules where slug='treinos-exemplo'`)).rows[0].id;
  const ins=`insert into public.learning_sessions(module_id,title,objective,library_code,focus,season_block,status) values($1,'T','O','T01','condução',2,'aprovado')`;
  await db.query(ins,[mod]);
  await assert.rejects(()=>db.query(ins,[mod]),/duplicate key|unique/i);
  await asUser(db,B); await db.query(ins,[mod]); // outro dono pode usar T01
}));

test('plano: semanas únicas, cascade e RLS', async()=>withDb(async db=>{
  await asUser(db,A);
  const p=(await db.query(`insert into public.learning_season_plans(age_group_code,season_label,title,start_date,end_date,status) values('sub8','2026/27','Época','2026-09-07','2027-07-30','aprovado') returning id`)).rows[0].id;
  const w=`insert into public.learning_plan_weeks(plan_id,week_no,starts_on,block_no,block_title,objective) values($1,1,'2026-09-07',1,'Adaptação','Conhecer o grupo')`;
  await db.query(w,[p]);
  await assert.rejects(()=>db.query(w,[p]),/duplicate key|unique/i);
  await asUser(db,B);
  assert.equal((await db.query(`select * from public.learning_plan_weeks`)).rows.length,0);
  await asUser(db,A);
  await db.query(`delete from public.learning_season_plans where id=$1`,[p]);
  assert.equal((await db.query(`select * from public.learning_plan_weeks`)).rows.length,0);
}));
```

- [ ] Correr → FAIL. Escrever a migração:

```sql
alter table public.learning_sessions add column if not exists library_code text;
alter table public.learning_sessions add column if not exists focus text;
alter table public.learning_sessions add column if not exists season_block smallint check (season_block between 1 and 5);
create unique index if not exists learning_sessions_library_code
  on public.learning_sessions(owner_id, library_code) where library_code is not null;

create table if not exists public.learning_season_plans (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid(),
  age_group_code text not null references public.learning_age_groups(code),
  season_label text not null,
  title text not null,
  start_date date not null,
  end_date date not null,
  status text not null default 'proposto' check (status in ('proposto','aprovado','rejeitado')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists learning_season_plans_one_approved
  on public.learning_season_plans(owner_id, age_group_code, season_label) where status = 'aprovado';

create table if not exists public.learning_plan_weeks (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid(),
  plan_id uuid not null references public.learning_season_plans(id) on delete cascade,
  week_no int not null,
  starts_on date not null,
  block_no smallint not null check (block_no between 1 and 5),
  block_title text not null,
  objective text not null,
  is_break boolean not null default false,
  session_a_id uuid references public.learning_sessions(id),
  session_b_id uuid references public.learning_sessions(id),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (plan_id, week_no)
);

alter table public.learning_season_plans enable row level security;
alter table public.learning_plan_weeks enable row level security;
do $$
declare t text;
begin
  foreach t in array array['learning_season_plans','learning_plan_weeks'] loop
    execute format('drop policy if exists %1$s_owner_all on public.%1$s', t);
    execute format('create policy %1$s_owner_all on public.%1$s for all to authenticated
      using (owner_id = auth.uid()) with check (owner_id = auth.uid())', t);
  end loop;
end $$;
```

- [ ] Em `tests/supabase_schema.test.js`, alargar o teste da Formação à lista `learning_season_plans`, `learning_plan_weeks`.
- [ ] Correr → PASS; `npm run check && npm test`; commit `feat(formacao): tabelas do plano da época e campos da biblioteca`.

---

### Task 2: Lógica pura — `js/learning.js`

**Produces (acrescentar à `api`):**
- `currentWeek(weeks, todayISO)` → semana cujo intervalo `[starts_on, starts_on+7d)` contém a data; antes do início → primeira; depois do fim → última; `weeks` vazio → `null`.
- `groupWeeksByBlock(weeks)` → `[{block_no, block_title, weeks:[…]}]` ordenado por `block_no` e `week_no`.
- `filterLibrary(sessions, {pillar, block, focus})` → só `isVisible`-equivalente (`status==='aprovado'`), ordenado por `library_code`; filtros ignorados quando vazios.
- `focuses(sessions)` → lista única e ordenada de `focus`.

- [ ] Testes em `tests/learning.test.js`:

```js
test('semana atual',()=>{
  const w=[{week_no:1,starts_on:'2026-09-07'},{week_no:2,starts_on:'2026-09-14'},{week_no:3,starts_on:'2026-09-21'}];
  assert.equal(L.currentWeek(w,'2026-09-01').week_no,1);
  assert.equal(L.currentWeek(w,'2026-09-16').week_no,2);
  assert.equal(L.currentWeek(w,'2026-09-20').week_no,2);
  assert.equal(L.currentWeek(w,'2027-01-01').week_no,3);
  assert.equal(L.currentWeek([],'2026-09-16'),null);
});
test('agrupar por bloco',()=>{
  const g=L.groupWeeksByBlock([{week_no:3,block_no:2,block_title:'B'},{week_no:1,block_no:1,block_title:'A'},{week_no:2,block_no:1,block_title:'A'}]);
  assert.deepEqual(g.map(b=>[b.block_no,b.weeks.map(w=>w.week_no)]),[[1,[1,2]],[2,[3]]]);
});
test('filtros da biblioteca',()=>{
  const s=[{library_code:'T02',status:'aprovado',pillars:['tecnica'],season_block:2,focus:'drible'},
           {library_code:'T01',status:'aprovado',pillars:['tatica'],season_block:1,focus:'jogo'},
           {library_code:'T03',status:'proposto',pillars:['tecnica'],season_block:2,focus:'drible'}];
  assert.deepEqual(L.filterLibrary(s,{}).map(x=>x.library_code),['T01','T02']);
  assert.deepEqual(L.filterLibrary(s,{pillar:'tecnica'}).map(x=>x.library_code),['T02']);
  assert.deepEqual(L.filterLibrary(s,{block:1}).map(x=>x.library_code),['T01']);
  assert.deepEqual(L.focuses(s),['drible','jogo']);
});
```

- [ ] Implementar (datas como strings ISO `YYYY-MM-DD`, comparação por `Date.UTC` para evitar fusos). Commit `feat(formacao): lógica do plano da época e filtros da biblioteca`.

---

### Task 3: Consultas — `js/learning_store.js`

**Produces (no objeto devolvido por `createStore`):**
- `listLibrary(ageGroupCode)` → treinos `aprovado` do módulo `treinos-exemplo` desse escalão (obter o id do módulo por `listModules`), ordenados por `library_code`.
- `getSeasonPlan(ageGroupCode)` → `{plan, weeks}` do plano `aprovado` mais recente (`order('start_date',{ascending:false}).limit(1).maybeSingle()`), semanas por `week_no`; sem plano → `{plan:null, weeks:[]}`.

- [ ] Testes em `tests/learning_store.test.js` com o `fake()` existente (acrescentar `limit` à lista de operações do fake): `listLibrary` filtra `status='aprovado'` e `module_id`; `getSeasonPlan` sem plano devolve `{plan:null,weeks:[]}`.
- [ ] Implementar; commit `feat(formacao): consultas da biblioteca e do plano`.

---

### Task 4: Ecrãs, rotas, barra móvel

**Files:** Modify `js/learning_ui.js`, `js/app.js` (só se a rota precisar), `css/styles.css`, `sw.js`, `index.html`, `tests/learning_ui.test.js`, `tests/e2e/learning.spec.js`.

**Produces:** `FormacaoUI.renderSeasonPlan(plan, weeks, sessionsById, todayISO)`, `FormacaoUI.renderLibrary(group, sessions, filters, focuses)`; `renderAgeGroup` passa a incluir os 2 cartões; `renderSession` mostra `library_code`, `focus` e "Usado nas semanas: n, m" quando receber `usedInWeeks`.

- [ ] Testes de render:

```js
test('plano: blocos, esta semana, pausas e links',()=>{
  const weeks=[{week_no:1,starts_on:'2026-09-07',block_no:1,block_title:'Adaptação',objective:'Conhecer',is_break:false,session_a_id:'s1',session_b_id:'s2'},
               {week_no:2,starts_on:'2026-12-21',block_no:2,block_title:'Condução',objective:'Natal',is_break:true}];
  const h=UI.renderSeasonPlan({title:'Época 2026/27'},weeks,{s1:{id:'s1',library_code:'T01',title:'<i>A</i>'},s2:{id:'s2',library_code:'T02',title:'B'}},'2026-09-09');
  assert.match(h,/Adaptação[\s\S]*Condução/);
  assert.match(h,/Esta semana/);
  assert.match(h,/learning-break/);
  assert.match(h,/href="#\/formacao\/treino\/s1"/);
  assert.match(h,/&lt;i&gt;A&lt;\/i&gt;/);
  assert.match(UI.renderSeasonPlan(null,[],{},'2026-09-09'),/Ainda não há plano da época aprovado/);
});
test('biblioteca: filtros e links',()=>{
  const s=[{id:'s1',library_code:'T01',title:'Rondos',status:'aprovado',pillars:['tecnica'],season_block:1,focus:'passe',duration_min:60}];
  const h=UI.renderLibrary({code:'sub8',name:'Sub-8'},s,{},['passe']);
  assert.match(h,/T01/); assert.match(h,/href="#\/formacao\/treino\/s1"/); assert.match(h,/passe/);
});
test('escalão: cartões de plano e biblioteca',()=>{
  const h=UI.renderAgeGroup({code:'sub8',name:'Sub-8'},[],{});
  assert.match(h,/href="#\/formacao\/plano\/sub8"/); assert.match(h,/href="#\/formacao\/biblioteca\/sub8"/);
});
```

- [ ] Implementar: em `view(parts)`, tratar `parts[1]==='plano'` e `parts[1]==='biblioteca'` antes do ramo de escalão; filtros da biblioteca com `<select data-learning-filter="pillar|block|focus">` que re-renderizam no `change` (estado em memória); ao abrir o plano, fazer `scrollIntoView` da semana atual (`[data-current-week]`). Nomes dos blocos vêm dos dados (`block_title`).
- [ ] CSS: `.bottom-nav{grid-template-columns:none;grid-auto-flow:column;grid-auto-columns:minmax(0,1fr)}` (na regra existente da linha ~151); classes novas com prefixo `learning-` (pausa a cinzento, semana atual destacada).
- [ ] `sw.js` CACHE `vision-coach-v172`; `index.html` `serviceWorkerVersion = 172`.
- [ ] e2e em `tests/e2e/learning.spec.js`:

```js
test('barra de baixo numa só linha com Formação ligada (390px)',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.addInitScript(()=>localStorage.setItem('vision.learning.enabled','1'));
  await page.goto('/#/formacao');
  const tops=await page.locator('.bottom-nav a:visible').evaluateAll(as=>as.map(a=>Math.round(a.getBoundingClientRect().top)));
  expect(tops.length).toBe(7);
  expect(new Set(tops).size).toBe(1);
});
```

- [ ] `npm run check && npm test && npm run test:e2e`; commit `feat(formacao): plano da época, biblioteca e barra móvel numa linha`.

---

### Task 5: Documentação

- [ ] `docs/learning.md`: secções "Plano da época" e "Biblioteca de treinos" (rotas, o que mostra, como o conteúdo entra). Commit `docs(formacao): plano da época e biblioteca`.
