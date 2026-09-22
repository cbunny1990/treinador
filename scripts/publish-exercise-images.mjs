#!/usr/bin/env node
// Node 22+. One command, no dependencies, no image re-encoding and no public upload.
import { readFile, stat } from 'node:fs/promises';
import { resolve, dirname, basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import { imageInfo, imageHash, readImageResponse, IMAGE_LIMIT } from '../supabase/functions/vision-coach-mcp/image_uploads.mjs';
const DEFAULT_ENDPOINT='https://rsydvhbsxzdoprekefij.supabase.co/functions/v1/vision-coach-mcp';
export function parseOptions(argv){
  const options={};
  for(let i=0;i<argv.length;i++){
    const k=argv[i];
    if(['--help','--approved','--dry-run'].includes(k)){options[k.slice(2)]=true;continue;}
    if(!['--manifest','--file','--exercise','--external-key'].includes(k)||!argv[i+1]||argv[i+1].startsWith('--'))throw new Error('invalid_cli_arguments');
    options[k.slice(2)]=argv[++i];
  }
  return options;
}
export async function loadInputs(options){
  let rows,base=process.cwd();
  if(options.manifest){const file=resolve(options.manifest);base=dirname(file);rows=JSON.parse(await readFile(file,'utf8')).images;}
  else rows=[{file:options.file,id:options.exercise,external_key:options['external-key'],approved:options.approved}];
  if(!Array.isArray(rows)||!rows.length||rows.length>50)throw new Error('manifest_requires_1_to_50_images');
  const seen=new Set(),out=[];
  for(const row of rows){
    if(!row.file||row.approved!==true||Boolean(row.id)===Boolean(row.external_key))throw new Error('file_approval_and_exact_identifier_required');
    const key=row.id||row.external_key;if(seen.has(key))throw new Error('duplicate_exercise_in_manifest');seen.add(key);
    const file=resolve(base,row.file),size=(await stat(file)).size;if(size>IMAGE_LIMIT)throw new Error('image_size_invalid');
    const bytes=new Uint8Array(await readFile(file)),meta=imageInfo(bytes),sha256=await imageHash(bytes);
    if(row.sha256&&row.sha256!==sha256)throw new Error('approved_original_hash_mismatch');
    out.push({selector:row.id?{id:row.id}:{external_key:row.external_key},bytes,meta:{...meta,sha256,file_name:basename(file)},approved:true});
  }
  return out;
}
export function rpcClient(endpoint,token){
  const url=new URL(endpoint);
  if(url.protocol!=='https:'||!url.hostname.endsWith('.supabase.co')||url.username||url.password||url.pathname!=='/functions/v1/vision-coach-mcp')throw new Error('untrusted_mcp_endpoint');
  if(!String(token||'').startsWith('vcmcp_'))throw new Error('VISION_COACH_TOKEN_required');
  return async(name,args)=>{
    const r=await fetch(endpoint,{method:'POST',redirect:'error',signal:AbortSignal.timeout(60000),headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:crypto.randomUUID(),method:'tools/call',params:{name,arguments:args}})});
    if(!r.ok)throw new Error('mcp_http_'+r.status);
    const body=await r.json(),data=body.result?.structuredContent;
    if(body.error||body.result?.isError||!data)throw new Error(String(data?.error||body.error?.message||'mcp_invalid_response').replace(/[^a-zA-Z0-9_: -]/g,'').slice(0,140));
    return data;
  };
}
export async function publishInputs(inputs,call){
  // Resolve every target before the first mutation. A batch is resumable, not a DB transaction.
  const prepared=[];
  for(const input of inputs)prepared.push({...input,current:await call('get_exercise_image',input.selector)});
  const results=[];
  for(const input of prepared){
    try {
      const start=await call('prepare_exercise_image_upload',{id:input.current.id,approved:true,expected_updated_at:input.current.updated_at,...input.meta});
      let completed=start;
      if(!start.already_linked){
        const u=new URL(start.upload_url);
        if(u.protocol!=='https:'||!u.hostname.endsWith('.supabase.co')||!u.pathname.startsWith('/storage/v1/object/upload/sign/team-media/')||u.username||u.password)throw new Error('untrusted_upload_destination');
        const upload=await fetch(u,{method:'PUT',redirect:'error',headers:start.headers,body:input.bytes,signal:AbortSignal.timeout(120000)});
        if(!upload.ok)throw new Error('upload_http_'+upload.status);
        completed=await call('complete_exercise_image_upload',{ticket:start.ticket});
      }
      const saved=await call('get_exercise_image',{id:input.current.id,download:true});
      if(saved.image?.sha256!==input.meta.sha256||saved.visual_removed)throw new Error('published_reference_mismatch');
      const source=saved.download_url||saved.visual_url;
      if(!source||new URL(source).protocol!=='https:')throw new Error('verification_url_missing');
      // No connector credential is ever forwarded to file URLs.
      const bytes=await readImageResponse(await fetch(source,{redirect:'error',signal:AbortSignal.timeout(60000)}));
      if(await imageHash(bytes)!==input.meta.sha256)throw new Error('published_bytes_mismatch');
      results.push({id:saved.id,external_key:saved.external_key,verified:true,already_linked:!!completed.already_linked,...input.meta});
    }catch(error){results.push({id:input.current.id,verified:false,error:String(error.message).slice(0,160)});}
  }
  return {ok:results.every(x=>x.verified),images:results};
}
export async function main(argv=process.argv.slice(2)){
  const opts=parseOptions(argv);
  if(opts.help){console.log('npm run images:publish -- --manifest approved-images.json [--dry-run]\nOr: --file /path/original.png --exercise UUID --approved\nVISION_COACH_TOKEN: authorized connector with read, write, media. Never pass it as a CLI argument.');return;}
  const inputs=await loadInputs(opts);
  if(opts['dry-run']){console.log(JSON.stringify({dry_run:true,images:inputs.map(x=>({...x.selector,...x.meta}))},null,2));return;}
  const result=await publishInputs(inputs,rpcClient(process.env.VISION_COACH_MCP_URL||DEFAULT_ENDPOINT,process.env.VISION_COACH_TOKEN));
  console.log(JSON.stringify(result,null,2));if(!result.ok)process.exitCode=1;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(error=>{console.error('Image workflow failed: '+String(error.message).slice(0,160));process.exitCode=1;});
