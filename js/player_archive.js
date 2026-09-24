"use strict";
// Read-only longitudinal snapshots retained when an athlete profile is deleted.
(function(root){
 const SCHEMA="vision-player-archive@1",copy=value=>JSON.parse(JSON.stringify(value));
 async function stableId(teamId,playerRef){
  const namespace=Uint8Array.from("89d48759ac124c3a930fd77f3a838d11".match(/../g),x=>parseInt(x,16)),bytes=new TextEncoder().encode("vision-player-archive:"+teamId+":"+playerRef),input=new Uint8Array(16+bytes.length);input.set(namespace);input.set(bytes,16);
  const out=new Uint8Array(await crypto.subtle.digest("SHA-1",input)).slice(0,16);out[6]=(out[6]&15)|80;out[8]=(out[8]&63)|128;const hex=[...out].map(x=>x.toString(16).padStart(2,"0")).join("");return hex.slice(0,8)+"-"+hex.slice(8,12)+"-"+hex.slice(12,16)+"-"+hex.slice(16,20)+"-"+hex.slice(20);
 }
 function snapshot(player,{teamId,teamName,teamAgeGroup,archivedAt=new Date().toISOString()}={}){
  const playerRef=String(player?.sync_id||"");if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(playerRef))throw new Error("Não é possível arquivar os objetivos sem o UUID partilhado do atleta. Sincroniza o plantel e tenta novamente.");
  const goals=copy(player.development_goals||{schema:"vision-player-goals@1",revision:0,items:[]});if(!Array.isArray(goals.items))throw new Error("Os objetivos do atleta estão inválidos; a remoção foi cancelada.");
  return{schema:SCHEMA,team_id:String(teamId||player.team_id||"default"),team_name:String(teamName||""),team_age_group:String(teamAgeGroup||player.escalao||""),player:{ref:playerRef,name:String(player.nome||"Atleta"),number:player.numero??null,age_group:String(player.escalao||"")},development_goals:goals,archived_at:archivedAt};
 }
 function state(doc){if(doc?.type!=="player_archive")throw new Error("Arquivo de atleta inválido.");let value;try{value=JSON.parse(doc.body||"{}");}catch{throw new Error("O arquivo de atleta não pode ser lido.");}if(value.schema!==SCHEMA||!Array.isArray(value.development_goals?.items))throw new Error("Atualiza a app para abrir este arquivo de atleta.");return value;}
 root.PlayerArchive={schema:SCHEMA,stableId,snapshot,state};if(typeof module!=="undefined"&&module.exports)module.exports=root.PlayerArchive;
})(globalThis);
