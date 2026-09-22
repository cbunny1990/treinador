// Match visual operations: stable UUIDs, same model as the PWA, current revisions and team scopes.
import '../../../js/match_visual.js';
const M=globalThis.VisionMatchVisual;
const selector={id:{type:'string'},external_key:{type:'string'}};
const choose={oneOf:[{required:['id'],not:{required:['external_key']}},{required:['external_key'],not:{required:['id']}}]};
const revision={expected_updated_at:{type:'string'},expected_revision:{type:'integer',minimum:0}};
function tool(name,description,properties,required,readOnly=false,destructive=false){return {name,description,inputSchema:{type:'object',properties:{...selector,...properties},required,additionalProperties:false,...choose},annotations:{readOnlyHint:readOnly,destructiveHint:destructive}};}
export const MATCH_VISUAL_TOOLS=[
 tool('get_match_visual','Read existing callup, visual 5v5 lineup, planned rotations, recorded movements and player minutes. Read-only; never infers minutes or starts a clock.',{},[],true),
 tool('save_match_visual_lineup','Set the initial 5v5 lineup using called, available player UUIDs. clear=true requires confirmation. A started lineup is immutable; use a recorded movement instead.',{...revision,slots:{type:'object',properties:Object.fromEntries(Object.keys(M.roles).map(k=>[k,{type:'string'}])),additionalProperties:false},clear:{type:'boolean'},confirmed:{type:'boolean'}},['expected_updated_at','expected_revision']),
 tool('set_match_visual_position','Move a role in the tactical drawing using normalized coordinates. Does not swap players or alter participation. reset=true restores the layout and requires confirmation.',{...revision,role:{type:'string',enum:Object.keys(M.roles)},x:{type:'number',minimum:.08,maximum:.92},y:{type:'number',minimum:.08,maximum:.92},reset:{type:'boolean'},confirmed:{type:'boolean'}},['expected_updated_at','expected_revision']),
 tool('save_match_rotation','Create/edit a planned rotation only. It NEVER performs an actual substitution at its scheduled minute; a separate explicit movement is required. Reuse rotation_id when editing.',{...revision,rotation_id:{type:'string',minLength:1,maxLength:100},out_ref:{type:'string'},in_ref:{type:'string'},at_min:{type:'number',minimum:0,maximum:240},note:{type:'string',maxLength:1000}},['expected_updated_at','expected_revision','rotation_id','out_ref','in_ref','at_min']),
 tool('delete_match_rotation','Delete an explicitly confirmed unexecuted rotation; does not erase a performed substitution or match history.',{...revision,rotation_id:{type:'string'},confirmed:{type:'boolean',const:true}},['expected_updated_at','expected_revision','rotation_id','confirmed'],false,true),
 tool('control_match_usage','Start/pause/resume/finish only when the coach explicitly requests it. Pause for intervals. One controller owns the clock; takeover is allowed only while paused with confirmation. reset_recording removes usage only, not the match, result or analysis. Never start a real match while testing development.',{...revision,action:{type:'string',enum:['start','pause','resume','finish','take_control','reset_recording']},confirmed:{type:'boolean'}},['expected_updated_at','expected_revision','action'],false,true),
 tool('record_match_movement','Record an explicitly confirmed substitution or role swap at the CURRENT clock time. undo_last corrects only the last non-voided movement while paused; not a reverse substitution now. Incoming player must be available; preserve exact outgoing/incoming UUIDs.',{...revision,action:{type:'string',enum:['substitute','swap','undo_last']},movement_id:{type:'string',maxLength:100},out_ref:{type:'string'},in_ref:{type:'string'},role_a:{type:'string',enum:Object.keys(M.roles)},role_b:{type:'string',enum:Object.keys(M.roles)},rotation_id:{type:'string'},note:{type:'string',maxLength:1000},confirmed:{type:'boolean',const:true}},['expected_updated_at','expected_revision','action','confirmed'],false,true)
];
async function find(admin,c,args){if(Boolean(args.id)===Boolean(args.external_key))throw new Error('exactly_one_match_identifier_required');let q=admin.from('workspace_records').select('*').eq('team_id',c.team_id).eq('kind','match').is('deleted_at',null);q=args.id?q.eq('id',args.id):q.eq('payload->>external_key',args.external_key);const {data,error}=await q;if(error)throw error;if(data?.length!==1)throw new Error(data?.length?'ambiguous_match_identity':'match_not_found');return data[0];}
async function players(admin,c){const {data,error}=await admin.from('workspace_records').select('id,payload').eq('team_id',c.team_id).eq('kind','player').is('deleted_at',null);if(error)throw error;return (data||[]).map(p=>({...p.payload,sync_id:p.id}));}
function output(row,roster){return {id:row.id,updated_at:row.updated_at,external_key:row.payload.external_key||null,opponent:row.payload.adversario,lineup:row.payload.lineup||null,visual_match:M.state(row.payload),usage:M.replay(row.payload),eligible_called:M.pool(row.payload,roster).filter(M.available).map(p=>({ref:p.sync_id,name:p.nome,number:p.numero??null}))};}
export async function executeMatchVisualTool(admin,c,name,args){
 if(!c.scopes?.includes('read'))throw new Error('connector_scope_read_required');const row=await find(admin,c,args),roster=await players(admin,c);
 if(name==='get_match_visual')return output(row,roster);
 if(!c.scopes?.includes('write'))throw new Error('connector_scope_write_required');
 if(!args.expected_updated_at||row.updated_at!==args.expected_updated_at)throw new Error('record_conflict_read_again');
 let cmd={expected_revision:args.expected_revision,confirmed:args.confirmed};
 if(name==='save_match_visual_lineup')cmd={...cmd,type:args.clear?'clear_lineup':'save_lineup',slots:args.slots};
 else if(name==='set_match_visual_position')cmd={...cmd,type:args.reset?'reset_layout':'position',role:args.role,x:args.x,y:args.y};
 else if(name==='save_match_rotation')cmd={...cmd,type:'save_rotation',id:args.rotation_id,out_ref:args.out_ref,in_ref:args.in_ref,at_min:args.at_min,note:args.note};
 else if(name==='delete_match_rotation')cmd={...cmd,type:'delete_rotation',id:args.rotation_id};
 else if(name==='control_match_usage'){if(!['start','pause','resume','finish','take_control','reset_recording'].includes(args.action))throw new Error('invalid_clock_action');cmd={...cmd,type:args.action};}
 else if(name==='record_match_movement'){if(!['substitute','swap','undo_last'].includes(args.action))throw new Error('invalid_movement_action');cmd={...cmd,type:args.action,id:args.movement_id,out_ref:args.out_ref,in_ref:args.in_ref,role_a:args.role_a,role_b:args.role_b,rotation_id:args.rotation_id,note:args.note};}
 else throw new Error('unknown_match_visual_tool');
 const payload=M.apply(row.payload,cmd,{controller_id:'mcp:'+c.id,actor:'Head Coach',players:roster});
 const {error}=await admin.rpc('head_coach_put_record',{p_team_id:c.team_id,p_kind:'match',p_payload:payload,p_record_id:row.id,p_expected_updated_at:row.updated_at,p_idempotency_key:'match-visual:'+c.id+':'+row.id+':'+row.updated_at+':'+cmd.type,p_agent_subject:'head-coach'});if(error)throw error;
 return output(await find(admin,c,{id:row.id}),roster);
}
