"use strict";

function tuEsc(value){
  return String(value == null ? "" : value).replace(/[&<>"']/g,(ch)=>({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  })[ch]);
}

function tuLines(value){
  return String(value || "").split(/\r?\n/).map((x)=>x.trim()).filter(Boolean);
}

function tuCsv(value){
  return String(value || "").split(",").map((x)=>x.trim()).filter(Boolean);
}

function tuListText(value){
  return Array.isArray(value) ? value.join("\n") : "";
}

function tuCsvText(value){
  return Array.isArray(value) ? value.join(", ") : "";
}

function tuExerciseRef(exercise){
  return TrainingPlanner.exerciseRef(exercise);
}

async function tuExercises(){
  const rows = await DB.listar("exercicios");
  await globalThis.VisionExerciseImageStorage?.resolve(rows);
  return TrainingPlanner.visionExercises(rows)
    .filter((x)=>(x.team_id || DEFAULT_TEAM_ID) === DEFAULT_TEAM_ID)
    .sort((a,b)=>String(a.nome).localeCompare(String(b.nome),"pt-PT"));
}

function tuVisualKind(exercise){
  const text=[exercise?.nome,exercise?.objetivo,...(exercise?.tags||[])].join(" ").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase();
  if(text.includes("saida curta")||text.includes("guarda-redes")||text.includes("pressao")) return "build";
  if(text.includes("jogo condicionado")||text.includes("acelerar")) return "conditioned";
  if(text.includes("jogo livre")||text.includes("avaliacao")) return "free";
  if(text.includes("terceiro homem")||text.includes("apoiar")) return "pass";
  return "activation";
}

function tuExerciseVisualSVG(exercise,compact){
  const kind=tuVisualKind(exercise);
  const title=tuEsc(exercise?.nome||"Exercício");
  const duration=Number(exercise?.duracao_total_min||exercise?.duracao_serie_min||0);
  const space=tuEsc(exercise?.espaco||"Campo");
  const player=(x,y,c,label)=>'<g><circle cx="'+x+'" cy="'+y+'" r="18" fill="'+c+'" stroke="#fff" stroke-width="4"/><circle cx="'+x+'" cy="'+(y-23)+'" r="8" fill="#f2c6a0"/>'+(label?'<text x="'+x+'" y="'+(y+5)+'" text-anchor="middle" fill="#fff" font-size="11" font-weight="800">'+label+'</text>':'')+'</g>';
  const cone=(x,y)=>'<path d="M '+(x-8)+' '+(y+8)+' L '+x+' '+(y-10)+' L '+(x+8)+' '+(y+8)+' Z" fill="#f97316"/>';
  const ball=(x,y)=>'<circle cx="'+x+'" cy="'+y+'" r="7" fill="#fff" stroke="#0f172a" stroke-width="2"/>';
  const arrow=(x1,y1,x2,y2,dash)=>'<line x1="'+x1+'" y1="'+y1+'" x2="'+x2+'" y2="'+y2+'" stroke="#fff" stroke-width="5" '+(dash?'stroke-dasharray="10 8"':'')+' marker-end="url(#arr)"/>';
  let field='';
  if(kind==="activation"){
    field=cone(125,175)+cone(675,175)+cone(125,425)+cone(675,425)+player(160,210,"#2563eb")+player(640,210,"#dc2626")+player(160,390,"#16a34a")+player(640,390,"#eab308")+ball(185,220)+arrow(205,220,565,220,false)+arrow(615,245,615,350,true)+arrow(570,385,230,385,true);
  }else if(kind==="pass"){
    field=cone(150,410)+cone(650,410)+cone(400,165)+player(190,380,"#2563eb","A")+player(610,380,"#dc2626","B")+player(400,205,"#eab308","C")+ball(220,380)+arrow(235,380,555,380,false)+arrow(585,350,430,235,false)+arrow(215,350,360,235,true);
  }else if(kind==="build"){
    field='<rect x="70" y="130" width="330" height="330" fill="rgba(255,255,255,.08)"/><line x1="400" y1="130" x2="400" y2="460" stroke="#fff" stroke-width="4" stroke-dasharray="12 10"/><rect x="48" y="250" width="36" height="90" fill="none" stroke="#fff" stroke-width="5"/>'+player(120,295,"#16a34a","GR")+ball(145,300)+player(230,185,"#2563eb")+player(230,405,"#2563eb")+player(330,295,"#2563eb")+player(470,205,"#dc2626")+player(480,300,"#dc2626")+player(470,395,"#dc2626")+player(650,295,"#2563eb")+arrow(155,290,210,200,false)+arrow(155,310,210,395,false)+arrow(255,205,315,280,false)+arrow(350,295,620,295,true);
  }else{
    const zone=kind==="conditioned"?'<rect x="70" y="130" width="240" height="330" fill="rgba(255,255,255,.10)"/><line x1="310" y1="130" x2="310" y2="460" stroke="#fff" stroke-width="4" stroke-dasharray="12 10"/>':'';
    field=zone+'<rect x="48" y="250" width="36" height="90" fill="none" stroke="#fff" stroke-width="5"/><rect x="716" y="250" width="36" height="90" fill="none" stroke="#fff" stroke-width="5"/>'+player(105,295,"#16a34a","GR")+player(215,190,"#2563eb")+player(215,400,"#2563eb")+player(365,235,"#2563eb")+player(380,365,"#2563eb")+player(685,295,"#eab308","GR")+player(560,185,"#dc2626")+player(560,405,"#dc2626")+player(455,225,"#dc2626")+player(455,370,"#dc2626")+ball(245,300)+arrow(130,295,195,205,false)+arrow(245,205,345,230,true)+arrow(395,245,535,195,true)+arrow(570,205,660,285,false);
  }
  return '<svg class="exercise-diagram-svg" viewBox="0 0 800 600" role="img" aria-label="Diagrama de '+title+'"><defs><marker id="arr" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto"><path d="M0,0 L0,6 L9,3 z" fill="#fff"/></marker></defs><rect width="800" height="600" rx="22" fill="#fff"/><rect x="0" y="0" width="800" height="82" rx="22" fill="#fff"/><rect x="28" y="18" width="54" height="54" rx="14" fill="#16a3a5"/><text x="55" y="55" text-anchor="middle" fill="#fff" font-size="28" font-weight="900">'+tuEsc(String(exercise?.visual_order||""))+'</text><text x="100" y="42" fill="#0f2744" font-size="'+(compact?18:22)+'" font-weight="900">'+title.slice(0,48)+'</text><text x="100" y="66" fill="#64748b" font-size="13">'+tuEsc(exercise?.escalao||"Sub-8")+' · '+duration+' min · '+space+'</text><rect x="40" y="105" width="720" height="380" rx="18" fill="#2f8f46"/><path d="M40 295 H760 M400 105 V485" stroke="rgba(255,255,255,.18)" stroke-width="2"/>'+field+'<rect x="40" y="505" width="720" height="70" rx="14" fill="#f8fafc"/><text x="60" y="532" fill="#0f2744" font-size="13" font-weight="900">OBJETIVO</text><text x="60" y="554" fill="#334155" font-size="12">'+tuEsc(String(exercise?.objetivo||"").slice(0,92))+'</text></svg>';
}

function tuExerciseVisualHTML(exercise,compact){
  const original=globalThis.VisionExerciseVisuals?.render(exercise,compact);
  if(original) return original;
  if(exercise?.visual_removed) return "";
  if(exercise?.visual_storage_path) return '<div class="notice">Imagem privada indisponível. Confirma a ligação à equipa e tenta novamente; o texto do exercício continua disponível.</div>';
  return '<div class="'+(compact?"exercise-visual-auto compact":"exercise-visual-auto")+'">'+tuExerciseVisualSVG(exercise,compact)+'</div>';
}

function tuExerciseCard(exercise){
  const search = [
    exercise.nome, exercise.objetivo, exercise.escalao,
    exercise.modelo, ...(exercise.tags || [])
  ].join(" ").toLowerCase();
  return '<article class="card exercise-card" data-exercise-card data-search="'+tuEsc(search)+'" data-favorite="'+(exercise.favorito?"1":"0")+'">'+
    '<a class="exercise-card-visual-link" href="#/exercicios/'+exercise.id+'">'+tuExerciseVisualHTML(exercise,true)+'</a>'+
    '<div class="row"><a class="grow" style="text-decoration:none" href="#/exercicios/'+exercise.id+'">'+
    '<span class="title">'+tuEsc(exercise.nome)+'</span>'+
    '<span class="meta">'+tuEsc([exercise.escalao,exercise.modelo,exercise.espaco].filter(Boolean).join(" · "))+'</span>'+
    '<span class="meta">'+tuEsc(exercise.objetivo || "")+'</span></a>'+
    '<button class="favorite-button '+(exercise.favorito?"active":"")+'" type="button" data-action="toggle-exercise-favorite" data-id="'+exercise.id+'" aria-label="Favorito">★</button></div></article>';
}

async function viewExercises(){
  const exercises = await tuExercises();
  const html = '<div class="section-head"><div><h2>Biblioteca de exercícios</h2><p>Exercícios reutilizáveis no workspace</p></div>'+
    '<div class="toolbar"><a class="btn secondary" href="#/treinos">Treinos</a><a class="btn accent" href="#/exercicios/novo">Novo exercício</a></div></div>'+
    '<div class="exercise-filter-bar"><input data-action="exercise-filter" placeholder="Pesquisar exercício, objetivo ou tag"><label class="favorite-filter"><input type="checkbox" data-action="exercise-favorites"> Só favoritos</label></div>'+
    (exercises.length?'<div class="exercise-grid">'+exercises.map(tuExerciseCard).join("")+'</div>':'<div class="empty">Ainda não existem exercícios Vision Coach nesta biblioteca.</div>');
  setView("Exercícios",html,"Planos");
}

async function viewExerciseForm(id){
  const old = id ? await DB.obter("exercicios",id) : null;
  const e = TrainingPlanner.normalizeExercise(old || { escalao:"Sub-8", modelo:"5x5-1-2-1", series:1 });
  let html='<section class="panel hero-main" style="max-width:880px"><form class="form" data-form="exercise" data-id="'+(id||"")+'">';
  html+='<div class="form-grid"><label class="field"><span>Nome</span><input name="nome" required value="'+tuEsc(e.nome)+'"></label><label class="field"><span>Escalão</span><input name="escalao" value="'+tuEsc(e.escalao)+'"></label></div>';
  html+='<div class="form-grid"><label class="field"><span>Modelo</span><input name="modelo" value="'+tuEsc(e.modelo)+'"></label><label class="field"><span>Espaço</span><input name="espaco" placeholder="20x15" value="'+tuEsc(e.espaco)+'"></label></div>';
  html+='<label class="field"><span>Objetivo</span><textarea name="objetivo">'+tuEsc(e.objetivo)+'</textarea></label>';
  html+='<label class="field"><span>Organização</span><input name="organizacao" value="'+tuEsc(e.organizacao)+'"></label>';
  html+='<div class="form-grid"><label class="field"><span>Séries</span><input type="number" min="1" name="series" value="'+tuEsc(e.series)+'"></label><label class="field"><span>Minutos por série</span><input type="number" min="0" name="duracao_serie_min" value="'+tuEsc(e.duracao_serie_min)+'"></label></div>';
  html+='<label class="field"><span>Material · separado por vírgulas</span><input name="material" value="'+tuEsc(tuCsvText(e.material))+'"></label>';
  html+='<label class="field"><span>Regras · uma por linha</span><textarea name="regras">'+tuEsc(tuListText(e.regras))+'</textarea></label>';
  html+='<label class="field"><span>Coaching points · um por linha</span><textarea name="coaching_points">'+tuEsc(tuListText(e.coaching_points))+'</textarea></label>';
  html+='<div class="form-grid"><label class="field"><span>Progressão</span><textarea name="progressao">'+tuEsc(e.progressao)+'</textarea></label><label class="field"><span>Regressão</span><textarea name="regressao">'+tuEsc(e.regressao)+'</textarea></label></div>';
  html+='<label class="field"><span>Tags · separadas por vírgulas</span><input name="tags" value="'+tuEsc(tuCsvText(e.tags))+'"></label>';
  html+='<label class="favorite-filter"><input type="checkbox" name="favorito" '+(e.favorito?"checked":"")+'> Marcar como favorito</label>';
  html+='<div class="toolbar"><button class="btn accent" type="submit">Guardar exercício</button><a class="btn secondary" href="'+(id?'#/exercicios/'+id:'#/exercicios')+'">Cancelar</a></div></form></section>';
  setView(id?"Editar exercício":"Novo exercício",html,"Planos");
}

async function viewExercise(id){
  const raw=await DB.obter("exercicios",id);
  if(!raw || !raw.workspace_v2) return go("#/exercicios");
  const e=TrainingPlanner.normalizeExercise(raw);
  await globalThis.VisionExerciseImageStorage?.resolve([e]);
  const media=await HeadCoachMedia.listForSubject("exercise",id);
  let html='<section class="panel hero-main"><div class="row"><div class="grow"><div class="kicker">'+tuEsc(e.escalao+' · '+e.modelo)+'</div><h2 class="display" style="font-size:30px">'+tuEsc(e.nome)+'</h2></div><span class="badge '+(e.favorito?"ready":"")+'">'+(e.favorito?"Favorito":"Exercício")+'</span></div>';
  html+=tuExerciseVisualHTML(e,false);
  html+='<p class="lead">'+tuEsc(e.objetivo)+'</p><div class="exercise-facts"><span><strong>'+tuEsc(e.organizacao||"—")+'</strong><small>organização</small></span><span><strong>'+tuEsc(e.espaco||"—")+'</strong><small>espaço</small></span><span><strong>'+e.duracao_total_min+' min</strong><small>duração</small></span></div>';
  html+='<div class="grid cols-2 section"><div><h3>Regras</h3><div class="body-copy">'+tuEsc((e.regras||[]).join("\n"))+'</div></div><div><h3>Coaching points</h3><div class="body-copy">'+tuEsc((e.coaching_points||[]).join("\n"))+'</div></div></div>';
  html+='<div class="toolbar" style="margin-top:18px"><a class="btn accent" href="#/treinos/novo/'+id+'">Usar num treino</a><a class="btn secondary" href="#/exercicios/'+id+'/editar">Editar</a><a class="btn secondary" href="#/media/novo/exercise/'+id+'">Adicionar media</a><button class="btn danger" type="button" data-action="delete-exercise" data-id="'+id+'">Apagar exercício</button></div></section>';
  html+='<section class="section"><div class="section-head"><div><h2>Media</h2><p>'+media.length+' item(ns)</p></div></div>'+renderMediaCards(media)+'</section>';
  setView(e.nome,html,"Planos");
}

function tuExerciseByRef(exercises,ref){
  const wanted=String(ref||"");
  return exercises.find((x)=>tuExerciseRef(x)===wanted || String(x.id)===wanted) || null;
}

function tuMatchRef(match){
  return String(match?.sync_id || match?.id || "");
}

function tuTrainingBlocksForm(exercises,training,preselectedId){
  const existing=new Map((training.blocos||[]).map((b)=>[String(b.exercise_ref),b]));
  if(preselectedId){
    const e=exercises.find((x)=>String(x.id)===String(preselectedId));
    if(e && !existing.has(tuExerciseRef(e))) existing.set(tuExerciseRef(e),{
      exercise_ref:tuExerciseRef(e),phase:"principal",duration_min:e.duracao_total_min||10,order:0
    });
  }
  const selected=[...existing.keys()];
  const ordered=exercises.slice().sort((a,b)=>{
    const ia=selected.indexOf(tuExerciseRef(a)), ib=selected.indexOf(tuExerciseRef(b));
    if(ia>=0 || ib>=0) return (ia<0?999:ia)-(ib<0?999:ib);
    return String(a.nome).localeCompare(String(b.nome),"pt-PT");
  });
  return ordered.map((e)=>{
    const ref=tuExerciseRef(e), block=existing.get(ref), checked=!!block;
    const duration=block?.duration_min ?? e.duracao_total_min ?? 10;
    const phase=block?.phase || "principal";
    return '<article class="training-block-choice"><label class="row"><input type="checkbox" name="exercise_refs" value="'+tuEsc(ref)+'" '+(checked?"checked":"")+'><span class="grow"><strong>'+tuEsc(e.nome)+'</strong><small>'+tuEsc(e.objetivo||"")+'</small></span></label>'+
      '<div class="toolbar session-reorder"><button type="button" class="btn secondary small" data-action="training-block-up">↑ Subir</button><button type="button" class="btn secondary small" data-action="training-block-down">↓ Descer</button></div>'+
      '<div class="form-grid compact"><label class="field"><span>Fase</span><select name="phase__'+tuEsc(ref)+'"><option value="ativacao" '+(phase==="ativacao"?"selected":"")+'>Ativação</option><option value="principal" '+(phase==="principal"?"selected":"")+'>Principal</option><option value="jogo" '+(phase==="jogo"?"selected":"")+'>Jogo</option><option value="retorno" '+(phase==="retorno"?"selected":"")+'>Retorno</option></select></label><label class="field"><span>Minutos</span><input data-block-duration type="number" min="0" name="duration__'+tuEsc(ref)+'" value="'+tuEsc(duration)+'"></label></div><label class="field"><span>Notas deste exercício</span><textarea name="notes__'+tuEsc(ref)+'">'+tuEsc(block?.notes||'')+'</textarea></label></article>';
  }).join("");
}

async function viewTrainingForm(id,preselectedId,sourceMatchId){
  const team=await HeadCoachMemory.ensureTeam();
  const old=id?await DB.obter("treinos",id):null;
  if(old?.session?.started_at) return setView("Planeamento preservado",'<div class="notice">Este treino já foi iniciado. O plano fica preservado para comparação com o realizado. <a class="link" href="#/treinos/'+id+'/duplicar">Duplicar para uma nova sessão</a></div>',"Treino");
  const matches=(await DB.porIndice("jogos","team_id",DEFAULT_TEAM_ID)).sort((a,b)=>String(b.data).localeCompare(String(a.data)));
  const sourceMatch=!old&&sourceMatchId?matches.find((m)=>String(m.id)===String(sourceMatchId)):null;
  const sourcePost=sourceMatch?VisionCalendar.normalizeMatch(sourceMatch).post_game:null;
  const sourceObjective=sourcePost&&(sourcePost.melhorar||sourcePost.conclusoes)||"";
  const sourceNotes=sourcePost&&Array.isArray(sourcePost.acoes_proximo_treino)&&sourcePost.acoes_proximo_treino.length
    ? "Ações da análise:\n"+sourcePost.acoes_proximo_treino.map((x)=>"- "+x).join("\n")
    : "";
  const training=TrainingPlanner.normalizeTraining(old||{
    data:today(),hora:"19:15",status:"draft",
    objetivo:sourceObjective,
    notas:sourceNotes,
    source_match_ref:sourceMatch?tuMatchRef(sourceMatch):null
  });
  const exercises=await tuExercises();
  const matchOptions='<option value="">Sem ligação a jogo</option>'+matches.map((m)=>{
    const ref=tuMatchRef(m);
    return '<option value="'+tuEsc(ref)+'" '+(String(training.source_match_ref||"")===ref?"selected":"")+'> '+fmtDate(m.data)+' · '+tuEsc(m.adversario||"Jogo")+'</option>';
  }).join("");
  let html='<section class="panel hero-main"><form class="form" data-form="training-plan" data-id="'+(id||"")+'">';
  if(sourceMatch) html+='<div class="notice">Treino criado a partir da análise do jogo de '+fmtDate(sourceMatch.data)+' vs '+tuEsc(sourceMatch.adversario||"adversário")+'. Ajusta objetivo, exercícios e duração antes de guardar.</div>';
  html+='<div class="form-grid"><label class="field"><span>Data</span><input type="date" name="data" required value="'+tuEsc(training.data||today())+'"></label><label class="field"><span>Hora</span><input type="time" name="hora" value="'+tuEsc(training.hora||"")+'"></label></div>';
  html+='<label class="field"><span>Objetivo da sessão</span><textarea name="objetivo">'+tuEsc(training.objetivo)+'</textarea></label>';
  html+='<div class="form-grid"><label class="field"><span>Local</span><input name="local" value="'+tuEsc(training.local||"")+'"></label><label class="field"><span>Origem / jogo relacionado</span><select name="source_match_ref">'+matchOptions+'</select></label></div>';
  html+='<div class="section-head" style="margin-top:8px"><div><h2>Blocos da sessão</h2><p>Seleciona exercícios e ajusta fase/duração</p></div><div class="training-total">Total: <strong data-training-total>'+training.duracao_min+'</strong> min</div></div>';
  html+=exercises.length?'<div class="training-block-grid">'+tuTrainingBlocksForm(exercises,training,preselectedId)+'</div>':'<div class="empty">Ainda não existem exercícios Vision Coach. <a class="link" href="#/exercicios/novo">Criar exercício</a></div>';
  html+='<label class="field"><span>Notas</span><textarea name="notas">'+tuEsc(training.notas||"")+'</textarea></label>';
  html+='<div class="toolbar"><button class="btn accent" type="submit">Guardar treino</button><a class="btn secondary" href="'+(id?'#/treinos/'+id:'#/treinos')+'">Cancelar</a></div></form></section>';
  setView(id?"Editar treino":"Novo treino",html,"Planos");
  tuRefreshTrainingTotal();
}
async function viewTrainingConsultation(id,step){
  try{
    const status=await RemoteWorkspace.status();
    if(navigator.onLine && status.signedIn && status.remoteTeamId) await RemoteWorkspace.syncNow();
  }catch(_){}
  const rows=(await DB.porIndice("treinos","team_id",DEFAULT_TEAM_ID))
    .map((x)=>TrainingPlanner.normalizeTraining(x))
    .sort((a,b)=>String(a.data||"").localeCompare(String(b.data||"")));
  let t=id?rows.find((x)=>String(x.id)===String(id)):null;
  if(!t){
    const todayIso=today();
    t=rows.find((x)=>String(x.data||"")>=todayIso)||rows[rows.length-1]||null;
  }
  if(!t) return setView("Consulta de treino",'<div class="empty">Ainda não existe um treino para consultar.</div>',"Treino");
  const exercises=await tuExercises();
  const blocks=t.blocos||[];
  if(!blocks.length) return setView("Treino · "+fmtDate(t.data),'<div class="empty">Este treino ainda não tem exercícios.</div>',"Treino");
  let index=Math.max(0,Math.min(blocks.length-1,Number(step||0)));
  const block=blocks[index];
  const e=tuExerciseByRef(exercises,block.exercise_ref);
  const passos=Array.isArray(e?.passos)&&e.passos.length?e.passos:(e?.regras||[]);
  const material=Array.isArray(e?.material)?e.material.join(" · "):(e?.material||"—");
  const regras=(e?.regras||[]).map((x)=>'<li>'+tuEsc(x)+'</li>').join("");
  const coaching=(e?.coaching_points||[]).map((x)=>'<li>'+tuEsc(x)+'</li>').join("");
  const steps=passos.length?passos.map((x,i)=>'<div class="consult-step"><span>'+(i+1)+'</span><p>'+tuEsc(x)+'</p></div>').join(""):'<div class="empty">Sem passos detalhados.</div>';
  const timeline=blocks.map((b,i)=>{
    const ex=tuExerciseByRef(exercises,b.exercise_ref);
    return '<a class="consult-index '+(i===index?"active":"")+'" href="#/consulta/'+t.id+'/'+i+'"><strong>'+(i+1)+'. '+tuEsc(ex?.nome||b.exercise_name||"Exercício")+'</strong><small>'+b.duration_min+' min · '+tuEsc(b.phase||"")+'</small></a>';
  }).join("");
  let html='<section class="panel hero-main consult-hero"><div class="kicker">'+fmtDate(t.data)+(t.hora?' · '+tuEsc(t.hora):'')+'</div><h2 class="display" style="font-size:28px">Consulta do treino</h2><p class="lead">'+tuEsc(t.objetivo||"Sem objetivo definido.")+'</p><div class="row" style="margin-top:14px"><span class="badge ready">'+t.duracao_min+' min</span><span class="badge">'+blocks.length+' exercícios</span></div></section>';
  html+='<div class="toolbar section"><a class="btn accent" href="#/sessao/'+t.id+'">Treino em campo / presenças</a></div>';
  html+='<section class="section"><div class="consult-index-list">'+timeline+'</div></section>';
  html+='<section class="panel hero-main consult-exercise"><div class="kicker">Exercício '+(index+1)+' de '+blocks.length+' · '+block.duration_min+' min</div><h2 class="display" style="font-size:27px">'+tuEsc(e?.nome||block.exercise_name||"Exercício")+'</h2><p class="lead">'+tuEsc(e?.objetivo||block.notes||"")+'</p>';
  if(e) html+=tuExerciseVisualHTML(e,false);
  html+='<div class="consult-facts"><div><span>Montagem</span><strong>'+tuEsc(e?.organizacao||"—")+'</strong></div><div><span>Material</span><strong>'+tuEsc(material)+'</strong></div><div><span>Espaço</span><strong>'+tuEsc(e?.espaco||"—")+'</strong></div></div>';
  html+='<div class="section"><h3>Passo a passo</h3><div class="consult-steps">'+steps+'</div></div>';
  if(regras) html+='<div class="section"><h3>Regras</h3><ul class="consult-list">'+regras+'</ul></div>';
  if(coaching) html+='<div class="section"><h3>O que corrigir</h3><ul class="consult-list">'+coaching+'</ul></div>';
  if(block.notes) html+='<div class="notice" style="margin-top:18px">'+tuEsc(block.notes)+'</div>';
  html+='<div class="toolbar consult-nav" style="margin-top:22px">'+(index>0?'<a class="btn secondary" href="#/consulta/'+t.id+'/'+(index-1)+'">← Anterior</a>':'')+(index<blocks.length-1?'<a class="btn accent" href="#/consulta/'+t.id+'/'+(index+1)+'">Seguinte →</a>':'<a class="btn accent" href="#/treinos/'+t.id+'">Terminar consulta</a>')+'</div></section>';
  setView("Treino · "+fmtDate(t.data),html,"Consulta");
}

async function viewTrainings(){
  const rows=(await DB.porIndice("treinos","team_id",DEFAULT_TEAM_ID))
    .sort((a,b)=>String(b.data).localeCompare(String(a.data)));
  const cards=rows.length?rows.map((raw)=>{
    const t=TrainingPlanner.normalizeTraining(raw);
    return '<a class="card training-card" href="#/treinos/'+t.id+'"><span class="grow"><span class="title">Treino · '+fmtDate(t.data)+'</span><span class="meta">'+tuEsc([t.hora,t.objetivo].filter(Boolean).join(" · "))+'</span><span class="meta">'+t.blocos.length+' bloco(s) · '+t.duracao_min+' min</span></span><span class="badge '+(t.status==="ready"?"ready":"draft")+'">'+tuEsc(t.status)+'</span></a>';
  }).join(""):'<div class="empty">Ainda não existem treinos planeados.</div>';
  setView("Treinos",'<div class="section-head"><div><h2>Planeador de treino</h2><p>Sessões por blocos reutilizando a biblioteca</p></div><div class="toolbar"><a class="btn secondary" href="#/exercicios">Exercícios</a><a class="btn accent" href="#/treinos/novo">Novo treino</a></div></div><div class="list">'+cards+'</div>',"Planos");
}

async function viewTraining(id){
  const raw=await DB.obter("treinos",id);
  if(!raw) return go("#/treinos");
  const t=TrainingPlanner.normalizeTraining(raw);
  const exercises=await tuExercises();
  const matches=await DB.porIndice("jogos","team_id",DEFAULT_TEAM_ID);
  const linked=matches.find((m)=>tuMatchRef(m)===String(t.source_match_ref||""));
  const blocks=t.blocos.length?t.blocos.map((b)=>{
    const e=tuExerciseByRef(exercises,b.exercise_ref);
    return '<div class="list-item row"><span class="block-order">'+(b.order+1)+'</span><span class="grow"><span class="title">'+tuEsc(e?.nome||b.exercise_name||"Exercício")+'</span><span class="meta">'+tuEsc(b.phase)+' · '+b.duration_min+' min</span></span></div>';
  }).join(""):'<div class="empty">Sem blocos.</div>';
  let html='<section class="panel hero-main"><div class="kicker">'+fmtDate(t.data)+(t.hora?' · '+tuEsc(t.hora):'')+'</div><h2 class="display" style="font-size:30px">Treino</h2><p class="lead">'+tuEsc(t.objetivo||"Sem objetivo definido.")+'</p><div class="exercise-facts"><span><strong>'+t.blocos.length+'</strong><small>blocos</small></span><span><strong>'+t.duracao_min+' min</strong><small>duração</small></span><span><strong>'+tuEsc(t.status)+'</strong><small>estado</small></span></div>';
  if(linked) html+='<div class="notice" style="margin-top:16px">Ligado ao jogo de '+fmtDate(linked.data)+' vs '+tuEsc(linked.adversario||"adversário")+'.</div>';
  html+='<div class="toolbar" style="margin-top:18px"><a class="btn accent" href="#/sessao/'+id+'">Treino em campo / presenças</a><a class="btn secondary" href="#/treinos/'+id+'/duplicar">Duplicar treino</a><a class="btn secondary" href="#/treinos/'+id+'/editar">Editar planeamento</a><a class="btn secondary" href="#/media/novo/training/'+id+'">Adicionar media</a><button class="btn danger" type="button" data-action="delete-training" data-id="'+id+'">Apagar treino</button></div></section>';
  html+='<section class="section"><div class="section-head"><div><h2>Blocos</h2><p>Sequência da sessão</p></div></div><div class="list">'+blocks+'</div></section>';
  html+='<section class="section"><div class="section-head"><div><h2>Avaliação pós-treino</h2><p>Fecha o ciclo com o jogo que originou esta sessão</p></div></div><form class="panel match-form form" data-form="training-review" data-id="'+id+'"><div class="form-grid"><label class="field"><span>O que melhorou</span><textarea name="melhorou">'+tuEsc(t.review.melhorou||"")+'</textarea></label><label class="field"><span>O que continua por corrigir</span><textarea name="continua">'+tuEsc(t.review.continua||"")+'</textarea></label></div><label class="field"><span>Conclusão</span><textarea name="conclusao">'+tuEsc(t.review.conclusao||"")+'</textarea></label><label class="field"><span>Próxima ação</span><textarea name="proxima_acao">'+tuEsc(t.review.proxima_acao||"")+'</textarea></label><div class="toolbar"><button class="btn accent" type="submit">Guardar avaliação</button>'+(linked?'<a class="btn secondary" href="#/equipa/jogo/'+linked.id+'">Voltar ao jogo de origem</a>':'')+'</div></form></section>';
  setView("Treino · "+fmtDate(t.data),html,"Planos");
}

function tuRefreshExerciseFilter(){
  const q=document.querySelector('[data-action="exercise-filter"]')?.value||"";
  const fav=!!document.querySelector('[data-action="exercise-favorites"]')?.checked;
  document.querySelectorAll("[data-exercise-card]").forEach((card)=>{
    const match=(!q || card.dataset.search.includes(q.toLowerCase())) && (!fav || card.dataset.favorite==="1");
    card.hidden=!match;
  });
}

function tuRefreshTrainingTotal(){
  const form=document.querySelector('form[data-form="training-plan"]');
  if(!form) return;
  let total=0;
  form.querySelectorAll('input[name="exercise_refs"]:checked').forEach((cb)=>{
    const input=form.elements["duration__"+cb.value];
    total+=Math.max(0,Number(input?.value||0));
  });
  const out=form.querySelector("[data-training-total]");
  if(out) out.textContent=String(total);
}

async function tuSaveExercise(form,fd,id){
  const old=id?await DB.obter("exercicios",id):null;
  const row=TrainingPlanner.normalizeExercise({
    ...(old||{}), team_id:DEFAULT_TEAM_ID, workspace_v2:true,
    nome:fd.get("nome"), escalao:fd.get("escalao")||"Sub-8",
    modelo:fd.get("modelo")||"5x5-1-2-1", objetivo:fd.get("objetivo")||"",
    organizacao:fd.get("organizacao")||"", espaco:fd.get("espaco")||"",
    series:Number(fd.get("series")||1), duracao_serie_min:Number(fd.get("duracao_serie_min")||0),
    material:tuCsv(fd.get("material")), regras:tuLines(fd.get("regras")),
    coaching_points:tuLines(fd.get("coaching_points")), progressao:fd.get("progressao")||null,
    regressao:fd.get("regressao")||null, tags:tuCsv(fd.get("tags")),
    favorito:fd.get("favorito")==="on", status:"active"
  });
  const saved=await saveRecord("exercicios",id,row);
  await logHuman(id?"updated_exercise":"created_exercise",(id?"Atualizou exercício · ":"Criou exercício · ")+row.nome,"exercise",saved);
  go("#/exercicios/"+saved);
}

function tuRandomKey(){
  const id=globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2);
  return String(id).slice(0,8);
}
async function tuSaveTrainingReview(fd,id){
  const old=await DB.obter("treinos",id);
  if(!old) throw new Error("Treino não encontrado.");
  const row=TrainingPlanner.normalizeTraining({
    ...old,
    review:{
      status:"done",
      melhorou:fd.get("melhorou")||null,
      continua:fd.get("continua")||null,
      conclusao:fd.get("conclusao")||null,
      proxima_acao:fd.get("proxima_acao")||null
    }
  });
  await DB.atualizar("treinos",row);
  await logHuman("reviewed_training","Avaliou treino · "+fmtDate(row.data),"training",row.sync_id||id);
  go("#/treinos/"+id);
}
async function tuSaveTraining(form,fd,id){
  const old=id?await DB.obter("treinos",id):null;
  const exercises=await tuExercises();
  if(old?.session?.started_at) throw new Error("O treino já foi iniciado. Duplica a sessão para alterar o plano.");
  const refs=fd.getAll("exercise_refs").map(String);
  const previousBlocks=new Map((old?.blocos||[]).map(b=>[String(b.exercise_ref),b]));
  const blocks=refs.map((ref,index)=>{
    const e=tuExerciseByRef(exercises,ref);
    return {
      ...(previousBlocks.get(ref)||{}), block_id:previousBlocks.get(ref)?.block_id||crypto.randomUUID(),
      order:index, exercise_ref:ref, exercise_name:e?.nome||null,
      phase:fd.get("phase__"+ref)||"principal",
      duration_min:Math.max(0,Number(fd.get("duration__"+ref)||0)),
      notes:fd.get("notes__"+ref)||null
    };
  });
  const team=await HeadCoachMemory.ensureTeam();
  const row=TrainingPlanner.normalizeTraining({
    ...(old||{}), team_id:DEFAULT_TEAM_ID, data:fd.get("data"),
    hora:fd.get("hora")||null, local:fd.get("local")||null,
    escalao:team.escalao||"sub-8", objetivo:fd.get("objetivo")||"",
    notas:fd.get("notas")||null, source_match_ref:fd.get("source_match_ref")||null,
    status:"ready", blocos:blocks,
    external_key:old?.external_key || ("training-"+fd.get("data")+"-"+tuRandomKey())
  });
  let saved;
  if(id){
    await DB.modificar("treinos",id,current=>{
      if(current.session?.started_at) throw new Error("O treino começou entretanto; o planeamento não foi alterado.");
      return {...current,...row,session:current.session,review:current.review||row.review};
    });saved=id;
  }else saved=await saveRecord("treinos",id,row);
  await logHuman(id?"updated_training_plan":"created_training_plan",(id?"Atualizou treino · ":"Criou treino · ")+fmtDate(row.data),"training",saved);
  go("#/treinos/"+saved);
}

document.addEventListener("input",(event)=>{
  if(event.target.matches('[data-action="exercise-filter"]')) tuRefreshExerciseFilter();
  if(event.target.matches("[data-block-duration]")) tuRefreshTrainingTotal();
});

document.addEventListener("change",(event)=>{
  if(event.target.matches('[data-action="exercise-favorites"]')) tuRefreshExerciseFilter();
  if(event.target.matches('input[name="exercise_refs"]')) tuRefreshTrainingTotal();
});
document.addEventListener("click",async(event)=>{
  const target=event.target.closest("[data-action]");
  if(!target) return;
  if(target.dataset.action==="training-block-up" || target.dataset.action==="training-block-down"){
    event.preventDefault();
    const card=target.closest(".training-block-choice"),parent=card?.parentElement;
    if(!parent) return;
    if(target.dataset.action==="training-block-up" && card.previousElementSibling) parent.insertBefore(card,card.previousElementSibling);
    if(target.dataset.action==="training-block-down" && card.nextElementSibling) parent.insertBefore(card.nextElementSibling,card);
    return;
  }
  if(target.dataset.action==="toggle-exercise-favorite"){
    const row=await DB.obter("exercicios",Number(target.dataset.id));
    if(!row) return;
    row.favorito=!row.favorito;
    await DB.atualizar("exercicios",row);
    await logHuman("updated_exercise_favorite","Alterou favorito · "+row.nome,"exercise",row.id);
    return router();
  }
  if(target.dataset.action==="delete-exercise"){
    if(!confirm("Apagar este exercício? A remoção será sincronizada.")) return;
    await DB.apagar("exercicios",Number(target.dataset.id));
    await logHuman("deleted_exercise","Apagou exercício","exercise",target.dataset.id);
    return go("#/exercicios");
  }
  if(target.dataset.action==="delete-training"){
    if(!confirm("Apagar este treino? A remoção será sincronizada.")) return;
    await DB.apagar("treinos",Number(target.dataset.id));
    await logHuman("deleted_training","Apagou treino","training",target.dataset.id);
    return go("#/treinos");
  }
});

document.addEventListener("submit",async(event)=>{
  const form=event.target.closest("form[data-form]");
  if(!form) return;
  const type=form.dataset.form;
  if(type!=="exercise" && type!=="training-plan" && type!=="training-review") return;
  event.preventDefault();
  const fd=new FormData(form);
  const id=form.dataset.id?Number(form.dataset.id):null;
  if(type==="exercise") return tuSaveExercise(form,fd,id);
  if(type==="training-review") return tuSaveTrainingReview(fd,id);
  if(type==="training-plan") return tuSaveTraining(form,fd,id);
});
const TrainingUI={
  viewExercises,
  viewExerciseForm,
  viewExercise,
  viewTrainings,
  viewTrainingForm,
  viewTraining,
  viewTrainingConsultation,
};

if(typeof globalThis!=="undefined") globalThis.TrainingUI=TrainingUI;
if(typeof module!=="undefined"&&module.exports) module.exports={TrainingUI};
