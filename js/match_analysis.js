"use strict";
// Structured post-match analysis. Facts remain sourced from match records; coach and agent text stay separate.
(function(root){
 const SCHEMA='vision-match-analysis@1';
 const FIELDS={
  summary:'Resumo',positives:'Pontos positivos',problems:'Problemas',
  losses:'Perdas de bola',recoveries:'Recuperações',offense:'Criação ofensiva',
  defense:'Comportamento defensivo',transitions:'Transições',set_pieces:'Bolas paradas',
  player_use:'Utilização dos jogadores',keep:'Aspetos a manter',correct:'Aspetos a corrigir',
  observations:'Observação do treinador',interpretation:'Interpretação',hypotheses:'Hipóteses por confirmar',
  decisions:'Decisão do treinador',next_priority:'Prioridade para os próximos treinos'
 };
 const clone=x=>JSON.parse(JSON.stringify(x)),txt=(x,max=5000)=>String(x??'').trim().slice(0,max);
 const stamp=n=>new Date(n??Date.now()).toISOString();
 function state(value){
  const old=value||{};if(old.schema&&old.schema!==SCHEMA)throw new Error('Atualiza a app para ler esta análise.');
  const s={schema:SCHEMA,revision:0,status:'draft',fields:{},goals_conceded:{},history:[],memory_ref:null,memory_fingerprint:null,agent_proposal:null,...clone(old)};
  if(!Number.isInteger(s.revision)||s.revision<0||!s.fields||typeof s.fields!=='object'||!Array.isArray(s.history)||!s.goals_conceded||typeof s.goals_conceded!=='object')throw new Error('Análise pós-jogo inválida.');
  s.fields=Object.fromEntries(Object.keys(FIELDS).map(k=>[k,txt(s.fields[k])]));
  return s;
 }
 function fromMatch(match){return state(match?.post_game?.analysis);}
 function hasCoachContent(fields,goals){return Object.values(fields||{}).some(v=>txt(v))||Object.values(goals||{}).some(v=>txt(v));}
 function save(match,input,{expected_revision,actor='Treinador',now}={}){
  const row=clone(match),old=fromMatch(row);if(old.revision!==expected_revision)throw new Error('A análise mudou noutro dispositivo. Atualiza antes de guardar; o texto foi preservado.');
  const fields=Object.fromEntries(Object.keys(FIELDS).map(k=>[k,txt(input.fields?.[k])]));
  const goals={...old.goals_conceded};for(const [id,value] of Object.entries(input.goals_conceded||{})){if(/^[0-9a-f-]{1,100}$/i.test(id))goals[id]=txt(value,2000);}
  const changed=JSON.stringify([old.fields,old.goals_conceded])!==JSON.stringify([fields,goals]);
  const history=old.history.slice();if(changed&&hasCoachContent(old.fields,old.goals_conceded))history.push({revision:old.revision,fields:old.fields,goals_conceded:old.goals_conceded,saved_at:old.updated_at||null,author:old.updated_by||'Treinador'});
  const analysis={...old,schema:SCHEMA,revision:old.revision+1,status:hasCoachContent(fields,goals)?'done':'draft',fields,goals_conceded:goals,history:history.slice(-20),updated_at:stamp(now),updated_by:actor};
  row.post_game={...(row.post_game||{}),analysis};return row;
 }
 function memoryContent(analysis,events=[]){
  const s=state(analysis),parts=[];for(const [key,label] of Object.entries(FIELDS))if(txt(s.fields[key]))parts.push(label+': '+txt(s.fields[key]));
  const eventById=new Map((events||[]).filter(e=>e.type==='goal_against').map(e=>[String(e.id),e]));
  for(const [id,cause] of Object.entries(s.goals_conceded))if(txt(cause)&&eventById.has(String(id))){const e=eventById.get(String(id));parts.push('Causa provável de golo sofrido · '+Math.floor(e.at_ms/60000)+':'+String(Math.floor(e.at_ms/1000)%60).padStart(2,'0')+': '+txt(cause));}
  if(events.length)parts.push('Evidências registadas no jogo: '+events.map(e=>{const label=root.VisionMatchEvents?.types?.[e.type]||e.type;return Math.floor(e.at_ms/60000)+':'+String(Math.floor(e.at_ms/1000)%60).padStart(2,'0')+' '+label;}).join('; '));
  return parts.join('\n');
 }
 function fingerprint(analysis){const s=state(analysis);return JSON.stringify({fields:s.fields,goals_conceded:s.goals_conceded});}
 root.VisionMatchAnalysis={schema:SCHEMA,fields:FIELDS,state,fromMatch,save,hasCoachContent,memoryContent,fingerprint};
 if(typeof module!=='undefined'&&module.exports)module.exports=root.VisionMatchAnalysis;
})(globalThis);
