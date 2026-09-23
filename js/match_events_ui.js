"use strict";
// Coach-facing UI for match events and counted statistics. Renders inside the visual match page.
(function(root){
 const M=root.VisionMatchVisual,E=root.VisionMatchEvents;
 let current=null,players=[],busy=false;
 const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const playerName=ref=>players.find(p=>p.sync_id===ref)?.nome||'Atleta';
 function minute(value){const sec=Math.floor(Math.max(0,value)/1000);return String(Math.floor(sec/60)).padStart(2,'0')+':'+String(sec%60).padStart(2,'0');}
 function feedback(text){const p=document.querySelector('[data-event-feedback]');if(p){p.hidden=false;p.textContent=text;}}
 function statsTable(match){
  const t=E.stats(match),c=t.counts;
  const row=(label,count)=>'<tr><td>'+esc(label)+'</td><td><strong>'+count+'</strong></td><td>'+esc(t.provenance.counts)+'</td></tr>';
  let rows=row('Golos a favor',c.goal_for)+row('Golos sofridos',c.goal_against)+row('Remates à baliza · total',t.shots.on)+row('Remates à baliza · nossa equipa',t.shots.own_on)+row('Remates à baliza · adversário',t.shots.against_on)+row('Remates à baliza · lado não indicado',t.shots.unknown_side_on)+row('Remates para fora · total',t.shots.off)+row('Remates para fora · nossa equipa',t.shots.own_off)+row('Remates para fora · adversário',t.shots.against_off)+row('Remates para fora · lado não indicado',t.shots.unknown_side_off)+row('Cantos a favor',c.corner_for)+row('Cantos contra',c.corner_against)+row('Perdas de bola',t.losses.total)+row('Recuperações de bola',t.recoveries.total)+row('Bolas em profundidade',t.through_balls)+row('Bolas no pé do avançado',t.striker_foots)+row('Notas livres',t.free_notes);
  const join=tally=>Object.entries(tally).map(([k,n])=>esc(k==='none'?'Sem motivo':(E.lossReasons[k]||E.zones[k]||k))+' · '+n).join(' · ');
  if(Object.keys(t.losses.by_reason).length)rows+='<tr><td>Perdas por motivo</td><td colspan="2">'+join(t.losses.by_reason)+'</td></tr>';
  if(Object.keys(t.losses.by_zone).length)rows+='<tr><td>Perdas por zona</td><td colspan="2">'+join(t.losses.by_zone)+'</td></tr>';
  if(Object.keys(t.recoveries.by_zone).length)rows+='<tr><td>Recuperações por zona</td><td colspan="2">'+join(t.recoveries.by_zone)+'</td></tr>';
  return '<h3 class="section">Estatísticas do jogo</h3><p class="hint">Contagens derivadas dos lances que registaste. Cada linha indica a origem; nada é inferido.</p><div class="table-wrap section"><table><thead><tr><th>O que</th><th>Contagem</th><th>Origem</th></tr></thead><tbody>'+rows+'</tbody></table></div>';
 }
 function possessionSection(match){
  const p=E.state(match).possession;
  const provenance=p.kind==='measured'?'Medida (introduzida por ti)':p.kind==='estimated'?'Estimada (introduzida por ti)':'Desconhecida';
  let html='<h3 class="section">Posse de bola</h3><p class="hint">A posse nunca é inferida. Marca-a como medida só quando for contada de forma real; estimativas ficam identificadas como tal.</p><p class="section"><span class="badge ready">'+esc(provenance)+'</span>'+(p.value!=null?' <strong>'+esc(p.value)+'%</strong>':' <small class="meta">Sem valor registado</small>')+'</p>';
  html+='<form class="form section" data-event-form="possession"><div class="form-grid"><label class="field"><span>Tipo de valor</span><select name="kind"><option value="unknown" '+(p.kind==='unknown'?'selected':'')+'>Desconhecida</option><option value="measured" '+(p.kind==='measured'?'selected':'')+'>Medida</option><option value="estimated" '+(p.kind==='estimated'?'selected':'')+'>Estimada</option></select></label><label class="field"><span>Percentagem</span><input name="value" type="number" min="0" max="100" step="1" value="'+esc(p.value??'')+'"></label></div><div class="toolbar"><button class="btn secondary" type="submit">Guardar posse</button></div></form>';
  return html;
 }
 function recordSection(match){
  const s=M.state(match);
  if(!s.started_at)return '<p class="notice">O registo de lances usa o minuto do cronómetro deste jogo. Inicia primeiro a utilização e volta aqui para contar os lances.</p>';
  const active=['running','paused','completed'].includes(s.status);
  const clockMinute=Math.round(M.replay(match).total_ms/60000*10)/10;
  const rosterRows=s.roster;
  let html='<h3 class="section">Registar lance</h3><p class="hint">Toca no tipo para preparar o registo com o minuto atual, confirma os detalhes e guarda. Registar um lance não altera o resultado nem os minutos.</p><div class="grid quick-grid match-event-quick section">';
  for(const [t,label] of Object.entries(E.types))html+='<button type="button" class="btn'+' secondary'+' btn-sm" data-event-quick="'+t+'" '+(active?'':'disabled')+'>'+esc(label)+'</button>';
  html+='</div>';
  if(!active)return html+'<p class="notice">Só é possível registar lances com o jogo a correr, em pausa ou terminado.</p>';
  html+='<form class="form section" data-event-form="record" data-event-edit-id=""><div class="form-grid"><label class="field"><span>Tipo de lance</span><select name="type">'+Object.entries(E.types).map(([k,v])=>'<option value="'+k+'">'+esc(v)+'</option>').join('')+'</select></label><label class="field"><span>Minuto</span><input name="at_min" type="number" min="0" max="240" step="0.1" value="'+esc(clockMinute)+'" required></label></div><div class="form-grid"><label class="field"><span>Lado</span><select name="side"><option value="">Não se aplica</option>'+Object.entries(E.sides).map(([k,v])=>'<option value="'+k+'">'+esc(v)+'</option>').join('')+'</select></label><label class="field"><span>Atleta (nossa equipa)</span><select name="player_ref"><option value="">—</option>'+rosterRows.map(p=>'<option value="'+esc(p.ref)+'">'+esc(p.name)+(p.number!=null?' · #'+esc(p.number):'')+'</option>').join('')+'</select></label></div><div class="form-grid"><label class="field"><span>Zona do campo</span><select name="zone"><option value="">—</option>'+Object.entries(E.zones).map(([k,v])=>'<option value="'+k+'">'+esc(v)+'</option>').join('')+'</select></label><label class="field"><span>Motivo (perdas)</span><select name="reason"><option value="">—</option>'+Object.entries(E.lossReasons).map(([k,v])=>'<option value="'+k+'">'+esc(v)+'</option>').join('')+'</select></label></div><label class="field"><span>Observação</span><input name="note" maxlength="300"></label><div class="toolbar"><button class="btn accent" type="submit">Registar lance</button><button class="btn secondary" type="button" data-event-action="reset_form">Limpar</button></div></form>';
  return html;
 }
 function eventsSection(match){
  const s=M.state(match),es=E.state(match).events,settled=['paused','completed'].includes(s.status);
  if(!es.length)return '<h3 class="section">Lances registados</h3><p class="empty section">Ainda não há lances registados neste jogo.</p>';
  return '<h3 class="section">Lances registados</h3><p class="hint">'+(settled?'Podes editar ou apagar um lance com confirmação.':'Pausa ou termina o jogo para editar ou apagar lances.')+'</p><div class="list">'+es.map(e=>{
   const bits=[minute(e.at_ms),esc(E.types[e.type])];
   if(e.side&&E.sides[e.side])bits.push(esc(E.sides[e.side]));
   if(e.player_ref)bits.push(esc(playerName(e.player_ref)));
   if(e.zone&&E.zones[e.zone])bits.push(esc(E.zones[e.zone]));
   if(e.reason&&E.lossReasons[e.reason])bits.push(esc(E.lossReasons[e.reason]));
   if(e.note)bits.push(esc(e.note));
   let html='<article class="list-item"><strong>'+bits.join(' · ')+'</strong><p class="meta">'+esc((e.created_by||'Treinador')+' · '+String(e.created_at||'').slice(0,16).replace('T',' '))+'</p><div class="toolbar">';
   if(settled)html+='<button type="button" class="btn secondary btn-sm" data-event-action="edit" data-event-id="'+esc(e.id)+'">Editar lance</button><button type="button" class="btn danger btn-sm" data-event-action="delete" data-event-id="'+esc(e.id)+'">Apagar lance</button>';
   else html+='<small class="meta">Edição em pausa ou após o fim do jogo.</small>';
   return html+'</div></article>';
  }).join('')+'</div>';
 }
 function resultNotice(match){
  if(match.golos_favor==null||match.golos_contra==null)return '';
  const t=E.stats(match),forN=Number(match.golos_favor),againstN=Number(match.golos_contra);
  if(t.goals.for!==forN||t.goals.against!==againstN)return '<p class="notice">Golos contados nos lances: '+t.goals.for+'–'+t.goals.against+'. Resultado registado manualmente na ficha: '+forN+'–'+againstN+'. O resultado mantém o valor da ficha; corrige onde estiver errado.</p>';
  return '';
 }
 function html(match,roster){
  if(roster&&roster.length)players=roster;
  let out='<section class="panel hero-main section" data-match-events="'+match.id+'"><h2>Lances e estatísticas</h2><p class="lead">Registo rápido dos acontecimentos do jogo, no minuto em que acontecem.</p><p class="notice" data-event-feedback role="status" hidden></p>';
  out+=resultNotice(match);
  out+=recordSection(match);
  out+=eventsSection(match);
  out+=statsTable(match);
  out+=possessionSection(match);
  out+='</section>';
  return out;
 }
 function attach(match,roster){current=match;players=roster||players;}
 function reset(){current=null;players=[];}
 async function commit(command){
  if(!current||busy)return;busy=true;
  const id=current.id,rev=E.state(current).revision;
  try{
   const saved=await DB.modificar('jogos',id,row=>E.apply(row,{...command,expected_revision:rev},{players:players}));
   try{await logHuman('match_events_'+command.type,'Atualizou lances do jogo · '+(saved.adversario||''),'match',saved.sync_id||id);}catch(_){}
   if(location.hash.startsWith('#/jogo-visual/'))await root.MatchVisualUI.view(id);
   else current=saved;
   feedback(command.type==='delete'?'Lance apagado neste dispositivo.':'Lance guardado neste dispositivo.');
  }catch(error){feedback(error.message)}
  finally{busy=false;}
 }
 document.addEventListener('click',async event=>{
  if(!current)return;
  const quick=event.target.closest('[data-event-quick]');
  if(quick){
   const type=quick.dataset.eventQuick,v=Math.round(M.replay(current).total_ms/60000*10)/10;
   const form=document.querySelector('[data-event-form="record"]');
   if(form){if(form.dataset.eventEditId){if(!confirm('Abandonar as alterações a este lance e preparar um novo?'))return;form.reset();delete form.dataset.dirty;delete form.dataset.eventEditId;form.elements.type.disabled=false;}form.elements.type.value=type;form.elements.at_min.value=String(v);form.elements.type.disabled=false;if(!E.sidedTypes.includes(type))form.elements.side.value='';if(type!=='loss')form.elements.reason.value='';form.dataset.dirty='true';form.scrollIntoView({block:'center',behavior:'smooth'});}
   return;
  }
  const target=event.target.closest('[data-event-action]');if(!target)return;event.preventDefault();if(busy)return;
  const type=target.dataset.eventAction;
  if(type==='reset_form'){const form=target.closest('[data-event-form="record"]');if(form){form.reset();delete form.dataset.dirty;delete form.dataset.eventEditId;}feedback('Formulário limpo.');return;}
  if(type==='edit'){
   const e=E.state(current).events.find(x=>x.id===target.dataset.eventId);if(!e)return feedback('Lance não encontrado neste dispositivo.');
   const form=document.querySelector('[data-event-form="record"]');
   if(form){form.reset();delete form.dataset.dirty;form.dataset.eventEditId=e.id;form.elements.type.value=e.type;form.elements.type.disabled=true;form.elements.at_min.value=String(Math.round(e.at_ms/60000*10)/10);form.elements.side.value=e.side||'';form.elements.player_ref.value=e.player_ref||'';form.elements.zone.value=e.zone||'';form.elements.reason.value=e.reason||'';form.elements.note.value=e.note||'';form.dataset.dirty='true';form.scrollIntoView({block:'center',behavior:'smooth'});}
   feedback('A editar um lance existente: muda os teus dados e guarda.');
   return;
  }
  if(type==='delete'){
   const e=E.state(current).events.find(x=>x.id===target.dataset.eventId);if(!e)return;
   if(!confirm('Apagar este lance ('+minute(e.at_ms)+' · '+E.types[e.type]+')? Não pode ser recuperado depois da sincronização.'))return;
   return void commit({type:'delete',id:e.id,confirmed:true});
  }
 });
 document.addEventListener('input',event=>{const f=event.target.closest('[data-event-form]');if(f)f.dataset.dirty='true';});
 document.addEventListener('change',event=>{const f=event.target.closest('[data-event-form]');if(f)f.dataset.dirty='true';});
 document.addEventListener('submit',async event=>{
  const form=event.target.closest('[data-event-form]');if(!form||!current)return;event.preventDefault();if(busy)return;
  const fd=new FormData(form);
  if(form.dataset.eventForm==='possession'){
   const kind=fd.get('kind');
   if(!confirm('Guardar a posse de bola como '+(E.possessionKinds[kind]||kind)+'?'))return;
   return void commit({type:'save_possession',kind,value:fd.get('value')===''?null:Number(fd.get('value')),confirmed:true});
  }
  const editId=form.dataset.eventEditId,type=fd.get('type');
  const minute=String(fd.get('at_min')||'');
  if(editId&&!confirm('Guardar as alterações a este lance?'))return;
  const atNumber=Number(minute.replace(',','.'));
  const payload={type:editId?'edit':'record',id:editId||crypto.randomUUID(),at_ms:Math.round(atNumber*10)/10*60000,...(!editId?{event_type:type}:{})};
  const sided=editId?(E.state(current).events.find(e=>e.id===editId)?.type||''):type;
  const side=E.sidedTypes.includes(sided)?(fd.get('side')||null):null;
  if(!editId){if(side)payload.side=side;}else payload.side=side;
  payload.player_ref=fd.get('player_ref')||null;payload.zone=fd.get('zone')||null;payload.reason=fd.get('reason')||null;payload.note=fd.get('note')||'';
  return void commit(payload);
 });
 window.addEventListener('hashchange',()=>{if(!location.hash.startsWith('#/jogo-visual/'))reset();});
 root.MatchEventsUI={html,attach,reset};
})(globalThis);
