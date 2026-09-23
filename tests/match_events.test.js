const test=require('node:test'),assert=require('node:assert/strict');
const M=require('../js/match_visual.js'),E=require('../js/match_events.js');
const refs=Array.from({length:7},(_,i)=>'00000000-0000-4000-8000-'+String(i+1).padStart(12,'0'));
const roster=()=>refs.map((sync_id,i)=>({sync_id,nome:'Atleta '+(i+1),numero:i+1,plantel_ativo:true,estado_disponibilidade:'disponivel'}));
const plan=()=>({id:4,sync_id:'00000000-0000-4000-8000-999999999999',estado:'agendado',golos_favor:null,callup:{player_ids:refs},lineup:{system:'1-2-1',goalkeeper_id:refs[0],starters:refs.slice(1,5),substitutes:refs.slice(5)}});
const act=(r,type,now=0,args={},opts={})=>M.apply(r,{type,expected_revision:M.state(r).revision,...args},{now,controller_id:'phone',players:roster(),...opts});
const evt=(r,type,now=1200000,args={},opts={})=>E.apply(r,{type,expected_revision:E.state(r).revision,...args},{now,players:roster(),...opts});
const started=()=>act(plan(),'start',0,{confirmed:true});
const rec=(r,type,at_ms,args={},opts={})=>evt(r,'record',opts.now??1200000,{id:args.id||crypto.randomUUID(),event_type:type,at_ms,...args},opts);

test('events require started usage; planned match cannot collect counts',()=>{
 const r=plan();assert.throws(()=>rec(r,'shot_on',60000),/depois de iniciar o cronómetro/);assert.equal(E.stats(r).event_count,0);
});

test('manually entered match result keeps provenance separate from counted event goals',()=>{
 const missing=E.stats(plan());assert.deepEqual(missing.recorded_result,{for:null,against:null,provenance:'desconhecida'});
 const entered=E.stats({...plan(),golos_favor:2,golos_contra:1});assert.deepEqual(entered.recorded_result,{for:2,against:1,provenance:'introduzida_manual'});assert.equal(entered.provenance.result,'introduzida_manual');
 assert.equal(entered.goals.for,0);assert.equal(entered.goals.against,0);
});

test('recording each type stores minute, player, zone, reason and note with provenance',()=>{
 let r=started();
 r=rec(r,'goal_for',60000,{player_ref:refs[4],zone:'ata_c'});
 r=rec(r,'goal_against',300000,{zone:'def_c'});
 r=rec(r,'loss',480000,{player_ref:refs[1],zone:'def_e',reason:'pass',note:'Passe errado na saída'});
 r=rec(r,'recovery',500000,{player_ref:refs[2],zone:'med_c'});
 r=rec(r,'shot_on',540000,{player_ref:refs[4],zone:'ata_c',side:'propia'});
 r=rec(r,'shot_off',600000,{side:'adversaria'});
 r=rec(r,'corner_for',660000);r=rec(r,'corner_against',700000);
 r=rec(r,'through_ball',720000,{player_ref:refs[4]});r=rec(r,'striker_foot',740000,{player_ref:refs[4]});
 r=rec(r,'note',760000,{note:'Desta vez os alas fecharam bem',side:'propia'});
 const t=E.stats(r);
 assert.equal(t.event_count,11);assert.equal(t.goals.for,1);assert.equal(t.goals.against,1);
 assert.equal(t.shots.own_on,1);assert.equal(t.shots.against_off,1);assert.equal(t.counts.corner_for,1);
 assert.equal(t.losses.by_reason['pass'],1);assert.equal(t.losses.by_zone['def_e'],1);
 assert.equal(t.recoveries.by_zone['med_c'],1);assert.equal(t.through_balls,1);assert.equal(t.striker_foots,1);
 assert.equal(t.origin,'Contada nos lances registados');
 assert.throws(()=>rec(r,'loss',800000,{reason:'duel',side:'adversaria'}),/Lado não se aplica/);
});

test('field coordinates use the same nine zones as match events',()=>{
 assert.equal(E.zoneFromPoint(.1,.1),'ata_e');
 assert.equal(E.zoneFromPoint(.5,.1),'ata_c');
 assert.equal(E.zoneFromPoint(.9,.1),'ata_d');
 assert.equal(E.zoneFromPoint(.1,.5),'med_e');
 assert.equal(E.zoneFromPoint(.5,.5),'med_c');
 assert.equal(E.zoneFromPoint(.9,.5),'med_d');
 assert.equal(E.zoneFromPoint(.1,.9),'def_e');
 assert.equal(E.zoneFromPoint(.5,.9),'def_c');
 assert.equal(E.zoneFromPoint(.9,.9),'def_d');
 assert.throws(()=>E.zoneFromPoint(-.1,.5),/Coordenada/);
});

test('losses without reason count as sem motivo; unknown reason rejected',()=>{
 let r=rec(started(),'loss',60000,{});assert.equal(E.stats(r).losses.total,1);assert.equal(E.stats(r).losses.by_reason.none,1);assert.deepEqual(E.stats(r).losses.by_zone,{});
 assert.throws(()=>rec(r,'loss',60000,{id:crypto.randomUUID(),reason:'xxx'}),/Motivo/);
});

test('events cannot be recorded in the future of the running clock',()=>{
 const r=started();assert.throws(()=>rec(r,'goal_for',90000,{},{now:0}),/futuro do cronómetro/);
});

test('wrong team and malformed ids are rejected',()=>{
 const r=started();
 assert.throws(()=>rec(r,'goal_for',60000,{player_ref:'00000000-0000-4000-8000-999999999999'}),/não pertence a esta equipa/);
 assert.throws(()=>rec(r,'goal_for',60000,{player_ref:'5'}),/identificador estável/);
 assert.throws(()=>rec(r,'goal_for',60000,{id:''}),/em falta/);
 assert.throws(()=>rec(r,'goal_for',60000,{zone:'barra'}),/Zona/);
});

test('duplicate event ids are rejected and edits keep identity',()=>{
 const r=rec(started(),'shot_on',60000,{id:'x',player_ref:refs[1]});
 assert.throws(()=>rec(r,'shot_on',60000,{id:'x'}),/repetido/);
 const paused=act(r,'pause',120000);
 const edited=evt(paused,'edit',120000,{id:'x',player_ref:refs[2]});
 assert.equal(edited.match_events.events[0].player_ref,refs[2]);assert.equal(edited.match_events.events[0].type,'shot_on');
 assert.throws(()=>evt(edited,'edit',120000,{id:'missing'}),/inexistente/);
});

test('edit and delete need pause or completion, like movement corrections',()=>{
 let r=rec(started(),'shot_on',60000,{id:'x'});
 assert.throws(()=>evt(r,'edit',0,{id:'x',note:'n'}),/Pausa ou termina/);
 assert.throws(()=>evt(r,'delete',0,{id:'x',confirmed:true}),/Pausa ou termina/);
 r=act(r,'pause',120000);
 const edited=evt(r,'edit',0,{id:'x',note:'n'});assert.equal(edited.match_events.events[0].note,'n');
 assert.throws(()=>evt(edited,'delete',0,{id:'x'}),/confirmação/);
 const out=evt(edited,'delete',0,{id:'x',confirmed:true});
 assert.equal(out.match_events.events.length,0);assert.equal(out.match_events.revision,3);
});

test('possession provenance: unknown, measured and estimated stay distinct',()=>{
 let r=started();
 assert.throws(()=>evt(r,'save_possession',0,{kind:'measured'}),/percentagem/);
 assert.throws(()=>evt(r,'save_possession',0,{kind:'medida',value:50}),/medida, estimada ou desconhecida/);
 assert.throws(()=>evt(r,'save_possession',0,{kind:'measured',value:101}),/0 e 100/);
 r=evt(r,'save_possession',0,{kind:'measured',value:55,confirmed:true});
 assert.equal(E.state(r).possession.kind,'measured');assert.equal(E.stats(r).possession.value,55);
 assert.throws(()=>evt(r,'save_possession',0,{kind:'estimated',value:60}),/confirmação/);
 r=evt(r,'save_possession',0,{kind:'estimated',value:60,confirmed:true});
 assert.equal(E.state(r).possession.kind,'estimated');
 r=evt(r,'save_possession',0,{kind:'unknown',confirmed:true});
 assert.deepEqual(E.state(r).possession,{kind:'unknown',value:null,updated_at:E.state(r).possession.updated_at});
});

test('stale revision refused instead of silently overwriting recorded events',()=>{
 const r=rec(started(),'shot_on',60000,{id:'x'});
 assert.throws(()=>E.apply(r,{type:'record',expected_revision:0,event_type:'shot_on',at_ms:60000,id:'y'}),/mudaram/);
});

test('events survive usage reset as history but stop collecting until a new start',()=>{
 let r=started();r=rec(r,'goal_for',60000,{});r=act(r,'pause',120000);
 const out=act(r,'reset_recording',120000,{confirmed:true});
 assert.equal(E.state(out).events.length,1);assert.throws(()=>evt(out,'record',0,{event_type:'shot_on',at_ms:60000,id:'z'}),/depois de iniciar o cronómetro/);
});

test('events round trip through remote payload without browser ids',()=>{
 const {remotePayload}=require('../js/remote_workspace.js');
 let r=rec(started(),'loss',60000,{id:'rt',player_ref:refs[1],zone:'def_c',reason:'pass'});
 const payload=remotePayload({...r,sync_dirty:true,remote_updated_at:'before'});
 const other={...payload,id:987,sync_id:r.sync_id,team_id:'default'};
 assert.deepEqual(E.state(other).events,E.state(r).events);assert.deepEqual(E.stats(other).losses.by_reason,E.stats(r).losses.by_reason);
});
test('side is only attached when the coach chooses between teams for shots or a free note',()=>{
 const r=started();
 const goal=rec(r,'goal_for',60000,{});
 assert.equal(Object.hasOwn(E.state(goal).events[0],'side'),false);
 const unknown=rec(goal,'shot_on',120000,{});
 assert.equal(E.stats(unknown).shots.unknown_side_on,1);assert.equal(E.stats(unknown).shots.own_on,0);
 const shot=rec(unknown,'shot_on',180000,{side:'propia'});
 assert.equal(E.state(shot).events.at(-1).side,'propia');assert.equal(E.stats(shot).shots.own_on,1);
});

test('minutes with decimals map to the clock and stay inside the accepted range',()=>{
 const r=rec(started(),'shot_on',60500,{id:'a'});assert.equal(E.state(r).events[0].at_ms,60500);
 const finished=act(started(),'finish',1200000,{confirmed:true});
 assert.throws(()=>evt(finished,'record',1200001,{event_type:'shot_on',at_ms:241*60000,id:'b'}),/intervalo/);
});
