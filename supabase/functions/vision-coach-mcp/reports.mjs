// Structured, read-only match reports built from the same persisted match record as the PWA.
import '../../../js/match_visual.js';
import '../../../js/match_events.js';
import '../../../js/match_analysis.js';
import '../../../js/match_evidence.js';
import '../../../js/training_session.js';
import '../../../js/player_goals.js';
import '../../../js/seasons.js';
import { executePlayerGoalTool } from './player_goals.mjs';

const M=globalThis.VisionMatchVisual,E=globalThis.VisionMatchEvents,A=globalThis.VisionMatchAnalysis,V=globalThis.VisionMatchEvidence;
const T=globalThis.VisionTrainingSession;
const G=globalThis.PlayerGoals,S=globalThis.VisionSeasons;
const LOCAL_WORKSPACE_KEY='default';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const selector={id:{type:'string',format:'uuid'},external_key:{type:'string'}};
const choose={oneOf:[{required:['id'],not:{required:['external_key']}},{required:['external_key'],not:{required:['id']}}]};

export const REPORT_TOOLS=[{
 name:'get_match_report',
 description:'Prepare current structured match-sheet and post-match report data from one persisted match. Includes kickoff availability snapshot when recorded, plus recorded events, usage, analysis and video evidence, with provenance; read-only and scoped to the authorized team.',
 inputSchema:{type:'object',properties:{...selector,report_type:{type:'string',enum:['match_sheet','post_match'],default:'post_match'}},required:['report_type'],additionalProperties:false,...choose},
 annotations:{readOnlyHint:true,destructiveHint:false}
},{
 name:'get_training_report',
 description:'Prepare current structured training-plan report data from one persisted training. Includes planned sequence, exercise setup and steps, approved original image identity, explicitly marked attendance and recorded execution. Read-only and scoped to the authorized team.',
 inputSchema:{type:'object',properties:selector,required:[],additionalProperties:false,...choose},
 annotations:{readOnlyHint:true,destructiveHint:false}
},{
 name:'get_player_report',
 description:'Prepare a structured longitudinal report for one athlete from explicit attendance, match call-ups, starts, recorded movements, minutes, positions, UUID-attributed goal_for events and coach-entered development goals. Unknown participation remains null; read-only and scoped to the authorized team.',
 inputSchema:{type:'object',properties:{...selector,from_date:{type:'string',format:'date'},to_date:{type:'string',format:'date'},season_id:{type:'string',format:'uuid'}},required:[],additionalProperties:false,...choose},
 annotations:{readOnlyHint:true,destructiveHint:false}
},{
 name:'get_team_report',
 description:'Prepare a structured team participation and development report for a date period or saved season. Counts only explicit attendance and recorded game usage, includes coach-entered development goals, and does not rank athletes or infer improvement.',
 inputSchema:{type:'object',properties:{from_date:{type:'string',format:'date'},to_date:{type:'string',format:'date'},season_id:{type:'string',format:'uuid'}},required:[],additionalProperties:false},
 annotations:{readOnlyHint:true,destructiveHint:false}
}];

function validDate(value){return value==null||/^\d{4}-\d{2}-\d{2}$/.test(value);}
function dateFilter(args,season){if(!validDate(args.from_date)||!validDate(args.to_date))throw new Error('invalid_report_date');if(args.from_date&&args.to_date&&args.from_date>args.to_date)throw new Error('invalid_report_period');const from=args.from_date||season?.start_date||null,to=args.to_date||season?.end_date||null;return d=>(!from||d>=from)&&(!to||d<=to);}
async function seasonFilter(admin,c,args){if(!args.season_id)return null;if(!UUID.test(args.season_id))throw new Error('invalid_season_uuid');const key='season-index:'+LOCAL_WORKSPACE_KEY,{data,error}=await admin.from('workspace_records').select('id,payload').eq('team_id',c.team_id).eq('kind','document').eq('payload->>external_key',key).is('deleted_at',null);if(error)throw error;if(data?.length!==1)throw new Error(data?.length?'ambiguous_season_index':'season_index_not_found');const index=S.state({body:data[0].payload?.body}),season=index.items.find(x=>x.id===args.season_id);if(!season)throw new Error('season_not_found');return season;}
function filteredHistory(history,include){const training_records=history.training_records.filter(x=>include(x.date||'')),match_records=history.match_records.filter(x=>include(x.date||'')),known=match_records.filter(x=>x.minutes_known);return{...history,summary:{training_records:training_records.length,call_ups:match_records.filter(x=>x.called_up).length,recorded_starts:match_records.filter(x=>x.started_as_starter).length,entries:match_records.reduce((n,x)=>n+x.entries.length,0),exits:match_records.reduce((n,x)=>n+x.exits.length,0),matches_with_recorded_minutes:known.length,matches_without_recorded_minutes:match_records.length-known.length,total_minutes_ms:known.length?known.reduce((n,x)=>n+x.minutes_ms,0):null},training_records,match_records};}
async function attributedGoalsFor(admin,c,playerId,include){const{data,error}=await admin.from('workspace_records').select('id,payload').eq('team_id',c.team_id).eq('kind','match').is('deleted_at',null);if(error)throw error;let knownGoals=0,withEvents=0,empty=0,concludedMissing=0,notConcludedMissing=0;const matches=(data||[]).filter(row=>include(row.payload?.data||'')).sort((a,b)=>String(a.payload?.data||'').localeCompare(String(b.payload?.data||''))||String(a.id).localeCompare(String(b.id))).map(row=>{const payload=row.payload||{},eventsSaved=Array.isArray(payload.match_events?.events),concluded=payload.estado==='concluido';if(!eventsSaved){if(concluded)concludedMissing++;else notConcludedMissing++;return{match_ref:row.id,date:payload.data||null,opponent:payload.adversario||null,attributed_goal_for:null,events_status:concluded?'missing_concluded':'not_recorded_yet'};}const events=E.state(payload).events;withEvents++;if(events.length===0)empty++;const count=events.filter(event=>event.type==='goal_for'&&event.player_ref===playerId).length;knownGoals+=count;return{match_ref:row.id,date:payload.data||null,opponent:payload.adversario||null,attributed_goal_for:count,events_status:events.length===0?'recorded_empty':'recorded'};});return{summary:{matches_with_event_lists:withEvents,matches_with_empty_event_lists:empty,concluded_matches_missing_events:concludedMissing,non_concluded_matches_without_events:notConcludedMissing,total_attributed_goals:concludedMissing?null:knownGoals,known_attributed_goals:knownGoals},match_records:matches};}
async function archivedPlayer(admin,c,id){if(!UUID.test(id))return null;const externalKey='player-archive:'+LOCAL_WORKSPACE_KEY+':'+id,{data,error}=await admin.from('workspace_records').select('id,payload,updated_at').eq('team_id',c.team_id).eq('kind','document').eq('payload->>external_key',externalKey).is('deleted_at',null);if(error)throw error;if(data?.length>1)throw new Error('ambiguous_player_archive');if(!data?.length)return null;let snapshot;try{snapshot=JSON.parse(data[0].payload?.body||'{}');}catch{throw new Error('invalid_player_archive');}if(snapshot.schema!=='vision-player-archive@1'||snapshot.team_id!==LOCAL_WORKSPACE_KEY||snapshot.player?.ref!==id||!Array.isArray(snapshot.development_goals?.items))throw new Error('invalid_player_archive');return{row:data[0],snapshot};}
async function playerReport(admin,c,args,season,include,providedArchive=null,includeGoalFor=true){let player,archive=providedArchive;try{player=await find(admin,c,args,'player');}catch(error){if(error.message!=='player_not_found'||!args.id)throw error;archive=archive||await archivedPlayer(admin,c,args.id);if(!archive)throw error;player={id:args.id,updated_at:archive.row.updated_at,payload:{external_key:archive.row.payload.external_key||null,nome:archive.snapshot.player.name||null,numero:archive.snapshot.player.number??null,development_goals:archive.snapshot.development_goals}};}if(archive&&archive.snapshot?.player?.ref!==player.id)throw new Error('invalid_player_archive');const archiveReport=archive?await executePlayerGoalTool(admin,c,'get_archived_player_development',{player_ref:player.id}):null,history=archive?archiveReport.participation_history:await executePlayerGoalTool(admin,c,'get_player_participation_history',{id:player.id});const goalState=G.state(player.payload);const allowed=season?new Set(season.roster.map(x=>x.ref)):null;if(allowed&&!allowed.has(player.id))throw new Error('player_not_in_selected_season');const filtered=filteredHistory(history,include),goals=(archive?archiveReport.goals:goalState.items).filter(x=>include(x.started_at||'')),unknownMinutes=filtered.match_records.filter(x=>!x.minutes_known).length,goalFor=includeGoalFor?await attributedGoalsFor(admin,c,player.id,include):null;return{schema:'vision-player-report@1',player:{id:player.id,external_key:player.payload?.external_key||null,updated_at:player.updated_at,name:player.payload?.nome||null,number:player.payload?.numero??null,archived:Boolean(archive),archive_updated_at:archive?.row?.updated_at||null},period:{from:args.from_date||season?.start_date||null,to:args.to_date||season?.end_date||null,season:season?{id:season.id,name:season.name}:null},development_goals:{revision:archiveReport?.revision??goalState.revision,items:goals},participation:filtered,goal_for:goalFor,provenance:{identity:archive?'Coach-approved archived identity snapshot; participation remains in original training and match records.':'Current player record.',goals:'Coach-entered development goals and status.',goal_for:'Counts saved goal_for events with an exact athlete UUID across all team matches in the selected period, including matches without a recorded call-up. Manual match scores and events assigned to another athlete are excluded.',attendance:'Explicit saved training attendance; missing or unknown entries are not counted.',matches:'Saved call-up, lineup, entries and exits.',minutes:'Recorded match clock and movements only; null means no recorded usage, not zero.',positions:'Saved recorded match roles only.'},missing_data:{training_attendance:filtered.training_records.length===0,match_participation:filtered.match_records.length===0,recorded_minutes:filtered.summary.matches_with_recorded_minutes===0,partial_recorded_minutes:filtered.summary.matches_with_recorded_minutes>0&&unknownMinutes>0,matches_without_recorded_minutes:unknownMinutes,goal_for_events:(goalFor?.summary.concluded_matches_missing_events||0)>0,concluded_matches_missing_goal_events:(goalFor?.summary.concluded_matches_missing_events||0)>0,partial_goal_for_events:(goalFor?.summary.matches_with_event_lists||0)>0&&(goalFor?.summary.concluded_matches_missing_events||0)>0}};}
async function teamReport(admin,c,args,season,include){const [playersResult,docsResult]=await Promise.all([admin.from('workspace_records').select('id,payload,updated_at').eq('team_id',c.team_id).eq('kind','player').is('deleted_at',null),admin.from('workspace_records').select('id,payload,updated_at').eq('team_id',c.team_id).eq('kind','document').is('deleted_at',null).in('payload->>type',['team_goal','weekly_plan','player_archive'])]);if(playersResult.error)throw playersResult.error;if(docsResult.error)throw docsResult.error;const roster=season?season.roster:((playersResult.data||[]).filter(x=>x.payload?.plantel_ativo!==false).map(x=>({ref:x.id,name:x.payload?.nome||null,number:x.payload?.numero??null})));const rows=new Map((playersResult.data||[]).map(x=>[x.id,x])),archives=new Map();for(const doc of docsResult.data||[]){if(doc.payload?.type!=='player_archive')continue;try{const snapshot=JSON.parse(doc.payload.body||'{}');if(snapshot.schema==='vision-player-archive@1'&&snapshot.team_id===LOCAL_WORKSPACE_KEY&&snapshot.player?.ref)archives.set(snapshot.player.ref,{row:doc,snapshot});}catch{}}const athletes=[];for(const entry of roster){const player=rows.get(entry.ref),archive=archives.get(entry.ref);if(!player&&!archive)continue;const report=await playerReport(admin,c,{id:entry.ref,from_date:args.from_date,to_date:args.to_date},null,include,archive||null,false);athletes.push({player:report.player,participation:report.participation.summary,goals:report.development_goals.items});}const goals=(docsResult.data||[]).filter(x=>x.payload?.type==='team_goal').map(x=>({id:x.id,external_key:x.payload.external_key||null,updated_at:x.updated_at,goal:(()=>{try{return JSON.parse(x.payload.body||'{}');}catch{return null;}})()})).filter(x=>include(x.goal?.identified_at||''));const plans=(docsResult.data||[]).filter(x=>x.payload?.type==='weekly_plan').map(x=>({id:x.id,external_key:x.payload.external_key||null,updated_at:x.updated_at,plan:(()=>{try{return JSON.parse(x.payload.body||'{}');}catch{return null;}})()})).filter(x=>include(x.plan?.week_start||''));return{schema:'vision-team-report@1',team_id:c.team_id,period:{from:args.from_date||season?.start_date||null,to:args.to_date||season?.end_date||null,season:season?{id:season.id,name:season.name}:null},athletes,team_development_goals:goals,weekly_plans:plans,provenance:{attendance:'Explicit saved training attendance only.',minutes:'Recorded match clock and movements only; null means no recorded usage, not zero.',goals:'Coach-entered athlete and team development goals; stages and improvement are not inferred.'},missing_data:{athletes:athletes.length===0,team_goals:goals.length===0,weekly_plans:plans.length===0}};}

async function find(admin,c,args,kind){
 if(Boolean(args.id)===Boolean(args.external_key))throw new Error('exactly_one_'+kind+'_identifier_required');
 if(args.id&&!UUID.test(args.id))throw new Error('invalid_'+kind+'_uuid');
 let q=admin.from('workspace_records').select('*').eq('team_id',c.team_id).eq('kind',kind).is('deleted_at',null);
 q=args.id?q.eq('id',args.id):q.eq('payload->>external_key',args.external_key);
 const{data,error}=await q;if(error)throw error;
 if(data?.length!==1)throw new Error(data?.length?'ambiguous_'+kind+'_identity':kind+'_not_found');
 return data[0];
}

async function trainingReport(admin,c,args){
 const row=await find(admin,c,args,'training'),p=row.payload,session=T.normalize(p.session),execution=T.summary(session);
 const blocks=(Array.isArray(p.blocos)?p.blocos:[]).slice().sort((a,b)=>(a.order||0)-(b.order||0));
 const refs=[...new Set(blocks.map(b=>b.exercise_ref).filter(x=>UUID.test(x)))];
 let exercises=[];
 if(refs.length){
  const{data,error}=await admin.from('workspace_records').select('id,payload,updated_at').eq('team_id',c.team_id).eq('kind','exercise').is('deleted_at',null).in('id',refs);
  if(error)throw error;exercises=data||[];
 }
 const exerciseById=new Map(exercises.map(x=>[x.id,x]));
 return{
  schema:'vision-training-report@1',id:row.id,updated_at:row.updated_at,
  training:{date:p.data||null,time:p.hora||null,objective:p.objetivo||null,planned_minutes:p.duracao_min??null,notes:p.notas||null},
  attendance:{provenance:'explicit_training_attendance',entries:session.attendance.map(a=>({player_ref:a.player_ref,name:a.name||null,number:a.number??null,status:a.status,marked_at:a.updated_at||null}))},
  planned_blocks:blocks.map((b,index)=>{const exercise=exerciseById.get(b.exercise_ref),detail=exercise?.payload||{},image=detail.visual_removed?null:detail.visual_image||null;return{order:index+1,exercise_ref:b.exercise_ref||null,exercise_name:detail.nome||b.exercise_name||null,exercise_updated_at:exercise?.updated_at||null,phase:b.phase||null,planned_minutes:b.duration_min??null,notes:b.notes||null,setup:detail.montagem||null,steps:detail.passos||null,approved_image:image?{exercise_ref:exercise.id,sha256:image.sha256||null,width:image.width??null,height:image.height??null,source:image.source||null}:null,exercise_missing:!!b.exercise_ref&&!exercise};}),
  execution:{status:execution.status,marked_attendance:execution.marked,participants_present_or_late:execution.participants,actual_ms:session.started_at?execution.actual_ms:null,blocks:session.started_at?execution.blocks:[]},
  missing_data:{blocks:blocks.length===0,attendance:session.attendance.length===0,execution:!session.started_at}
 };
}

export async function executeReportTool(admin,c,name,args){
 if(!c.scopes?.includes('read'))throw new Error('connector_scope_read_required');
 if(name==='get_player_report'||name==='get_team_report'){const season=await seasonFilter(admin,c,args);if(season){if(args.from_date&&args.from_date<season.start_date||args.to_date&&args.to_date>season.end_date)throw new Error('report_period_outside_season');}const include=dateFilter(args,season);return name==='get_player_report'?playerReport(admin,c,args,season,include):teamReport(admin,c,args,season,include);}
 if(name==='get_training_report')return trainingReport(admin,c,args);
 if(name!=='get_match_report')throw new Error('unknown_report_tool');
 if(!['match_sheet','post_match'].includes(args.report_type))throw new Error('invalid_match_report_type');
 const row=await find(admin,c,args,'match'),p=row.payload,usage=M.replay(p),events=E.state(p).events,stats=E.stats(p),analysis=A.fromMatch(p),evidence=V.state(p);
 const availability=p.availability_snapshot?.schema==='vision-match-availability@1'?{captured_at:p.availability_snapshot.captured_at||null,players:Array.isArray(p.availability_snapshot.players)?p.availability_snapshot.players.filter(x=>x&&UUID.test(x.ref||'')).map(x=>({ref:x.ref,name:x.name||null,number:x.number??null,status:x.status||null})):[]}:null;
 const result={
  schema:'vision-match-report@1',report_type:args.report_type,id:row.id,updated_at:row.updated_at,
  match:{date:p.data||null,time:p.hora||null,venue:p.local||null,opponent:p.adversario||null,state:p.estado||null,
   result:{for:p.golos_favor??null,against:p.golos_contra??null,provenance:p.golos_favor!=null&&p.golos_contra!=null?'introduced_manual':'unknown'},
   callup:p.callup||null,lineup:p.lineup||null,availability_snapshot:availability,notes:p.nota_tatica||p.notas||null},
  registered_events:events,statistics:stats,
  usage:{status:usage.status,period:usage.period,total_ms:usage.total_ms,provenance:'recorded_clock_and_movements',players:usage.players.map(x=>({ref:x.ref,name:x.name||null,number:x.number??null,total_ms:x.elapsed_ms,goalkeeper_ms:x.keeper_ms,entries:x.entries,on_field:x.on_field,positions_played:M.positionsPlayed(p,x.ref).map(role=>M.roles[role])})),movements:usage.events.map(x=>({id:x.id,type:x.type,at_ms:x.at_ms,...(x.out_ref?{out_ref:x.out_ref}:{}),...(x.in_ref?{in_ref:x.in_ref}:{}),...(x.role?{role:x.role}:{}),...(x.role_a?{role_a:x.role_a,role_b:x.role_b}:{}),note:x.note||null}))},
  analysis:{status:analysis.status,fields:analysis.fields,goals_conceded:analysis.goals_conceded,agent_proposal:analysis.agent_proposal||null},
  video_evidence:evidence.moments,
  missing_data:{result:p.golos_favor==null||p.golos_contra==null,events:!stats.events_available,registered_events_empty:stats.events_available&&events.length===0,usage:!p.visual_match?.started_at,availability_snapshot:!availability,analysis:!A.hasCoachContent(analysis.fields,analysis.goals_conceded),video:evidence.moments.length===0}
 };
 if(args.report_type==='match_sheet')delete result.analysis;
 if(args.report_type==='post_match'){
  const opponent=p.post_game?.opponent_observation||p.pre_game||{};
  const hasOpponentData=Boolean(opponent.adversario_sistema||opponent.adversario_estilo||opponent.adversario_notas||(opponent.adversario_pontos_fortes||[]).length||(opponent.adversario_vulnerabilidades||[]).length);
  result.opponent_observation={formation:opponent.adversario_sistema||null,style:opponent.adversario_estilo||null,strengths:opponent.adversario_pontos_fortes||[],vulnerabilities:opponent.adversario_vulnerabilidades||[],notes:opponent.adversario_notas||null,source:p.post_game?.opponent_observation?'post_match':hasOpponentData?'legacy_pre_game':'not_recorded'};
 }
 return result;
}
