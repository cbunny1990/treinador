"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
global.Learning=require("../js/learning.js");
const UI=require("../js/learning_ui.js");
test("Início: Sub-8 ativo com link, restantes em breve sem link",()=>{
  const h=UI.renderHome([{code:"sub8",name:"Sub-8",active:true},{code:"sub9",name:"Sub-9",active:false}],{sub8:{seen:1,total:4}});
  assert.match(h,/href="#\/formacao\/sub8"/);assert.match(h,/1\/4/);
  assert.match(h,/Sub-9[\s\S]*em breve/);assert.doesNotMatch(h,/href="#\/formacao\/sub9"/);
});
test("Escalão: 3 blocos na ordem certa",()=>{
  const mods=[{block:"treinador",slug:"como-agir",title:"Como agir"},{block:"jogador",slug:"quem-sao",title:"Quem são os Sub-8"},{block:"ensinar",slug:"tecnica",title:"Técnica"}];
  const h=UI.renderAgeGroup({code:"sub8",name:"Sub-8"},mods,{});
  assert.ok(h.indexOf("O jogador")<h.indexOf("O que ensinar")&&h.indexOf("O que ensinar")<h.indexOf("O treinador"));
  assert.match(h,/href="#\/formacao\/sub8\/tecnica"/);
});
test("Módulo: escapa HTML, YouTube nocookie, externos com noopener, vazio explicado",()=>{
  const items=[{id:"1",kind:"ver",media:"video",status:"aprovado",broken:false,title:"<b>x</b>",url:"https://youtu.be/abc",source:"YT",summary_pt:"s",key_points:["a"],why:"porque"},{id:"2",kind:"ler",media:"blog",status:"aprovado",broken:false,title:"Blog",url:"https://blog.pt/a",key_points:[]}];
  const m={slug:"tecnica",title:"Técnica",age_group_code:"sub8"},ver=UI.renderModule(m,null,items,"ver");
  assert.match(ver,/&lt;b&gt;x&lt;\/b&gt;/);assert.match(ver,/youtube-nocookie\.com\/embed\/abc/);assert.match(ver,/Porquê ver/);
  assert.match(UI.renderModule(m,null,items,"ler"),/rel="noopener noreferrer"/);
  assert.match(UI.renderModule(m,null,[],"seguir"),/Ainda sem conteúdo aprovado/);
});
test("Treino-exemplo mostra porquê e pontos de ensino",()=>{
  const h=UI.renderSession({title:"Rondos",objective:"Passe",pillars:["tecnica"],duration_min:60,season_phase:"inicio",why:"Aprendem a jogar",exercises:[{fase:"Parte principal",organizacao:"4x1",regras:"2 toques",variantes:"",pontos_ensino:["Olhar antes"],erros_comuns:["Parar a bola"]}]});
  assert.match(h,/Porquê este treino/);assert.match(h,/Olhar antes/);assert.match(h,/Parar a bola/);
});
test("texto da base de dados é escapado também em atributos HTML",()=>{
  const h=UI.renderModule({slug:"tecnica",title:'Técnica "<script>',age_group_code:"sub8"},null,[
    {id:'x" onmouseover="alert(1)',kind:"ver",media:"video",status:"aprovado",broken:false,title:'Vídeo "<script>',url:"https://youtu.be/abc",source:"<b>fonte</b>",notes:'</textarea><script>alert(1)</script>'}
  ],"ver");
  assert.doesNotMatch(h,/<script>|onmouseover="alert/);
  assert.match(h,/&quot;&lt;script&gt;/);
  assert.match(h,/data-id="x&amp;quot;|data-id="x&quot;/);
  assert.match(h,/&lt;\/textarea&gt;/);
});
test("plano: blocos, esta semana, pausas e links",()=>{
  const weeks=[{week_no:1,starts_on:"2026-09-07",block_no:1,block_title:"Adaptação",objective:"Conhecer",is_break:false,session_a_id:"s1",session_b_id:"s2"},
               {week_no:2,starts_on:"2026-12-21",block_no:2,block_title:"Condução",objective:"Natal",is_break:true}];
  const h=UI.renderSeasonPlan({title:"Época 2026/27"},weeks,{s1:{id:"s1",library_code:"T01",title:"<i>A</i>"},s2:{id:"s2",library_code:"T02",title:"B"}},"2026-09-09");
  assert.match(h,/Adaptação[\s\S]*Condução/);
  assert.match(h,/Esta semana/);
  assert.match(h,/learning-break/);
  assert.match(h,/href="#\/formacao\/treino\/s1"/);
  assert.match(h,/&lt;i&gt;A&lt;\/i&gt;/);
  assert.match(UI.renderSeasonPlan(null,[],{},"2026-09-09"),/Ainda não há plano da época aprovado/);
});
test("biblioteca: filtros e links",()=>{
  const s=[{id:"s1",library_code:"T01",title:"Rondos",status:"aprovado",pillars:["tecnica"],season_block:1,focus:"passe",duration_min:60}];
  const h=UI.renderLibrary({code:"sub8",name:"Sub-8"},s,{},["passe"]);
  assert.match(h,/T01/);assert.match(h,/href="#\/formacao\/treino\/s1"/);assert.match(h,/passe/);
});
test("escalão: cartões de plano e biblioteca",()=>{
  const h=UI.renderAgeGroup({code:"sub8",name:"Sub-8"},[],{});
  assert.match(h,/href="#\/formacao\/plano\/sub8"/);assert.match(h,/href="#\/formacao\/biblioteca\/sub8"/);
});
