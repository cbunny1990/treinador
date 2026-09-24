"use strict";
(function(root){
  const M=root.VisionTrainingSession;
  let state=null,clock=null,generation=0,saving=false;
  const e=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function device(){let id=localStorage.getItem('vision.training.device');if(!id){id=crypto.randomUUID();localStorage.setItem('vision.training.device',id);}return id;}
  const owns=s=>!s.controller_id||s.controller_id===device();
  function button(action,label,disabled=false,extra=''){return '<button class="btn '+(action==='finish'?'accent':'secondary')+'" type="button" data-session-action="'+action+'" '+(disabled?'disabled':'')+' '+extra+'>'+label+'</button>';}
  function notice(message){const out=document.querySelector('[data-session-feedback]');if(out){out.hidden=false;out.textContent=message;}}
  function tick(){
    if(!state||!document.querySelector('[data-training-session]'))return;
    const s=M.normalize(state.session),sum=M.summary(s),b=sum.blocks[s.active_index];
    const current=document.querySelector('[data-session-clock]'),total=document.querySelector('[data-session-total]');
    if(current)current.textContent=M.format(b?.actual_ms||0);document.querySelectorAll('[data-session-total]').forEach(x=>x.textContent=M.format(sum.actual_ms));
    const over=document.querySelector('[data-session-over]');if(over)over.hidden=!b||b.actual_ms<=b.planned_min*60000;
  }
  async function players(){
    const rows=await DB.porIndice('jogadores','team_id',DEFAULT_TEAM_ID);
    // IDs embedded in sessions must remain valid on other devices, including legacy players.
    for(let i=0;i<rows.length;i++)if(!rows[i].sync_id)rows[i]=await DB.modificar('jogadores',rows[i].id,p=>({...p,sync_id:p.sync_id||crypto.randomUUID()}));
    return rows;
  }
  function noteList(block){
    return (block.notes||[]).map(n=>'<div class="session-observation"><p>'+e(n.text)+'</p><small>'+e(n.actor||'Treinador')+'</small><div class="toolbar">'+button('edit-note','Editar',false,'data-block-key="'+e(block.key)+'" data-note-id="'+e(n.id)+'"')+button('delete-note','Apagar',false,'data-block-key="'+e(block.key)+'" data-note-id="'+e(n.id)+'"')+'</div></div>').join('');
  }
  function attendanceHTML(roster,s){
    const options=status=>Object.entries(M.attendance).map(([key,label])=>'<option value="'+key+'" '+(key===status?'selected':'')+'>'+label+'</option>').join('');
    const rows=roster.map(p=>'<label class="session-attendee"><span>'+e(p.name)+(p.number!=null?' <small>#'+e(p.number)+'</small>':'')+'</span><select data-session-presence="'+e(p.player_ref)+'" aria-label="Presença de '+e(p.name)+'">'+options(p.status)+'</select></label>').join('');
    return '<details class="panel session-attendance" '+(s.status==='not_started'?'open':'')+'><summary>Presenças · '+roster.filter(p=>['present','late'].includes(p.status)).length+'/'+roster.length+' presentes</summary><p class="hint">Disponibilidade no plantel não marca presença automaticamente. Cada alteração fica guardada nesta sessão.</p>'+(rows||'<p class="empty">Sem atletas no plantel.</p>')+'</details>';
  }
  async function view(id){
    const turn=++generation,raw=await DB.obter('treinos',id);
    if(!raw){state=null;return setView('Treino indisponível','<div class="notice">Este treino foi apagado ou não está neste dispositivo.</div>','Treino');}
    const rosterRows=await players(),all=await tuExercises();
    if(turn!==generation||!location.hash.startsWith('#/sessao/'))return;
    state=raw;const t=TrainingPlanner.normalizeTraining(raw),s=M.normalize(raw.session),sum=M.summary(s),roster=M.roster(rosterRows,s),mine=owns(s);
    const b=s.blocks[s.active_index],exercise=b?tuExerciseByRef(all,b.exercise_ref):null;
    const statusText=!navigator.onLine?'Guardado neste dispositivo · envio pendente até regressar a Internet':raw.sync_dirty?'Guardado neste dispositivo · sincronização pendente':'Sem alterações locais pendentes';
    let html='<div data-training-session="'+id+'"><section class="panel hero-main"><div class="kicker">'+fmtDate(t.data)+' · '+e(t.hora||'')+'</div><h2>Treino em campo</h2><p class="lead">'+e(t.objetivo)+'</p><div class="toolbar section"><span class="badge '+(s.status==='running'?'ready':'')+'">'+M.states[s.status]+'</span><a class="btn secondary" href="#/consulta/'+id+'">Consultar exercícios</a><a class="btn secondary" href="#/treinos/'+id+'">Ficha do treino</a></div><p class="hint" data-session-sync>'+statusText+'</p><p class="notice" data-session-feedback role="status" hidden></p><div class="notice" data-session-remote hidden>Existem alterações recebidas. Guarda ou copia as notas antes de atualizar. '+button('refresh','Atualizar sessão')+'</div></section>';
    html+=attendanceHTML(roster,s);
    if(s.status==='not_started'){
      html+='<section class="panel hero-main section"><h3>Pronto para começar</h3><p class="lead">'+t.blocos.length+' exercícios · '+t.duracao_min+' min previstos. Iniciar não altera o planeamento.</p>'+button('start','Iniciar treino',!t.blocos.length)+'</section>';
    }else if(s.status!=='completed'){
      html+='<section class="panel hero-main section session-active"><div class="kicker">Exercício '+(s.active_index+1)+' de '+s.blocks.length+'</div><h2>'+e(b?.exercise_name)+'</h2><div class="session-clock" data-session-clock aria-label="Tempo do exercício">'+M.format(b?.elapsed_ms)+'</div><p>'+e(b?.planned_min)+' min previstos · total ativo <strong data-session-total>'+M.format(sum.actual_ms)+'</strong></p><p class="notice" data-session-over hidden>Tempo previsto ultrapassado. Decide quando passar ao exercício seguinte.</p><div class="toolbar section">';
      html+=s.status==='running'?button('pause','Pausar',!mine):button('resume','Retomar',!mine);
      html+=button('next','Exercício seguinte',!mine||s.active_index>=s.blocks.length-1)+button('finish','Terminar treino',!mine);
      if(!mine&&s.status==='paused')html+=button('take_control','Assumir controlo neste dispositivo');
      html+='</div><p class="hint">'+(!mine?'O cronómetro pertence a outro dispositivo. ':'')+'O tempo continua a contar com o ecrã bloqueado; usa Pausar para descontar intervalos. Não há alarme garantido em segundo plano.</p>';
      if(exercise){html+=tuExerciseVisualHTML(exercise,false);html+='<p class="lead">'+e(exercise.objetivo)+'</p><div class="session-instructions"><h3>Montagem</h3><p>'+e(exercise.organizacao||'—')+'</p><h3>Passo a passo</h3><ol>'+(exercise.passos||exercise.regras||[]).map(x=>'<li>'+e(x)+'</li>').join('')+'</ol></div>';}
      else html+='<p class="notice">A ficha do exercício não está disponível; o seu nome, tempo e observações continuam preservados na sessão.</p>';
      html+='</section>';
    }
    if(s.blocks.length){
      html+='<section class="panel hero-main section"><h3>Observação por exercício</h3><form data-session-note-form data-note-id=""><label class="field"><span>Exercício</span><select name="block_key">'+s.blocks.map((x,i)=>'<option value="'+e(x.key)+'" '+(i===s.active_index?'selected':'')+'>'+(i+1)+'. '+e(x.exercise_name)+'</option>').join('')+'</select></label><label class="field"><span>O que observaste?</span><textarea name="text" maxlength="3000" placeholder="Ex.: depois de passar, voltou a dar apoio."></textarea></label><div class="toolbar"><button class="btn accent" type="submit">Guardar observação</button>'+button('cancel-note','Cancelar edição')+'</div></form></section>';
      html+='<section class="panel hero-main section"><h3>'+(s.status==='completed'?'Resumo do treino realizado':'Registo da sessão')+'</h3><p class="lead">Tempo ativo: <strong data-session-total>'+M.format(sum.actual_ms)+'</strong> · Planeado: '+sum.planned_min+' min · '+sum.participants+' presentes/atrasados · '+sum.counts.unknown+' por marcar.</p><div class="session-summary">'+sum.blocks.map((x,i)=>'<article><h4>'+(i+1)+'. '+e(x.exercise_name)+'</h4><p>'+x.planned_min+' min previstos · '+M.format(x.actual_ms)+' realizados · '+(x.done?'Concluído':i===s.active_index&&s.status!=='completed'?'Atual':'Não concluído')+'</p>'+noteList(x)+'</article>').join('')+'</div>';
      if(s.status==='completed')html+='<a class="btn accent section" href="#/treinos/'+id+'">Preencher avaliação final</a>';
      html+='<div class="toolbar section">'+button('reset','Apagar registo da sessão',s.status==='running')+'</div><p class="hint">Apaga presenças, tempos e observações desta sessão. O plano e os exercícios não são apagados.</p></section>';
    }
    html+='</div>';const scroll=window.scrollY;setView('Treino em campo',html,'Treino');window.scrollTo(0,scroll);
    clearInterval(clock);tick();clock=setInterval(tick,500);
  }
  async function mutate(command){
    if(saving||!state)return;saving=true;
    const id=state.id,expected_revision=M.normalize(state.session).revision;
    try{
      const updated=await DB.modificar('treinos',id,row=>M.apply(row,{...command,expected_revision},{controller_id:device()}));
      state=updated;
      // The data commit is authoritative even if ancillary activity recording fails.
      try{await logHuman('training_session_'+command.type,'Atualizou sessão de treino · '+fmtDate(updated.data),'training',updated.sync_id||id);}catch(_){}
      await view(id);
    }catch(error){notice(error.message);document.querySelector('[data-session-remote]')?.removeAttribute('hidden');}
    finally{saving=false;}
  }
  async function duplicateView(id){
    const raw=await DB.obter('treinos',id);if(!raw)return go('#/treinos');
    const identity=crypto.randomUUID();
    const html='<section class="panel hero-main"><h2>Duplicar treino</h2><p class="lead">Copia objetivo, exercícios, ordem, tempos previstos e notas. Não copia presenças, cronómetro ou avaliação.</p><form data-session-duplicate data-source-id="'+id+'" data-identity="'+identity+'"><div class="form-grid"><label class="field"><span>Data da nova sessão</span><input name="date" type="date" required value="'+today()+'"></label><label class="field"><span>Hora</span><input name="time" type="time" value="'+e(raw.hora||'')+'"></label></div><div class="toolbar section"><button class="btn accent" type="submit">Criar cópia</button><a class="btn secondary" href="#/treinos/'+id+'">Cancelar</a></div><p data-copy-feedback role="alert"></p></form></section>';
    setView('Duplicar treino',html,'Treino');
  }
  async function history(player){
    if(!player.sync_id)return '';
    const records=[];
    await DB.percorrerIndice('treinos','team_id',DEFAULT_TEAM_ID,t=>{const a=t.session?.attendance?.find(a=>a.player_ref===player.sync_id);if(a&&a.status!=='unknown')records.push({t:{id:t.id,data:t.data},a});});
    records.sort((a,b)=>String(b.t.data).localeCompare(String(a.t.data)));
    if(!records.length)return '<section class="section"><h2>Presenças em treinos</h2><p class="empty">Ainda sem presenças registadas.</p></section>';
    return '<section class="section"><h2>Presenças em treinos</h2><p class="meta">'+records.filter(x=>['present','late'].includes(x.a.status)).length+' presenças/atrasos em '+records.length+' sessões com registo.</p><div class="list">'+records.map(({t,a})=>'<a class="list-item row" href="#/sessao/'+t.id+'"><span class="grow">'+fmtDate(t.data)+'</span><span class="badge">'+e(M.attendance[a.status])+'</span></a>').join('')+'</div></section>';
  }
  document.addEventListener('input',event=>{const form=event.target.closest('[data-session-note-form]');if(form)form.dataset.dirty='true';});
  document.addEventListener('change',async event=>{
    const select=event.target.closest('[data-session-presence]');if(!select||!state)return;
    if(document.querySelector('[data-session-note-form][data-dirty="true"]')){notice('Guarda a observação antes de alterar as presenças.');const old=M.normalize(state.session).attendance.find(x=>x.player_ref===select.dataset.sessionPresence);select.value=old?.status||'unknown';return;}
    const roster=M.roster(await players(),state.session),entry=roster.find(p=>p.player_ref===select.dataset.sessionPresence);
    if(entry){select.disabled=true;await mutate({type:'attendance',entries:roster.map(p=>p.player_ref===entry.player_ref?{...p,status:select.value}:p)});select.disabled=false;}
  });
  document.addEventListener('submit',async event=>{
    const note=event.target.closest('[data-session-note-form]'),duplicate=event.target.closest('[data-session-duplicate]');
    if(!note&&!duplicate)return;event.preventDefault();
    if(note){const fd=new FormData(note);return mutate({type:'note',block_key:fd.get('block_key'),text:fd.get('text'),note_id:note.dataset.noteId||crypto.randomUUID()});}
    const button=duplicate.querySelector('[type="submit"]');if(button.disabled)return;button.disabled=true;
    try{
      const raw=await DB.obter('treinos',duplicate.dataset.sourceId);if(!raw)throw new Error('O treino de origem foi apagado.');
      const fd=new FormData(duplicate),copy=M.duplicate(raw,{date:fd.get('date'),time:fd.get('time'),identity:duplicate.dataset.identity});
      const prior=(await DB.porIndice('treinos','team_id',DEFAULT_TEAM_ID)).find(t=>t.external_key===copy.external_key);
      const id=prior?.id||await DB.criar('treinos',copy);await logHuman('duplicated_training','Duplicou treino · '+fmtDate(raw.data),'training',id);go('#/treinos/'+id+'/editar');
    }catch(error){duplicate.querySelector('[data-copy-feedback]').textContent=error.message;button.disabled=false;}
  });
  document.addEventListener('click',async event=>{
    const target=event.target.closest('[data-session-action]');if(!target||!state)return;event.preventDefault();
    const type=target.dataset.sessionAction,form=document.querySelector('[data-session-note-form]');
    if(type==='cancel-note'){if(form){form.reset();form.dataset.noteId='';delete form.dataset.dirty;}return;}
    if(type==='edit-note'){
      const block=M.normalize(state.session).blocks.find(x=>x.key===target.dataset.blockKey),note=block?.notes?.find(n=>n.id===target.dataset.noteId);
      if(form&&note){if(form.dataset.dirty&&!confirm('Substituir a observação ainda não guardada?'))return;form.elements.block_key.value=block.key;form.elements.text.value=note.text;form.dataset.noteId=note.id;form.dataset.dirty='true';form.scrollIntoView({block:'center'});form.elements.text.focus();}return;
    }
    if(form?.dataset.dirty==='true'&&!confirm('A observação ainda não foi guardada. Continuar sem a guardar?'))return;
    if(type==='refresh')return view(state.id);
    const messages={finish:'Terminar o treino? Os exercícios ainda não realizados ficam identificados no resumo.',reset:'Apagar presenças, tempos e observações desta sessão? O plano mantém-se.',take_control:'Assumir o controlo deste treino em pausa neste dispositivo?', 'delete-note':'Apagar esta observação?'};
    if(messages[type]&&!confirm(messages[type]))return;
    const cmd=type==='delete-note'?{type:'remove_note',block_key:target.dataset.blockKey,note_id:target.dataset.noteId,confirmed:true}:{type,confirmed:!!messages[type]};
    if(type==='start')cmd.players=await players();
    target.disabled=true;try{await mutate(cmd);}finally{target.disabled=false;}
  });
  window.addEventListener('hashchange',()=>{if(!location.hash.startsWith('#/sessao/')){generation++;state=null;clearInterval(clock);}});
  window.addEventListener('visioncoach:sync-complete',event=>{
    if(!state||saving||!location.hash.startsWith('#/sessao/'))return;
    if((event.detail?.conflicts||[]).some(c=>c.store==='treinos'&&(c.sync_id===state.sync_id||String(c.local_id)===String(state.id)))){notice('Conflito de sincronização: existe outra versão deste treino. Os dados locais foram preservados; revê o conflito nas Definições antes de continuar noutro dispositivo.');return;}
    if(document.querySelector('[data-session-note-form][data-dirty="true"]')||document.querySelector('#exercise-image-viewer[open]')){document.querySelector('[data-session-remote]')?.removeAttribute('hidden');return;}
    void view(state.id);
  });
  root.TrainingSessionUI={view,duplicateView,history};
})(globalThis);
