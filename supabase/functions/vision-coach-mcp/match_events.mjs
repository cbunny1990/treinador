// Match event operations: same model as the PWA, stable UUIDs, current revisions and team scopes.
import '../../../js/match_visual.js';
import '../../../js/match_events.js';
const M=globalThis.VisionMatchVisual,E=globalThis.VisionMatchEvents;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const selector={id:{type:'string',format:'uuid'},external_key:{type:'string'}};
const choose={oneOf:[{required:['id'],not:{required:['external_key']}},{required:['external_key'],not:{required:['id']}}]};
const revision={expected_updated_at:{type:'string'},expected_revision:{type:'integer',minimum:0}};
function tool(name,description,properties,required,readOnly=false,destructive=false){return {name,description,inputSchema:{type:'object',properties:{...selector,...properties},required,additionalProperties:false,...choose},annotations:{readOnlyHint:readOnly,destructiveHint:destructive}};}
const detailProperties={
 event_type:{type:'string',enum:Object.keys(E.types)},
 event_id:{type:'string',minLength:1,maxLength:100},
 zone:{type:'string',enum:Object.keys(E.zones)},
 player_ref:{type:'string'},
 opponent_player_name:{type:'string',minLength:1,maxLength:100},
 reason:{type:'string',enum:Object.keys(E.lossReasons)},
 side:{type:'string',enum:Object.keys(E.sides)},
 note:{type:'string',maxLength:300},
 minute:{type:'number',minimum:0,maximum:240},
 confirmed:{type:'boolean',const:true}
};
const editableProperties={...detailProperties};delete editableProperties.event_type;delete editableProperties.event_id;delete editableProperties.confirmed;
export const MATCH_EVENTS_TOOLS=[
 tool('get_match_events','Read match events, counted statistics and possession provenance. Read-only; never records events or infers counts.',{},[],true),
 tool('record_match_event','Record one explicitly confirmed match event described by the coach. Never records events the coach did not report. minute uses the match clock (0..240); omit it in running/paused usage to use the current clock.',{...detailProperties},['expected_updated_at','expected_revision','event_type','event_id','confirmed']),
 tool('update_match_event','Update an existing event. Allowed with usage paused or completed. Event type and fields left out keep the recorded value.',{...revision,...editableProperties,event_id:detailProperties.event_id,confirmed:detailProperties.confirmed},['expected_updated_at','expected_revision','event_id','confirmed']),
 tool('delete_match_event','Delete an explicitly confirmed event. Allowed with usage paused or completed.',{...revision,event_id:{type:'string',minLength:1,maxLength:100},confirmed:{type:'boolean',const:true}},['expected_updated_at','expected_revision','event_id','confirmed'],false,true),
 tool('save_match_possession','Store possession provenance: measured (counted by the coach), estimated, or unknown. Never presents an estimate as a measurement.',{...revision,kind:{type:'string',enum:['measured','estimated','unknown']},value:{type:'number',minimum:0,maximum:100},confirmed:{type:'boolean',const:true}},['expected_updated_at','expected_revision','kind','confirmed'])
];
async function find(admin,c,args){if(Boolean(args.id)===Boolean(args.external_key))throw new Error('exactly_one_match_identifier_required');if(args.id&&!UUID.test(args.id))throw new Error('invalid_match_uuid');let q=admin.from('workspace_records').select('*').eq('team_id',c.team_id).eq('kind','match').is('deleted_at',null);q=args.id?q.eq('id',args.id):q.eq('payload->>external_key',args.external_key);const {data,error}=await q;if(error)throw error;if(data?.length!==1)throw new Error(data?.length?'ambiguous_match_identity':'match_not_found');return data[0];}
async function players(admin,c){const {data,error}=await admin.from('workspace_records').select('id,payload').eq('team_id',c.team_id).eq('kind','player').is('deleted_at',null);if(error)throw error;return (data||[]).map(p=>({...p.payload,sync_id:p.id}));}
function launch(command,row,at,roster){
 const cmd={...command,expected_revision:row.payload.match_events?.revision||0};
 return M.state(row.payload).status==='running'?E.apply(row.payload,cmd,{now:at,actor:'Head Coach',players:roster}):E.apply(row.payload,cmd,{actor:'Head Coach',players:roster});
}
function output(row){
 const payload=row.payload,stats=E.stats(payload);
 return {id:row.id,updated_at:row.updated_at,external_key:payload.external_key||null,opponent:payload.adversario,events:E.state(payload).events,statistics:stats,possession:stats.possession,match_events_revision:payload.match_events?.revision||0,visual_match_status:M.state(payload).status};
}
export async function executeMatchEventsTool(admin,c,name,args){
 if(!c.scopes?.includes('read'))throw new Error('connector_scope_read_required');
 const row=await find(admin,c,args);
 if(name==='get_match_events')return output(row);
 if(!c.scopes?.includes('write'))throw new Error('connector_scope_write_required');
 if(args.confirmed!==true)throw new Error('explicit_confirmation_required');
 if(!args.expected_updated_at||row.updated_at!==args.expected_updated_at)throw new Error('record_conflict_read_again');
 const currentRevision=row.payload.match_events?.revision||0;
 if(!Number.isInteger(args.expected_revision)||args.expected_revision!==currentRevision)throw new Error('domain_revision_conflict_read_again');
 const status=M.state(row.payload).status;
 let cmd;
 if(name==='record_match_event'){
  if(!Object.hasOwn(E.types,args.event_type||''))throw new Error('invalid_event_type');
  cmd={type:'record',id:String(args.event_id).slice(0,100),event_type:args.event_type,confirmed:true,reason:args.reason,zone:args.zone,player_ref:args.player_ref,opponent_player_name:args.opponent_player_name,side:E.sidedTypes.includes(args.event_type)?args.side:undefined,note:args.note};
  if(args.minute!=null)cmd.at_ms=Math.round(Number(args.minute)*10)/10*60000;
 }else if(name==='update_match_event'){
  cmd={type:'edit',id:String(args.event_id).slice(0,100),confirmed:true};
  if(args.event_type!=null)throw new Error('event_type_is_immutable');
  if(args.minute!=null)cmd.at_ms=Math.round(Number(args.minute)*10)/10*60000;
  for(const key of ['zone','player_ref','opponent_player_name','note','reason'])if(args[key]!=null)cmd[key]=args[key];
  if(args.side!=null)cmd.side=args.side;
 }else if(name==='delete_match_event')cmd={type:'delete',id:String(args.event_id).slice(0,100),confirmed:args.confirmed};
 else if(name==='save_match_possession')cmd={type:'save_possession',kind:args.kind,value:args.value??null,confirmed:true};
 else throw new Error('unknown_match_events_tool');
 const payload=launch(cmd,row,Date.now(),await players(admin,c));
 const {error}=await admin.rpc('head_coach_put_record',{p_team_id:c.team_id,p_kind:'match',p_payload:payload,p_record_id:row.id,p_expected_updated_at:row.updated_at,p_idempotency_key:'match-events:'+c.id+':'+row.id+':'+row.updated_at+':'+cmd.type+':'+cmd.id,p_agent_subject:'head-coach'});if(error)throw error;
 return output(await find(admin,c,{id:row.id}));
}
