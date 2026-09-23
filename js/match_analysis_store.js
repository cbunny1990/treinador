"use strict";
// Atomic local save for analysis and its explicitly requested, deduplicated memory record.
(function(root){
 const A=root.VisionMatchAnalysis;
 async function stableId(value){
  const ns=Uint8Array.from('918501f8c0d54a799513a9b7ce8d28b0'.match(/../g),s=>parseInt(s,16));
  const bytes=new TextEncoder().encode(value),input=new Uint8Array(16+bytes.length);input.set(ns);input.set(bytes,16);
  const out=new Uint8Array(await crypto.subtle.digest('SHA-1',input)).slice(0,16);out[6]=(out[6]&15)|80;out[8]=(out[8]&63)|128;
  const h=[...out].map(x=>x.toString(16).padStart(2,'0')).join('');return h.slice(0,8)+'-'+h.slice(8,12)+'-'+h.slice(12,16)+'-'+h.slice(16,20)+'-'+h.slice(20);
 }
 async function commit(id,input,{expected_revision,save_memory=false,legacy={},actor='Treinador'}={}){
  let match=await DB.obter('jogos',id);if(!match)throw new Error('O jogo foi apagado ou não está disponível.');
  if(!match.sync_id)match=await DB.modificar('jogos',id,row=>({...row,sync_id:row.sync_id||crypto.randomUUID()}));
  const memoryId=await stableId('vision-match-analysis:'+match.sync_id),external='match-analysis-'+match.sync_id,db=await abrirDB();
  return new Promise((resolve,reject)=>{
   const tx=db.transaction(['jogos','memory_items','sync_tombstones'],'readwrite');let failure,result;
   tx.onabort=()=>reject(failure||tx.error||new Error('Nada foi guardado: a transação foi interrompida.'));
   tx.onerror=()=>{failure=failure||tx.error;};
   tx.oncomplete=()=>{_notifyRemoteSync('jogos');if(save_memory)_notifyRemoteSync('memory_items');resolve(result);};
   const readMatches=tx.objectStore('jogos').getAll(),readMemories=tx.objectStore('memory_items').getAll(),readTombstones=tx.objectStore('sync_tombstones').getAll();
   let remaining=3;for(const req of [readMatches,readMemories,readTombstones])req.onsuccess=()=>{if(--remaining===0)apply(readMatches.result,readMemories.result,readTombstones.result);};
   function apply(matches,memories,tombstones){try{
    const source=matches.find(x=>Number(x.id)===Number(id));if(!source)throw new Error('O jogo foi apagado. A análise não será recriada.');
    let saved=A.save(source,input,{expected_revision,actor});
    saved.post_game={...saved.post_game,...legacy,status:saved.post_game.analysis.status==='done'?'done':(saved.post_game.status||'pending')};
    if(save_memory){
     const analysis=A.fromMatch(saved),content=A.memoryContent(analysis,saved.match_events?.events||[]);
     if(analysis.status!=='done'||!content)throw new Error('Guarda primeiro uma análise com conteúdo antes de a ligar à memória.');
     const team=source.team_id||DEFAULT_TEAM_ID,existing=memories.find(m=>(m.team_id||DEFAULT_TEAM_ID)===team&&(m.sync_id===memoryId||m.external_key===external));
     if(tombstones.some(t=>t.store==='memory_items'&&(t.sync_id===memoryId||t.sync_id===existing?.sync_id)))throw new Error('A memória desta análise foi apagada. Não será recriada.');
     if(existing&&existing.metadata?.managed_by!=='match_analysis_v1')throw new Error('Já existe uma memória deste jogo noutro formato. Não foi substituída.');
     const now=new Date().toISOString(),fingerprint=A.fingerprint(analysis);
     const item={...(existing||{}),team_id:team,sync_id:existing?.sync_id||memoryId,external_key:external,kind:'observation',title:'Análise do jogo · '+(source.adversario||source.data||''),content,occurred_at:source.data||now.slice(0,10),source:{type:'match',label:'Análise do treinador',ref_type:'match',ref_id:source.sync_id},subject_refs:[{type:'match',id:source.sync_id,relation:'analysis_of'}],evidence_ids:[],related_ids:[],status:'active',created_at:existing?.created_at||now,updated_at:now,metadata:{...(existing?.metadata||{}),managed_by:'match_analysis_v1',source_match_ref:source.sync_id,source_fingerprint:fingerprint,actor:actor==='Head Coach'?'agent':'human',actor_label:actor}};
     tx.objectStore('memory_items').put(_prepareSyncRecord('memory_items',item));
     saved.post_game.analysis={...analysis,memory_ref:item.sync_id,memory_fingerprint:fingerprint,memory_updated_at:now};
     result={match_id:id,memory_id:existing?.id||null,memory_created:!existing,memory_updated:!!existing};
    }else result={match_id:id,memory_created:false,memory_updated:false};
    tx.objectStore('jogos').put(_prepareSyncRecord('jogos',saved));
   }catch(error){failure=error;tx.abort();}}
  });
 }
 root.MatchAnalysisStore={commit,stableId};
})(globalThis);
