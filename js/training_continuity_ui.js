"use strict";
(function(root){
  const C=root.VisionTrainingContinuity,Store=root.TrainingContinuityStore;
  let current=null,busy=false,turn=0;
  const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const action=(key,label,extra='')=>'<button type="button" class="btn secondary" data-continuity-action="'+key+'" '+extra+'>'+label+'</button>';
  function error(message){const el=document.querySelector('[data-continuity-feedback]');if(el){el.textContent=message;el.hidden=false;}}
  async function summary(training){
    const rows=await DB.porIndice('treinos','team_id',DEFAULT_TEAM_ID),p=C.state(training).proposal;
    const target=p&&rows.find(t=>t.sync_id===p.target_ref),source=training.source_training_ref&&rows.find(t=>t.sync_id===training.source_training_ref);
    let html='';
    if(training.continuity_origin){html+='<section class="notice section"><strong>Foco retomado do treino anterior</strong><p>'+esc(training.objetivo)+'</p><p><strong>Como avaliar:</strong> '+esc(training.continuity_origin.success_criterion)+'</p>'+(source?'<a class="link" href="#/continuidade/'+source.id+'">Ver origem e evidências</a>':'<p>Treino de origem não disponível neste dispositivo; a proposta aprovada está preservada.</p>')+'</section>';}
    const progress=C.progress(training,target);
    html+='<section class="panel hero-main section"><h3>Continuidade do Head Coach</h3><p class="lead">'+(training.review?.status==='done'?esc(progress.label):'Preenche a avaliação para preparar a próxima sessão sem perder o contexto.')+'</p>'+(progress.outcome?'<p>Resultado assinalado pelo treinador: <strong>'+esc(progress.outcome)+'</strong></p>':'')+'<a class="btn accent section" href="#/continuidade/'+training.id+'">Avaliação → próximo treino</a></section>';
    return html;
  }
  function evidenceHTML(items){return '<div class="continuity-evidence">'+items.map(x=>'<article><strong>'+esc(x.date)+' · '+esc(x.label)+'</strong><blockquote>'+esc(x.quote)+'</blockquote></article>').join('')+'</div>';}
  function choices(exercises,p){
    const selected=new Map((p.blocks||[]).map(b=>[b.exercise_ref,b]));
    const order=new Map((p.blocks||[]).map((b,i)=>[b.exercise_ref,i]));
    return C.available(exercises).slice().sort((a,b)=>(order.get(a.sync_id)??999)-(order.get(b.sync_id)??999)).map(ex=>{
      const ref=String(ex.sync_id||''),b=selected.get(ref);if(!ref)return '';
      return '<article class="continuity-choice"><label class="row"><input type="checkbox" name="exercise_ref" value="'+esc(ref)+'" '+(b?'checked':'')+'><span>'+esc(ex.nome)+'</span></label><div class="form-grid"><label class="field"><span>Minutos</span><input type="number" min="1" max="240" name="duration__'+ref+'" value="'+esc(b?.duration_min||ex.duracao_total_min||10)+'"></label><label class="field"><span>Fase</span><select name="phase__'+ref+'">'+[['ativacao','Ativação'],['principal','Principal'],['jogo','Jogo'],['retorno','Retorno à calma']].map(([k,l])=>'<option value="'+k+'" '+((b?.phase||'principal')===k?'selected':'')+'>'+l+'</option>').join('')+'</select></label></div><label class="field"><span>Consigna / nota</span><input name="notes__'+ref+'" value="'+esc(b?.notes||'')+'"></label></article>';
    }).join('');
  }
  async function view(id){
    const token=++turn,training=await DB.obter('treinos',id);if(!training)return setView('Continuidade indisponível','<div class="notice">O treino não está disponível.</div>','Treino');
    const all=await tuExercises(),rows=await DB.porIndice('treinos','team_id',DEFAULT_TEAM_ID);if(token!==turn||!location.hash.startsWith('#/continuidade/'))return;
    const s=C.state(training),p=s.proposal,target=p&&rows.find(t=>t.sync_id===p.target_ref),progress=C.progress(training,target);current={id:training.id,revision:s.revision,review_key:C.reviewKey(training.review)};
    let html='<div data-training-continuity><section class="panel hero-main"><div class="kicker">Treino · '+fmtDate(training.data)+'</div><h2>Do que observámos ao próximo treino</h2><p class="lead">Uma proposta não é um treino aprovado. Revê o foco, os exercícios e o critério de avaliação antes de criar a sessão.</p><a class="link" href="#/treinos/'+id+'">Voltar ao treino e à avaliação</a><p class="notice" data-continuity-feedback role="alert" hidden></p><p class="hint">'+(!navigator.onLine?'Offline · alterações guardadas localmente e pendentes de envio.':training.sync_dirty?'Existem alterações locais pendentes de sincronização.':'Sem alterações locais pendentes.')+'</p></section>';
    html+='<section class="panel hero-main section"><h3>O que está registado</h3>'+(C.evidence(training).length?evidenceHTML(C.evidence(training)):'<p class="empty">Ainda não existe uma avaliação com conteúdo. Não será inventado um foco.</p>')+'</section>';
    if(!p||p.status==='dismissed'){
      html+='<section class="panel hero-main section"><h3>Preparar continuidade</h3><p class="lead">A proposta inicial retoma a próxima ação ou o que continua por corrigir e os exercícios da sessão anterior. É uma regra local de organização, não uma análise automática por IA.</p>'+action('propose',p?'Gerar novamente a proposta':'Gerar proposta de continuidade',training.review?.status!=='done'?'disabled':'')+'</section>';
    }else if(p.status==='approved'){
      html+='<section class="panel hero-main section"><h3>'+esc(progress.label)+'</h3><p>'+esc(p.objective)+'</p><p><strong>Como avaliar:</strong> '+esc(p.success_criterion)+'</p><p class="hint">Aprovação de '+esc(p.approved_by)+' · '+esc(p.date)+' '+esc(p.time)+'</p>'+(progress.outcome?'<p class="notice">Resultado indicado: '+esc(progress.outcome)+'</p>':'')+(target?'<a class="btn accent section" href="#/treinos/'+target.id+'">Abrir treino seguinte</a>':'<p class="notice">O treino aprovado não está neste dispositivo ou foi apagado. Não será recriado automaticamente.</p>')+(p.source_key!==C.sourceKey(training)?'<p class="notice">A avaliação original mudou depois da aprovação. O treino aprovado e as evidências da decisão mantêm-se preservados.</p>':'')+'<details class="section"><summary>Evidências usadas na aprovação</summary>'+evidenceHTML(p.evidence)+'</details></section>';
    }else{
      const stale=p.source_key!==C.sourceKey(training);
      html+='<section class="panel hero-main section"><div class="toolbar"><span class="badge draft">Por aprovar</span><span class="hint">Origem: '+esc(p.author)+' · '+(p.method==='agent_proposal'?'Proposta da IA autorizada':'Modelo de continuidade local')+'</span></div>';
      if(stale)html+='<p class="notice">A avaliação ou as notas mudaram. A proposta está desatualizada.</p>'+action('propose','Gerar proposta atualizada');
      html+='<form data-continuity-form class="form section"><label class="field"><span>Foco / objetivo</span><textarea name="objective" required maxlength="5000">'+esc(p.objective)+'</textarea></label><label class="field"><span>Porque trabalhar isto?</span><textarea name="rationale" required maxlength="5000">'+esc(p.rationale)+'</textarea></label><label class="field"><span>Como vais verificar a melhoria?</span><textarea name="success_criterion" maxlength="5000" placeholder="Define o comportamento a observar, sem inventar resultados.">'+esc(p.success_criterion)+'</textarea></label><div class="form-grid"><label class="field"><span>Data do próximo treino</span><input type="date" name="date" value="'+esc(p.date)+'"></label><label class="field"><span>Hora</span><input type="time" name="time" value="'+esc(p.time)+'"></label></div><h3>Exercícios existentes na biblioteca</h3><p class="hint">Não são criados outros exercícios nem imagens. Revê a seleção e os tempos.</p><div class="continuity-blocks">'+choices(all,p)+'</div><div class="toolbar"><button class="btn secondary" type="submit" '+(stale?'disabled':'')+'>Guardar ajustes da proposta</button>'+action('approve','Aprovar e criar treino',stale?'disabled':'')+action('dismiss','Apagar proposta')+'</div><p class="hint">Guarda os ajustes antes de aprovar. A aprovação pede confirmação.</p></form><details class="section"><summary>Evidências da proposta</summary>'+evidenceHTML(p.evidence)+'</details></section>';
    }
    html+='</div>';setView('Continuidade do treino',html,'Head Coach');
  }
  async function run(operation,args={}){
    if(!current||busy)return;busy=true;const id=current.id;
    document.querySelectorAll('[data-continuity-action], [data-continuity-form] [type="submit"]').forEach(b=>b.disabled=true);
    try{const result=await Store.commit(id,operation,{expected_revision:current.revision,...args});try{await logHuman('training_continuity_'+operation,'Atualizou continuidade de treino','training',id);}catch(_){};await view(id);if(operation==='save_proposal')error('Proposta guardada. Podes agora aprovar.');return result;}
    catch(err){error(err.message);document.querySelectorAll('[data-continuity-action], [data-continuity-form] [type="submit"]').forEach(b=>b.disabled=false);}finally{busy=false;}
  }
  document.addEventListener('input',event=>{const form=event.target.closest('[data-continuity-form]');if(form)form.dataset.dirty='true';});
  document.addEventListener('change',event=>{const form=event.target.closest('[data-continuity-form]');if(form)form.dataset.dirty='true';});
  document.addEventListener('submit',async event=>{
    const form=event.target.closest('[data-continuity-form]');if(!form)return;event.preventDefault();
    const fd=new FormData(form),refs=fd.getAll('exercise_ref').map(String);
    await run('save_proposal',{changes:{objective:fd.get('objective'),rationale:fd.get('rationale'),success_criterion:fd.get('success_criterion'),date:fd.get('date'),time:fd.get('time'),blocks:refs.map(ref=>({exercise_ref:ref,phase:fd.get('phase__'+ref),duration_min:Number(fd.get('duration__'+ref)),notes:fd.get('notes__'+ref)}))}});
  });
  document.addEventListener('click',async event=>{
    const el=event.target.closest('[data-continuity-action]');if(!el)return;event.preventDefault();if(busy)return;
    const op=el.dataset.continuityAction,dirty=document.querySelector('[data-continuity-form][data-dirty="true"]');
    if(dirty&&op==='approve'){error('Guarda primeiro os ajustes da proposta antes de aprovar.');return;}
    if(dirty&&op!=='approve'&&!confirm('Substituir os ajustes ainda não guardados?'))return;
    if(op==='approve'&&!confirm('Aprovar esta proposta e criar o treino na data indicada?'))return;
    if(op==='dismiss'&&!confirm('Apagar a proposta? A avaliação e os exercícios ficam preservados.'))return;
    el.disabled=true;try{await run(op,{confirmed:op==='approve'||op==='dismiss'});}finally{el.disabled=false;}
  });
  window.addEventListener('visioncoach:sync-complete',()=>{if(current&&!busy&&location.hash.startsWith('#/continuidade/'))error('Existem dados recebidos. Os ajustes não guardados foram preservados; volta a abrir esta área antes de aprovar.');});
  window.addEventListener('hashchange',()=>{if(!location.hash.startsWith('#/continuidade/')){current=null;turn++;}});
  root.TrainingContinuityUI={view,summary};
})(globalThis);
