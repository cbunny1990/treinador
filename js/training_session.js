"use strict";
// Pure, shared session model. Planned blocks are frozen at start; ticks never write data.
(function(root){
  const SCHEMA='vision-training-session@1';
  const ATTENDANCE={unknown:'Por marcar',present:'Presente',late:'Atrasado',absent:'Ausente',excused:'Falta justificada'};
  const STATES={not_started:'Por iniciar',running:'Em curso',paused:'Em pausa',completed:'Terminado'};
  const copy=x=>JSON.parse(JSON.stringify(x));
  const text=(x,max=3000)=>String(x??'').trim().slice(0,max);
  function stamp(now){const d=new Date(now??Date.now());if(!Number.isFinite(d.getTime()))throw new Error('Data inválida.');return d.toISOString();}
  function normalize(value){
    if(value?.schema&&value.schema!==SCHEMA)throw new Error('Esta sessão precisa de uma versão mais recente da app.');
    const s={schema:SCHEMA,revision:0,status:'not_started',controller_id:null,started_at:null,finished_at:null,active_index:0,active_since:null,blocks:[],attendance:[],...(value?copy(value):{})};
    if(!Object.hasOwn(STATES,s.status))throw new Error('Estado de sessão inválido.');
    s.revision=Number.isInteger(s.revision)&&s.revision>=0?s.revision:0;
    s.blocks=Array.isArray(s.blocks)?s.blocks:[];s.attendance=Array.isArray(s.attendance)?s.attendance:[];
    return s;
  }
  function roster(players,session){
    const entries=new Map(normalize(session).attendance.map(x=>[x.player_ref,{...x}]));
    for(const p of players||[]){
      if(p.plantel_ativo===false)continue;
      const ref=text(p.sync_id,100);if(!ref)throw new Error('Jogador sem identificador estável. Reabre a ficha antes de marcar presença.');
      if(!entries.has(ref))entries.set(ref,{player_ref:ref,name:text(p.nome,180),number:p.numero??null,status:'unknown'});
    }
    return [...entries.values()].sort((a,b)=>a.name.localeCompare(b.name,'pt-PT'));
  }
  function elapsed(block,session,index,now=Date.now()){
    const base=Math.max(0,Number(block?.elapsed_ms)||0);
    if(session.status!=='running'||session.active_index!==index||!session.active_since)return base;
    return base+Math.max(0,new Date(now).getTime()-Date.parse(session.active_since));
  }
  function summary(session,now){
    const s=normalize(session),counts=Object.fromEntries(Object.keys(ATTENDANCE).map(k=>[k,0]));
    for(const a of s.attendance)if(Object.hasOwn(counts,a.status))counts[a.status]++;
    const blocks=s.blocks.map((b,i)=>({...b,actual_ms:elapsed(b,s,i,now)}));
    return {status:s.status,counts,participants:counts.present+counts.late,marked:s.attendance.length-counts.unknown,total:s.attendance.length,blocks,actual_ms:blocks.reduce((n,b)=>n+b.actual_ms,0),planned_min:blocks.reduce((n,b)=>n+(Number(b.planned_min)||0),0)};
  }
  function settle(s,at){
    if(s.status==='running'&&s.blocks[s.active_index])s.blocks[s.active_index].elapsed_ms=elapsed(s.blocks[s.active_index],s,s.active_index,at);
    s.active_since=null;
  }
  function apply(training,command,options={}){
    const row=copy(training),s=normalize(row.session),at=stamp(options.now),controller=text(options.controller_id,180),actor=text(options.actor||'Treinador',180);
    if(command.expected_revision!==s.revision)throw new Error('A sessão mudou noutro separador ou dispositivo. Atualiza antes de guardar.');
    const action=command.type;
    if(['start','pause','resume','next','finish','take_control','reset'].includes(action)&&!controller)throw new Error('Controlador da sessão em falta.');
    if(['pause','resume','next','finish'].includes(action)&&s.controller_id!==controller)throw new Error('O cronómetro está a ser controlado noutro dispositivo. Coloca em pausa nesse dispositivo antes de assumir o controlo.');
    if(action==='attendance'){
      if(!Array.isArray(command.entries)||command.entries.length>150)throw new Error('Lista de presenças inválida.');
      const existing=new Map(s.attendance.map(x=>[x.player_ref,x]));const seen=new Set();
      for(const a of command.entries){
        const ref=text(a.player_ref,100);
        if(!ref||!a.name||seen.has(ref)||!Object.hasOwn(ATTENDANCE,a.status))throw new Error('Presença inválida.');
        seen.add(ref);existing.set(ref,{player_ref:ref,name:text(a.name,180),number:a.number??null,status:a.status,updated_at:at,actor});
      }
      s.attendance=[...existing.values()];
    }else if(action==='start'){
      if(s.status!=='not_started')throw new Error('O treino já foi iniciado.');
      if(!Array.isArray(row.blocos)||!row.blocos.length)throw new Error('Adiciona exercícios antes de iniciar o treino.');
      s.blocks=row.blocos.slice().sort((a,b)=>(a.order||0)-(b.order||0)).map((b,i)=>{
        const min=Number(b.duration_min||0);if(!Number.isFinite(min)||min<0||min>240)throw new Error('Duração prevista inválida.');
        return {key:b.block_id||'block-'+i,exercise_ref:text(b.exercise_ref,100),exercise_name:text(b.exercise_name||'Exercício '+(i+1),200),phase:b.phase||'principal',planned_min:min,planned_notes:b.notes||null,elapsed_ms:0,done:false,notes:[]};
      });
      if(command.players)s.attendance=roster(command.players,s);
      s.status='running';s.controller_id=controller;s.started_at=at;s.active_since=at;s.active_index=0;
    }else if(action==='pause'){
      if(s.status!=='running')throw new Error('O cronómetro não está a contar.');settle(s,at);s.status='paused';
    }else if(action==='resume'){
      if(s.status!=='paused')throw new Error('O treino não está em pausa.');s.status='running';s.active_since=at;
    }else if(action==='next'){
      if(!['running','paused'].includes(s.status))throw new Error('Inicia o treino primeiro.');
      if(s.active_index>=s.blocks.length-1)throw new Error('Este é o último exercício. Termina o treino.');
      settle(s,at);s.blocks[s.active_index].done=true;s.active_index++;if(s.status==='running')s.active_since=at;
    }else if(action==='finish'){
      if(!['running','paused'].includes(s.status))throw new Error('O treino não está em curso.');
      if(command.confirmed!==true)throw new Error('Confirma o fim do treino.');
      settle(s,at);s.blocks[s.active_index].done=true;s.status='completed';s.finished_at=at;
    }else if(action==='take_control'){
      if(s.status!=='paused'||command.confirmed!==true)throw new Error('Só podes assumir o controlo de um treino em pausa, com confirmação.');s.controller_id=controller;
    }else if(action==='note'||action==='remove_note'){
      const block=s.blocks.find(b=>b.key===command.block_key);if(!block)throw new Error('Exercício da sessão não encontrado.');
      const id=text(command.note_id,100);if(!id)throw new Error('Identificador da observação em falta.');
      const notes=Array.isArray(block.notes)?block.notes:[],index=notes.findIndex(n=>n.id===id);
      if(action==='remove_note'){
        if(command.confirmed!==true||index<0)throw new Error('Confirma a observação a apagar.');block.notes=notes.filter(n=>n.id!==id);
      }else{
        const value=text(command.text);if(!value)throw new Error('Escreve uma observação.');
        if(index<0&&notes.length>=100)throw new Error('Limite de observações deste exercício atingido.');
        const note={id,text:value,created_at:index<0?at:notes[index].created_at,updated_at:at,actor};
        if(index<0)notes.push(note);else notes[index]=note;block.notes=notes;
      }
    }else if(action==='reset'){
      if(command.confirmed!==true||s.status==='running')throw new Error('Coloca em pausa e confirma antes de apagar o registo da sessão.');
      row.session={...normalize(null),revision:s.revision+1,updated_at:at,reset_at:at};return row;
    }else throw new Error('Operação de sessão desconhecida.');
    s.revision++;s.updated_at=at;row.session=s;return row;
  }
  function duplicate(training,{date,time,identity}){
    if(!/^\d{4}-\d{2}-\d{2}$/.test(date||'')||new Date(date+'T12:00:00Z').toISOString().slice(0,10)!==date)throw new Error('Escolhe uma data válida.');
    if(time&&!/^([01]\d|2[0-3]):[0-5]\d$/.test(time))throw new Error('Hora inválida.');
    if(!identity)throw new Error('Identificador da cópia em falta.');
    // Allowlist: never copy local/remote IDs, attendance, timing, review or upload state.
    return {team_id:training.team_id,source_training_ref:training.sync_id||null,data:date,hora:time||training.hora||null,local:training.local||null,escalao:training.escalao||null,objetivo:training.objetivo||'',notas:training.notas||null,source_match_ref:training.source_match_ref||null,status:'draft',external_key:'training-copy-'+identity,blocos:(training.blocos||[]).map((b,i)=>({...copy(b),order:i,block_id:identity+'-'+i})),review:{status:'pending'}};
  }
  function format(ms){const sec=Math.floor(Math.max(0,Number(ms)||0)/1000);return String(Math.floor(sec/60)).padStart(2,'0')+':'+String(sec%60).padStart(2,'0');}
  const api={schema:SCHEMA,attendance:ATTENDANCE,states:STATES,normalize,roster,elapsed,summary,apply,duplicate,format};
  root.VisionTrainingSession=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(globalThis);
