const test=require('node:test'),assert=require('node:assert/strict');let api,visual;
// Relógio simulado, sempre no mesmo processo deste ficheiro.
let nowMs=Date.parse('2026-09-26T15:00:00Z');
test.before(async()=>{
 api=await import('../supabase/functions/vision-coach-mcp/match_events.mjs');
 visual=await import('../supabase/functions/vision-coach-mcp/match_visual.mjs');
 Date.now=()=>nowMs;
 globalThis.__tickMatchEvents=ms=>{nowMs+=ms;return nowMs;};
});
const c={id:'connector',team_id:'team',scopes:['read','write']};
const MATCH='99999999-9999-4999-8999-999999999999';
const refs=Array.from({length:7},(_,i)=>'00000000-0000-4000-8000-'+String(i+1).padStart(12,'0'));
function fixture(){const match={id:MATCH,team_id:'team',kind:'match',updated_at:'v0',deleted_at:null,payload:{estado:'agendado',adversario:'Teste',callup:{player_ids:refs},lineup:{goalkeeper_id:refs[0],starters:refs.slice(1,5)}}};
 const rows=[match,...refs.map((id,i)=>({id,team_id:'team',kind:'player',deleted_at:null,payload:{nome:'Atleta '+i,numero:i+1,estado_disponibilidade:'disponivel',foto:'private-photo-not-to-expose'}}))],calls=[];
 const admin={from(){const filters=[];return {select(){return this;},eq(k,v){filters.push(r=>(k==='payload->>external_key'?r.payload.external_key:r[k])===v);return this;},is(k,v){return this.eq(k,v);},then(resolve){return Promise.resolve({data:rows.filter(r=>filters.every(f=>f(r))).map(r=>structuredClone(r))}).then(resolve);}}},async rpc(name,args){assert.equal(name,'head_coach_put_record');assert.equal(args.p_kind,'match');assert.equal(args.p_team_id,'team');assert.equal(args.p_record_id,MATCH);calls.push(args);match.payload=structuredClone(args.p_payload);match.updated_at='v'+calls.length;return {data:{ok:true}};}};
 const call=(name,args={})=>api.executeMatchEventsTool(admin,c,name,{id:MATCH,expected_updated_at:match.updated_at,expected_revision:match.payload.match_events?.revision||0,...args});
 const startUsage=async()=>visual.executeMatchVisualTool(admin,c,'control_match_usage',{id:MATCH,expected_updated_at:match.updated_at,expected_revision:match.payload.visual_match?.revision||0,action:'start',confirmed:true});
 const advance=ms=>{nowMs+=ms;return nowMs;};
 return {match,rows,calls,admin,call,startUsage,advance};
}
test('five tools, read-only get, absent events stay unknown',async()=>{const f=fixture(),out=await f.call('get_match_events');assert.equal(api.MATCH_EVENTS_TOOLS.length,5);assert.equal(out.events.length,0);assert.equal(out.statistics.events_available,false);assert.equal(out.statistics.event_count,null);assert.equal(f.calls.length,0);});
test('explicit empty event list returns counted zeros',async()=>{const f=fixture();f.match.payload.match_events={schema:'vision-match-events@1',revision:0,events:[],possession:{kind:'unknown',value:null,updated_at:null}};const out=await f.call('get_match_events');assert.equal(out.statistics.events_available,true);assert.equal(out.statistics.event_count,0);assert.equal(out.statistics.counts.goal_for,0);});
test('scopes, exact identity and stale revision enforced',async()=>{
 const f=fixture();
 await assert.rejects(api.executeMatchEventsTool(f.admin,{...c,scopes:['read']},'record_match_event',{id:MATCH,event_type:'shot_on',event_id:'a',confirmed:true}),/scope_write/);
 await assert.rejects(f.call('get_match_events',{external_key:'x'}),/exactly_one/);
 await assert.rejects(f.call('get_match_events',{id:'99999999-9999-4999-8999-999999999998'}),/not_found/);
 await assert.rejects(f.call('get_match_events',{id:'local-17'}),/invalid_match_uuid/);
 assert.equal(api.MATCH_EVENTS_TOOLS[0].inputSchema.properties.id.format,'uuid');
 await f.startUsage();await f.advance(600000);
 await f.call('record_match_event',{event_type:'shot_on',event_id:'a',minute:5,confirmed:true});
 await assert.rejects(f.call('record_match_event',{event_type:'shot_on',event_id:'b',minute:6,confirmed:true,expected_updated_at:'old'}),/conflict/);
 await assert.rejects(f.call('record_match_event',{event_type:'shot_on',event_id:'c',minute:7,confirmed:true,expected_revision:0}),/domain_revision_conflict/);
});
test('record with explicit coach report stores details and minute',async()=>{
 const f=fixture();await f.startUsage();await f.advance(600000);
 await assert.rejects(f.call('record_match_event',{event_type:'shot_on',event_id:'unconfirmed'}),/explicit_confirmation_required/);
 const out=await f.call('record_match_event',{event_type:'loss',event_id:'l1',player_ref:refs[1],opponent_player_name:'Adversário 9',zone:'def_c',reason:'pass',note:'Saída de bola',minute:7,confirmed:true});
 assert.equal(out.events[0].at_ms,420000);assert.equal(out.statistics.losses.by_reason['pass'],1);
 assert.equal(out.events[0].opponent_player_name,'Adversário 9');
 const write=f.calls.find(x=>x.p_idempotency_key.startsWith('match-events:'));assert.ok(write);
 await assert.rejects(f.call('record_match_event',{event_type:'xxx',event_id:'l2',confirmed:true}),/invalid_event_type/);
});
test('goals and corners use their event type for team side, never an incompatible side field',async()=>{
 const f=fixture();await f.startUsage();await f.advance(600000);
 const goal=await f.call('record_match_event',{event_type:'goal_for',event_id:'g1',minute:4,confirmed:true});
 assert.equal(goal.statistics.goals.for,1);
 const corner=await f.call('record_match_event',{event_type:'corner_against',event_id:'c1',minute:5,confirmed:true});
 assert.equal(corner.statistics.counts.corner_against,1);
});
test('update and delete require pause or completion plus confirmation',async()=>{
 const f=fixture();await f.startUsage();await f.advance(600000);
 await f.call('record_match_event',{event_type:'shot_on',event_id:'a',minute:5,confirmed:true});
 await visual.executeMatchVisualTool(f.admin,c,'control_match_usage',{id:MATCH,expected_updated_at:f.match.updated_at,expected_revision:f.match.payload.visual_match?.revision||0,action:'pause',confirmed:true});
 const out=await f.call('update_match_event',{event_id:'a',minute:6,confirmed:true});
 assert.equal(out.events[0].at_ms,360000);
 await assert.rejects(f.call('delete_match_event',{event_id:'a'}),/explicit_confirmation_required/);
 const after=await f.call('delete_match_event',{event_id:'a',confirmed:true});
 assert.equal(after.events.length,0);
});
test('possession provenance is explicit; estimates never called measured',async()=>{
 const f=fixture();
 await assert.rejects(f.call('save_match_possession',{kind:'measured',confirmed:true}),/percentagem/);
 await assert.rejects(f.call('save_match_possession',{kind:'unknown'}),/explicit_confirmation_required/);
 const out=await f.call('save_match_possession',{kind:'estimated',value:60,confirmed:true});
 assert.equal(out.possession.kind,'estimated');assert.equal(out.statistics.provenance.possession.estimated,'estimada');
});
test('events cannot be recorded before the coach starts the game',async()=>{
 const f=fixture();
 await assert.rejects(f.call('record_match_event',{event_type:'goal_for',event_id:'g',minute:5,confirmed:true}),/depois de iniciar o cronómetro/);
 assert.equal(f.calls.length,0);
});
