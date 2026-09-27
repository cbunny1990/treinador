"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const L = require("../js/learning.js");
const mem = () => { const m = new Map(); return { getItem: k => m.has(k) ? m.get(k) : null, setItem: (k,v) => m.set(k,String(v)), removeItem: k => m.delete(k) }; };
test("interruptor desligado por omissão e ligável", () => {
  const s=mem(); assert.equal(L.isEnabled(s),false); L.setEnabled(true,s); assert.equal(L.isEnabled(s),true);
  L.setEnabled(false,s); assert.equal(L.isEnabled(s),false);
  assert.equal(L.isEnabled({getItem(){throw new Error("blocked")}}),false);
});
test("normalizeUrl junta variantes do mesmo endereço", () => {
  assert.equal(L.normalizeUrl("https://youtu.be/abc123?si=zz"),"https://youtube.com/watch?v=abc123");
  assert.equal(L.normalizeUrl("https://www.youtube.com/watch?v=abc123&t=30s"),"https://youtube.com/watch?v=abc123");
  assert.equal(L.normalizeUrl("https://www.youtube.com/shorts/abc123"),"https://youtube.com/watch?v=abc123");
  assert.equal(L.normalizeUrl(" HTTP://WWW.Blog.pt/Artigo/?utm_source=x&fbclid=y#topo "),"https://blog.pt/Artigo");
  assert.equal(L.normalizeUrl("https://a.pt/?q=1"),"https://a.pt/?q=1");
});
test("embedUrl só para YouTube e em modo nocookie", () => {
  assert.equal(L.embedUrl("https://youtu.be/abc123"),"https://www.youtube-nocookie.com/embed/abc123");
  assert.equal(L.embedUrl("https://instagram.com/p/x"),null);
});
test("visibilidade, agrupamento e progresso", () => {
  const rows=[{kind:"ver",status:"aprovado",broken:false,seen_at:"2026-09-26"},{kind:"ler",status:"aprovado",broken:false,seen_at:null},{kind:"seguir",status:"proposto",broken:false},{kind:"ver",status:"aprovado",broken:true},{kind:"ler",status:"rejeitado",broken:false}];
  const g=L.byKind(rows); assert.deepEqual([g.ver.length,g.ler.length,g.seguir.length],[1,1,0]);
  assert.deepEqual(L.progress(rows),{seen:1,total:2});
  assert.deepEqual(L.BLOCKS.map(b=>b.id),["jogador","ensinar","treinador"]);
});

test("semana atual",()=>{
  const w=[{week_no:1,starts_on:"2026-09-07"},{week_no:2,starts_on:"2026-09-14"},{week_no:3,starts_on:"2026-09-21"}];
  assert.equal(L.currentWeek(w,"2026-09-01").week_no,1);
  assert.equal(L.currentWeek(w,"2026-09-16").week_no,2);
  assert.equal(L.currentWeek(w,"2026-09-20").week_no,2);
  assert.equal(L.currentWeek(w,"2027-01-01").week_no,3);
  assert.equal(L.currentWeek([],"2026-09-16"),null);
});
test("agrupar por bloco",()=>{
  const g=L.groupWeeksByBlock([{week_no:3,block_no:2,block_title:"B"},{week_no:1,block_no:1,block_title:"A"},{week_no:2,block_no:1,block_title:"A"}]);
  assert.deepEqual(g.map(b=>[b.block_no,b.weeks.map(w=>w.week_no)]),[[1,[1,2]],[2,[3]]]);
});
test("filtros da biblioteca",()=>{
  const s=[{library_code:"T02",status:"aprovado",pillars:["tecnica"],season_block:2,focus:"drible"},
           {library_code:"T01",status:"aprovado",pillars:["tatica"],season_block:1,focus:"jogo"},
           {library_code:"T03",status:"proposto",pillars:["tecnica"],season_block:2,focus:"drible"}];
  assert.deepEqual(L.filterLibrary(s,{}).map(x=>x.library_code),["T01","T02"]);
  assert.deepEqual(L.filterLibrary(s,{pillar:"tecnica"}).map(x=>x.library_code),["T02"]);
  assert.deepEqual(L.filterLibrary(s,{block:1}).map(x=>x.library_code),["T01"]);
  assert.deepEqual(L.focuses(s),["drible","jogo"]);
});
