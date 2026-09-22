"use strict";
// Shared evidence-first model. Offline drafts are explicit templates, not an AI verdict.
(function(root){
  const SCHEMA='vision-training-continuity@1';
  const FIELDS={melhorou:'O que melhorou',continua:'O que continua por corrigir',conclusao:'Conclusão',proxima_acao:'Próxima ação'};
  const OUTCOMES={pending:'Por avaliar',improved:'Melhorou',continues:'Continua por corrigir',inconclusive:'Sem conclusão'};
  const clone=x=>JSON.parse(JSON.stringify(x));
  const txt=(x,max=5000)=>String(x??'').trim().slice(0,max);
  const stamp=n=>new Date(n??Date.now()).toISOString();
  const uuid=x=>/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(x||''));
  function state(row){const s=row?.continuity||{};if(s.schema&&s.schema!==SCHEMA)throw new Error('Atualiza a app para ler esta proposta.');return {schema:SCHEMA,revision:0,proposal:null,...clone(s)};}
  function reviewKey(review){return JSON.stringify({status:review?.status||'pending',...Object.fromEntries(Object.keys(FIELDS).map(k=>[k,txt(review?.[k])])),focus_outcome:review?.focus_outcome||'pending'});}
  function sourceData(row){return {source_ref:row.sync_id,date:row.data||null,objective:txt(row.objetivo),review:JSON.parse(reviewKey(row.review)),notes:(row.session?.blocks||[]).flatMap(b=>(b.notes||[]).map(n=>({id:n.id,block_key:b.key,exercise:b.exercise_name||'',text:txt(n.text)}))).sort((a,b)=>String(a.id).localeCompare(String(b.id)))};}
  const sourceKey=row=>JSON.stringify(sourceData(row));
  async function digest(value,algorithm='SHA-256'){return new Uint8Array(await crypto.subtle.digest(algorithm,new TextEncoder().encode(value)));}
  async function stableId(value){
    // UUID v5, fixed namespace; identifiers only, not a cryptographic security primitive.
    const ns=Uint8Array.from('918501f8c0d54a799513a9b7ce8d28b0'.match(/../g),s=>parseInt(s,16));
    const bytes=new TextEncoder().encode(value),input=new Uint8Array(16+bytes.length);input.set(ns);input.set(bytes,16);
    const out=new Uint8Array(await crypto.subtle.digest('SHA-1',input)).slice(0,16);out[6]=(out[6]&15)|80;out[8]=(out[8]&63)|128;
    const h=[...out].map(x=>x.toString(16).padStart(2,'0')).join('');return h.slice(0,8)+'-'+h.slice(8,12)+'-'+h.slice(12,16)+'-'+h.slice(16,20)+'-'+h.slice(20);
  }
  async function identities(row){
    if(!uuid(row.sync_id))throw new Error('Treino sem identificador partilhado.');
    const key=sourceKey(row),fingerprint=[...await digest(key)].map(x=>x.toString(16).padStart(2,'0')).join('');
    return {source_key:key,fingerprint,memory_ref:await stableId('vision-review:'+row.sync_id),proposal_id:await stableId('vision-proposal:'+row.sync_id+':'+fingerprint),target_ref:await stableId('vision-followup:'+row.sync_id)};
  }
  function evidence(row){
    const review=row.review||{},list=[];
    if(review.status==='done')for(const [field,label] of Object.entries(FIELDS))if(txt(review[field]))list.push({source_type:'training',source_ref:row.sync_id,date:row.data||null,field:'review.'+field,label,quote:txt(review[field])});
    for(const b of row.session?.blocks||[])for(const n of b.notes||[])if(txt(n.text))list.push({source_type:'training',source_ref:row.sync_id,date:row.data||null,field:'session.note:'+n.id,label:'Observação · '+txt(b.exercise_name,200),quote:txt(n.text)});
    return list;
  }
  function saveReview(row,input,{expected_review_key,actor='Treinador',now}={}){
    if(reviewKey(row.review)!==expected_review_key)throw new Error('A avaliação mudou. Atualiza antes de guardar; o texto foi preservado.');
    const r={status:'done',...Object.fromEntries(Object.keys(FIELDS).map(k=>[k,txt(input[k])||null])),focus_outcome:input.focus_outcome||'pending'};
    if(!Object.keys(FIELDS).some(k=>r[k]))throw new Error('Escreve pelo menos uma observação na avaliação.');
    if(!Object.hasOwn(OUTCOMES,r.focus_outcome))throw new Error('Resultado do foco inválido.');
    const next=clone(row);next.review={...r,revision:(row.review?.revision||0)+1,updated_at:stamp(now),actor};
    next.continuity={...state(row),revision:state(row).revision+1};return next;
  }
  function clearReview(row,{expected_review_key,confirmed,now}={}){
    if(!confirmed)throw new Error('Confirma a remoção da avaliação.');
    if(reviewKey(row.review)!==expected_review_key)throw new Error('A avaliação mudou. Atualiza antes de apagar.');
    return {...clone(row),review:{status:'pending',revision:(row.review?.revision||0)+1,focus_outcome:'pending',updated_at:stamp(now)},continuity:{...state(row),revision:state(row).revision+1}};
  }
  function memory(row,ids,{actor='Treinador',now}={}){
    const review=row.review||{},active=review.status==='done'&&Object.keys(FIELDS).some(k=>txt(review[k]));
    return {kind:'observation',title:'Avaliação do treino · '+(row.data||''),content:Object.entries(FIELDS).filter(([k])=>txt(review[k])).map(([k,label])=>label+': '+txt(review[k])).join('\n')||'Avaliação removida pelo treinador.',occurred_at:row.data||stamp(now).slice(0,10),source:{type:'training',label:'Avaliação do treinador',ref_type:'training',ref_id:row.sync_id},subject_refs:[{type:'training',id:row.sync_id,relation:'review_of'}],evidence_ids:[],related_ids:[],status:active?'active':'archived',external_key:'training-review-'+row.sync_id,metadata:{managed_by:'training_review_v1',source_training_ref:row.sync_id,source_fingerprint:ids.fingerprint,actor:actor==='Head Coach'?'agent':'human',actor_label:actor,focus_outcome:review.focus_outcome||'pending',source_review:JSON.parse(reviewKey(review))}};
  }
  const ref=x=>String(x.sync_id||x.id||'');
  const available=xs=>(xs||[]).filter(x=>x.workspace_v2&&x.status!=='archived'&&x.status!=='deleted'&&!x.deleted_at);
  function exerciseSignature(x){return JSON.stringify([x.nome,x.objetivo,x.organizacao,x.passos,x.regras,x.duracao_total_min,x.status]);}
  function blocks(values,exercises,{strict=false}={}){
    if(!Array.isArray(values)||values.length>30)throw new Error('Seleciona até 30 exercícios.');
    const pool=available(exercises);return values.map((b,i)=>{
      const ex=pool.find(x=>ref(x)===String(b.exercise_ref)||String(x.id)===String(b.exercise_ref));if(!ex)throw new Error('Um exercício foi apagado ou está indisponível. Revê a proposta.');
      const duration=Number(b.duration_min);if(!Number.isFinite(duration)||duration<=0||duration>240)throw new Error('Define uma duração válida para cada exercício.');
      if(!['ativacao','principal','jogo','retorno'].includes(b.phase))throw new Error('Fase de exercício inválida.');
      const signature=exerciseSignature(ex);if(strict&&b.exercise_signature!==signature)throw new Error('A ficha de um exercício mudou. Guarda novamente a proposta antes de aprovar.');
      return {order:i,exercise_ref:ref(ex),exercise_name:ex.nome,phase:b.phase,duration_min:duration,notes:txt(b.notes)||null,exercise_signature:signature};
    });
  }
  function prepare(row,exercises,ids,{actor='Regra de continuidade',now}={}){
    if(state(row).proposal?.status==='approved')throw new Error('Já existe um treino de continuidade aprovado. Continua a partir desse treino.');
    if(row.review?.status!=='done')throw new Error('Guarda primeiro a avaliação pós-treino.');
    const focus=txt(row.review.proxima_acao)||txt(row.review.continua);if(!focus)throw new Error('Indica o que continua por corrigir ou a próxima ação. Não vou inventar um problema.');
    const pool=available(exercises);
    const previous=(row.blocos||[]).filter(b=>pool.some(x=>ref(x)===String(b.exercise_ref)||String(x.id)===String(b.exercise_ref)));
    const selected=blocks(previous,exercises);
    const proposal={id:ids.proposal_id,status:'draft',target_ref:ids.target_ref,source_fingerprint:ids.fingerprint,source_key:ids.source_key,source_ref:row.sync_id,evidence:evidence(row),objective:focus,rationale:'Continuidade proposta a partir da avaliação registada. Os exercícios são retomados do plano anterior; revê a adequação e os tempos antes de aprovar.',success_criterion:'',date:'',time:row.hora||'',blocks:selected,author:actor,method:'review_template',created_at:stamp(now),updated_at:stamp(now)};
    return {...clone(row),continuity:{...state(row),revision:state(row).revision+1,memory_ref:ids.memory_ref,proposal}};
  }
  function check(row,{expected_revision,source_key}={}){
    if(state(row).revision!==expected_revision)throw new Error('A proposta mudou noutro local. Atualiza antes de guardar.');
    if(source_key!==undefined&&sourceKey(row)!==source_key)throw new Error('A avaliação ou as observações mudaram. Gera uma proposta atualizada.');
  }
  function update(row,changes,exercises,options={}){
    check(row,options);const s=state(row),p=s.proposal;
    if(!p||p.status!=='draft')throw new Error('Não existe uma proposta editável.');
    if(p.source_key!==sourceKey(row))throw new Error('A origem mudou. Gera uma nova proposta antes de a aprovar.');
    const next={...p,objective:txt(changes.objective),rationale:txt(changes.rationale),success_criterion:txt(changes.success_criterion),date:txt(changes.date,10),time:txt(changes.time,5),blocks:blocks(changes.blocks,exercises),edited_by:options.actor||'Treinador',updated_at:stamp(options.now)};
    return {...clone(row),continuity:{...s,revision:s.revision+1,proposal:next}};
  }
  function dismiss(row,{expected_revision,confirmed,actor='Treinador',now}={}){
    check(row,{expected_revision});if(!confirmed)throw new Error('Confirma a remoção da proposta.');
    const s=state(row);if(!s.proposal||s.proposal.status==='approved')throw new Error('Uma aprovação existente não pode ser apagada como rascunho.');
    return {...clone(row),continuity:{...s,revision:s.revision+1,proposal:{...s.proposal,status:'dismissed',dismissed_at:stamp(now),dismissed_by:actor}}};
  }
  function validDate(date){return /^\d{4}-\d{2}-\d{2}$/.test(date||'')&&Number.isFinite(Date.parse(date+'T12:00:00Z'))&&new Date(date+'T12:00:00Z').toISOString().slice(0,10)===date;}
  function approve(row,exercises,{expected_revision,confirmed,actor='Treinador',now}={}){
    if(!confirmed)throw new Error('A criação do treino exige a tua aprovação explícita.');check(row,{expected_revision});
    const s=state(row),p=s.proposal;if(!p||p.status!=='draft')throw new Error('A proposta já foi aprovada ou não está disponível.');
    if(p.source_key!==sourceKey(row))throw new Error('A avaliação mudou desde a proposta. Atualiza-a antes de aprovar.');
    if(!validDate(p.date)||p.date<=String(row.data||''))throw new Error('Escolhe uma data válida posterior ao treino de origem.');
    if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(p.time))throw new Error('Define uma hora válida.');
    if(!txt(p.objective)||!txt(p.rationale)||!txt(p.success_criterion))throw new Error('Define objetivo, justificação e como vais avaliar o foco.');
    if(!p.blocks.length)throw new Error('Seleciona pelo menos um exercício.');
    const planned=blocks(p.blocks,exercises,{strict:true}),total=planned.reduce((n,b)=>n+b.duration_min,0);if(total>240)throw new Error('A sessão não pode exceder 240 minutos.');
    const approved={...p,status:'approved',approved_at:stamp(now),approved_by:actor,updated_at:stamp(now)};
    const signature=JSON.stringify([p.id,p.objective,p.date,p.time,p.success_criterion,planned]);
    const next={team_id:row.team_id,sync_id:p.target_ref,external_key:'training-continuation-'+row.sync_id,data:p.date,hora:p.time,local:row.local||null,escalao:row.escalao||null,objetivo:p.objective,notas:'Foco: '+p.objective+'\nComo avaliar: '+p.success_criterion,source_training_ref:row.sync_id,source_match_ref:row.source_match_ref||null,status:'ready',duracao_min:total,blocos:planned.map(({exercise_signature,...b},i)=>({...b,block_id:p.id+'-'+i})),review:{status:'pending',focus_outcome:'pending'},continuity_origin:{source_ref:row.sync_id,proposal_id:p.id,source_fingerprint:p.source_fingerprint,evidence:clone(p.evidence),success_criterion:p.success_criterion,approval_signature:signature,approved_by:actor,approved_at:stamp(now)}};
    return {source:{...clone(row),continuity:{...s,revision:s.revision+1,proposal:approved}},target:next};
  }
  function progress(source,target){
    const p=state(source).proposal;if(!p)return {stage:'identified',label:'Avaliação registada'};
    if(p.status==='dismissed')return {stage:'dismissed',label:'Proposta retirada'};
    if(p.status!=='approved')return {stage:'proposed',label:p.source_key===sourceKey(source)?'Proposta por aprovar':'Proposta desatualizada'};
    if(!target)return {stage:'created',label:'Treino aprovado; não disponível neste dispositivo'};
    if(target.review?.status==='done')return {stage:'evaluated',label:'Avaliado',outcome:OUTCOMES[target.review.focus_outcome]||OUTCOMES.pending};
    if(target.session?.status==='completed')return {stage:'trained',label:'Realizado · falta avaliar'};
    return {stage:'created',label:'Treino criado'};
  }
  const api={schema:SCHEMA,fields:FIELDS,outcomes:OUTCOMES,state,reviewKey,sourceKey,sourceData,stableId,identities,evidence,saveReview,clearReview,memory,prepare,check,update,dismiss,approve,progress,blocks,available};
  root.VisionTrainingContinuity=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(globalThis);
