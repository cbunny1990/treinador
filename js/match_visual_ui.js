"use strict";
(function(root){
 const M=root.VisionMatchVisual;
 let current=null,roster=[],turn=0,busy=false,timer=null,selectedRole='';
 const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const route=id=>'#/jogo-visual/'+id;
 function device(){let id=localStorage.getItem('vision.match.controller');if(!id){id=crypto.randomUUID();localStorage.setItem('vision.match.controller',id);}return id;}
 const mine=s=>!s.controller_id||s.controller_id===device();
 function feedback(text){const p=document.querySelector('[data-match-feedback]');if(p){p.hidden=false;p.textContent=text;}}
 function button(action,label,disabled=false,extra='',accent=false){return '<button type="button" class="btn '+(accent?'accent':'secondary')+'" data-match-action="'+action+'" '+(disabled?'disabled ':'')+extra+'>'+label+'</button>';}
 async function teamPlayers(){const all=await DB.porIndice('jogadores','team_id',DEFAULT_TEAM_ID);for(let i=0;i<all.length;i++)if(!all[i].sync_id)all[i]=await DB.modificar('jogadores',all[i].id,p=>({...p,sync_id:p.sync_id||crypto.randomUUID()}));return all;}
 const dirty=()=>!!document.querySelector('[data-match-visual] form[data-dirty="true"]');
 function label(ref,s){return s.roster.find(p=>p.ref===ref)?.name||roster.find(p=>p.sync_id===ref)?.nome||'Atleta não disponível';}
 function options(list,selected='',blank=true){return (blank?'<option value="">Escolher atleta</option>':'')+list.map(p=>'<option value="'+esc(p.ref||p.sync_id)+'" '+((p.ref||p.sync_id)===selected?'selected':'')+'>'+esc(p.name||p.nome)+(p.number!=null?' · #'+esc(p.number):p.numero!=null?' · #'+esc(p.numero):'')+'</option>').join('');}
 function board(match,players){
  const s=M.state(match),v=M.replay(match),by=new Map(players.map(p=>[p.sync_id,p]));
  return '<div class="match-pitch" data-match-pitch aria-label="Campo tático 5v5"><div class="pitch-half"></div><div class="pitch-centre"></div><div class="pitch-box pitch-box-top"></div><div class="pitch-box pitch-box-bottom"></div><span class="pitch-direction">ATACAR ↑</span>'+Object.entries(M.roles).map(([role,title])=>{
   const ref=v.slots[role],historic=s.roster.find(p=>p.ref===ref),p=by.get(ref)||{nome:historic?.name||title,numero:historic?.number},pos=s.layout[role],name=ref?(historic?.name||p.nome):'Escolher';
   return '<button type="button" class="pitch-player '+(role==='gr'?'keeper ':'')+(selectedRole===role?'selected':'')+'" data-pitch-role="'+role+'" style="left:'+(Math.max(.16,Math.min(.84,pos.x))*100)+'%;top:'+(Math.max(.12,Math.min(.88,pos.y))*100)+'%" aria-label="'+esc(title+': '+name)+'" aria-pressed="'+(selectedRole===role)+'">'+avatarHTML(p,40)+'<span class="pitch-player-name">'+esc(name)+'</span><small>'+esc(title)+'</small></button>';
  }).join('')+'</div>';
 }
 function tick(){
  if(!current||!document.querySelector('[data-match-visual]'))return;
  try{const v=M.replay(current);document.querySelectorAll('[data-match-clock]').forEach(x=>x.textContent=M.format(v.total_ms));
   for(const p of v.players){document.querySelector('[data-player-minutes="'+p.ref+'"]')?.replaceChildren(document.createTextNode(M.format(p.elapsed_ms)));document.querySelector('[data-player-keeper="'+p.ref+'"]')?.replaceChildren(document.createTextNode(M.format(p.keeper_ms)));}
   for(const r of v.rotations){const node=document.querySelector('[data-rotation-due="'+r.id+'"]');if(node)node.hidden=!r.due||r.applied||v.status==='not_started'||v.status==='completed';}
  }catch(error){feedback(error.message);}
 }
 function timeline(s){
  const evs=s.events.filter(ev=>!ev.voided_at);return evs.length?'<div class="list">'+evs.map(ev=>'<div class="list-item"><strong>'+M.format(ev.at_ms)+'</strong> · '+(ev.type==='substitute'?'Sai '+esc(label(ev.out_ref,s))+' → entra '+esc(label(ev.in_ref,s)):'Troca de posições: '+esc(M.roles[ev.role_a])+' ↔ '+esc(M.roles[ev.role_b]))+(ev.rotation_id?' <span class="badge">Rotação realizada</span>':'')+'</div>').join('')+'</div>':'<p class="empty">Ainda sem substituições ou trocas de posição registadas.</p>';
 }
 async function view(id){
  const epoch=++turn,raw=await DB.obter('jogos',id);if(!raw){if(location.hash===route(id))setView('Jogo indisponível','<p class="notice">Este jogo foi apagado ou não está disponível neste dispositivo.</p>','Jogo');return;}
  const players=await teamPlayers(),photos=await applyPlayerProfilePhotos(players);
  if(epoch!==turn||location.hash!==route(id))return;
  current=raw;roster=players;const s=M.state(raw),v=M.replay(raw),eligible=M.pool(raw,players).filter(M.available),known=s.started_at?s.roster:eligible,owns=mine(s),active=['running','paused'].includes(s.status);
  const slots=s.started_at?v.slots:M.initialSlots(raw),chosen=new Set(Object.values(slots)),bench=s.started_at?v.bench:eligible.filter(p=>!chosen.has(p.sync_id));
  let html='<div data-match-visual="'+id+'"><section class="panel hero-main"><div class="kicker">'+fmtDate(raw.data)+' · '+esc(raw.hora||'')+'</div><h2>Jogo visual · '+esc(raw.adversario||'Adversário')+'</h2><p class="lead">Campo 5v5, rotações e minutos de utilização.</p><div class="toolbar section"><span class="badge">'+M.states[s.status]+'</span><a class="btn secondary" href="#/equipa/jogo/'+id+'">Ficha / convocatória / análise</a></div><p class="hint">'+(!navigator.onLine?'Guardado neste dispositivo · envio pendente quando regressar a Internet':raw.sync_dirty?'Guardado neste dispositivo · sincronização pendente':'Sem alterações locais pendentes')+'</p><p class="notice" data-match-feedback role="status" hidden></p><div class="notice" data-match-remote hidden>Foram recebidas alterações. Os teus ajustes não foram substituídos. '+button('refresh','Atualizar jogo')+'</div></section>';
  html+='<div class="match-visual-grid section"><section class="panel hero-main">'+board(raw,photos)+'<p class="hint">Seleciona uma posição e toca no campo para a mover. No PC também podes usar as setas do teclado. Isto altera o desenho, não os minutos nem quem está a jogar.</p><div class="toolbar">'+button('reset_layout','Repor posições no campo')+'</div></section><section class="panel hero-main">';
  if(!s.started_at){
   html+='<h3>Alinhamento inicial</h3><p class="hint">Escolhe entre os atletas convocados e disponíveis. Os restantes ficam como suplentes.</p><form data-match-form="lineup" class="form">'+Object.entries(M.roles).map(([role,title])=>'<label class="field"><span>'+title+'</span><select name="'+role+'">'+options(eligible,slots[role])+'</select></label>').join('')+'<div class="toolbar"><button class="btn accent" type="submit">Guardar alinhamento visual</button>'+button('clear_lineup','Apagar alinhamento')+button('cancel_form','Cancelar alterações')+'</div></form>';
   if(!eligible.length)html+='<p class="notice">Define primeiro a convocatória na ficha do jogo.</p>';
  }else{
   html+='<h3>Tempo de jogo registado</h3><div class="match-live-clock" data-match-clock>'+M.format(v.total_ms)+'</div><p class="hint">Minutos calculados pelo cronómetro e pelos movimentos que registares. Não são recuperados do vídeo.</p><div class="toolbar">';
   if(active)html+=(s.status==='running'?button('pause','Pausar / intervalo',!owns):button('resume','Retomar jogo',!owns))+button('finish','Terminar utilização',!owns,'',true);
   if(s.status==='paused'&&!owns)html+=button('take_control','Assumir controlo neste dispositivo');
   html+='</div><p class="hint">'+(!owns&&active?'O cronómetro pertence a outro dispositivo. ':'')+'Pausa no intervalo. A contagem retoma o tempo decorrido ao reabrir a app; não há alerta garantido em segundo plano.</p>';
   if(active){
    const onField=s.roster.filter(p=>chosen.has(p.ref)),canEnter=bench.filter(p=>M.available(players.find(x=>x.sync_id===p.ref)));
    html+='<form class="form section" data-match-form="substitution"><h3>Substituição agora</h3><label class="field"><span>Sai do campo</span><select name="out_ref">'+options(onField)+'</select></label><label class="field"><span>Entra no campo</span><select name="in_ref">'+options(canEnter)+'</select></label><div class="toolbar"><button class="btn accent" type="submit" '+(!owns?'disabled':'')+'>Registar substituição</button>'+button('cancel_form','Cancelar alterações')+'</div></form>';
    html+='<form class="form section" data-match-form="swap"><h3>Trocar funções em campo</h3><div class="form-grid">'+['role_a','role_b'].map((k,i)=>'<label class="field"><span>'+(i?'Segunda posição':'Primeira posição')+'</span><select name="'+k+'">'+Object.entries(M.roles).map(([role,title])=>'<option value="'+role+'" '+(role===(i?'def':'gr')?'selected':'')+'>'+title+'</option>').join('')+'</select></label>').join('')+'</div><div class="toolbar"><button class="btn secondary" type="submit" '+(!owns?'disabled':'')+'>Trocar posições agora</button>'+button('cancel_form','Cancelar alterações')+'</div></form>';
   }
  }
  html+='<h3 class="section">'+(s.started_at?'Banco atual':'Suplentes')+'</h3><div class="match-bench">'+(bench.length?bench.map(p=>'<span class="badge">'+esc(p.name||p.nome)+'</span>').join(''):'<span class="meta">Sem suplentes disponíveis neste alinhamento.</span>')+'</div>';
  if(!s.started_at)html+='<div class="section">'+button('start','Iniciar jogo e contar minutos',eligible.length<5||Object.values(slots).filter(Boolean).length!==5||['concluido','cancelado'].includes(raw.estado),'',true)+'</div>';
  html+='</section></div>';
  html+='<section class="panel hero-main section"><h3>Plano de rotações</h3><p class="hint">Planeia quem sai e quem entra. O minuto é uma intenção; só “Realizar agora” regista uma substituição no tempo atual.</p>';
  if(s.status!=='completed')html+='<form class="form section" data-match-form="rotation" data-rotation-id=""><div class="form-grid"><label class="field"><span>Sai na rotação</span><select name="out_ref">'+options(known)+'</select></label><label class="field"><span>Entra na rotação</span><select name="in_ref">'+options(known)+'</select></label></div><div class="form-grid"><label class="field"><span>Minuto previsto</span><input name="at_min" type="number" min="0" max="240" step="0.5" required value="5"></label><label class="field"><span>Nota da rotação</span><input name="note" maxlength="1000"></label></div><div class="toolbar"><button type="submit" class="btn accent">Guardar rotação</button>'+button('cancel_form','Cancelar alterações')+'</div></form>';
  html+='<div class="list section">'+v.rotations.slice().sort((a,b)=>a.at_min-b.at_min).map(r=>'<article class="list-item"><strong>'+esc(r.at_min)+' min · '+esc(label(r.out_ref,s))+' → '+esc(label(r.in_ref,s))+'</strong><p class="meta">'+esc(r.note||'')+'</p><p class="notice" data-rotation-due="'+esc(r.id)+'" hidden>Minuto previsto atingido. Confirma se queres realizar a troca.</p><div class="toolbar section">'+(r.applied?'<span class="badge ready">Realizada</span>':button('edit_rotation','Editar rotação',s.status==='completed','data-rotation-id="'+esc(r.id)+'"')+button('delete_rotation','Apagar rotação',false,'data-rotation-id="'+esc(r.id)+'"')+(active?button('apply_rotation','Realizar agora',!owns,'data-rotation-id="'+esc(r.id)+'"'):''))+'</div></article>').join('')+'</div></section>';
  if(s.started_at){
   html+='<section class="panel hero-main section"><h3>Minutos por atleta</h3><p class="hint">Tempo registado, incluindo o guarda-redes. Quem não entrou tem 00:00; pausas/intervalos não contam.</p><div class="table-wrap section"><table><thead><tr><th>Atleta</th><th>Em campo</th><th>Como GR</th><th>Agora</th></tr></thead><tbody>'+v.players.map(p=>'<tr><td>'+esc(p.name)+'</td><td data-player-minutes="'+p.ref+'">'+M.format(p.elapsed_ms)+'</td><td data-player-keeper="'+p.ref+'">'+M.format(p.keeper_ms)+'</td><td>'+((s.status==='completed')?'—':p.on_field?'Campo':'Banco')+'</td></tr>').join('')+'</tbody></table></div><h3 class="section">Entradas, saídas e trocas</h3>'+timeline(s)+'<div class="toolbar section">'+button('undo_last','Anular último movimento',s.status!=='paused'||!owns||!v.events.length)+button('reset_recording','Apagar registo de utilização',s.status==='running')+'</div><p class="hint">Anular corrige o último movimento desde o instante em que foi registado; não equivale a fazer uma substituição inversa agora. Apagar utilização mantém o jogo, plano, resultado e análise.</p></section>';
  }
  html+='</div>';const y=window.scrollY;setView('Jogo visual',html,'Jogo');window.scrollTo(0,y);clearInterval(timer);tick();timer=setInterval(tick,500);
 }
 async function commit(command){
  if(!current||busy)return;busy=true;const id=current.id,rev=M.state(current).revision,key=M.planKey(current);
  const controls=[...document.querySelectorAll('[data-match-visual] button')].map(b=>[b,b.disabled]);controls.forEach(([b])=>b.disabled=true);
  try{
   const players=await teamPlayers();
   const saved=await DB.modificar('jogos',id,row=>M.apply(row,{...command,expected_revision:rev,expected_plan_key:key},{controller_id:device(),players}));
   current=saved;try{await logHuman('match_visual_'+command.type,'Atualizou jogo visual · '+(saved.adversario||''),'match',saved.sync_id||id);}catch(_){}
   if(location.hash!==route(id))return;
   await view(id);feedback('Alteração guardada neste dispositivo.');
  }catch(error){feedback(error.message);document.querySelector('[data-match-remote]')?.removeAttribute('hidden');controls.forEach(([b,disabled])=>{if(b.isConnected)b.disabled=disabled;});}
  finally{busy=false;}
 }
 function discardGuard(){if(!dirty())return true;feedback('Guarda ou cancela os ajustes do formulário antes desta ação.');return false;}
 document.addEventListener('input',event=>{const f=event.target.closest('[data-match-form]');if(f)f.dataset.dirty='true';});
 document.addEventListener('change',event=>{const f=event.target.closest('[data-match-form]');if(f)f.dataset.dirty='true';});
 document.addEventListener('submit',async event=>{
  const form=event.target.closest('[data-match-form]');if(!form||!current)return;event.preventDefault();if(busy)return;
  const other=document.querySelector('[data-match-form][data-dirty="true"]:not([data-match-form="'+form.dataset.matchForm+'"])');if(other){feedback('Guarda ou cancela primeiro os ajustes do outro formulário.');return;}
  const fd=new FormData(form);let cmd;
  if(form.dataset.matchForm==='lineup')cmd={type:'save_lineup',slots:Object.fromEntries(Object.keys(M.roles).map(k=>[k,fd.get(k)]))};
  if(form.dataset.matchForm==='rotation')cmd={type:'save_rotation',id:form.dataset.rotationId||crypto.randomUUID(),out_ref:fd.get('out_ref'),in_ref:fd.get('in_ref'),at_min:Number(fd.get('at_min')),note:fd.get('note')};
  if(form.dataset.matchForm==='substitution'){if(!confirm('Confirmas esta substituição no instante atual do cronómetro?'))return;cmd={type:'substitute',id:crypto.randomUUID(),out_ref:fd.get('out_ref'),in_ref:fd.get('in_ref'),confirmed:true};}
  if(form.dataset.matchForm==='swap'){if(!confirm('Confirmas a troca de funções no instante atual, incluindo o guarda-redes quando selecionado?'))return;cmd={type:'swap',id:crypto.randomUUID(),role_a:fd.get('role_a'),role_b:fd.get('role_b'),confirmed:true};}
  if(cmd)await commit(cmd);
 });
 document.addEventListener('click',async event=>{
  const pawn=event.target.closest('[data-pitch-role]');
  if(pawn){selectedRole=pawn.dataset.pitchRole;document.querySelectorAll('[data-pitch-role]').forEach(p=>{p.classList.toggle('selected',p===pawn);p.setAttribute('aria-pressed',String(p===pawn));});return;}
  const pitch=event.target.closest('[data-match-pitch]');
  if(pitch&&selectedRole&&current){if(!discardGuard())return;const box=pitch.getBoundingClientRect(),x=Math.min(.92,Math.max(.08,(event.clientX-box.left)/box.width)),y=Math.min(.92,Math.max(.08,(event.clientY-box.top)/box.height));return commit({type:'position',role:selectedRole,x,y});}
  const target=event.target.closest('[data-match-action]');if(!target||!current)return;event.preventDefault();if(busy)return;
  const type=target.dataset.matchAction,s=M.state(current);
  if(type==='cancel_form'){const form=target.closest('form');if(form){form.reset();delete form.dataset.dirty;delete form.dataset.rotationId;}feedback('Alterações do formulário canceladas.');return;}
  if(type==='refresh'){if(dirty()&&!confirm('Descartar os ajustes ainda não guardados e carregar a versão atual?'))return;return view(current.id);}
  if(!discardGuard())return;
  if(type==='edit_rotation'){
   const r=s.rotations.find(r=>r.id===target.dataset.rotationId),f=document.querySelector('[data-match-form="rotation"]');if(r&&f){f.dataset.rotationId=r.id;for(const k of ['out_ref','in_ref','at_min','note'])f.elements[k].value=r[k];f.dataset.dirty='true';f.scrollIntoView({block:'center'});}return;
  }
  const messages={start:'Iniciar o cronómetro agora? Os cinco titulares começam a acumular minutos; os suplentes só contam depois de entrarem.',finish:'Terminar o registo de utilização? O resultado e a análise continuam a ser preenchidos na ficha do jogo.',take_control:'Assumir o controlo deste jogo em pausa?',reset_recording:'Apagar tempos e movimentos de utilização? O jogo, alinhamento, rotações previstas, resultado e análise mantêm-se.',clear_lineup:'Apagar apenas o alinhamento inicial?',reset_layout:'Repor a distribuição 1-2-1 no desenho do campo?',delete_rotation:'Apagar esta rotação planeada?',undo_last:'Anular o último movimento como correção? Os minutos serão recalculados desde esse instante.',apply_rotation:'Realizar esta rotação agora, no tempo atual do cronómetro?'};
  if(messages[type]&&!confirm(messages[type]))return;
  let cmd={type,confirmed:!!messages[type]};
  if(type==='delete_rotation')cmd.id=target.dataset.rotationId;
  if(type==='apply_rotation'){const r=s.rotations.find(r=>r.id===target.dataset.rotationId);if(!r)return;cmd={type:'substitute',id:crypto.randomUUID(),out_ref:r.out_ref,in_ref:r.in_ref,rotation_id:r.id,confirmed:true};}
  await commit(cmd);
 });
 document.addEventListener('keydown',async event=>{
  const pawn=event.target.closest?.('[data-pitch-role]');if(!pawn||!current||!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key))return;
  event.preventDefault();if(busy||!discardGuard())return;selectedRole=pawn.dataset.pitchRole;const p=M.state(current).layout[selectedRole];
  const x=Math.max(.08,Math.min(.92,p.x+(event.key==='ArrowLeft'?-.04:event.key==='ArrowRight'?.04:0))),y=Math.max(.08,Math.min(.92,p.y+(event.key==='ArrowUp'?-.04:event.key==='ArrowDown'?.04:0)));
  await commit({type:'position',role:selectedRole,x,y});document.querySelector('[data-pitch-role="'+selectedRole+'"]')?.focus({preventScroll:true});
 });
 window.addEventListener('hashchange',()=>{if(!location.hash.startsWith('#/jogo-visual/')){turn++;current=null;clearInterval(timer);}});
 window.addEventListener('visioncoach:sync-complete',event=>{
  if(!current||busy||location.hash!==route(current.id))return;
  if((event.detail?.conflicts||[]).some(c=>c.store==='jogos'&&(c.sync_id===current.sync_id||String(c.local_id)===String(current.id)))){feedback('Conflito de sincronização neste jogo. Os dados locais foram preservados; resolve-o nas Definições antes de continuar noutro dispositivo.');return;}
  if(dirty()){document.querySelector('[data-match-remote]')?.removeAttribute('hidden');return;}void view(current.id);
 });
 async function history(player){
  if(!player.sync_id)return '';const rows=await DB.porIndice('jogos','team_id',DEFAULT_TEAM_ID),records=[];
  for(const row of rows)if(row.visual_match?.started_at){const v=M.replay(row),p=v.players.find(x=>x.ref===player.sync_id);if(p)records.push({row,p,status:v.status});}
  if(!records.length)return '';
  return '<section class="section"><h2>Utilização em jogos</h2><p class="hint">Apenas jogos com cronómetro e movimentos registados; os restantes não são estimados.</p><div class="list">'+records.sort((a,b)=>String(b.row.data).localeCompare(String(a.row.data))).map(({row,p,status})=>'<a class="list-item row" href="'+route(row.id)+'"><span class="grow">'+fmtDate(row.data)+' · '+esc(row.adversario)+'</span><span class="badge">'+M.format(p.elapsed_ms)+(status==='completed'?'':' · parcial')+'</span></a>').join('')+'</div></section>';
 }
 root.MatchVisualUI={view,history};
})(globalThis);
