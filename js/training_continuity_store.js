"use strict";
// All local continuity changes commit atomically; no network/await occurs inside the IDB transaction.
(function(root){
  const C=root.VisionTrainingContinuity;
  async function commit(id,operation,args={}){
    let before=await DB.obter('treinos',id);if(!before)throw new Error('O treino foi apagado ou não está disponível.');
    if(!before.sync_id)before=await DB.modificar('treinos',id,row=>({...row,sync_id:row.sync_id||crypto.randomUUID()}));
    if(['propose','save_proposal','approve'].includes(operation)){
      for(const ex of await DB.porIndice('exercicios','team_id',before.team_id||DEFAULT_TEAM_ID))if(ex.workspace_v2&&!ex.sync_id)await DB.modificar('exercicios',ex.id,row=>({...row,sync_id:row.sync_id||crypto.randomUUID()}));
    }
    const baseline=C.sourceKey(before),revision=C.state(before).revision;
    if(args.expected_revision!==undefined&&args.expected_revision!==revision)throw new Error('A proposta mudou. Atualiza a página antes de guardar.');
    let preview=before;
    if(operation==='review')preview=C.saveReview(before,args.review,{expected_review_key:args.expected_review_key});
    if(operation==='clear_review')preview=C.clearReview(before,args);
    const ids=await C.identities(preview),db=await abrirDB();
    return new Promise((resolve,reject)=>{
      const tx=db.transaction(['treinos','memory_items','exercicios','sync_tombstones'],'readwrite');
      const readings={},stores=['treinos','memory_items','exercicios','sync_tombstones'];let left=stores.length,result,failure;
      tx.onabort=()=>reject(failure||tx.error||new Error('Nada foi guardado: a transação foi interrompida.'));
      tx.onerror=()=>{failure=failure||tx.error;};
      tx.oncomplete=()=>{_notifyRemoteSync('treinos');_notifyRemoteSync('memory_items');resolve(result);};
      for(const name of stores){const req=tx.objectStore(name).getAll();req.onsuccess=()=>{readings[name]=req.result;if(--left===0)apply();};}
      function apply(){try{
        const source=readings.treinos.find(t=>Number(t.id)===Number(id));if(!source)throw new Error('O treino foi apagado. Não será recriado.');
        C.check(source,{source_key:baseline,expected_revision:revision});
        const team=source.team_id||DEFAULT_TEAM_ID,pool=readings.exercicios.filter(x=>(x.team_id||DEFAULT_TEAM_ID)===team);
        let next=source,target=null;
        if(operation==='review')next=C.saveReview(source,args.review,{expected_review_key:args.expected_review_key});
        else if(operation==='clear_review')next=C.clearReview(source,args);
        else if(operation==='propose')next=C.prepare(source,pool,ids);
        else if(operation==='save_proposal')next=C.update(source,args.changes,pool,{expected_revision:revision,actor:'Treinador'});
        else if(operation==='dismiss')next=C.dismiss(source,{...args,expected_revision:revision});
        else if(operation==='approve'){
          const p=C.state(source).proposal;
          if(!args.confirmed)throw new Error('Confirma a aprovação.');
          if(p?.status==='approved'){
            const existing=readings.treinos.find(t=>t.sync_id===p.target_ref&&(t.team_id||DEFAULT_TEAM_ID)===team);
            if(!existing)throw new Error('O treino aprovado não está disponível ou foi apagado. Não será recriado.');
            result={source_id:source.id,target_id:existing.id,already_approved:true};return;
          }
          const approved=C.approve(source,pool,{expected_revision:revision,confirmed:args.confirmed});next=approved.source;target=approved.target;
          if(readings.sync_tombstones.some(t=>t.store==='treinos'&&t.sync_id===target.sync_id))throw new Error('O treino de continuidade foi apagado. A aprovação não o vai recriar.');
          const existing=readings.treinos.find(t=>(t.team_id||DEFAULT_TEAM_ID)===team&&(t.sync_id===target.sync_id||t.external_key===target.external_key));
          if(existing){
            if(existing.continuity_origin?.approval_signature!==target.continuity_origin.approval_signature)throw new Error('Já existe outra versão do treino seguinte. Resolve o conflito antes de aprovar.');
            result={source_id:source.id,target_id:existing.id,already_approved:true};target=null;
          }
        }else throw new Error('Operação de continuidade desconhecida.');
        result=result||{source_id:source.id,target_id:null,already_approved:false};
        const memId=ids.memory_ref,external='training-review-'+source.sync_id;
        const existingMemory=readings.memory_items.find(m=>(m.team_id||DEFAULT_TEAM_ID)===team&&(m.sync_id===memId||m.external_key===external));
        const removedMemory=readings.sync_tombstones.some(t=>t.store==='memory_items'&&(t.sync_id===memId||t.sync_id===existingMemory?.sync_id));
        if(!removedMemory){
          if(existingMemory&&existingMemory.metadata?.managed_by!=='training_review_v1')throw new Error('A memória de origem já existe noutro formato. Não foi substituída.');
          const memory=C.memory(next,ids),now=new Date().toISOString(),newMem={...(existingMemory||{}),...memory,created_at:existingMemory?.created_at||now,updated_at:now,team_id:team,sync_id:existingMemory?.sync_id||memId,subject_refs:[{type:'training',id:String(source.id),relation:'review_of'}]};
          if(existingMemory||next.review?.status==='done')tx.objectStore('memory_items').put(_prepareSyncRecord('memory_items',newMem));
          next.continuity={...C.state(next),memory_ref:existingMemory?.sync_id||memId};result.memory_linked=next.review?.status==='done';
        }else result.memory_linked=false;
        tx.objectStore('treinos').put(_prepareSyncRecord('treinos',next));
        if(target){const req=tx.objectStore('treinos').add(_prepareSyncRecord('treinos',target));req.onsuccess=()=>{result.target_id=req.result;};}
      }catch(error){failure=error;tx.abort();}}
    });
  }
  root.TrainingContinuityStore={commit};
})(globalThis);
