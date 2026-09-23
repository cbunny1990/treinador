// Same pure model as the PWA. All reads/writes use the connector's team and scopes.
import '../../../js/training_session.js';
const M=globalThis.VisionTrainingSession;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const selector={id:{type:'string',format:'uuid'},external_key:{type:'string'}};
const choose={oneOf:[{required:['id'],not:{required:['external_key']}},{required:['external_key'],not:{required:['id']}}]};
function tool(name,description,properties,required,readOnly=false){return {name,description,inputSchema:{type:'object',properties:{...selector,...properties},required,additionalProperties:false,...choose},annotations:{readOnlyHint:readOnly,destructiveHint:!readOnly}};}
export const SESSION_TOOLS=[
  tool('get_training_session','Read the training plan, attendance, actual block times and notes. Does not start a timer.',{},[],true),
  tool('update_training_attendance','Set attendance only for explicitly identified players. Availability does not imply attendance. Requires explicit coach confirmation and preserves all other session and plan data.',{expected_updated_at:{type:'string'},expected_revision:{type:'integer',minimum:0},confirmed:{type:'boolean',const:true},entries:{type:'array',minItems:1,maxItems:150,items:{type:'object',properties:{player_ref:{type:'string',format:'uuid'},status:{type:'string',enum:Object.keys(M.attendance)}},required:['player_ref','status'],additionalProperties:false}}},['expected_updated_at','expected_revision','confirmed','entries']),
  tool('write_training_session_note','Create or edit factual text explicitly supplied by the coach on an executed block. A stable note_id allows updates; requires confirmation and the current revision.',{expected_updated_at:{type:'string'},expected_revision:{type:'integer',minimum:0},confirmed:{type:'boolean',const:true},block_key:{type:'string'},note_id:{type:'string'},text:{type:'string',minLength:1,maxLength:3000}},['expected_updated_at','expected_revision','confirmed','block_key','note_id','text']),
  tool('remove_training_session_note','Delete only the explicitly confirmed block note; never deletes the training.',{expected_updated_at:{type:'string'},expected_revision:{type:'integer',minimum:0},block_key:{type:'string'},note_id:{type:'string'},confirmed:{type:'boolean',const:true}},['expected_updated_at','expected_revision','block_key','note_id','confirmed']),
  tool('control_training_session','Start, pause, resume, move to next block or finish a training only after explicit coach confirmation. A timer belongs to one controller. Another controller can take over only while paused, with confirmation.',{expected_updated_at:{type:'string'},expected_revision:{type:'integer',minimum:0},action:{type:'string',enum:['start','pause','resume','next','finish','take_control','reset']},confirmed:{type:'boolean',const:true}},['expected_updated_at','expected_revision','action','confirmed']),
  tool('duplicate_training_plan','Copy the current training plan to a new date only after explicit coach confirmation, without copying attendance, timing or review. Requires its current version and preserves the source link. Reuse request_key on retries.',{expected_updated_at:{type:'string'},expected_revision:{type:'integer',minimum:0},date:{type:'string',format:'date'},time:{type:'string'},request_key:{type:'string',minLength:1,maxLength:80},confirmed:{type:'boolean',const:true}},['expected_updated_at','expected_revision','date','request_key','confirmed'])
];
async function find(admin,c,kind,args){
  if(Boolean(args.id)===Boolean(args.external_key))throw new Error('exactly_one_identifier_required');
  if(args.id&&!UUID.test(args.id))throw new Error('invalid_training_uuid');
  let q=admin.from('workspace_records').select('*').eq('team_id',c.team_id).eq('kind',kind).is('deleted_at',null);
  q=args.id?q.eq('id',args.id):q.eq('payload->>external_key',args.external_key);
  const {data,error}=await q;if(error)throw error;if(data?.length!==1)throw new Error(data?.length?'ambiguous_identity':'record_not_found');return data[0];
}
function output(row){const session=M.normalize(row.payload.session);return {id:row.id,updated_at:row.updated_at,external_key:row.payload.external_key,plan:{date:row.payload.data,time:row.payload.hora,objective:row.payload.objetivo,blocks:row.payload.blocos},session,summary:M.summary(session)};}
export async function executeSessionTool(admin,c,name,args){
  if(!c.scopes?.includes('read'))throw new Error('connector_scope_read_required');
  if(!SESSION_TOOLS.some(tool=>tool.name===name))throw new Error('unknown_training_tool');
  if(name!=='get_training_session'&&!c.scopes?.includes('write'))throw new Error('connector_scope_write_required');
  if(['update_training_attendance','write_training_session_note','control_training_session'].includes(name)&&args.confirmed!==true)throw new Error('explicit_confirmation_required');
  if(name==='duplicate_training_plan'&&args.confirmed!==true)throw new Error('explicit_confirmation_required');
  if(name==='update_training_attendance'){
    if(!Array.isArray(args.entries)||args.entries.length<1||args.entries.length>150)throw new Error('invalid_attendance');
    for(const entry of args.entries)if(!entry||!UUID.test(String(entry.player_ref||''))||!Object.hasOwn(M.attendance,entry.status||''))throw new Error('invalid_attendance_entry');
  }
  const row=await find(admin,c,'training',args);
  if(name==='get_training_session')return output(row);
  if(!args.expected_updated_at||args.expected_updated_at!==row.updated_at)throw new Error('record_conflict_read_again');
  if(args.expected_revision!==(row.payload.session?.revision||0))throw new Error('training_revision_conflict_read_again');
  if(name==='duplicate_training_plan'){
    if(!/^[a-zA-Z0-9_-]{1,80}$/.test(args.request_key||''))throw new Error('invalid_request_key');
    const identity=c.id+'-'+args.request_key;
    const payload=M.duplicate({...row.payload,sync_id:row.id},{date:args.date,time:args.time,identity});
    const {data,error}=await admin.rpc('head_coach_put_record',{p_team_id:c.team_id,p_kind:'training',p_payload:payload,p_record_id:null,p_expected_updated_at:null,p_idempotency_key:'training-copy:'+identity,p_agent_subject:'head-coach'});if(error)throw error;
    return {created:true,record:data};
  }
  let command={expected_revision:args.expected_revision};
  if(name==='update_training_attendance'||(name==='control_training_session'&&args.action==='start')){
    const {data,error}=await admin.from('workspace_records').select('id,payload').eq('team_id',c.team_id).eq('kind','player').is('deleted_at',null);if(error)throw error;
    const players=(data||[]).map(p=>({...p.payload,sync_id:p.id}));
    if(name==='update_training_attendance'){
      if(!Array.isArray(args.entries))throw new Error('invalid_attendance');
      command={...command,type:'attendance',entries:args.entries.map(a=>{const p=players.find(p=>p.sync_id===a.player_ref);if(!p)throw new Error('player_not_in_team');return {player_ref:p.sync_id,name:p.nome,number:p.numero??null,status:a.status};})};
    }else command={...command,type:'start',players};
  }else if(name==='write_training_session_note')command={...command,type:'note',block_key:args.block_key,note_id:args.note_id,text:args.text};
  else if(name==='remove_training_session_note')command={...command,type:'remove_note',block_key:args.block_key,note_id:args.note_id,confirmed:args.confirmed};
  else if(name==='control_training_session')command={...command,type:args.action,confirmed:args.confirmed};
  else throw new Error('unknown_training_tool');
  const payload=M.apply(row.payload,command,{controller_id:'mcp:'+c.id,actor:'Head Coach'});
  const {error}=await admin.rpc('head_coach_put_record',{p_team_id:c.team_id,p_kind:'training',p_payload:payload,p_record_id:row.id,p_expected_updated_at:row.updated_at,p_idempotency_key:'session:'+c.id+':'+row.id+':'+row.updated_at+':'+command.type,p_agent_subject:'head-coach'});
  if(error)throw error;
  return output(await find(admin,c,'training',{id:row.id}));
}
