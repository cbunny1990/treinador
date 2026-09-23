// Structured, read-only match reports built from the same persisted match record as the PWA.
import '../../../js/match_visual.js';
import '../../../js/match_events.js';
import '../../../js/match_analysis.js';
import '../../../js/match_evidence.js';
import '../../../js/training_session.js';

const M=globalThis.VisionMatchVisual,E=globalThis.VisionMatchEvents,A=globalThis.VisionMatchAnalysis,V=globalThis.VisionMatchEvidence;
const T=globalThis.VisionTrainingSession;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const selector={id:{type:'string',format:'uuid'},external_key:{type:'string'}};
const choose={oneOf:[{required:['id'],not:{required:['external_key']}},{required:['external_key'],not:{required:['id']}}]};

export const REPORT_TOOLS=[{
 name:'get_match_report',
 description:'Prepare current structured match-sheet and post-match report data from one persisted match. Includes only recorded events, usage, analysis and video evidence, with provenance; read-only and scoped to the authorized team.',
 inputSchema:{type:'object',properties:{...selector,report_type:{type:'string',enum:['match_sheet','post_match'],default:'post_match'}},required:['report_type'],additionalProperties:false,...choose},
 annotations:{readOnlyHint:true,destructiveHint:false}
},{
 name:'get_training_report',
 description:'Prepare current structured training-plan report data from one persisted training. Includes planned sequence, exercise setup and steps, approved original image identity, explicitly marked attendance and recorded execution. Read-only and scoped to the authorized team.',
 inputSchema:{type:'object',properties:selector,required:[],additionalProperties:false,...choose},
 annotations:{readOnlyHint:true,destructiveHint:false}
}];

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
 if(name==='get_training_report')return trainingReport(admin,c,args);
 if(name!=='get_match_report')throw new Error('unknown_report_tool');
 if(!['match_sheet','post_match'].includes(args.report_type))throw new Error('invalid_match_report_type');
 const row=await find(admin,c,args,'match'),p=row.payload,usage=M.replay(p),events=E.state(p).events,stats=E.stats(p),analysis=A.fromMatch(p),evidence=V.state(p);
 const result={
  schema:'vision-match-report@1',report_type:args.report_type,id:row.id,updated_at:row.updated_at,
  match:{date:p.data||null,time:p.hora||null,venue:p.local||null,opponent:p.adversario||null,state:p.estado||null,
   result:{for:p.golos_favor??null,against:p.golos_contra??null,provenance:p.golos_favor!=null&&p.golos_contra!=null?'introduced_manual':'unknown'},
   callup:p.callup||null,lineup:p.lineup||null,notes:p.nota_tatica||p.notas||null},
  registered_events:events,statistics:stats,
  usage:{status:usage.status,period:usage.period,total_ms:usage.total_ms,provenance:'recorded_clock_and_movements',players:usage.players.map(x=>({ref:x.ref,name:x.name||null,number:x.number??null,total_ms:x.elapsed_ms,goalkeeper_ms:x.keeper_ms,entries:x.entries,on_field:x.on_field,positions_played:M.positionsPlayed(p,x.ref).map(role=>M.roles[role])}))},
  analysis:{status:analysis.status,fields:analysis.fields,goals_conceded:analysis.goals_conceded,agent_proposal:analysis.agent_proposal||null},
  video_evidence:evidence.moments,
  missing_data:{result:p.golos_favor==null||p.golos_contra==null,events:events.length===0,usage:!p.visual_match?.started_at,analysis:!A.hasCoachContent(analysis.fields,analysis.goals_conceded),video:evidence.moments.length===0}
 };
 if(args.report_type==='match_sheet')delete result.analysis;
 return result;
}
