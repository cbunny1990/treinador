"use strict";
// 5v5 participation model, shared by browser and authenticated MCP. No inferred statistics.
(function(root){
 const SCHEMA='vision-match-visual@1';
 const ROLES={gr:'Guarda-redes',def:'Defesa',left:'Ala esquerda',right:'Ala direita',front:'Avançado'};
 const DEFAULT={gr:{x:.5,y:.86},def:{x:.5,y:.66},left:{x:.22,y:.43},right:{x:.78,y:.43},front:{x:.5,y:.18}};
 const STATES={not_started:'Por iniciar',running:'Em jogo',paused:'Em pausa / intervalo',completed:'Terminado'};
 const clone=x=>JSON.parse(JSON.stringify(x)),text=(x,n=200)=>String(x??'').trim().slice(0,n);
 const uid=x=>typeof x==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(x);
 const ms=now=>{const n=new Date(now??Date.now()).getTime();if(!Number.isFinite(n))throw new Error('Instante inválido.');return n;};
 function state(match){
  const old=match?.visual_match;if(old?.schema&&old.schema!==SCHEMA)throw new Error('Atualiza a app antes de abrir este jogo.');
  const s={schema:SCHEMA,revision:0,layout:clone(DEFAULT),rotations:[],status:'not_started',controller_id:null,started_at:null,finished_at:null,active_since:null,elapsed_ms:0,roster:[],initial_slots:null,events:[],...(old?clone(old):{})};
  if(!Number.isInteger(s.revision)||s.revision<0||!Object.hasOwn(STATES,s.status)||!Array.isArray(s.events)||!Array.isArray(s.rotations)||!Array.isArray(s.roster))throw new Error('Registo de jogo inválido.');
  s.layout={...clone(DEFAULT),...s.layout};return s;
 }
 function planKey(match){return JSON.stringify({callup:match.callup||null,lineup:match.lineup||null});}
 function initialSlots(match){
  const l=match.lineup||{},slots={gr:String(l.goalkeeper_id||''),def:'',left:'',right:'',front:''};
  const starters=(l.starters||[]).map(String).filter(x=>x&&x!==slots.gr).slice(0,4),used=new Set([slots.gr]);
  for(const role of ['def','left','right','front']){const candidate=String(l.positions?.[role]||'');if(starters.includes(candidate)&&!used.has(candidate)){slots[role]=candidate;used.add(candidate);}}
  for(const role of ['def','left','right','front'])if(!slots[role]){const candidate=starters.find(x=>!used.has(x));if(candidate){slots[role]=candidate;used.add(candidate);}}
  return slots;
 }
 function available(p){return !!p&&p.plantel_ativo!==false&&(p.estado_disponibilidade||'disponivel')==='disponivel';}
 function pool(match,players){const called=new Set((match.callup?.player_ids||[]).map(String));return (players||[]).filter(p=>called.has(p.sync_id));}
 function validateSlots(slots,match,players,complete=false){
  if(!slots||typeof slots!=='object'||Array.isArray(slots)||Object.keys(slots).some(k=>!Object.hasOwn(ROLES,k)))throw new Error('Posições inválidas.');
  const out={},seen=new Set(),called=pool(match,players);
  for(const role of Object.keys(ROLES)){
   const ref=text(slots[role],100);if(!ref){if(complete)throw new Error('Escolhe um guarda-redes e quatro jogadores de campo antes de iniciar.');out[role]='';continue;}
   if(!uid(ref)||seen.has(ref))throw new Error('Um atleta só pode ocupar uma posição; usa o identificador estável.');
   const p=called.find(p=>p.sync_id===ref);if(!available(p))throw new Error('Só podem jogar atletas convocados e disponíveis.');
   out[role]=ref;seen.add(ref);
  }return out;
 }
 function elapsed(s,now){const base=Math.max(0,Number(s.elapsed_ms)||0);return base+(s.status==='running'&&s.active_since?Math.max(0,ms(now)-ms(s.active_since)):0);}
 function format(value){const sec=Math.floor(Math.max(0,value)/1000);return String(Math.floor(sec/60)).padStart(2,'0')+':'+String(sec%60).padStart(2,'0');}
 function replay(match,now){
  const s=state(match),total=elapsed(s,now),slots=clone(s.initial_slots||initialSlots(match)),players=new Map(s.roster.map(p=>[p.ref,{...p,elapsed_ms:0,keeper_ms:0,entries:0}]));
  let cursor=0;
  function add(until){if(until<cursor||until>total)throw new Error('Cronologia inconsistente; revê o relógio antes de continuar.');const dt=until-cursor;for(const [role,ref] of Object.entries(slots)){if(!ref)continue;const p=players.get(ref);if(!p){if(s.started_at)throw new Error('Atleta histórico em falta.');continue;}p.elapsed_ms+=dt;if(role==='gr')p.keeper_ms+=dt;}cursor=until;}
  for(const ref of Object.values(slots))if(players.has(ref))players.get(ref).entries=1;
  for(const ev of s.events.filter(x=>!x.voided_at)){
   add(ev.at_ms);
   if(ev.type==='substitute'){
    const role=Object.keys(slots).find(k=>slots[k]===ev.out_ref);
    if(!role||Object.values(slots).includes(ev.in_ref)||!players.has(ev.in_ref))throw new Error('Substituição incompatível com a sequência.');
    slots[role]=ev.in_ref;players.get(ev.in_ref).entries++;
   }else if(ev.type==='swap'){
    if(!Object.hasOwn(ROLES,ev.role_a)||!Object.hasOwn(ROLES,ev.role_b))throw new Error('Troca de posições inválida.');
    [slots[ev.role_a],slots[ev.role_b]]=[slots[ev.role_b],slots[ev.role_a]];
   }else throw new Error('Movimento de jogo desconhecido.');
  }
  add(total);const field=new Set(Object.values(slots));
  return {status:s.status,total_ms:total,slots,players:[...players.values()].map(p=>({...p,on_field:field.has(p.ref)})),bench:s.roster.filter(p=>!field.has(p.ref)),events:s.events.filter(x=>!x.voided_at),rotations:s.rotations.filter(r=>!r.removed_at).map(r=>({...r,applied:s.events.some(ev=>!ev.voided_at&&ev.rotation_id===r.id),due:total>=r.at_min*60000}))};
 }
 function apply(match,command,options={}){
  const row=clone(match),s=state(row),at=ms(options.now),iso=new Date(at).toISOString(),controller=text(options.controller_id,160),actor=text(options.actor||'Treinador'),players=options.players||[];
  if(command.expected_revision!==s.revision)throw new Error('O jogo mudou noutro separador ou dispositivo. Atualiza antes de guardar.');
  if(command.expected_plan_key!=null&&command.expected_plan_key!==planKey(row))throw new Error('A convocatória ou o alinhamento mudou. Atualiza antes de guardar.');
  const type=command.type;
  function confirmed(){if(command.confirmed!==true)throw new Error('É necessária confirmação explícita.');}
  function live(){if(!['running','paused'].includes(s.status))throw new Error('O registo de utilização não está em curso.');}
  function owner(){if(!controller||s.controller_id!==controller)throw new Error('Outro dispositivo controla o jogo. Pausa nesse dispositivo antes de assumir o controlo.');}
  function settle(){s.elapsed_ms=elapsed(s,at);s.active_since=null;}
  function playingRef(ref){if(!s.roster.some(p=>p.ref===ref))throw new Error('Atleta não incluído no registo inicial do jogo.');}
  if(type==='save_lineup'){
   if(s.started_at)throw new Error('O alinhamento inicial está preservado. Durante o jogo usa Substituir ou Trocar posições.');
   const slots=validateSlots(command.slots,row,players),refs=Object.values(slots).filter(Boolean);
   row.lineup={...(row.lineup||{}),system:'1-2-1',status:refs.length===5?'ready':'draft',goalkeeper_id:slots.gr||null,starters:['def','left','right','front'].map(k=>slots[k]).filter(Boolean),positions:slots,substitutes:pool(row,players).filter(available).map(p=>p.sync_id).filter(x=>!refs.includes(x))};
  }else if(type==='clear_lineup'){
   if(s.started_at)throw new Error('O alinhamento inicial já faz parte do histórico.');confirmed();row.lineup={...(row.lineup||{}),status:'draft',goalkeeper_id:null,starters:[],positions:{},substitutes:pool(row,players).filter(available).map(p=>p.sync_id)};
  }else if(type==='position'){
   if(!Object.hasOwn(ROLES,command.role)||![command.x,command.y].every(x=>typeof x==='number'&&Number.isFinite(x)&&x>=.08&&x<=.92))throw new Error('Escolhe uma posição dentro do campo.');
   s.layout[command.role]={x:command.x,y:command.y};
  }else if(type==='reset_layout'){confirmed();s.layout=clone(DEFAULT);
  }else if(type==='save_rotation'){
   if(s.status==='completed')throw new Error('O jogo terminou.');
   if(!text(command.id,100)||command.id.length>100||command.out_ref===command.in_ref||![command.out_ref,command.in_ref].every(uid)||!Number.isFinite(command.at_min)||command.at_min<0||command.at_min>240)throw new Error('Rotação inválida.');
   const eligible=s.started_at?s.roster.map(p=>p.ref):pool(row,players).filter(available).map(p=>p.sync_id);
   if(![command.out_ref,command.in_ref].every(r=>eligible.includes(r)))throw new Error('Escolhe dois atletas convocados para esta rotação.');
   if(s.events.some(ev=>ev.rotation_id===command.id&&!ev.voided_at))throw new Error('Uma rotação realizada não pode ser alterada como plano.');
   const index=s.rotations.findIndex(r=>r.id===command.id);if(index<0&&s.rotations.length>=100)throw new Error('Limite de rotações atingido.');
   const next={id:command.id,out_ref:command.out_ref,in_ref:command.in_ref,at_min:command.at_min,note:text(command.note,1000),updated_at:iso,actor};if(index<0)s.rotations.push(next);else s.rotations[index]=next;
  }else if(type==='delete_rotation'){
   confirmed();const r=s.rotations.find(r=>r.id===command.id);if(!r||s.events.some(ev=>ev.rotation_id===r.id&&!ev.voided_at))throw new Error('Rotação inexistente ou já realizada.');r.removed_at=iso;
  }else if(type==='start'){
   confirmed();if(!controller)throw new Error('Dispositivo de controlo em falta.');if(s.status!=='not_started')throw new Error('O registo já foi iniciado.');
   if(['cancelado','concluido'].includes(row.estado))throw new Error('Este jogo está cancelado ou concluído. Não se inventam minutos retroativos.');
   s.initial_slots=validateSlots(initialSlots(row),row,players,true);
   s.roster=pool(row,players).filter(available).map(p=>({ref:p.sync_id,name:text(p.nome,180),number:p.numero??null}));
   s.status='running';s.started_at=iso;s.active_since=iso;s.controller_id=controller;s.elapsed_ms=0;s.events=[];
  }else if(type==='pause'){
   owner();if(s.status!=='running')throw new Error('O cronómetro não está a contar.');settle();s.status='paused';
  }else if(type==='resume'){
   owner();if(s.status!=='paused')throw new Error('O jogo não está em pausa.');s.status='running';s.active_since=iso;
  }else if(type==='take_control'){
   confirmed();if(s.status!=='paused'||!controller)throw new Error('Só podes assumir o controlo com o jogo em pausa.');s.controller_id=controller;
  }else if(type==='finish'){
   confirmed();owner();live();settle();s.status='completed';s.finished_at=iso;
  }else if(type==='substitute'||type==='swap'){
   confirmed();owner();live();if(s.events.length>=500)throw new Error('Limite de movimentos atingido.');
   if(!text(command.id,100)||s.events.some(ev=>ev.id===command.id))throw new Error('Identificador de movimento repetido ou em falta.');
   const current=replay(row,at),event={id:command.id,type,at_ms:current.total_ms,created_at:iso,actor,note:text(command.note,1000)};
   if(type==='substitute'){
    playingRef(command.in_ref);playingRef(command.out_ref);
    if(!Object.values(current.slots).includes(command.out_ref)||Object.values(current.slots).includes(command.in_ref))throw new Error('Escolhe quem está em campo para sair e um suplente para entrar.');
    if(!available(players.find(p=>p.sync_id===command.in_ref)))throw new Error('O atleta que entra deixou de estar disponível no plantel.');
    Object.assign(event,{out_ref:command.out_ref,in_ref:command.in_ref});
    if(command.rotation_id){const r=s.rotations.find(r=>r.id===command.rotation_id&&!r.removed_at);if(!r||r.out_ref!==command.out_ref||r.in_ref!==command.in_ref||s.events.some(ev=>!ev.voided_at&&ev.rotation_id===r.id))throw new Error('A rotação mudou ou já foi realizada.');event.rotation_id=r.id;}
   }else{
    if(command.role_a===command.role_b||![command.role_a,command.role_b].every(k=>Object.hasOwn(ROLES,k)))throw new Error('Escolhe duas posições diferentes.');
    Object.assign(event,{role_a:command.role_a,role_b:command.role_b});
   }
   s.events.push(event);
  }else if(type==='undo_last'){
   confirmed();owner();if(s.status!=='paused')throw new Error('Pausa o jogo antes de corrigir o último movimento.');const last=s.events.filter(ev=>!ev.voided_at).at(-1);if(!last)throw new Error('Sem movimentos para corrigir.');last.voided_at=iso;last.voided_by=actor;
  }else if(type==='reset_recording'){
   confirmed();if(s.status==='running')throw new Error('Pausa o jogo antes de apagar o registo de utilização.');
   row.visual_match={...state(null),layout:s.layout,rotations:s.rotations,revision:s.revision+1,updated_at:iso,reset_at:iso};return row;
  }else throw new Error('Operação de jogo desconhecida.');
  s.revision++;s.updated_at=iso;row.visual_match=s;
  if(s.started_at)replay(row,at);return row;
 }
 root.VisionMatchVisual={schema:SCHEMA,roles:ROLES,defaults:DEFAULT,states:STATES,state,initialSlots,planKey,pool,available,validateSlots,elapsed,format,replay,apply};
 if(typeof module!=='undefined'&&module.exports)module.exports=root.VisionMatchVisual;
})(globalThis);
