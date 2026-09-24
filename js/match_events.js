"use strict";
// Match events recorded by the coach, shared by browser and authenticated MCP. Never inferred.
(function(root){
 const SCHEMA='vision-match-events@1';
 const TYPES={goal_for:'Golo a favor',goal_against:'Golo sofrido',shot_on:'Remate à baliza',shot_off:'Remate para fora',corner_for:'Canto a favor',corner_against:'Canto contra',recovery:'Recuperação de bola',loss:'Perda de bola',through_ball:'Bola em profundidade',striker_foot:'Bola no pé do avançado',note:'Acontecimento livre'};
 const LOSS_REASONS={pass:'Passe errado',reception:'Receção',dribble:'Condução',decision:'Decisão',pressure:'Pressão adversária',duel:'Duelo',other:'Outro'};
 const ZONES={def_e:'Defesa · esquerda',def_c:'Defesa · centro',def_d:'Defesa · direita',med_e:'Meio-campo · esquerda',med_c:'Meio-campo · centro',med_d:'Meio-campo · direita',ata_e:'Ataque · esquerda',ata_c:'Ataque · centro',ata_d:'Ataque · direita'};
 const SIDES={propia:'Nossa',adversaria:'Do adversário'};
 const SIDED=['shot_on','shot_off','note'];
 const POSESSION_KINDS={unknown:'Desconhecida',measured:'Medida',estimated:'Estimada'};
 function zoneFromPoint(x,y){
  const horizontal=Number(x),vertical=Number(y);
  if(!Number.isFinite(horizontal)||!Number.isFinite(vertical)||horizontal<0||horizontal>1||vertical<0||vertical>1)throw new Error('Coordenada fora do campo.');
  const corridor=horizontal<1/3?'e':horizontal>2/3?'d':'c';
  const third=vertical<1/3?'ata':vertical>2/3?'def':'med';
  return `${third}_${corridor}`;
 }
 const clone=x=>JSON.parse(JSON.stringify(x)),text=(x,n=300)=>String(x??'').trim().slice(0,n);
 const isUid=x=>typeof x==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(x);
 const MAX_MS=240*60000;
 function state(match){
  const old=match?.match_events;if(old?.schema&&old.schema!==SCHEMA)throw new Error('Atualiza a app antes de abrir os lances deste jogo.');
  const s={schema:SCHEMA,revision:0,events:[],possession:{kind:'unknown',value:null,updated_at:null},...(old?clone(old):{})};
  if(!Number.isInteger(s.revision)||s.revision<0||!Array.isArray(s.events)||s.events.length>1000||!s.possession||!Object.hasOwn(POSESSION_KINDS,s.possession.kind||'unknown'))throw new Error('Registo de lances inválido.');
  if(!Number.isFinite(s.possession.value)&&s.possession.value!==null)throw new Error('Registo de lances inválido.');
  if(s.possession.kind==='unknown'&&s.possession.value!==null||s.possession.kind!=='unknown'&&(s.possession.value===null||s.possession.value<0||s.possession.value>100))throw new Error('Registo de posse inválido. Atualiza a origem do valor antes de o apresentar.');
  const ids=new Set();for(const event of s.events){validEvent(event);if(ids.has(event.id))throw new Error('Registo de lances inválido: identificador repetido.');ids.add(event.id);}
  return s;
 }
 function validEvent(e){
  if(!e||typeof e.id!=='string'||!TYPES[e.type]||!text(e.id,100)||e.id.length>100)throw new Error('Acontecimento inválido.');
  if(!Number.isFinite(e.at_ms)||e.at_ms<0||e.at_ms>MAX_MS)throw new Error('Minuto fora do intervalo possível.');
  if(e.reason&&!Object.hasOwn(LOSS_REASONS,e.reason))throw new Error('Motivo de perda desconhecido.');
  if(e.reason&&e.type!=='loss')throw new Error('Motivo só se aplica a perdas de bola.');
  if(e.zone&&!Object.hasOwn(ZONES,e.zone))throw new Error('Zona do campo desconhecida.');
  if(e.player_ref&&!isUid(e.player_ref))throw new Error('Usa o identificador estável do atleta.');
  if(e.opponent_player_name!=null&&(typeof e.opponent_player_name!=='string'||!text(e.opponent_player_name,100)||e.opponent_player_name.length>100||/[\x00-\x1f\x7f]/.test(e.opponent_player_name)))throw new Error('Nome do atleta adversário inválido.');
  if(e.side&&!Object.hasOwn(SIDES,e.side))throw new Error('Lado inválido.');
  if(e.side&&e.type!=='note'&&!SIDED.includes(e.type))throw new Error('Lado não se aplica a este tipo de lance.');
  if(e.note!=null&&(typeof e.note!=='string'||e.note.length>300))throw new Error('Observação do lance inválida.');
  if(typeof e.note==='string'&&e.note.length===0)delete e.note;
  }
  function validateAgainstClock(usage,match,at_ms,now){
  const M=root.VisionMatchVisual;if(usage.status==='running'||usage.status==='paused'){const total=M.replay(match,usage.status==='running'?now:undefined).total_ms;if(at_ms>total)throw new Error('O lance fica no futuro do cronómetro; usa o minuto real.');}
 }
 function normalized(command,s){
  const out={};
  for(const k of ['at_ms','player_ref','opponent_player_name','zone','reason','side']){
   const value=command[k];
   if(value!=null&&value!=='')out[k]=k==='at_ms'?Number(value):text(value,100);
  }
  out.note=command.note==null?'':text(command.note);
  if(!s)delete out.player_ref;
  return out;
 }
 function apply(match,command,options={}){
  const row=clone(match),s=state(row),M=root.VisionMatchVisual,at=Number.isFinite(Number(options.now))?Number(options.now):Date.now(),iso=new Date(at).toISOString(),actor=text(options.actor||'Treinador',160);
  const usage=M.state(row);
  if(command.expected_revision!==s.revision)throw new Error('Os lances mudaram noutro separador ou dispositivo. Atualiza antes de guardar.');
  function live(){if(!['running','paused','completed'].includes(usage.status))throw new Error('Regista lances depois de iniciar o cronómetro do jogo.');}
  function settled(){if(!['paused','completed'].includes(usage.status))throw new Error('Pausa ou termina o jogo antes de corrigir lances.');}
  function playerOk(ref){if(ref&&!((options.players||[]).some(p=>p.sync_id===ref)))throw new Error('Atleta não pertence a esta equipa. Usa o identificador estável.');}
  const type=command.type;
  if(type==='save_possession'){
   const kind=Object.hasOwn(POSESSION_KINDS,command.kind)?command.kind:null;if(!kind)throw new Error('Indica se a posse é medida, estimada ou desconhecida.');
   const value=command.value==null?null:Number(command.value);
   if(kind!=='unknown'&&(!Number.isFinite(value)||value<0||value>100))throw new Error('Indica a percentagem de posse entre 0 e 100.');
   if(command.confirmed!==true)throw new Error('É necessária confirmação explícita.');
   s.possession={kind,value:kind==='unknown'?null:value,updated_at:iso};
  }else if(type==='record'){
   live();
   const base=normalized(command,s);
   if(base.at_ms==null)base.at_ms=M.replay(row,at).total_ms;
   validateAgainstClock(usage,row,base.at_ms,at);
   const event={id:text(command.id,100),type:command.event_type,...base,created_at:iso,created_by:actor};
   if(!event.id||event.id.length>100)throw new Error('Identificador do lance em falta.');
   if(s.events.some(e=>e.id===event.id))throw new Error('Identificador de lance repetido.');
   if(command.event_type==='loss'&&!event.reason)event.reason='';
   validEvent(event);playerOk(event.player_ref);
   if(s.events.length>=1000)throw new Error('Limite de lances atingido.');
   s.events.push(event);
  }else if(type==='edit'){
   settled();
   const event=s.events.find(e=>e.id===command.id);if(!event)throw new Error('Lance inexistente ou já apagado.');
   const base=normalized(command,s);
    if(base.at_ms!=null)validateAgainstClock(usage,row,base.at_ms,at);else delete base.at_ms;
   if(Object.hasOwn(base,'at_ms'))event.at_ms=base.at_ms;
   for(const k of ['player_ref','opponent_player_name','zone','reason','side']){const value=base[k];if(value)event[k]=value;else delete event[k];}
   if(base.note)event.note=base.note;else delete event.note;
   if(event.type==='loss'&&!Object.hasOwn(event,'reason'))event.reason='';
   Object.assign(event,{updated_at:iso,edited_by:actor});
   validEvent(event);playerOk(event.player_ref);
  }else if(type==='delete'){
   settled();if(command.confirmed!==true)throw new Error('É necessária confirmação explícita.');
   const index=s.events.findIndex(e=>e.id===command.id);if(index<0)throw new Error('Lance inexistente ou já apagado.');
   s.events.splice(index,1);
  }else throw new Error('Operação de lances desconhecida.');
  s.revision++;s.updated_at=iso;
  s.events.sort((a,b)=>a.at_ms-b.at_ms||String(a.id).localeCompare(String(b.id)));
  row.match_events=s;return row;
 }
 function stats(match){
  const s=state(match),eventsAvailable=Array.isArray(match?.match_events?.events),count=k=>s.events.filter(e=>e.type===k).length;
  const by=(key,filter,missing=null)=>s.events.filter(filter).reduce((acc,e)=>{const value=e[key]||missing;if(value)acc[value]=(acc[value]||0)+1;return acc;},{});
  const shot=(type,side)=>s.events.filter(e=>e.type===type&&e.side===side).length;
  const result={for:match?.golos_favor??null,against:match?.golos_contra??null,provenance:match?.golos_favor!=null&&match?.golos_contra!=null?'introduzida_manual':'desconhecida'};
  if(!eventsAvailable)return {
   events_available:false,event_count:null,origin:'Sem registo de lances',recorded_result:result,
   counts:null,goals:null,shots:null,losses:null,recoveries:null,through_balls:null,striker_foots:null,free_notes:null,
   possession:s.possession,
   provenance:{counts:'desconhecida',losses:'desconhecida',recoveries:'desconhecida',minutes:'desconhecida',result:result.provenance,possession:{measured:'medida',estimated:'estimada',unknown:'desconhecida'}}
  };
  return {
   events_available:true,
   event_count:s.events.length,
   origin:'Contada nos lances registados',
   recorded_result:result,
   counts:Object.fromEntries(Object.keys(TYPES).map(k=>[k,count(k)])),
   goals:{for:count('goal_for'),against:count('goal_against')},
   shots:{on:count('shot_on'),off:count('shot_off'),own_on:shot('shot_on','propia'),against_on:shot('shot_on','adversaria'),unknown_side_on:count('shot_on')-shot('shot_on','propia')-shot('shot_on','adversaria'),own_off:shot('shot_off','propia'),against_off:shot('shot_off','adversaria'),unknown_side_off:count('shot_off')-shot('shot_off','propia')-shot('shot_off','adversaria')},
   losses:{total:count('loss'),by_reason:by('reason',e=>e.type==='loss','none'),by_zone:by('zone',e=>e.type==='loss')},
   recoveries:{total:count('recovery'),by_zone:by('zone',e=>e.type==='recovery')},
   through_balls:count('through_ball'),striker_foots:count('striker_foot'),
   free_notes:s.events.filter(e=>e.type==='note').length,
   possession:s.possession,
   provenance:{counts:'contada',losses:'contada',recoveries:'contada',minutes:'registada',result:match?.golos_favor!=null&&match?.golos_contra!=null?'introduzida_manual':'desconhecida',possession:{measured:'medida',estimated:'estimada',unknown:'desconhecida'}}
  };
 }
 root.VisionMatchEvents={schema:SCHEMA,types:TYPES,lossReasons:LOSS_REASONS,zones:ZONES,zoneFromPoint,sides:SIDES,possessionKinds:POSESSION_KINDS,sidedTypes:SIDED,state,apply,stats,sideOf:()=>null};
 if(typeof module!=='undefined'&&module.exports)module.exports=root.VisionMatchEvents;
})(globalThis);
