const test=require('node:test'),assert=require('node:assert/strict');
let api;
test.before(async()=>{api=await import('../supabase/functions/vision-coach-mcp/reports.mjs');});
const c={id:'coach',team_id:'team-a',scopes:['read']};
const MATCH='99999999-9999-4999-8999-999999999999';
const refs=Array.from({length:6},(_,i)=>'00000000-0000-4000-8000-'+String(i+1).padStart(12,'0'));
function fixture(){
 const match={
  id:MATCH,team_id:'team-a',kind:'match',updated_at:'v7',deleted_at:null,
  payload:{
   external_key:'cup-final',data:'2026-09-20',hora:'10:30',local:'Campo A',adversario:'Rivais',estado:'concluido',golos_favor:2,golos_contra:1,
   callup:{player_refs:refs},lineup:{goalkeeper_ref:refs[0]},
   match_events:{schema:'vision-match-events@1',revision:1,possession:{kind:'estimated',value:55},events:[
    {id:'loss-1',type:'loss',at_ms:12000,player_ref:refs[1],zone:'def_c',reason:'pass',note:'Passe intercetado'},
    {id:'goal-1',type:'goal_for',at_ms:44000}
   ]},
   visual_match:{schema:'vision-match-visual@1',revision:3,status:'paused',period:1,elapsed_ms:60000,started_at:'2026-09-20T10:30:00.000Z',active_since:null,
    initial_slots:{gr:refs[0],def:refs[1],left:refs[2],right:refs[3],front:refs[4]},
    roster:refs.map((ref,i)=>({ref,name:'Atleta '+i,number:i+1})),events:[{id:'sub-1',type:'substitute',at_ms:30000,out_ref:refs[1],in_ref:refs[5]}]
   },
   post_game:{analysis:{schema:'vision-match-analysis@1',revision:2,status:'done',
    fields:{summary:'Vitória com boa reação.',observations:'Apoio irregular',interpretation:'A distância pode ter condicionado a saída',hypotheses:'Confirmar em mais jogos',decisions:'Treinar apoios curtos'},
    goals_conceded:{'goal-against-1':'Possível falha de cobertura'}
   }},
   match_evidence:{schema:'vision-match-evidence@1',revision:1,moments:[{id:'clip-1',url:'https://video.example/match?t=4s',seconds:4,category:'goal',description:'Golo marcado',relation_type:'statistic',relation_ref:'goals.for'}]}
  }
 };
 const rows=[match],calls=[];
 const admin={from(table){assert.equal(table,'workspace_records');const filters=[];return{select(){return this},eq(k,v){filters.push([k,v]);return this},is(k,v){filters.push([k,v]);return this},then(resolve){return Promise.resolve({data:rows.filter(r=>filters.every(([k,v])=>k==='payload->>external_key'?r.payload.external_key===v:r[k]===v)).map(x=>structuredClone(x)),error:null}).then(resolve)}}},async rpc(){calls.push('write');throw Error('report lookup must be read-only')}};
 return{match,rows,calls,admin};
}
test('match report MCP is read-only and exposes registered evidence with provenance',async()=>{
 const f=fixture(),tool=api.REPORT_TOOLS[0];
 assert.equal(tool.name,'get_match_report');assert.equal(tool.annotations.readOnlyHint,true);
 const out=await api.executeReportTool(f.admin,c,'get_match_report',{id:MATCH,report_type:'post_match'});
 assert.equal(out.schema,'vision-match-report@1');assert.equal(out.updated_at,'v7');
 assert.deepEqual(out.match.result,{for:2,against:1,provenance:'introduced_manual'});
 assert.equal(out.registered_events.length,2);assert.equal(out.statistics.losses.by_reason.pass,1);
 assert.equal(out.statistics.possession.kind,'estimated');assert.equal(out.statistics.possession.value,55);
 assert.equal(out.usage.provenance,'recorded_clock_and_movements');assert.equal(out.usage.players.find(x=>x.ref===refs[1]).total_ms,30000);assert.equal(out.usage.players.find(x=>x.ref===refs[5]).entries,1);
 assert.equal(out.analysis.fields.observations,'Apoio irregular');assert.equal(out.analysis.fields.hypotheses,'Confirmar em mais jogos');
 assert.equal(out.video_evidence[0].seconds,4);assert.equal(out.missing_data.events,false);assert.equal(f.calls.length,0);
});
test('match-sheet report excludes post-match analysis but keeps missing data explicit',async()=>{
 const f=fixture();f.match.payload.match_events.events=[];f.match.payload.golos_favor=null;f.match.payload.golos_contra=null;f.match.payload.visual_match={schema:'vision-match-visual@1',revision:0,status:'not_started',period:1,elapsed_ms:0,roster:[],events:[]};
 const out=await api.executeReportTool(f.admin,c,'get_match_report',{external_key:'cup-final',report_type:'match_sheet'});
 assert.equal(Object.hasOwn(out,'analysis'),false);assert.equal(out.missing_data.result,true);assert.equal(out.missing_data.events,true);assert.equal(out.missing_data.usage,true);
});
test('report MCP enforces scope, team isolation and one exact match identity',async()=>{
 const f=fixture();
 await assert.rejects(api.executeReportTool(f.admin,{...c,scopes:[]},'get_match_report',{id:MATCH,report_type:'post_match'}),/scope_read/);
 await assert.rejects(api.executeReportTool(f.admin,c,'get_match_report',{id:'local-1',report_type:'post_match'}),/invalid_match_uuid/);
 await assert.rejects(api.executeReportTool(f.admin,c,'get_match_report',{id:MATCH,external_key:'cup-final',report_type:'post_match'}),/exactly_one/);
 await assert.rejects(api.executeReportTool(f.admin,{...c,team_id:'team-b'},'get_match_report',{id:MATCH,report_type:'post_match'}),/match_not_found/);
 await assert.rejects(api.executeReportTool(f.admin,c,'get_match_report',{id:MATCH,report_type:'training'}),/invalid_match_report_type/);
 assert.equal(f.calls.length,0);
});
