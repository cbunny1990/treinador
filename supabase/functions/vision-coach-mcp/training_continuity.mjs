// Evidence and approval use the same pure model as the PWA; multi-record writes use one RPC transaction.
import '../../../js/training_continuity.js';
const C=globalThis.VisionTrainingContinuity;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const idProps={id:{type:'string',format:'uuid'},external_key:{type:'string'}};
const select={oneOf:[{required:['id'],not:{required:['external_key']}},{required:['external_key'],not:{required:['id']}}]};
const baseline={expected_updated_at:{type:'string'},expected_revision:{type:'integer',minimum:0}};
const review={type:'object',properties:{...Object.fromEntries(Object.keys(C.fields).map(k=>[k,{type:'string',maxLength:5000}])),focus_outcome:{type:'string',enum:Object.keys(C.outcomes)}},additionalProperties:false};
const changes={type:'object',properties:{objective:{type:'string',maxLength:5000},rationale:{type:'string',maxLength:5000},success_criterion:{type:'string',maxLength:5000},date:{type:'string',format:'date'},time:{type:'string',pattern:'^([01]\\d|2[0-3]):[0-5]\\d$'},blocks:{type:'array',maxItems:30,items:{type:'object',properties:{exercise_ref:{type:'string',format:'uuid'},phase:{type:'string',enum:['ativacao','principal','jogo','retorno']},duration_min:{type:'number',exclusiveMinimum:0,maximum:240},notes:{type:'string',maxLength:5000}},required:['exercise_ref','phase','duration_min'],additionalProperties:false}}},required:['objective','rationale','success_criterion','date','time','blocks'],additionalProperties:false};
function tool(name,description,properties,required,readOnly=false,destructive=false){return {name,description,inputSchema:{type:'object',properties:{...idProps,...properties},required,additionalProperties:false,...select},annotations:{readOnlyHint:readOnly,destructiveHint:destructive}};}
export const CONTINUITY_TOOLS=[
 tool('get_training_continuity','Read review, original quoted evidence, current proposal/revision and follow-up progress. Read-only: never creates a proposal or training.',{},[],true),
 tool('save_training_review','Save the explicitly confirmed, coach-provided review and upsert ONE linked memory atomically. Do not infer improvement. Preserve existing content not explicitly replaced.',{...baseline,confirmed:{type:'boolean',const:true},review},['expected_updated_at','expected_revision','confirmed','review']),
 tool('clear_training_review','Remove the explicitly confirmed review and archive its linked memory. Preserves the training, notes and approved follow-up.',{...baseline,confirmed:{type:'boolean',const:true}},['expected_updated_at','expected_revision','confirmed'],false,true),
 tool('prepare_training_continuity','Prepare a DRAFT from the recorded next action or remaining issue. Reuses existing exercises; never invents evidence. An unchanged draft is returned as-is unless replace_existing=true was explicitly requested.',{...baseline,replace_existing:{type:'boolean'}},['expected_updated_at','expected_revision']),
 tool('update_training_continuity','Revise a draft as the authorized Head Coach, using recorded evidence and existing exercises. Explain your reasoning and specify observable success criteria. This does NOT create a training.',{...baseline,changes},['expected_updated_at','expected_revision','changes']),
 tool('dismiss_training_continuity','Dismiss an unapproved draft only with explicit confirmation. Preserves source review and exercises.',{...baseline,confirmed:{type:'boolean',const:true}},['expected_updated_at','expected_revision','confirmed'],false,true),
 tool('approve_training_continuity','Create the linked follow-up only AFTER the coach explicitly approves the displayed proposal. Needs valid date, time, exercises, rationale and observable success criteria. Atomic and no duplicated or resurrected training.',{...baseline,confirmed:{type:'boolean',const:true}},['expected_updated_at','expected_revision','confirmed'])
];
async function find(admin,c,kind,args,{optional=false}={}){
 if(Boolean(args.id)===Boolean(args.external_key))throw new Error('exactly_one_identifier_required');
 if(args.id&&!UUID.test(args.id))throw new Error('invalid_training_uuid');
 let q=admin.from('workspace_records').select('*').eq('team_id',c.team_id).eq('kind',kind).is('deleted_at',null);
 q=args.id?q.eq('id',args.id):q.eq('payload->>external_key',args.external_key);
 const {data,error}=await q;if(error)throw error;if(data?.length>1)throw new Error('ambiguous_identity');if(!data?.length&&!optional)throw new Error('training_not_found');return data?.[0]||null;
}
const model=row=>({...row.payload,sync_id:row.id});
const clean=row=>{const p={...row};delete p.sync_id;delete p.team_id;return p;};
async function output(admin,c,row,extra={}){
 const r=model(row),p=C.state(r).proposal,target=p?.target_ref?await find(admin,c,'training',{id:p.target_ref},{optional:true}):null;
 return {id:row.id,updated_at:row.updated_at,external_key:r.external_key||null,date:r.data,review:r.review||{status:'pending'},review_key:C.reviewKey(r.review),continuity:C.state(r),evidence:C.evidence(r),progress:C.progress(r,target?model(target):null),followup:target?{id:target.id,updated_at:target.updated_at,date:target.payload.data,objective:target.payload.objetivo}:null,...extra};
}
export async function executeContinuityTool(admin,c,name,args){
 if(!c.scopes?.includes('read'))throw new Error('connector_scope_read_required');
 if(!CONTINUITY_TOOLS.some(tool=>tool.name===name))throw new Error('unknown_continuity_tool');
 const source=await find(admin,c,'training',args),row=model(source),state=C.state(row);
 if(name==='get_training_continuity')return output(admin,c,source);
 if(!c.scopes?.includes('write'))throw new Error('connector_scope_write_required');
 if(name==='save_training_review'&&args.confirmed!==true)throw new Error('explicit_confirmation_required');
 if(name==='approve_training_continuity'&&state.proposal?.status==='approved'){
  if(args.confirmed!==true)throw new Error('explicit_approval_required');
  const out=await output(admin,c,source,{already_approved:true});if(!out.followup)throw new Error('approved_followup_deleted_or_missing');return out;
 }
 if(!args.expected_updated_at||source.updated_at!==args.expected_updated_at)throw new Error('record_conflict_read_again');
 C.check(row,{expected_revision:args.expected_revision});
 let next=row,action,exercises=[],versions=[];
 if(['prepare_training_continuity','update_training_continuity','approve_training_continuity'].includes(name)){
  const {data,error}=await admin.from('workspace_records').select('id,payload,updated_at').eq('team_id',c.team_id).eq('kind','exercise').is('deleted_at',null);if(error)throw error;
  exercises=(data||[]).map(model);versions=(data||[]).map(x=>({id:x.id,updated_at:x.updated_at}));
 }
 let target=null;
 if(name==='save_training_review'){action='review';next=C.saveReview(row,{...row.review,...(args.review||{})},{expected_review_key:C.reviewKey(row.review),actor:'Head Coach'});}
 else if(name==='clear_training_review'){action='clear_review';next=C.clearReview(row,{expected_review_key:C.reviewKey(row.review),confirmed:args.confirmed});}
 else if(name==='prepare_training_continuity'){
  if(state.proposal?.status==='draft'&&state.proposal.source_key===C.sourceKey(row)&&!args.replace_existing)return output(admin,c,source,{already_prepared:true});
  action='propose';next=C.prepare(row,exercises,await C.identities(row),{actor:'Regra de continuidade'});
 }
 else if(name==='update_training_continuity'){action='save_proposal';next=C.update(row,args.changes||{},exercises,{expected_revision:args.expected_revision,actor:'Head Coach'});next.continuity.proposal.method='agent_proposal';next.continuity.proposal.author='Head Coach';}
 else if(name==='dismiss_training_continuity'){action='dismiss';next=C.dismiss(row,{expected_revision:args.expected_revision,confirmed:args.confirmed,actor:'Head Coach'});}
 else if(name==='approve_training_continuity'){action='approve';const a=C.approve(row,exercises,{expected_revision:args.expected_revision,confirmed:args.confirmed,actor:'Head Coach — aprovação explícita do treinador'});next=a.source;target=a.target;}
 else throw new Error('unknown_continuity_tool');
 const ids=await C.identities(next),memory=C.memory(next,ids,{actor:'Head Coach'});
 const selected=new Set((target?.blocos||next.continuity?.proposal?.blocks||[]).map(b=>b.exercise_ref));
 const change={action,confirmed:args.confirmed===true,source:clean(next),memory_ref:ids.memory_ref,memory,exercise_versions:versions.filter(v=>selected.has(v.id)),target_ref:target?.sync_id||null,target:target?clean(target):null};
 const {data,error}=await admin.rpc('head_coach_commit_training_continuity',{p_team_id:c.team_id,p_source_id:source.id,p_expected_updated_at:source.updated_at,p_change:change,p_agent_subject:'head-coach'});if(error)throw error;
 const saved=await find(admin,c,'training',{id:source.id});
 return output(admin,c,saved,{saved:true,memory_linked:data?.memory_linked===true});
}
