const test=require('node:test'),assert=require('node:assert/strict');
let api;
test.before(async()=>{api=await import('../supabase/functions/vision-coach-mcp/reports.mjs');});
const TEAM='team-a',PLAYER='11111111-1111-4111-8111-111111111111',SEASON='22222222-2222-4222-8222-222222222222',MATCH='33333333-3333-4333-8333-333333333333',TRAINING='44444444-4444-4444-8444-444444444444',GOAL='55555555-5555-4555-8555-555555555555';
const archive={schema:'vision-player-archive@1',team_id:'default',team_name:'Equipa A',player:{ref:PLAYER,name:'Atleta removido',number:9,age_group:'Sub-8'},development_goals:{schema:'vision-player-goals@1',revision:1,items:[{id:GOAL,title:'Apoiar após passe',started_at:'2026-09-02',status:'active',notes:'Objetivo desportivo',evidence_refs:[],exercise_refs:[],history:[]}]},archived_at:'2026-09-22T10:00:00.000Z'};
const seasonIndex={schema:'vision-seasons@1',revision:1,active_id:SEASON,items:[{id:SEASON,name:'2026/27',start_date:'2026-08-01',end_date:'2027-07-31',roster:[{ref:PLAYER,name:'Atleta removido',number:9}]}]};
function fixture(){const rows=[
 {id:'66666666-6666-4666-8666-666666666666',team_id:TEAM,kind:'document',updated_at:'archive-v2',deleted_at:null,payload:{type:'player_archive',external_key:'player-archive:default:'+PLAYER,body:JSON.stringify(archive)}},
 {id:'77777777-7777-4777-8777-777777777777',team_id:TEAM,kind:'document',updated_at:'season-v1',deleted_at:null,payload:{type:'season_index',external_key:'season-index:default',body:JSON.stringify(seasonIndex)}},
 {id:MATCH,team_id:TEAM,kind:'match',updated_at:'match-v1',deleted_at:null,payload:{data:'2026-09-10',adversario:'Rivais',callup:{player_ids:[PLAYER]},visual_match:{schema:'vision-match-visual@1',revision:0,status:'not_started',period:1,elapsed_ms:0,roster:[],events:[]}}},
 {id:TRAINING,team_id:TEAM,kind:'training',updated_at:'training-v1',deleted_at:null,payload:{data:'2026-09-05',objetivo:'Passe e apoio',session:{attendance:[{player_ref:PLAYER,status:'present'}]}}}
 ];let writes=0;const admin={from(table){assert.equal(table,'workspace_records');const filters=[],inFilters=[],containsFilters=[],ranges=[];const q={select(){return this},eq(k,v){filters.push([k,v]);return this},is(k,v){filters.push([k,v]);return this},in(k,v){inFilters.push([k,v]);return this},contains(k,v){containsFilters.push([k,v]);return this},order(){return this},range(a,b){ranges.push([a,b]);return this},then(resolve){let data=rows.filter(row=>filters.every(([k,v])=>{if(k==='payload->>external_key')return row.payload?.external_key===v;if(k.startsWith('payload->>'))return row.payload?.[k.slice('payload->>'.length)]===v;if(k==='payload->source->>type')return row.payload?.source?.type===v;return row[k]===v;})&&inFilters.every(([k,v])=>v.includes(k==='payload->>type'?row.payload?.type:row[k]))&&containsFilters.every(([k,v])=>(row.payload?.[k.slice('payload->'.length)]||[]).some(x=>(v.subject_refs||[]).some(y=>x.type===y.type&&x.id===y.id))));if(ranges.length)data=data.slice(ranges[0][0],ranges[0][1]+1);return Promise.resolve({data:structuredClone(data),error:null}).then(resolve)}};return q;},async rpc(){writes++;throw Error('report operation must be read-only')}};return{admin,rows,get writes(){return writes;}};}
const coach={team_id:TEAM,id:'coach-a',scopes:['read']};

test('player report uses the exact team-scoped archive and original participation records after permanent removal',async()=>{
 const f=fixture(),out=await api.executeReportTool(f.admin,coach,'get_player_report',{id:PLAYER,season_id:SEASON});
 assert.equal(out.player.archived,true);assert.equal(out.player.name,'Atleta removido');assert.equal(out.player.archive_updated_at,'archive-v2');assert.equal(out.period.season.name,'2026/27');
 assert.equal(out.participation.summary.training_records,1);assert.equal(out.participation.training_records[0].attendance,'present');assert.equal(out.participation.summary.call_ups,1);assert.equal(out.participation.match_records[0].minutes_ms,null);assert.equal(out.participation.match_records[0].minutes_known,false);
 assert.equal(out.development_goals.items[0].id,GOAL);assert.match(out.provenance.identity,/archived identity snapshot/);assert.equal(f.writes,0);
});

test('season team report retains an archived roster member and its evidence without restoring a player row',async()=>{
 const f=fixture(),out=await api.executeReportTool(f.admin,coach,'get_team_report',{season_id:SEASON});
 assert.equal(out.athletes.length,1);assert.equal(out.athletes[0].player.id,PLAYER);assert.equal(out.athletes[0].player.archived,true);assert.equal(out.athletes[0].participation.training_records,1);assert.equal(out.athletes[0].participation.matches_without_recorded_minutes,1);assert.equal(out.athletes[0].goals[0].title,'Apoiar após passe');assert.equal(f.rows.filter(x=>x.kind==='player').length,0);assert.equal(f.writes,0);
});

test('archived player reports reject another team context',async()=>{
 const f=fixture();await assert.rejects(api.executeReportTool(f.admin,{...coach,team_id:'team-b'},'get_player_report',{id:PLAYER}),/player_not_found/);assert.equal(f.writes,0);
});
