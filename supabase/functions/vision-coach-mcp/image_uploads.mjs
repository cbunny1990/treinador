// Original-image workflow. No resizing, conversion, public buckets or client secrets.
export const IMAGE_LIMIT = 16 * 1024 * 1024;
const BUCKET = 'team-media';
const enc = new TextEncoder();
const fail = (code) => { throw new Error(code); };
export async function imageHash(bytes) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');
}
export function imageInfo(input) {
  const b = new Uint8Array(input), v = new DataView(b.buffer,b.byteOffset,b.byteLength);
  const ascii=(start,n)=>String.fromCharCode(...b.subarray(start,start+n));
  if(b.length<24||b.length>IMAGE_LIMIT) fail('image_size_invalid');
  let width=0,height=0,mime_type='';
  if(b[0]===137&&ascii(1,3)==='PNG'&&ascii(12,4)==='IHDR') {
    width=v.getUint32(16);height=v.getUint32(20);mime_type='image/png';
    if(ascii(b.length-8,4)!=='IEND') fail('image_png_incomplete');
  } else if(ascii(0,4)==='RIFF'&&ascii(8,4)==='WEBP') {
    if(v.getUint32(4,true)+8!==b.length) fail('image_webp_incomplete');
    const type=ascii(12,4);mime_type='image/webp';
    if(type==='VP8X'&&b.length>=30){width=1+b[24]+(b[25]<<8)+(b[26]<<16);height=1+b[27]+(b[28]<<8)+(b[29]<<16);}
    else if(type==='VP8 '&&b.length>=30&&b[23]===157&&b[24]===1&&b[25]===42){width=v.getUint16(26,true)&16383;height=v.getUint16(28,true)&16383;}
    else if(type==='VP8L'&&b[20]===47){width=1+b[21]+((b[22]&63)<<8);height=1+(b[22]>>6)+(b[23]<<2)+((b[24]&15)<<10);}
  } else if(b[0]===255&&b[1]===216) {
    mime_type='image/jpeg';
    if(b[b.length-2]!==255||b[b.length-1]!==217) fail('image_jpeg_incomplete');
    for(let i=2;i+9<b.length;) {
      if(b[i++]!==255) fail('image_jpeg_invalid');
      while(b[i]===255)i++;
      const marker=b[i++];if(marker===218||marker===217)break;
      if(marker===1||(marker>=208&&marker<=215))continue;
      const len=v.getUint16(i);if(len<2||i+len>b.length)fail('image_jpeg_invalid');
      if([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)){height=v.getUint16(i+3);width=v.getUint16(i+5);break;}
      i+=len;
    }
  }
  if(!mime_type||!width||!height||width>20000||height>20000||width*height>60000000) fail('image_format_or_dimensions_invalid');
  return {width,height,mime_type,size_bytes:b.length};
}
export async function readImageResponse(response) {
  if(!response.ok) fail('image_download_failed_'+response.status);
  if(Number(response.headers.get('content-length')||0)>IMAGE_LIMIT) fail('image_size_invalid');
  const reader=response.body?.getReader();if(!reader)fail('image_empty');
  const chunks=[];let n=0;
  try { while(true){const {done,value}=await reader.read();if(done)break;n+=value.length;if(n>IMAGE_LIMIT)fail('image_size_invalid');chunks.push(value);} }
  catch(error){await reader.cancel().catch(()=>{});throw error;}finally{reader.releaseLock();}
  const all=new Uint8Array(n);let at=0;for(const chunk of chunks){all.set(chunk,at);at+=chunk.length;}return all;
}
const b64=(b)=>btoa(String.fromCharCode(...b)).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
const un64=(s)=>Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
async function ticketKey(secret){if(!secret||secret.length<32)fail('image_signing_unavailable');return crypto.subtle.importKey('raw',enc.encode('vision-image-v1:'+secret),{name:'HMAC',hash:'SHA-256'},false,['sign','verify']);}
export async function signImageTicket(value,secret){const bytes=enc.encode(JSON.stringify(value));return b64(bytes)+'.'+b64(new Uint8Array(await crypto.subtle.sign('HMAC',await ticketKey(secret),bytes)));}
export async function verifyImageTicket(ticket,secret,connector,now=Date.now()) {
  try {
    if(typeof ticket!=='string'||ticket.length>8192)fail('image_ticket_invalid');
    const [data,sig,extra]=ticket.split('.');if(extra||!data||!sig)fail('image_ticket_invalid');
    const bytes=un64(data);
    if(!await crypto.subtle.verify('HMAC',await ticketKey(secret),un64(sig),bytes))fail('image_ticket_invalid');
    const t=JSON.parse(new TextDecoder().decode(bytes));
    if(t.version!==1||t.connector!==connector.id||t.team!==connector.team_id||t.expires<=now)fail('image_ticket_invalid_or_expired');
    if(!t.path.startsWith(t.team+'/exercise-images/'+t.id+'/')||t.path.includes('..'))fail('image_ticket_invalid');
    return t;
  }catch(_){fail('image_ticket_invalid_or_expired');}
}
function scope(c,...names){for(const name of names)if(!c?.scopes?.includes(name))fail('connector_scope_'+name+'_required');}
async function exercise(admin,connector,args) {
  if(Boolean(args.id)===Boolean(args.external_key))fail('exactly_one_exercise_identifier_required');
  let q=admin.from('workspace_records').select('*').eq('team_id',connector.team_id).eq('kind','exercise').is('deleted_at',null);
  if(args.id)q=q.eq('id',args.id);else q=q.eq('payload->>external_key',args.external_key);
  const {data,error}=await q;if(error)throw error;
  if(data?.length!==1)fail(data?.length?'exercise_identity_ambiguous':'exercise_not_found');return data[0];
}
function snapshot(row){return {id:row.id,external_key:row.payload?.external_key||null,name:row.payload?.nome||null,updated_at:row.updated_at,visual_removed:row.payload?.visual_removed===true,image:row.payload?.visual_image||null,storage_path:row.payload?.visual_storage_path||null,visual_url:row.payload?.visual_url||null};}
function version(row,wanted){if(!wanted||row.updated_at!==wanted)fail('record_conflict_read_again');}
async function privateLink(admin,path){const {data,error}=await admin.storage.from(BUCKET).createSignedUrl(path,300);if(error)throw error;return data.signedUrl;}
async function saveImage(admin,c,row,payload,key) {
  const {error}=await admin.rpc('head_coach_put_record',{p_team_id:c.team_id,p_kind:'exercise',p_payload:payload,p_record_id:row.id,p_expected_updated_at:row.updated_at,p_idempotency_key:key,p_agent_subject:'head-coach'});
  if(error)throw error;
  return exercise(admin,c,{id:row.id});
}
const idProps={id:{type:'string',description:'Remote UUID, not a browser-local ID.'},external_key:{type:'string',minLength:1}};
const selector={oneOf:[{required:['id'],not:{required:['external_key']}},{required:['external_key'],not:{required:['id']}}]};
function tool(name,description,properties,required,readOnly=false,destructive=false,select=false){return {name,description,inputSchema:{type:'object',properties,required,additionalProperties:false,...(select?selector:{})},annotations:{readOnlyHint:readOnly,destructiveHint:destructive}};}
export const IMAGE_TOOLS=[
  tool('get_exercise_image','Read the exact exercise identity, revision and current image. Optional private download URL expires in five minutes; never expose signed URLs.',{...idProps,download:{type:'boolean'}},[],true,false,true),
  tool('prepare_exercise_image_upload','Prepare binary upload of the APPROVED ORIGINAL to private Storage. PUT the unmodified bytes to upload_url, then call complete_exercise_image_upload. Never regenerate, downsize, send base64 in MCP, or expose tickets and signed URLs.',{...idProps,approved:{const:true,type:'boolean'},expected_updated_at:{type:'string'},file_name:{type:'string',maxLength:180},sha256:{type:'string',pattern:'^[0-9a-f]{64}$'},size_bytes:{type:'integer',minimum:24,maximum:IMAGE_LIMIT},mime_type:{type:'string',enum:['image/png','image/jpeg','image/webp']},width:{type:'integer',minimum:1,maximum:20000},height:{type:'integer',minimum:1,maximum:20000}},['approved','expected_updated_at','file_name','sha256','size_bytes','mime_type','width','height'],false,false,true),
  tool('complete_exercise_image_upload','Verify actual Storage bytes, SHA-256, type and dimensions; attach to the SAME existing exercise using optimistic concurrency. Only this step confirms integration.',{ticket:{type:'string',maxLength:8192}},['ticket']),
  tool('remove_exercise_image','Unlink the image without deleting the exercise or its history. Requires explicit confirmation and the current revision.',{...idProps,confirmed:{const:true,type:'boolean'},expected_updated_at:{type:'string'}},['confirmed','expected_updated_at'],false,true,true)
];
export async function executeImageTool(admin,c,name,args,secret) {
  scope(c,'read');
  if(name==='get_exercise_image') {
    const row=await exercise(admin,c,args),out=snapshot(row);
    if(args.download&&out.storage_path&&!out.visual_removed){scope(c,'media');if(!out.storage_path.startsWith(c.team_id+'/'))fail('image_path_forbidden');out.download_url=await privateLink(admin,out.storage_path);out.download_expires_in=300;}
    return out;
  }
  scope(c,'write','media');
  if(name==='prepare_exercise_image_upload') {
    if(args.approved!==true)fail('original_approval_required');
    if(!/^[0-9a-f]{64}$/.test(args.sha256||'')||!['image/png','image/jpeg','image/webp'].includes(args.mime_type)||!Number.isInteger(args.size_bytes)||args.size_bytes<24||args.size_bytes>IMAGE_LIMIT)fail('image_metadata_invalid');
    for(const k of ['width','height'])if(!Number.isInteger(args[k])||args[k]<1||args[k]>20000)fail('image_metadata_invalid');
    if(args.width*args.height>60000000||!args.file_name||args.file_name.length>180||/[\x00-\x1f/\\]/.test(args.file_name))fail('image_metadata_invalid');
    const row=await exercise(admin,c,args);version(row,args.expected_updated_at);
    if(!row.payload.visual_removed&&row.payload.visual_image?.sha256===args.sha256&&(row.payload.visual_storage_path||row.payload.visual_url))return {already_linked:true,exercise:snapshot(row)};
    const extension={'image/png':'png','image/jpeg':'jpg','image/webp':'webp'}[args.mime_type];
    const path=c.team_id+'/exercise-images/'+row.id+'/'+crypto.randomUUID()+'.'+extension;
    const t={version:1,connector:c.id,team:c.team_id,id:row.id,expected:row.updated_at,path,expires:Date.now()+30*60000,sha256:args.sha256,size_bytes:args.size_bytes,mime_type:args.mime_type,width:args.width,height:args.height,file_name:args.file_name};
    const {data,error}=await admin.storage.from(BUCKET).createSignedUploadUrl(path,{upsert:false});if(error)throw error;
    return {already_linked:false,exercise:snapshot(row),method:'PUT',upload_url:data.signedUrl,headers:{'Content-Type':args.mime_type,'x-upsert':'false'},ticket:await signImageTicket(t,secret),complete_before:new Date(t.expires).toISOString()};
  }
  if(name==='complete_exercise_image_upload') {
    const t=await verifyImageTicket(args.ticket,secret,c),row=await exercise(admin,c,{id:t.id});
    if(!row.payload.visual_removed&&row.payload.visual_storage_path===t.path&&row.payload.visual_image?.sha256===t.sha256)return {verified:true,already_linked:true,exercise:snapshot(row)};
    version(row,t.expected);
    const url=await privateLink(admin,t.path);
    const bytes=await readImageResponse(await fetch(url,{signal:AbortSignal.timeout(30000)}));
    const meta=imageInfo(bytes),hash=await imageHash(bytes);
    if(hash!==t.sha256||meta.size_bytes!==t.size_bytes||meta.mime_type!==t.mime_type||meta.width!==t.width||meta.height!==t.height)fail('original_bytes_or_metadata_mismatch');
    const payload={...row.payload,visual_removed:false,visual_storage_path:t.path,visual_storage_bucket:BUCKET,visual_image:{...meta,sha256:hash,file_name:t.file_name,source:'approved_original_upload',verified_at:new Date().toISOString()}};
    delete payload.visual_url;delete payload.visual_data_url;
    const saved=await saveImage(admin,c,row,payload,'image:'+c.id+':'+await imageHash(enc.encode(t.path)));
    if(saved.payload.visual_storage_path!==t.path)fail('record_changed_after_upload');
    return {verified:true,already_linked:false,exercise:snapshot(saved)};
  }
  if(name==='remove_exercise_image') {
    if(args.confirmed!==true)fail('image_removal_confirmation_required');
    const row=await exercise(admin,c,args);version(row,args.expected_updated_at);
    const payload={...row.payload,visual_removed:true};for(const k of ['visual_url','visual_data_url','visual_storage_path','visual_storage_bucket','visual_image'])delete payload[k];
    const saved=await saveImage(admin,c,row,payload,'image-remove:'+c.id+':'+row.id+':'+row.updated_at);return {removed:true,exercise:snapshot(saved)};
  }
  fail('unknown_image_tool');
}
