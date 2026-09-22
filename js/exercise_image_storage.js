"use strict";
// Private originals are resolved per authorized account; signed URLs never enter sync payloads.
(function(root){
  const CACHE='vision-coach-private-images-v1',MAX=16*1024*1024;
  const images=new Map(),owned=new Set(),pending=new Map();let user=null,team=null,epoch=0,subscribed=null;
  function resetMemory(){epoch++;for(const url of owned)URL.revokeObjectURL(url);owned.clear();images.clear();pending.clear();}
  async function clear(){resetMemory();user=null;team=null;try{await caches.delete(CACHE);}catch(_){} }
  async function hash(bytes){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');}
  async function load(row,client,account,selected,generation){
    const path=row.visual_storage_path,expected=row.visual_image?.sha256;
    if(!path.startsWith(selected+'/exercise-images/')||path.includes('..')||!/^[0-9a-f]{64}$/.test(expected||''))return;
    const key=account+'|'+path+'|'+expected;if(images.has(key))return;
    if(pending.has(key))return pending.get(key);
    const operation=(async()=>{
      const cacheKey=location.origin+'/__vision_private_image/'+encodeURIComponent(account)+'/'+encodeURIComponent(path)+'/'+expected;
      let cache=null,response=null;
      try{cache=await caches.open(CACHE);response=await cache.match(cacheKey);}catch(_){}
      if(!response){
        if(!navigator.onLine)return;
        const {data,error}=await client.storage.from('team-media').createSignedUrl(path,300);
        if(error||!data?.signedUrl)throw new Error('private_image_permission_or_link');
        response=await fetch(data.signedUrl,{cache:'no-store',signal:AbortSignal.timeout(30000)});
        if(!response.ok)throw new Error('private_image_download');
      }
      if(Number(response.headers.get('content-length')||0)>MAX)throw new Error('private_image_too_large');
      const blob=await response.blob();if(blob.size>MAX||!['image/png','image/jpeg','image/webp'].includes(blob.type))throw new Error('private_image_invalid');
      if(await hash(await blob.arrayBuffer())!==expected)throw new Error('private_image_integrity');
      if(generation!==epoch||account!==user||selected!==team)return;
      if(cache)await cache.put(cacheKey,new Response(blob,{headers:{'Content-Type':blob.type}})).catch(()=>{});
      const url=URL.createObjectURL(blob);owned.add(url);images.set(key,{src:url,width:row.visual_image.width,height:row.visual_image.height});
    })();
    pending.set(key,operation);
    try{await operation;}finally{pending.delete(key);}
  }
  async function resolve(rows){
    const wanted=(rows||[]).filter(x=>x.visual_storage_path&&!x.visual_removed);if(!wanted.length)return rows;
    try{
      const remote=root.RemoteWorkspace,client=await remote?.init(),session=await remote?.getSession();
      const account=session?.user?.id,selected=remote?.getConfig()?.remoteTeamId;
      if(!client||!account||!selected){resetMemory();user=null;team=null;return rows;}
      if(user!==account||team!==selected){resetMemory();user=account;team=selected;}
      if(subscribed!==client){subscribed=client;client.auth.onAuthStateChange(event=>{if(event==='SIGNED_OUT')void clear();});}
      const generation=epoch;
      // Bounded parallelism: large originals must not load 50 copies into memory at once.
      for(let start=0;start<wanted.length;start+=3)await Promise.all(wanted.slice(start,start+3).map(row=>load(row,client,account,selected,generation).catch(()=>{})));
    }catch(_){/* Keep text consultation usable; never substitute an unrelated illustration. */}
    return rows;
  }
  function source(row){if(row?.visual_removed||!user||!team)return null;return images.get(user+'|'+row?.visual_storage_path+'|'+row?.visual_image?.sha256)||null;}
  root.VisionExerciseImageStorage={resolve,source,clear,isOwnedBlob:value=>owned.has(value)};
})(globalThis);
