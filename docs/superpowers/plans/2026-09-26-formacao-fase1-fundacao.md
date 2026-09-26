# Formação — Fase 1 (Fundação) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Criar as tabelas da Formação com RLS, um interruptor desligado por omissão e os ecrãs de leitura (Início, Escalão, Módulo, Treino-exemplo), sem alterar nada do comportamento atual.

**Architecture:** Migração Supabase aditiva com 5 tabelas `learning_*` (2 de referência com seed Sub-8, 3 do dono com RLS `owner_id = auth.uid()`). Três módulos JS no padrão IIFE do projeto: `js/learning.js` (lógica pura + interruptor), `js/learning_store.js` (consultas diretas via `RemoteWorkspace`, fora da sincronização), `js/learning_ui.js` (funções de render puras + `FormacaoUI.view`). Rota `#/formacao` em `js/app.js`; links no menu escondidos enquanto o interruptor estiver desligado.

**Tech Stack:** JS clássico sem bundler (IIFE `root.X=api` + `module.exports`), Supabase JS client, Postgres/RLS, `node:test`, PGlite (`@electric-sql/pglite`), Playwright.

**Spec:** `docs/superpowers/specs/2026-09-26-formacao-sub8-design.md`

## Global Constraints

- Migração só aditiva; nenhuma chave estrangeira para tabelas existentes; não tocar em tabelas/políticas existentes.
- Nada entra em `js/db.js` `STORES`/`SYNCABLE_STORES` nem em `REMOTE_STORE_KINDS`/`REMOTE_SUBJECT_STORES` de `js/remote_workspace.js`.
- Interruptor desligado por omissão: com ele desligado a app tem de ficar visualmente e funcionalmente idêntica (sem links "Formação").
- Texto de interface em pt-PT inline; códigos de erro técnicos em inglês snake_case.
- Só conteúdo `status = 'aprovado'` e `broken = false` aparece nos ecrãs desta fase.
- YouTube embebido só via `https://www.youtube-nocookie.com/embed/<id>`; outros links abrem em nova janela com `rel="noopener noreferrer"`.
- Todo o texto vindo da base de dados é escapado antes de ir para HTML.
- Cada ficheiro JS novo: `<script>` em `index.html` antes de `js/app.js`, entrada em `ASSETS` de `sw.js`, entrada no script `check` de `package.json`.
- `CACHE` em `sw.js` e `serviceWorkerVersion` em `index.html` sobem juntos de v170 para v171 (uma só vez nesta fase).
- `npm run check` e `npm test` verdes no fim de cada tarefa; a contagem de testes nunca desce face a `origin/main` (registar a contagem inicial na Tarefa 1, passo 0).
- Não fazer push para `main`, não fazer force-push, não usar reset/stash alheio. Ramo: `feature/formacao-sub8`.

---

### Task 1: Migração, seed Sub-8 e testes de RLS

**Files:**
- Create: `supabase/migrations/20260926120000_learning_tables.sql`
- Modify: `tests/supabase_schema.test.js` (acrescentar asserções no fim)
- Create: `tests/learning_migrations.pglite.test.js`

**Interfaces:**
- Produces: tabelas `public.learning_age_groups(code,name,sort,active)`, `public.learning_modules(id,age_group_code,block,slug,title,sort)`, `public.learning_items`, `public.learning_guides`, `public.learning_sessions` com as colunas abaixo. Seed: `sub8` ativo + 12 módulos com os slugs abaixo.

- [ ] **Step 0: Registar a linha de base**

Run: `npm run check && npm test 2>&1 | tail -n 15`
Anotar no relatório final o número de testes `pass`/`fail` de partida.

- [ ] **Step 1: Escrever o teste PGlite (falha porque a migração não existe)**

Ler primeiro `tests/team_knowledge_migrations.pglite.test.js` e **reutilizar o mesmo arranque** (stubs de `auth.*`, carregamento das migrações por ordem, troca de papel com `set_config('request.jwt.claim.role', …)` e do utilizador com `set_config('request.jwt.claim.sub', …)` — usar exatamente o mecanismo que esse ficheiro já usa para `auth.uid()`). Casos:

```js
const test=require('node:test'),assert=require('node:assert/strict');
// arranque copiado de team_knowledge_migrations.pglite.test.js → função `withDb(async db=>{…})`
const A='00000000-0000-4000-8000-00000000000a', B='00000000-0000-4000-8000-00000000000b';

test('seed Sub-8: escalão ativo e 12 módulos em 3 blocos', async()=>withDb(async db=>{
  const g=await db.query(`select code,active from public.learning_age_groups where code='sub8'`);
  assert.deepEqual(g.rows,[{code:'sub8',active:true}]);
  const m=await db.query(`select block,count(*)::int n from public.learning_modules where age_group_code='sub8' group by block order by block`);
  assert.deepEqual(m.rows,[{block:'ensinar',n:4},{block:'jogador',n:4},{block:'treinador',n:4}]);
}));

test('RLS: outro utilizador não vê nem altera itens do dono', async()=>withDb(async db=>{
  await asUser(db,A);
  const mod=(await db.query(`select id from public.learning_modules where slug='como-aprendem'`)).rows[0].id;
  await db.query(`insert into public.learning_items(module_id,kind,media,title,url,url_normalized,status) values($1,'ver','video','T','https://youtube.com/watch?v=x','https://youtube.com/watch?v=x','aprovado')`,[mod]);
  await asUser(db,B);
  assert.equal((await db.query(`select * from public.learning_items`)).rows.length,0);
  const u=await db.query(`update public.learning_items set notes='x' returning id`);
  assert.equal(u.rows.length,0);
}));

test('URL normalizado é único por dono', async()=>withDb(async db=>{
  await asUser(db,A);
  const mod=(await db.query(`select id from public.learning_modules where slug='tecnica'`)).rows[0].id;
  const ins=`insert into public.learning_items(module_id,kind,media,title,url,url_normalized) values($1,'ler','artigo','T','https://a.pt/x','https://a.pt/x')`;
  await db.query(ins,[mod]);
  await assert.rejects(()=>db.query(ins,[mod]),/duplicate key|unique/i);
}));

test('só um guia aprovado por módulo e dono', async()=>withDb(async db=>{
  await asUser(db,A);
  const mod=(await db.query(`select id from public.learning_modules where slug='tatica'`)).rows[0].id;
  const ins=`insert into public.learning_guides(module_id,body_md,status) values($1,'# g','aprovado')`;
  await db.query(ins,[mod]);
  await assert.rejects(()=>db.query(ins,[mod]),/duplicate key|unique/i);
}));
```

`asUser(db,id)` = definir papel `authenticated` e o `sub` do JWT como no ficheiro de referência.

- [ ] **Step 2: Correr e confirmar que falha**

Run: `node --test tests/learning_migrations.pglite.test.js`
Expected: FAIL (`relation "public.learning_age_groups" does not exist`).

- [ ] **Step 3: Escrever a migração**

```sql
-- Formação (aprendizagem do treinador). Tabelas novas, sem ligações às existentes.
create table if not exists public.learning_age_groups (
  code text primary key,
  name text not null,
  sort int not null,
  active boolean not null default false
);

create table if not exists public.learning_modules (
  id uuid primary key default gen_random_uuid(),
  age_group_code text not null references public.learning_age_groups(code),
  block text not null check (block in ('jogador','ensinar','treinador')),
  slug text not null,
  title text not null,
  sort int not null,
  unique (age_group_code, slug)
);

create table if not exists public.learning_items (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid(),
  module_id uuid not null references public.learning_modules(id),
  kind text not null check (kind in ('ver','ler','seguir')),
  media text not null check (media in ('video','artigo','manual','blog','rede_social','canal','outro')),
  title text not null,
  url text not null,
  url_normalized text not null,
  source text,
  summary_pt text,
  key_points jsonb not null default '[]'::jsonb,
  why text,
  status text not null default 'proposto' check (status in ('proposto','aprovado','rejeitado')),
  reject_reason text,
  broken boolean not null default false,
  seen_at timestamptz,
  notes text,
  proposed_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, url_normalized)
);

create table if not exists public.learning_guides (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid(),
  module_id uuid not null references public.learning_modules(id),
  body_md text not null,
  citations jsonb not null default '[]'::jsonb,
  status text not null default 'proposto' check (status in ('proposto','aprovado','rejeitado')),
  version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists learning_guides_one_approved
  on public.learning_guides(owner_id, module_id) where status = 'aprovado';

create table if not exists public.learning_sessions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid(),
  module_id uuid not null references public.learning_modules(id),
  title text not null,
  objective text not null,
  pillars text[] not null default '{}',
  duration_min int,
  equipment text,
  season_phase text check (season_phase in ('inicio','meio','fim')),
  exercises jsonb not null default '[]'::jsonb,
  why text,
  citations jsonb not null default '[]'::jsonb,
  status text not null default 'proposto' check (status in ('proposto','aprovado','rejeitado')),
  seen_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.learning_age_groups enable row level security;
alter table public.learning_modules enable row level security;
alter table public.learning_items enable row level security;
alter table public.learning_guides enable row level security;
alter table public.learning_sessions enable row level security;

drop policy if exists learning_age_groups_select on public.learning_age_groups;
create policy learning_age_groups_select on public.learning_age_groups for select to authenticated using (true);
drop policy if exists learning_modules_select on public.learning_modules;
create policy learning_modules_select on public.learning_modules for select to authenticated using (true);

do $$
declare t text;
begin
  foreach t in array array['learning_items','learning_guides','learning_sessions'] loop
    execute format('drop policy if exists %1$s_owner_all on public.%1$s', t);
    execute format('create policy %1$s_owner_all on public.%1$s for all to authenticated
      using (owner_id = auth.uid()) with check (owner_id = auth.uid())', t);
  end loop;
end $$;

insert into public.learning_age_groups(code,name,sort,active) values
  ('sub8','Sub-8',8,true),('sub9','Sub-9',9,false),('sub10','Sub-10',10,false),
  ('sub11','Sub-11',11,false),('sub12','Sub-12',12,false),('sub13','Sub-13',13,false),
  ('sub14','Sub-14',14,false),('sub15','Sub-15',15,false),('sub17','Sub-17',17,false),
  ('sub19','Sub-19',19,false),('senior','Sénior',99,false)
on conflict (code) do nothing;

insert into public.learning_modules(age_group_code,block,slug,title,sort) values
  ('sub8','jogador','quem-sao','Quem são os Sub-8',1),
  ('sub8','jogador','como-aprendem','Como aprendem',2),
  ('sub8','jogador','objetivos-ate-idade','Objetivos até esta idade',3),
  ('sub8','jogador','fica-para-depois','O que fica para depois',4),
  ('sub8','ensinar','tecnica','Técnica',5),
  ('sub8','ensinar','tatica','Tática',6),
  ('sub8','ensinar','fisico-coordenacao','Físico e coordenação',7),
  ('sub8','ensinar','psicossocial','Psicossocial',8),
  ('sub8','treinador','ensinar-explicar','Como ensinar e explicar',9),
  ('sub8','treinador','como-agir','Como agir',10),
  ('sub8','treinador','planeamento','Planeamento da época',11),
  ('sub8','treinador','treinos-exemplo','Treinos-exemplo',12)
on conflict (age_group_code, slug) do nothing;
```

Se o PGlite não tiver `gen_random_uuid()` sem extensão, verificar como as migrações existentes geram UUIDs e usar o mesmo.

- [ ] **Step 4: Asserções de texto em `tests/supabase_schema.test.js`**

Acrescentar um teste no fim, no mesmo estilo do ficheiro (usa o SQL concatenado já carregado):

```js
test('Formação: tabelas learning_* com RLS e sem sync', ()=>{
  for(const t of ['learning_age_groups','learning_modules','learning_items','learning_guides','learning_sessions'])
    assert.match(sql,new RegExp(`alter table public\\.${t} enable row level security`));
  assert.match(sql,/unique \(owner_id, url_normalized\)/);
  assert.doesNotMatch(sql,/learning_[a-z_]+[^;]*references public\.(teams|jogadores|treinos|workspace_records)/);
});
```

(Adaptar o nome da variável `sql` ao que o ficheiro usa.)

- [ ] **Step 5: Correr e confirmar que passa**

Run: `node --test tests/learning_migrations.pglite.test.js tests/supabase_schema.test.js`
Expected: PASS.

- [ ] **Step 6: Suite completa + commit**

Run: `npm run check && npm test`
```bash
git add supabase/migrations/20260926120000_learning_tables.sql tests/learning_migrations.pglite.test.js tests/supabase_schema.test.js
git commit -m "feat(formacao): tabelas learning_* com RLS e seed Sub-8"
```

(Se `npm test` usa o glob `tests/*.test.js`, o ficheiro `.pglite.test.js` entra automaticamente; confirmar.)

---

### Task 2: Lógica pura e interruptor — `js/learning.js`

**Files:**
- Create: `js/learning.js`
- Create: `tests/learning.test.js`
- Modify: `package.json` (script `check`: acrescentar `&& node --check js/learning.js` no mesmo formato)

**Interfaces:**
- Produces: global `Learning` = `{FLAG_KEY, isEnabled(storage?), setEnabled(on, storage?), normalizeUrl(raw):string, youtubeId(url):string|null, embedUrl(url):string|null, isVisible(row):boolean, byKind(items):{ver:[],ler:[],seguir:[]}, progress(rows):{seen:number,total:number}, BLOCKS:[{id,title}]}`.

- [ ] **Step 1: Teste que falha**

```js
const test=require('node:test'),assert=require('node:assert/strict');
const L=require('../js/learning.js');
const mem=()=>{const m=new Map();return{getItem:k=>m.has(k)?m.get(k):null,setItem:(k,v)=>m.set(k,String(v)),removeItem:k=>m.delete(k)}};

test('interruptor desligado por omissão e ligável',()=>{
  const s=mem();
  assert.equal(L.isEnabled(s),false);
  L.setEnabled(true,s); assert.equal(L.isEnabled(s),true);
  L.setEnabled(false,s); assert.equal(L.isEnabled(s),false);
  assert.equal(L.isEnabled({getItem(){throw new Error('blocked')}}),false);
});

test('normalizeUrl junta variantes do mesmo endereço',()=>{
  assert.equal(L.normalizeUrl('https://youtu.be/abc123?si=zz'),'https://youtube.com/watch?v=abc123');
  assert.equal(L.normalizeUrl('https://www.youtube.com/watch?v=abc123&t=30s'),'https://youtube.com/watch?v=abc123');
  assert.equal(L.normalizeUrl('https://www.youtube.com/shorts/abc123'),'https://youtube.com/watch?v=abc123');
  assert.equal(L.normalizeUrl(' HTTP://WWW.Blog.pt/Artigo/?utm_source=x&fbclid=y#topo '),'https://blog.pt/Artigo');
  assert.equal(L.normalizeUrl('https://a.pt/?q=1'),'https://a.pt/?q=1');
});

test('embedUrl só para YouTube e em modo nocookie',()=>{
  assert.equal(L.embedUrl('https://youtu.be/abc123'),'https://www.youtube-nocookie.com/embed/abc123');
  assert.equal(L.embedUrl('https://instagram.com/p/x'),null);
});

test('visibilidade, agrupamento e progresso',()=>{
  const rows=[
    {kind:'ver',status:'aprovado',broken:false,seen_at:'2026-09-26'},
    {kind:'ler',status:'aprovado',broken:false,seen_at:null},
    {kind:'seguir',status:'proposto',broken:false},
    {kind:'ver',status:'aprovado',broken:true},
    {kind:'ler',status:'rejeitado',broken:false}];
  const g=L.byKind(rows);
  assert.deepEqual([g.ver.length,g.ler.length,g.seguir.length],[1,1,0]);
  assert.deepEqual(L.progress(rows),{seen:1,total:2});
  assert.deepEqual(L.BLOCKS.map(b=>b.id),['jogador','ensinar','treinador']);
});
```

- [ ] **Step 2: Correr — falha**

Run: `node --test tests/learning.test.js` → FAIL (`Cannot find module '../js/learning.js'`).

- [ ] **Step 3: Implementação**

Usar o mesmo wrapper IIFE e a mesma expressão de `root` que `js/seasons.js` usa. Corpo:

```js
const FLAG_KEY='vision.learning.enabled';
const TRACKING=/^(utm_.+|fbclid|gclid|si|feature)$/i;
function store(s){if(s)return s;try{return root.localStorage}catch{return null}}
function isEnabled(s){try{return store(s)?.getItem(FLAG_KEY)==='1'}catch{return false}}
function setEnabled(on,s){try{const st=store(s);if(!st)return;on?st.setItem(FLAG_KEY,'1'):st.removeItem(FLAG_KEY)}catch{}}
function youtubeId(raw){
  let u;try{u=new URL(String(raw).trim())}catch{return null}
  const h=u.hostname.toLowerCase().replace(/^www\.|^m\./,'');
  if(h==='youtu.be')return u.pathname.slice(1).split('/')[0]||null;
  if(h==='youtube.com'||h==='youtube-nocookie.com'){
    if(u.pathname==='/watch')return u.searchParams.get('v');
    const m=u.pathname.match(/^\/(shorts|embed|live)\/([^/]+)/);return m?m[2]:null;
  }
  return null;
}
function normalizeUrl(raw){
  const id=youtubeId(raw);
  if(id)return `https://youtube.com/watch?v=${id}`;
  const u=new URL(String(raw).trim());
  u.protocol='https:';u.hash='';
  u.hostname=u.hostname.toLowerCase().replace(/^www\./,'');
  for(const k of [...u.searchParams.keys()])if(TRACKING.test(k))u.searchParams.delete(k);
  if(u.pathname.length>1)u.pathname=u.pathname.replace(/\/+$/,'');
  return u.toString();
}
function embedUrl(url){const id=youtubeId(url);return id?`https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}`:null}
function isVisible(r){return r?.status==='aprovado'&&!r.broken}
function byKind(items){const g={ver:[],ler:[],seguir:[]};for(const r of items||[])if(isVisible(r)&&g[r.kind])g[r.kind].push(r);return g}
function progress(rows){const v=(rows||[]).filter(isVisible);return{seen:v.filter(r=>r.seen_at).length,total:v.length}}
const BLOCKS=[{id:'jogador',title:'O jogador'},{id:'ensinar',title:'O que ensinar'},{id:'treinador',title:'O treinador'}];
const api={FLAG_KEY,isEnabled,setEnabled,normalizeUrl,youtubeId,embedUrl,isVisible,byKind,progress,BLOCKS};
root.Learning=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
```

Nota: `new URL('https://blog.pt/Artigo/').toString()` depois de limpar a query devolve `https://blog.pt/Artigo` sem `?`; se o Node deixar `?` pendurado, remover no fim com `.replace(/\?$/,'')`.

- [ ] **Step 4: Passa**

Run: `node --test tests/learning.test.js` → PASS. Acrescentar `node --check js/learning.js` ao `check`.

- [ ] **Step 5: Suite + commit**

Run: `npm run check && npm test`
```bash
git add js/learning.js tests/learning.test.js package.json
git commit -m "feat(formacao): lógica pura e interruptor"
```

---

### Task 3: Acesso a dados — `js/learning_store.js`

**Files:**
- Create: `js/learning_store.js`
- Create: `tests/learning_store.test.js`
- Modify: `package.json` (`check`: `&& node --check js/learning_store.js`)

**Interfaces:**
- Consumes: `RemoteWorkspace.init()` → cliente Supabase; `RemoteWorkspace.getSession()` → `{user:{id}}`.
- Produces: global `LearningStore` = `{createStore(remote), store}` onde `store`/`createStore(...)` expõe:
  `listAgeGroups():Promise<[{code,name,sort,active}]>`,
  `listModules(ageGroupCode):Promise<[{id,block,slug,title,sort}]>`,
  `listItems(moduleIds:string[]):Promise<row[]>` (só aprovado e não partido),
  `getGuide(moduleId):Promise<row|null>` (aprovado),
  `listSessions(moduleId):Promise<row[]>` (aprovados),
  `getSession(id):Promise<row|null>`,
  `markSeen(table,id,seen:boolean)`, `saveNotes(table,id,notes)`, `markBroken(id)`.
  `table` ∈ `'learning_items'|'learning_sessions'`, caso contrário lança `Error('learning_table_not_allowed')`.
  Sem sessão: lança `Error('Inicia sessão na conta Vision Coach para usar a Formação.')`.

- [ ] **Step 1: Teste que falha (cliente falso que regista chamadas)**

```js
const test=require('node:test'),assert=require('node:assert/strict');
const {createStore}=require('../js/learning_store.js');
function fake(result={data:[],error:null},user='u1'){
  const calls=[];
  const q=(table)=>{const c={table,ops:[]};calls.push(c);const p={};
    for(const op of ['select','eq','in','order','update','maybeSingle'])p[op]=(...a)=>{c.ops.push([op,...a]);return p};
    p.then=(res,rej)=>Promise.resolve(result).then(res,rej);return p};
  return{calls,remote:{init:async()=>({from:q}),getSession:async()=>user?{user:{id:user}}:null}};
}

test('listItems filtra aprovado e não partido',async()=>{
  const f=fake();await createStore(f.remote).listItems(['m1','m2']);
  const ops=f.calls[0].ops;
  assert.equal(f.calls[0].table,'learning_items');
  assert.deepEqual(ops.find(o=>o[0]==='in'),['in','module_id',['m1','m2']]);
  assert.ok(ops.some(o=>o[0]==='eq'&&o[1]==='status'&&o[2]==='aprovado'));
  assert.ok(ops.some(o=>o[0]==='eq'&&o[1]==='broken'&&o[2]===false));
});

test('markSeen grava data e rejeita tabelas fora da lista',async()=>{
  const f=fake();const s=createStore(f.remote);
  await s.markSeen('learning_items','i1',true);
  const upd=f.calls[0].ops.find(o=>o[0]==='update')[1];
  assert.match(upd.seen_at,/^\d{4}-\d{2}-\d{2}T/);
  await s.markSeen('learning_items','i1',false);
  assert.equal(f.calls[1].ops.find(o=>o[0]==='update')[1].seen_at,null);
  await assert.rejects(()=>s.markSeen('teams','x',true),/learning_table_not_allowed/);
});

test('sem sessão dá mensagem clara em pt-PT',async()=>{
  const f=fake(undefined,null);
  await assert.rejects(()=>createStore(f.remote).listAgeGroups(),/Inicia sessão/);
});

test('erro do Supabase é propagado',async()=>{
  const f=fake({data:null,error:new Error('boom')});
  await assert.rejects(()=>createStore(f.remote).listAgeGroups(),/boom/);
});
```

- [ ] **Step 2: Correr — falha** (`Cannot find module`).

- [ ] **Step 3: Implementação** (mesmo wrapper IIFE)

```js
const TABLES=new Set(['learning_items','learning_sessions']);
function createStore(remote){
  async function ctx(){
    const client=await remote?.init?.();const session=await remote?.getSession?.();
    if(!client||!session?.user?.id)throw new Error('Inicia sessão na conta Vision Coach para usar a Formação.');
    return client;
  }
  async function run(q){const {data,error}=await q;if(error)throw error;return data}
  const now=()=>new Date().toISOString();
  function allowed(t){if(!TABLES.has(t))throw new Error('learning_table_not_allowed')}
  return{
    async listAgeGroups(){return run((await ctx()).from('learning_age_groups').select('code,name,sort,active').order('sort'))},
    async listModules(code){return run((await ctx()).from('learning_modules').select('id,block,slug,title,sort').eq('age_group_code',code).order('sort'))},
    async listItems(ids){if(!ids?.length)return[];return run((await ctx()).from('learning_items').select('*').in('module_id',ids).eq('status','aprovado').eq('broken',false).order('created_at'))},
    async getGuide(id){return run((await ctx()).from('learning_guides').select('*').eq('module_id',id).eq('status','aprovado').maybeSingle())},
    async listSessions(id){return run((await ctx()).from('learning_sessions').select('*').eq('module_id',id).eq('status','aprovado').order('created_at'))},
    async getSession(id){return run((await ctx()).from('learning_sessions').select('*').eq('id',id).eq('status','aprovado').maybeSingle())},
    async markSeen(t,id,seen){allowed(t);return run((await ctx()).from(t).update({seen_at:seen?now():null,updated_at:now()}).eq('id',id))},
    async saveNotes(t,id,notes){allowed(t);return run((await ctx()).from(t).update({notes:String(notes||'').slice(0,5000),updated_at:now()}).eq('id',id))},
    async markBroken(id){return run((await ctx()).from('learning_items').update({broken:true,updated_at:now()}).eq('id',id))}
  };
}
const store=createStore({init:()=>root.RemoteWorkspace?.init(),getSession:()=>root.RemoteWorkspace?.getSession()});
const api={createStore,store};
root.LearningStore=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
```

- [ ] **Step 4: Passa** — `node --test tests/learning_store.test.js`; acrescentar ao `check`.

- [ ] **Step 5: Suite + commit**

```bash
git add js/learning_store.js tests/learning_store.test.js package.json
git commit -m "feat(formacao): acesso direto às tabelas learning_*"
```

---

### Task 4: Ecrãs, rota, menu escondido e interruptor nas Definições

**Files:**
- Create: `js/learning_ui.js`
- Create: `tests/learning_ui.test.js`
- Create: `tests/e2e/learning.spec.js`
- Modify: `js/app.js` (`routeOnce()` ~l.193: ramo `formacao`; `viewSettings()` ~l.1031: caixa do interruptor; arranque: mostrar/esconder links)
- Modify: `index.html` (links em `<nav class="side-nav">` e `<nav class="bottom-nav">` com `hidden`; `<script src="js/learning.js">`, `js/learning_store.js`, `js/learning_ui.js` antes de `js/app.js`; `serviceWorkerVersion` 170→171)
- Modify: `sw.js` (`CACHE` → `vision-coach-v171`; 3 entradas novas em `ASSETS`)
- Modify: `css/styles.css` (só classes novas com prefixo `learning-`)
- Modify: `package.json` (`check`: `&& node --check js/learning_ui.js`)
- Modify: `tests/approved_visuals.test.js` só se a lista esperada de scripts/ordem o exigir.

**Interfaces:**
- Consumes: `Learning.*` (Tarefa 2), `LearningStore.store` (Tarefa 3), `setView(title,html,eyebrow)`, `go(hash)`, `markNav(tab)` de `js/app.js`, e o helper de escape de HTML já usado por `js/training_session_ui.js` (reutilizar esse; não criar outro se existir).
- Produces: global `FormacaoUI` = `{view(parts), renderHome(groups,progressByCode), renderAgeGroup(group,modules,progressByModule), renderModule(module,guide,items,kind), renderSession(session), syncNav()}`. As funções `render*` são puras (devolvem string HTML) e testáveis em Node.
- Rotas: `#/formacao` (Início), `#/formacao/<code>` (Escalão), `#/formacao/<code>/<slug>[/<ver|ler|seguir>]` (Módulo), `#/formacao/treino/<id>` (Treino-exemplo). `data-tab="formacao"`.

- [ ] **Step 1: Testes de render (falham)**

```js
const test=require('node:test'),assert=require('node:assert/strict');
global.Learning=require('../js/learning.js');
const UI=require('../js/learning_ui.js');

test('Início: Sub-8 ativo com link, restantes "em breve" sem link',()=>{
  const h=UI.renderHome([{code:'sub8',name:'Sub-8',active:true},{code:'sub9',name:'Sub-9',active:false}],{sub8:{seen:1,total:4}});
  assert.match(h,/href="#\/formacao\/sub8"/);
  assert.match(h,/1\/4/);
  assert.match(h,/Sub-9[\s\S]*em breve/);
  assert.doesNotMatch(h,/href="#\/formacao\/sub9"/);
});

test('Escalão: 3 blocos na ordem certa',()=>{
  const mods=[{block:'treinador',slug:'como-agir',title:'Como agir'},{block:'jogador',slug:'quem-sao',title:'Quem são os Sub-8'},{block:'ensinar',slug:'tecnica',title:'Técnica'}];
  const h=UI.renderAgeGroup({code:'sub8',name:'Sub-8'},mods,{});
  assert.ok(h.indexOf('O jogador')<h.indexOf('O que ensinar')&&h.indexOf('O que ensinar')<h.indexOf('O treinador'));
  assert.match(h,/href="#\/formacao\/sub8\/tecnica"/);
});

test('Módulo: escapa HTML, YouTube nocookie, externos com noopener, vazio explicado',()=>{
  const items=[
    {id:'1',kind:'ver',media:'video',status:'aprovado',broken:false,title:'<b>x</b>',url:'https://youtu.be/abc',source:'YT',summary_pt:'s',key_points:['a'],why:'porque'},
    {id:'2',kind:'ler',media:'blog',status:'aprovado',broken:false,title:'Blog',url:'https://blog.pt/a',key_points:[]}];
  const m={slug:'tecnica',title:'Técnica',age_group_code:'sub8'};
  const ver=UI.renderModule(m,null,items,'ver');
  assert.match(ver,/&lt;b&gt;x&lt;\/b&gt;/);
  assert.match(ver,/youtube-nocookie\.com\/embed\/abc/);
  assert.match(ver,/Porquê ver/);
  const ler=UI.renderModule(m,null,items,'ler');
  assert.match(ler,/rel="noopener noreferrer"/);
  assert.match(UI.renderModule(m,null,[],'seguir'),/Ainda sem conteúdo aprovado/);
});

test('Treino-exemplo mostra porquê e pontos de ensino',()=>{
  const h=UI.renderSession({title:'Rondos',objective:'Passe',pillars:['tecnica'],duration_min:60,season_phase:'inicio',why:'Aprendem a jogar',
    exercises:[{fase:'Parte principal',organizacao:'4x1',regras:'2 toques',variantes:'',pontos_ensino:['Olhar antes'],erros_comuns:['Parar a bola']}]});
  assert.match(h,/Porquê este treino/);
  assert.match(h,/Olhar antes/);
  assert.match(h,/Parar a bola/);
});
```

- [ ] **Step 2: Correr — falha** (`Cannot find module`).

- [ ] **Step 3: Implementar `js/learning_ui.js`**

Requisitos exatos (mesmo wrapper IIFE):
- `renderHome(groups, progressByCode)`: grelha `learning-groups`; ativo → `<a class="panel" href="#/formacao/<code>">Nome · x/y vistos</a>`; inativo → `<div class="panel learning-soon">Nome <span class="badge">em breve</span></div>`.
- `renderAgeGroup(group, modules, progressByModule)`: para cada `Learning.BLOCKS` na ordem, `<h3>` com o título e lista de links `#/formacao/<code>/<slug>` com "x/y vistos" (usar `{seen:0,total:0}` quando faltar).
- `renderModule(module, guide, items, kind)`: guia aprovado no topo (`guide.body_md` escapado, quebras de linha → `<br>`; lista de `citations` como links externos) ou "Guia-síntese ainda por aprovar."; separadores Ver/Ler/Seguir como links `#/formacao/<code>/<slug>/<kind>` com o ativo marcado `aria-current="page"`; itens de `Learning.byKind(items)[kind]` com título, fonte, resumo, `key_points` em `<ul>`, "Porquê ver/ler/seguir" + `why`; vídeo com `Learning.embedUrl` → `<iframe loading="lazy" allowfullscreen src="…" title="…">`, restantes → `<a target="_blank" rel="noopener noreferrer">Abrir</a>`; botões com `data-learning-action="seen|unseen|broken"` e `data-id`; `<textarea data-learning-notes data-id>` com as notas. Vazio: "Ainda sem conteúdo aprovado. Pede ao agente para procurar conteúdo para este módulo." No módulo `treinos-exemplo`, a lista usa os treinos (`items` = treinos) com link `#/formacao/treino/<id>`.
- `renderSession(s)`: título, objetivo, pilares, duração, fase ("Início/Meio/Fim da época"), "Porquê este treino", e para cada exercício: fase, organização, regras, variantes, "Pontos de ensino" (`pontos_ensino` lista), "Erros comuns" (`erros_comuns` lista); botões visto/notas com `data-table="learning_sessions"`.
- `view(parts)`: se `!Learning.isEnabled()` → `setView('Formação','<div class="notice">A secção Formação está desligada. Liga-a em Definições.</div>')`. Senão mostra "A carregar…", carrega via `LearningStore.store` e chama o render certo; erros → `<div class="notice">` com `err.message`. Depois de render, liga os eventos por delegação no contentor da vista: `seen/unseen/broken` chamam `markSeen/markBroken` e voltam a renderizar a rota atual; notas gravam em `change` com `saveNotes`.
- `syncNav()`: `document.querySelectorAll('[data-tab="formacao"]').forEach(a=>a.hidden=!Learning.isEnabled())`.
- Reutilizar o helper de escape existente (ver `js/training_session_ui.js`); se não houver helper global, definir `esc` local neste ficheiro.

- [ ] **Step 4: Ligar à app**
  - `index.html`: em ambos os `<nav>`, acrescentar `<a href="#/formacao" data-tab="formacao" hidden>Formação</a>` copiando a marcação dos links vizinhos (ícone incluído se os vizinhos tiverem). Scripts novos antes de `js/app.js`. `serviceWorkerVersion = 171`.
  - `js/app.js` `routeOnce()`: `if(root==="formacao") return FormacaoUI.view(parts);` junto dos outros ramos. No arranque (onde os listeners são registados) chamar `FormacaoUI.syncNav()`.
  - `js/app.js` `viewSettings()`: acrescentar um bloco com `<label><input type="checkbox" id="learning-toggle"> Mostrar a secção Formação (em testes)</label>`; ao mudar → `Learning.setEnabled(checked)`, `FormacaoUI.syncNav()`.
  - `sw.js`: `CACHE="vision-coach-v171"` e `"./js/learning.js","./js/learning_store.js","./js/learning_ui.js"` em `ASSETS`.
  - `package.json` `check`: `node --check js/learning_ui.js`.

- [ ] **Step 5: Teste e2e `tests/e2e/learning.spec.js`**

Seguir a estrutura de um spec existente em `tests/e2e/` (mesmo `baseURL`/arranque).

```js
const {test,expect}=require('@playwright/test');
test('interruptor desligado: sem link e rota explica',async({page})=>{
  await page.goto('/#/formacao');
  await expect(page.locator('[data-tab="formacao"]').first()).toBeHidden();
  await expect(page.getByText('A secção Formação está desligada')).toBeVisible();
});
test('interruptor ligado nas Definições mostra o link',async({page})=>{
  await page.addInitScript(()=>localStorage.setItem('vision.learning.enabled','1'));
  await page.goto('/#/formacao');
  await expect(page.locator('[data-tab="formacao"]').first()).toBeVisible();
  await expect(page.getByText(/Inicia sessão|Sub-8/)).toBeVisible();
});
```

- [ ] **Step 6: Correr tudo**

Run: `node --test tests/learning_ui.test.js` → PASS
Run: `npm run check && npm test` → verde, contagem ≥ linha de base
Run: `npm run test:e2e -- tests/e2e/learning.spec.js tests/e2e/service_worker_images.spec.js` → PASS
Run: `npm run test:e2e` (suite de navegador completa) → sem falhas novas face à linha de base (se houver falhas prévias, listar e provar que já falhavam em `origin/main`).

- [ ] **Step 7: Commit**

```bash
git add js/learning_ui.js js/app.js index.html sw.js css/styles.css package.json tests/learning_ui.test.js tests/e2e/learning.spec.js
git commit -m "feat(formacao): ecrãs de leitura, rota e interruptor (desligado por omissão)"
```

---

### Task 5: Documentação e verificação final

**Files:**
- Create: `docs/learning.md`
- Modify: `AGENTS.md` (secção curta "## Formação" a apontar para `docs/learning.md`)

- [ ] **Step 1: Escrever `docs/learning.md`** no estilo de `docs/training-session.md`:

```markdown
# Vision Coach — Formação do treinador

Espaço pessoal de aprendizagem: guias-síntese, recomendações (Ver / Ler / Seguir) e treinos-exemplo por escalão. Começa pelo Sub-8.

## Utilização
- Ligar: Definições → "Mostrar a secção Formação (em testes)".
- Rotas: `#/formacao`, `#/formacao/sub8`, `#/formacao/sub8/<módulo>[/ver|ler|seguir]`, `#/formacao/treino/<id>`.
- Só aparece conteúdo aprovado e sem "link partido".

## Regras
1. Os dados vivem nas tabelas `learning_*` (RLS por dono) e não entram na sincronização do workspace.
2. Nenhum agente aprova conteúdo; aprovar é sempre uma ação do treinador na app (fase 2).
3. Vídeos YouTube só via youtube-nocookie; restantes fontes abrem no sítio original, nunca são copiadas.
```

- [ ] **Step 2: Verificação final**

Run: `npm run check && npm test && npm run test:e2e`
Registar: contagem de testes antes/depois, lista de commits (`git log --oneline origin/main..HEAD`), `git diff --stat origin/main..HEAD`.

- [ ] **Step 3: Commit e push do ramo (nunca `main`)**

```bash
git add docs/learning.md AGENTS.md
git commit -m "docs(formacao): guia da secção Formação"
git push -u origin feature/formacao-sub8
```
