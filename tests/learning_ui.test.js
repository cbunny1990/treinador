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
