"use strict";
(function(root){
  const L=root.Learning||require("./learning.js");
  const D=root.LearningDiagram||(typeof require==="function"?require("./learning_diagram.js"):null);
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
    return `<p><a href="#/formacao">← Formação</a></p><h2>${esc(group.name)}</h2><div class="learning-feature-links"><a class="panel" href="#/formacao/plano/${code}"><h3>Plano da época</h3><p>Semana a semana</p></a><a class="panel" href="#/formacao/biblioteca/${code}"><h3>Biblioteca de treinos</h3><p>Treinos completos reutilizáveis</p></a></div>`+L.BLOCKS.map(b=>
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
    const used=Array.isArray(s.usedInWeeks)?s.usedInWeeks:[];
    const exercises=Array.isArray(s.exercises)?s.exercises:[],hasV2=exercises.some(e=>["espaco","jogadores","duracao_min","material","preparacao","passos","diagrama"].some(key=>e?.[key]!=null));
    const level=String(s.library_code||"").match(/^T(\d{1,2})$/i)?.[1];
    const material=items=>Array.isArray(items)&&items.length?`<ul>${items.map(entry=>`<li>${esc(entry.item)} · ${esc(entry.qtd)}</li>`).join("")}</ul>`:"<p>Sem material indicado.</p>";
    const numbered=items=>`<ol>${(Array.isArray(items)?items:[]).map(item=>`<li>${esc(item)}</li>`).join("")}</ol>`;
    const exerciseHtml=e=>{
      const modern=["espaco","jogadores","duracao_min","material","preparacao","passos","diagrama"].some(key=>e?.[key]!=null);
      if(!modern)return `<section class="panel learning-exercise"><h3>${esc(e.fase)}</h3><p><strong>Organização:</strong> ${esc(e.organizacao)}</p><p><strong>Regras:</strong> ${esc(e.regras)}</p><p><strong>Variantes:</strong> ${esc(e.variantes)}</p><h4>Pontos de ensino</h4>${list(e.pontos_ensino)}<h4>Erros comuns</h4>${list(e.erros_comuns)}</section>`;
      const hasSteps=Array.isArray(e.passos)&&e.passos.length>0;
      const diagram=D?.render(e.diagrama,{title:e.fase})||"";
      return `<section class="panel learning-exercise"><h3>${esc(e.fase)}</h3>${diagram?`<figure class="learning-diagram">${diagram}${e.diagrama?.legenda?`<figcaption class="learning-diagram-caption">${esc(e.diagrama.legenda)}</figcaption>`:""}</figure>`:""}<p><strong>Espaço:</strong> ${esc(e.espaco)} · <strong>Jogadores:</strong> ${esc(e.jogadores)} · <strong>Duração:</strong> ${esc(e.duracao_min)} min</p>${hasSteps?(e.mais_criancas?`<p><strong>Com mais crianças:</strong> ${esc(e.mais_criancas)}</p>`:""):`<p><strong>Organização:</strong> ${esc(e.organizacao)}</p>`}<h4>Material</h4>${material(e.material)}<h4>Como preparar</h4>${numbered(e.preparacao)}<h4>Passo a passo</h4>${numbered(e.passos)}<p><strong>Regras:</strong> ${esc(e.regras)}</p><h4>Pontos de ensino</h4>${list(e.pontos_ensino)}<h4>Erros comuns</h4>${list(e.erros_comuns)}<h4>Variantes</h4>${list(Array.isArray(e.variantes)?e.variantes:[e.variantes])}</section>`;
    };
    const sessionMaterial=hasV2?L.aggregateMaterial(exercises):[];
    return `<p><a href="#/formacao">← Formação</a></p><article class="learning-session"><h2>${esc(s.title)}</h2>${level?`<p><strong>Nível ${esc(Number(level))} de 30</strong></p>`:""}${s.library_code?`<p><strong>Código:</strong> ${esc(s.library_code)}</p>`:""}${s.focus?`<p><strong>Foco:</strong> ${esc(s.focus)}</p>`:""}${used.length?`<p><strong>Usado nas semanas:</strong> ${used.map(esc).join(", ")}</p>`:""}${s.progression?`<h3>Progressão</h3><p>${esc(s.progression)}</p>`:""}<p><strong>Objetivo:</strong> ${esc(s.objective)}</p><p><strong>Pilares:</strong> ${(Array.isArray(s.pillars)?s.pillars:[]).map(esc).join(" · ")}</p><p><strong>Duração:</strong> ${esc(s.duration_min)} min · <strong>Fase:</strong> ${esc(phase[s.season_phase]||"")} da época</p><p><strong>Material:</strong> ${esc(s.equipment)}</p>${hasV2?`<h3>Material para o treino</h3>${material(sessionMaterial)}`:""}<h3>Porquê este treino</h3><p>${esc(s.why)}</p>${exercises.map(exerciseHtml).join("")}${controls(s,"learning_sessions")}</article>`;
  }
  function renderSeasonPlan(plan,weeks,sessionsById={},todayISO=new Date().toISOString().slice(0,10)){
    if(!plan)return `<p><a href="#/formacao">← Formação</a></p><h2>Plano da época</h2><p>Ainda não há plano da época aprovado.</p>`;
    const current=L.currentWeek(weeks,todayISO),groups=L.groupWeeksByBlock(weeks);
    const date=iso=>{const d=new Date(`${iso}T00:00:00Z`);return Number.isNaN(d.getTime())?esc(iso):d.toLocaleDateString("pt-PT",{timeZone:"UTC"});};
    return `<p><a href="#/formacao">← Formação</a></p><h2>${esc(plan.title||"Plano da época")}</h2><p>${esc(plan.season_label||"")}</p>${groups.map(group=>`<section class="learning-plan-block"><h3>${esc(group.block_title)}</h3><div class="learning-plan-weeks">${group.weeks.map(week=>{
      const isCurrent=current===week,sessionLink=id=>{const session=sessionsById[id];return id?`<a href="#/formacao/treino/${encodeURIComponent(id)}">${esc(session?.library_code?`${session.library_code} · `:"")}${esc(session?.title||"Treino-exemplo")}</a>`:""};
      return `<article class="panel learning-plan-week${week.is_break?" learning-break":""}${isCurrent?" learning-current-week":""}" ${isCurrent?'data-current-week="true"':""}><h4>Semana ${esc(week.week_no)} · ${date(week.starts_on)}${isCurrent?' <span class="badge">Esta semana</span>':""}</h4><p>${esc(week.objective)}</p>${week.is_break?"<p>Pausa</p>":`<p>Treino A: ${sessionLink(week.session_a_id)}</p><p>Treino B: ${sessionLink(week.session_b_id)}</p>`}</article>`;
    }).join("")}</div></section>`).join("")}`;
  }
  function renderLibrary(group,sessions,filters={},focusOptions=[]){
    const level=s=>{const value=String(s.library_code||"").match(/^T(\d{1,2})$/i);return value?Number(value[1]):Number.MAX_SAFE_INTEGER;};
    const rows=L.filterLibrary(sessions,filters).sort((a,b)=>level(a)-level(b)||String(a.library_code||"").localeCompare(String(b.library_code||""))),pillars=[...new Set((sessions||[]).flatMap(s=>Array.isArray(s.pillars)?s.pillars:[]))].sort((a,b)=>String(a).localeCompare(String(b)));
    const select=(key,label,values)=>`<label>${label}<select data-learning-filter="${key}"><option value="">Todos</option>${values.map(value=>`<option value="${esc(value)}" ${String(filters[key]??"")===String(value)?"selected":""}>${esc(value)}</option>`).join("")}</select></label>`;
    return `<p><a href="#/formacao/${encodeURIComponent(group.code)}">← ${esc(group.name)}</a></p><h2>Biblioteca de treinos</h2><div class="learning-library-filters">${select("pillar","Pilar",pillars)}${select("block","Bloco",[...new Set((sessions||[]).map(s=>s.season_block).filter(Boolean))].sort((a,b)=>a-b))}${select("focus","Foco",focusOptions)}</div>${rows.length?`<div class="learning-items">${rows.map(s=>{const n=level(s);return `<a class="panel learning-library-item" href="#/formacao/treino/${encodeURIComponent(s.id)}"><strong>${esc(s.library_code)}</strong> · ${esc(s.title)}${n<31?`<p>Nível ${n}</p>`:""}<p>${esc(s.focus)} · ${(Array.isArray(s.pillars)?s.pillars:[]).map(esc).join(" · ")} · ${esc(s.duration_min)} min · Bloco ${esc(s.season_block)}</p></a>`;}).join("")}</div>`:"<p>Não há treinos aprovados para estes filtros.</p>"}`;
  }
  function syncNav(){if(typeof document!=="undefined")document.querySelectorAll('[data-tab="formacao"]').forEach(a=>a.hidden=!L.isEnabled());}
  let bound=false;
  function bind(){if(bound||typeof document==="undefined")return;bound=true;const app=document.getElementById("app");if(!app)return;
    app.addEventListener("click",async event=>{const button=event.target.closest("[data-learning-action]");if(!button)return;const action=button.dataset.learningAction,id=button.dataset.id,table=button.dataset.table||"learning_items";button.disabled=true;try{const store=root.LearningStore.store;if(action==="seen"||action==="unseen")await store.markSeen(table,id,action==="seen");else if(action==="broken")await store.markBroken(id);await view((location.hash||"#/formacao").slice(1).split("/").filter(Boolean));}catch(error){root.setView("Formação",`<div class="notice">${esc(error.message)}</div>`,"Formação");}});
    app.addEventListener("change",async event=>{const filter=event.target.closest("[data-learning-filter]");if(filter){const parts=(location.hash||"#/formacao").slice(1).split("/").filter(Boolean),code=parts[2];libraryFilters[code]={...(libraryFilters[code]||{}),[filter.dataset.learningFilter]:filter.value};await view(parts);return;}const field=event.target.closest("[data-learning-notes]");if(!field)return;try{await root.LearningStore.store.saveNotes(field.dataset.table,field.dataset.id,field.value);}catch(error){root.setView("Formação",`<div class="notice">${esc(error.message)}</div>`,"Formação");}});
  }
  const libraryFilters={};
  async function view(parts){
    if(!L.isEnabled()){root.setView("Formação",'<div class="notice">A secção Formação está desligada. Liga-a em Definições.</div>',"Formação");return;}
    root.setView("Formação",'<div class="notice">A carregar…</div>',"Formação");
    try{
      const store=root.LearningStore.store;let html="",title="Formação";
      if(parts[1]==="treino"&&parts[2]){const session=await store.getSession(parts[2]);if(!session)throw new Error("Treino-exemplo não encontrado.");const groups=await store.listAgeGroups();for(const group of groups){const module=(await store.listModules(group.code)).find(row=>row.id===session.module_id);if(!module)continue;const season=await store.getSeasonPlan(group.code);session.usedInWeeks=season.weeks.filter(week=>week.session_a_id===session.id||week.session_b_id===session.id).map(week=>week.week_no);break;}title=session.title;html=renderSession(session);}
      else if(!parts[1]){const groups=await store.listAgeGroups(),progress={};for(const g of groups.filter(x=>x.active)){const modules=await store.listModules(g.code),items=await store.listItems(modules.map(m=>m.id)),trainingModule=modules.find(m=>m.slug==="treinos-exemplo"),sessions=trainingModule?await store.listSessions(trainingModule.id):[];progress[g.code]=L.progress(items.concat(sessions));}html=renderHome(groups,progress);}
      else if(parts[1]==="plano"||parts[1]==="biblioteca"){
        const groups=await store.listAgeGroups(),group=groups.find(g=>g.code===parts[2]&&g.active);if(!group)throw new Error("Escalão não disponível.");
        if(parts[1]==="plano"){
          const {plan,weeks}=await store.getSeasonPlan(group.code),sessions=await store.listLibrary(group.code),sessionsById=Object.fromEntries(sessions.map(session=>[session.id,session]));
          const used=new Map();for(const week of weeks)for(const id of [week.session_a_id,week.session_b_id])if(id){if(!used.has(id))used.set(id,[]);used.get(id).push(week.week_no);}
          for(const [id,session] of Object.entries(sessionsById))session.usedInWeeks=used.get(id)||[];
          title="Plano da época";html=renderSeasonPlan(plan,weeks,sessionsById,new Date().toISOString().slice(0,10));
        }else{const sessions=await store.listLibrary(group.code),filters=libraryFilters[group.code]||{};title="Biblioteca de treinos";html=renderLibrary(group,sessions,filters,L.focuses(sessions));}
      }
      else {const groups=await store.listAgeGroups(),group=groups.find(g=>g.code===parts[1]&&g.active);if(!group)throw new Error("Escalão não disponível.");const modules=await store.listModules(group.code);title=group.name;
        if(!parts[2]){const items=await store.listItems(modules.map(m=>m.id)),progress={};for(const m of modules){const rows=m.slug==="treinos-exemplo"?await store.listSessions(m.id):items.filter(i=>i.module_id===m.id);progress[m.id]=L.progress(rows);}html=renderAgeGroup(group,modules,progress);}
        else {const module=modules.find(m=>m.slug===parts[2]);if(!module)throw new Error("Módulo não encontrado.");module.age_group_code=group.code;title=module.title;const guide=await store.getGuide(module.id),items=module.slug==="treinos-exemplo"?await store.listSessions(module.id):await store.listItems([module.id]);html=renderModule(module,guide,items,["ver","ler","seguir"].includes(parts[3])?parts[3]:"ver");}}
      root.setView(title,html,"Formação");bind();if(parts[1]==="plano"&&typeof requestAnimationFrame==="function")requestAnimationFrame(()=>document.querySelector("[data-current-week]")?.scrollIntoView({block:"center"}));
    }catch(error){root.setView("Formação",`<div class="notice">${esc(error.message)}</div>`,"Formação");}
  }
  const api={view,renderHome,renderAgeGroup,renderModule,renderSession,renderSeasonPlan,renderLibrary,syncNav};root.FormacaoUI=api;if(typeof module!=="undefined"&&module.exports)module.exports=api;
})(globalThis);
