"use strict";
(function(root){
  const L=root.Learning||require("./learning.js");
  // Mirrors the local HTML escape helper in training_session_ui.js.
  const esc=x=>String(x??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
  const safeUrl=x=>{try{const u=new URL(String(x));return /^https?:$/.test(u.protocol)?u.href:null;}catch{return null;}};
  const count=p=>`${Number(p?.seen||0)}/${Number(p?.total||0)} vistos`;
  const external=(url,label)=>{const href=safeUrl(url);return href?`<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(label)}</a>`:"";};
  const list=values=>`<ul>${(Array.isArray(values)?values:[]).map(v=>`<li>${esc(v)}</li>`).join("")}</ul>`;
  function renderHome(groups,progressByCode={}){
    return `<div class="learning-groups">${(groups||[]).map(g=>g.active
      ?`<a class="panel" href="#/formacao/${encodeURIComponent(g.code)}">${esc(g.name)} · ${count(progressByCode[g.code])}</a>`
      :`<div class="panel learning-soon">${esc(g.name)} <span class="badge">em breve</span></div>`).join("")}</div>`;
  }
  function renderAgeGroup(group,modules,progressByModule={}){
    const code=encodeURIComponent(group.code);
    return `<p><a href="#/formacao">← Formação</a></p><h2>${esc(group.name)}</h2>`+L.BLOCKS.map(b=>
      `<section class="learning-block"><h3>${esc(b.title)}</h3><div class="learning-modules">${(modules||[]).filter(m=>m.block===b.id).map(m=>
        `<a class="panel" href="#/formacao/${code}/${encodeURIComponent(m.slug)}">${esc(m.title)} · ${count(progressByModule[m.id])}</a>`).join("")}</div></section>`).join("");
  }
  function controls(row,table){const id=esc(row.id);return `<div class="learning-controls"><button type="button" data-learning-action="${row.seen_at?"unseen":"seen"}" data-table="${table}" data-id="${id}">${row.seen_at?"Marcar por ver":"Marcar visto"}</button>${table==="learning_items"?`<button type="button" data-learning-action="broken" data-id="${id}">Link partido</button>`:""}<label>Notas<textarea data-learning-notes data-table="${table}" data-id="${id}">${esc(row.notes)}</textarea></label></div>`;}
  function renderModule(module,guide,items,kind="ver"){
    const base=`#/formacao/${encodeURIComponent(module.age_group_code)}/${encodeURIComponent(module.slug)}`;
    let html=`<p><a href="#/formacao/${encodeURIComponent(module.age_group_code)}">← ${esc(module.age_group_code)}</a></p><h2>${esc(module.title)}</h2>`;
    html+=`<section class="panel learning-guide"><h3>Guia-síntese</h3>${guide?.status==="aprovado"?`<p>${esc(guide.body_md).replace(/\r?\n/g,"<br>")}</p><div>${(Array.isArray(guide.citations)?guide.citations:[]).map(c=>external(c.url||c, c.title||c.idea||"Fonte")).join(" · ")}</div>`:"<p>Guia-síntese ainda por aprovar.</p>"}</section>`;
    if(module.slug==="treinos-exemplo"){
      const sessions=(items||[]).filter(L.isVisible);
      return html+(sessions.length?`<div class="learning-items">${sessions.map(s=>`<a class="panel" href="#/formacao/treino/${encodeURIComponent(s.id)}">${esc(s.title)} · ${esc(s.objective)}</a>`).join("")}</div>`:"<p>Ainda sem conteúdo aprovado. Pede ao agente para procurar conteúdo para este módulo.</p>");
    }
    html+=`<nav class="learning-tabs">${["ver","ler","seguir"].map(k=>`<a href="${base}/${k}" ${k===kind?'aria-current="page"':""}>${k[0].toUpperCase()+k.slice(1)}</a>`).join("")}</nav>`;
    const rows=L.byKind(items)[kind]||[];
    return html+(rows.length?`<div class="learning-items">${rows.map(r=>{
      const url=safeUrl(r.url),embed=r.media==="video"&&url?L.embedUrl(url):null;
      return `<article class="panel learning-item"><h3>${esc(r.title)}</h3><p>${esc(r.source)}</p><p>${esc(r.summary_pt)}</p>${list(r.key_points)}<p><strong>Porquê ${esc(kind)}</strong> ${esc(r.why)}</p>${embed?`<iframe loading="lazy" allowfullscreen src="${esc(embed)}" title="${esc(r.title)}"></iframe>`:url?external(url,"Abrir"):""}${controls(r,"learning_items")}</article>`;
    }).join("")}</div>`:"<p>Ainda sem conteúdo aprovado. Pede ao agente para procurar conteúdo para este módulo.</p>");
  }
  function renderSession(s){
    const phase={inicio:"Início",meio:"Meio",fim:"Fim"};
    return `<p><a href="#/formacao">← Formação</a></p><article class="learning-session"><h2>${esc(s.title)}</h2><p><strong>Objetivo:</strong> ${esc(s.objective)}</p><p><strong>Pilares:</strong> ${(Array.isArray(s.pillars)?s.pillars:[]).map(esc).join(" · ")}</p><p><strong>Duração:</strong> ${esc(s.duration_min)} min · <strong>Fase:</strong> ${esc(phase[s.season_phase]||"")} da época</p><p><strong>Material:</strong> ${esc(s.equipment)}</p><h3>Porquê este treino</h3><p>${esc(s.why)}</p>${(Array.isArray(s.exercises)?s.exercises:[]).map(e=>`<section class="panel learning-exercise"><h3>${esc(e.fase)}</h3><p><strong>Organização:</strong> ${esc(e.organizacao)}</p><p><strong>Regras:</strong> ${esc(e.regras)}</p><p><strong>Variantes:</strong> ${esc(e.variantes)}</p><h4>Pontos de ensino</h4>${list(e.pontos_ensino)}<h4>Erros comuns</h4>${list(e.erros_comuns)}</section>`).join("")}${controls(s,"learning_sessions")}</article>`;
  }
  function syncNav(){if(typeof document!=="undefined")document.querySelectorAll('[data-tab="formacao"]').forEach(a=>a.hidden=!L.isEnabled());}
  let bound=false;
  function bind(){if(bound||typeof document==="undefined")return;bound=true;const app=document.getElementById("app");if(!app)return;
    app.addEventListener("click",async event=>{const button=event.target.closest("[data-learning-action]");if(!button)return;const action=button.dataset.learningAction,id=button.dataset.id,table=button.dataset.table||"learning_items";button.disabled=true;try{const store=root.LearningStore.store;if(action==="seen"||action==="unseen")await store.markSeen(table,id,action==="seen");else if(action==="broken")await store.markBroken(id);await view((location.hash||"#/formacao").slice(1).split("/").filter(Boolean));}catch(error){root.setView("Formação",`<div class="notice">${esc(error.message)}</div>`,"Formação");}});
    app.addEventListener("change",async event=>{const field=event.target.closest("[data-learning-notes]");if(!field)return;try{await root.LearningStore.store.saveNotes(field.dataset.table,field.dataset.id,field.value);}catch(error){root.setView("Formação",`<div class="notice">${esc(error.message)}</div>`,"Formação");}});
  }
  async function view(parts){
    if(!L.isEnabled()){root.setView("Formação",'<div class="notice">A secção Formação está desligada. Liga-a em Definições.</div>',"Formação");return;}
    root.setView("Formação",'<div class="notice">A carregar…</div>',"Formação");
    try{
      const store=root.LearningStore.store;let html="",title="Formação";
      if(parts[1]==="treino"&&parts[2]){const session=await store.getSession(parts[2]);if(!session)throw new Error("Treino-exemplo não encontrado.");title=session.title;html=renderSession(session);}
      else if(!parts[1]){const groups=await store.listAgeGroups(),progress={};for(const g of groups.filter(x=>x.active)){const modules=await store.listModules(g.code),items=await store.listItems(modules.map(m=>m.id)),trainingModule=modules.find(m=>m.slug==="treinos-exemplo"),sessions=trainingModule?await store.listSessions(trainingModule.id):[];progress[g.code]=L.progress(items.concat(sessions));}html=renderHome(groups,progress);}
      else {const groups=await store.listAgeGroups(),group=groups.find(g=>g.code===parts[1]&&g.active);if(!group)throw new Error("Escalão não disponível.");const modules=await store.listModules(group.code);title=group.name;
        if(!parts[2]){const items=await store.listItems(modules.map(m=>m.id)),progress={};for(const m of modules){const rows=m.slug==="treinos-exemplo"?await store.listSessions(m.id):items.filter(i=>i.module_id===m.id);progress[m.id]=L.progress(rows);}html=renderAgeGroup(group,modules,progress);}
        else {const module=modules.find(m=>m.slug===parts[2]);if(!module)throw new Error("Módulo não encontrado.");module.age_group_code=group.code;title=module.title;const guide=await store.getGuide(module.id),items=module.slug==="treinos-exemplo"?await store.listSessions(module.id):await store.listItems([module.id]);html=renderModule(module,guide,items,["ver","ler","seguir"].includes(parts[3])?parts[3]:"ver");}}
      root.setView(title,html,"Formação");bind();
    }catch(error){root.setView("Formação",`<div class="notice">${esc(error.message)}</div>`,"Formação");}
  }
  const api={view,renderHome,renderAgeGroup,renderModule,renderSession,syncNav};root.FormacaoUI=api;if(typeof module!=="undefined"&&module.exports)module.exports=api;
})(globalThis);
