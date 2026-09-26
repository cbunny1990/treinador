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
