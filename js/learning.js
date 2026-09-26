"use strict";
(function(root){
  const FLAG_KEY="vision.learning.enabled";
  const TRACKING=/^(utm_.+|fbclid|gclid|si|feature)$/i;
  function store(s){if(s)return s;try{return root.localStorage;}catch{return null;}}
  function isEnabled(s){try{return store(s)?.getItem(FLAG_KEY)==="1";}catch{return false;}}
  function setEnabled(on,s){try{const st=store(s);if(!st)return;on?st.setItem(FLAG_KEY,"1"):st.removeItem(FLAG_KEY);}catch{}}
  function youtubeId(raw){
    let u;try{u=new URL(String(raw).trim());}catch{return null;}
    const h=u.hostname.toLowerCase().replace(/^www\.|^m\./,"");
    if(h==="youtu.be")return u.pathname.slice(1).split("/")[0]||null;
    if(h==="youtube.com"||h==="youtube-nocookie.com"){
      if(u.pathname==="/watch")return u.searchParams.get("v");
      const m=u.pathname.match(/^\/(shorts|embed|live)\/([^/]+)/);return m?m[2]:null;
    }
    return null;
  }
  function normalizeUrl(raw){
    const id=youtubeId(raw);if(id)return `https://youtube.com/watch?v=${id}`;
    const u=new URL(String(raw).trim());u.protocol="https:";u.hash="";
    u.hostname=u.hostname.toLowerCase().replace(/^www\./,"");
    for(const k of [...u.searchParams.keys()])if(TRACKING.test(k))u.searchParams.delete(k);
    if(u.pathname.length>1)u.pathname=u.pathname.replace(/\/+$/,"");
    return u.toString().replace(/\?$/,"");
  }
  function embedUrl(url){const id=youtubeId(url);return id?`https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}`:null;}
  function isVisible(r){return r?.status==="aprovado"&&!r.broken;}
  function byKind(items){const g={ver:[],ler:[],seguir:[]};for(const r of items||[])if(isVisible(r)&&g[r.kind])g[r.kind].push(r);return g;}
  function progress(rows){const v=(rows||[]).filter(isVisible);return{seen:v.filter(r=>r.seen_at).length,total:v.length};}
  const BLOCKS=[{id:"jogador",title:"O jogador"},{id:"ensinar",title:"O que ensinar"},{id:"treinador",title:"O treinador"}];
  const api={FLAG_KEY,isEnabled,setEnabled,normalizeUrl,youtubeId,embedUrl,isVisible,byKind,progress,BLOCKS};
  root.Learning=api;if(typeof module!=="undefined"&&module.exports)module.exports=api;
})(globalThis);
