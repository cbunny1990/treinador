"use strict";
// Coach-authored reports for every athlete in a match callup.
(function(root){
 const SCHEMA='vision-match-player-reports@1',UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,copy=x=>JSON.parse(JSON.stringify(x)),trim=(x,n)=>String(x??'').trim().slice(0,n);
 function state(match){const value=match?.post_game?.player_reports;if(value?.schema&&value.schema!==SCHEMA)throw new Error('Atualiza a app antes de editar os relatórios dos atletas.');const s={schema:SCHEMA,revision:0,items:[],...(value?copy(value):{})};if(!Number.isInteger(s.revision)||s.revision<0||!Array.isArray(s.items))throw new Error('Relatórios dos atletas inválidos.');return s;}
 function called(match){return [...new Set((match?.callup?.player_ids||[]).map(String))];}
 function entry(match,ref){return state(match).items.find(x=>x.player_ref===String(ref))||null;}
 function pending(match){const s=state(match);return called(match).filter(ref=>!s.items.some(x=>x.player_ref===ref&&['reported','not_observed'].includes(x.status)));}
 function apply(match,command,{now}={}){const row=copy(match),s=state(row),ref=trim(command.player_ref,100),at=new Date(now??Date.now()).toISOString();if(row.estado!=='concluido')throw new Error('Conclui o jogo antes de escrever os relatórios.');if(command.expected_revision!==s.revision)throw new Error('Os relatórios mudaram noutro dispositivo. Atualiza antes de guardar.');if(!UUID.test(ref)||!called(row).includes(ref))throw new Error('O atleta não pertence à convocatória deste jogo.');const i=s.items.findIndex(x=>x.player_ref===ref),old=i<0?null:s.items[i],history=[...(old?.history||[])];if(old&&old.status!=='pending')history.push({status:old.status,observation:old.observation||'',positives:old.positives||'',to_improve:old.to_improve||'',updated_at:old.updated_at||null});let item;
  if(command.type==='save'){const observation=trim(command.observation,5000),positives=trim(command.positives,3000),toImprove=trim(command.to_improve,3000);if(!observation&&!positives&&!toImprove)throw new Error('Escreve pelo menos uma observação antes de guardar.');item={player_ref:ref,status:'reported',observation,positives,to_improve:toImprove,updated_at:at,history};}
  else if(command.type==='not_observed'){if(command.confirmed!==true)throw new Error('Confirma que não observaste este atleta.');item={player_ref:ref,status:'not_observed',observation:'',positives:'',to_improve:'',updated_at:at,history};}
  else if(command.type==='clear'){if(command.confirmed!==true||!old||old.status==='pending')throw new Error('Confirma a limpeza do relatório existente.');item={player_ref:ref,status:'pending',observation:'',positives:'',to_improve:'',updated_at:at,history};}
  else throw new Error('Operação de relatório desconhecida.');
  if(i<0)s.items.push(item);else s.items[i]=item;s.revision++;s.updated_at=at;row.post_game={...(row.post_game||{}),player_reports:s};return row;
 }
 root.VisionMatchPlayerReports={schema:SCHEMA,state,called,entry,pending,apply};if(typeof module!=='undefined'&&module.exports)module.exports=root.VisionMatchPlayerReports;
})(globalThis);
