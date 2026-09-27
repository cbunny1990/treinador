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
  function utcDay(iso){const m=String(iso||"").match(/^(\d{4})-(\d{2})-(\d{2})$/);return m?Date.UTC(Number(m[1]),Number(m[2])-1,Number(m[3])):NaN;}
  function currentWeek(weeks,todayISO){
    const sorted=[...(weeks||[])].sort((a,b)=>a.starts_on.localeCompare(b.starts_on)||a.week_no-b.week_no);
    if(!sorted.length)return null;
    const today=utcDay(todayISO);
    if(!Number.isFinite(today))return sorted[0];
    for(const week of sorted){const start=utcDay(week.starts_on);if(today>=start&&today<start+7*86400000)return week;}
    return today<utcDay(sorted[0].starts_on)?sorted[0]:sorted[sorted.length-1];
  }
  function groupWeeksByBlock(weeks){
    const groups=new Map();
    for(const week of weeks||[]){if(!groups.has(week.block_no))groups.set(week.block_no,{block_no:week.block_no,block_title:week.block_title,weeks:[]});groups.get(week.block_no).weeks.push(week);}
    return [...groups.values()].sort((a,b)=>a.block_no-b.block_no).map(group=>({...group,weeks:group.weeks.slice().sort((a,b)=>a.week_no-b.week_no)}));
  }
  function filterLibrary(sessions,filters={}){
    return (sessions||[]).filter(session=>session?.status==="aprovado"&&
      (!filters.pillar||(session.pillars||[]).includes(filters.pillar))&&
      (!filters.block||Number(session.season_block)===Number(filters.block))&&
      (!filters.focus||session.focus===filters.focus))
      .slice().sort((a,b)=>String(a.library_code||"").localeCompare(String(b.library_code||"")));
  }
  function focuses(sessions){return [...new Set((sessions||[]).map(session=>session?.focus).filter(focus=>typeof focus==="string"&&focus.length>0))].sort((a,b)=>a.localeCompare(b));}
  function aggregateMaterial(exercises){
    const materials=new Map();
    for(const exercise of Array.isArray(exercises)?exercises:[])for(const entry of Array.isArray(exercise?.material)?exercise.material:[]){
      const item=String(entry?.item??"").trim(),key=item.toLocaleLowerCase("pt-PT").replace(/\s+/g," "),qtd=Number(entry?.qtd);
      if(!item||!Number.isFinite(qtd)||qtd<0)continue;
      if(!materials.has(key))materials.set(key,{item,qtd});else materials.get(key).qtd=Math.max(materials.get(key).qtd,qtd);
    }
    return [...materials.values()];
  }
  const BLOCKS=[{id:"jogador",title:"O jogador"},{id:"ensinar",title:"O que ensinar"},{id:"treinador",title:"O treinador"}];
  const api={FLAG_KEY,isEnabled,setEnabled,normalizeUrl,youtubeId,embedUrl,isVisible,byKind,progress,currentWeek,groupWeeksByBlock,filterLibrary,focuses,aggregateMaterial,BLOCKS};
  root.Learning=api;if(typeof module!=="undefined"&&module.exports)module.exports=api;
})(globalThis);
