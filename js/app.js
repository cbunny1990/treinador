"use strict";

const app = document.getElementById("app");
const titleEl = document.getElementById("titulo");
const eyebrowEl = document.getElementById("eyebrow");
const quickCapture = document.getElementById("quick-capture");
const remoteStateEl = document.getElementById("remote-state");
const remoteDotEl = document.getElementById("remote-dot");
const remoteTitleEl = document.getElementById("remote-title");
const remoteDetailEl = document.getElementById("remote-detail");
const HUMAN_LABEL = "Treinador";
var remoteSyncFailed = false;
var renderedViewRoute = null;
var skipNextRemoteSync = false;
var viewRenderSequence = 0;
var userScrollIntentSequence = 0;
window.addEventListener("wheel",function(){userScrollIntentSequence++;},{passive:true});
window.addEventListener("touchmove",function(){userScrollIntentSequence++;},{passive:true});
window.addEventListener("keydown",function(event){
  if(["ArrowUp","ArrowDown","PageUp","PageDown","Home","End"," "].includes(event.key))userScrollIntentSequence++;
});

function esc(v){
  return String(v == null ? "" : v).replace(/[&<>"']/g,function(ch){
    return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch];
  });
}
function fmtDate(v){
  var iso=String(v||"").slice(0,10);
  if(!iso || iso.indexOf("-")<0) return "";
  var p=iso.split("-");
  return p[2]+"/"+p[1]+"/"+p[0];
}
function realtimeStatusMessage(status){
  if(status==="connected")return "Atualizações automáticas em tempo real ligadas.";
  if(status==="connecting")return "A ligar às atualizações em tempo real…";
  if(status==="degraded"||status==="closed")return "Atualizações em tempo real indisponíveis. A app tenta sincronizar ao regressar; também podes sincronizar agora.";
  return "A sincronização acontece ao abrir a app, ao regressar à ligação e quando pedes Sincronizar agora.";
}
function today(){return new Date().toISOString().slice(0,10);}
function go(hash){location.hash=hash;}
function setView(title,html,eyebrow){
  var currentRoute=location.hash||"#/";
  var routeChanged=renderedViewRoute!==currentRoute;
  var currentRender=++viewRenderSequence;
  var scrollX=window.scrollX,scrollY=window.scrollY,intentAtRender=userScrollIntentSequence;
  titleEl.textContent=title;
  eyebrowEl.textContent=eyebrow||"Workspace";
  app.innerHTML=html;
  renderedViewRoute=currentRoute;
  if(routeChanged) window.scrollTo(0,0);
  else requestAnimationFrame(function(){
    if(currentRender===viewRenderSequence&&intentAtRender===userScrollIntentSequence&&currentRoute===(location.hash||"#/"))window.scrollTo(scrollX,scrollY);
  });
  refreshRemoteIndicator();
}
function markNav(tab){
  document.querySelectorAll("[data-tab]").forEach(function(a){a.classList.toggle("active",a.dataset.tab===tab);});
}
async function refreshRemoteIndicator(){
  if (!globalThis.RemoteWorkspace || !remoteTitleEl) return;
  try {
    var status = await RemoteWorkspace.status();
    remoteDotEl.classList.toggle("connected", !!(status.signedIn && status.remoteTeamId));
    if (!status.configured) {
      remoteTitleEl.textContent = "Workspace local";
      remoteDetailEl.textContent = "Ligação remota por configurar";
    } else if (!status.signedIn) {
      remoteTitleEl.textContent = "Backend configurado";
      remoteDetailEl.textContent = "Falta iniciar sessão";
    } else if (!status.remoteTeamId) {
      remoteTitleEl.textContent = "Conta ligada";
      remoteDetailEl.textContent = "Falta escolher a equipa remota";
    } else {
      remoteTitleEl.textContent = "Workspace ligado";
      if(status.realtimeStatus==="degraded"||status.realtimeStatus==="closed")remoteDetailEl.textContent="Tempo real indisponível · sincroniza ao regressar";
      else if(status.realtimeStatus==="connecting")remoteDetailEl.textContent="A ligar atualizações em tempo real";
      else remoteDetailEl.textContent = status.lastSyncAt ? "Sincronizado " + fmtDate(status.lastSyncAt) : "Pronto para sincronizar";
    }
  } catch (_) {
    remoteTitleEl.textContent = "Ligação remota";
    remoteDetailEl.textContent = "Não foi possível verificar";
  }
}
function actorBadge(actor,label){
  var type=(actor==="agent"||actor==="system")?actor:"human";
  var text=label||(type==="agent"?"Agente":type==="system"?"Sistema":HUMAN_LABEL);
  return '<span class="badge '+type+'">'+esc(text)+'</span>';
}
function docStatusBadge(status){
  var labels={draft:"Rascunho",ready:"Pronto",approved:"Aprovado",archived:"Arquivado"};
  return '<span class="badge '+esc(status)+'">'+esc(labels[status]||status)+'</span>';
}
function initials(name){
  return String(name||"?").split(/\s+/).filter(Boolean).slice(0,2).map(function(x){return x[0];}).join("").toUpperCase();
}
function avatarHTML(player,px){
  px=px||42;
  var size='style="width:'+px+'px;height:'+px+'px"';
  if(player && player.foto) return '<span class="avatar" '+size+'><img src="'+esc(player.foto)+'" alt=""></span>';
  return '<span class="avatar" '+size+'>'+esc(player && (player.numero||initials(player.nome)))+'</span>';
}
async function applyPlayerProfilePhotos(players){
  var media=await DB.porIndice("media_items","team_id",DEFAULT_TEAM_ID);
  var photos=media.filter(function(item){
    return item.subject_type==="player" && item.type==="photo" &&
      String(item.note||"").toLowerCase().includes("foto de perfil");
  }).sort(function(a,b){
    return String(b.updated_at||b.created_at||"").localeCompare(String(a.updated_at||a.created_at||""));
  });
  return (players||[]).map(function(player){
    var photo=photos.find(function(item){return String(item.subject_id)===String(player.id);});
    var src=photo&&(photo.data_url||photo.url);
    if(src)return Object.assign({},player,{foto:src,profile_media_ref:photo.sync_id||null});
    if(!photo&&(player.profile_media_ref||String(player.foto||"").startsWith("data:")||/\/storage\/v1\/object\/sign\/team-media\//i.test(String(player.foto||""))))return Object.assign({},player,{foto:null});
    return player;
  });
}
function resultText(match){
  if(match && (match.golos_favor==null || match.golos_contra==null)) return "Por jogar";
  return String(match.golos_favor)+"–"+String(match.golos_contra);
}
function teamCrestSrc(team){
  var identity=[team&&team.nome,team&&team.clube].filter(Boolean).join(" ").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase();
  var category=String(team&&team.escalao||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase();
  return identity.includes("figueiro")&&category.includes("sub-8")?"assets/teams/14529_imgbank.png":null;
}
function teamCrestHTML(team,compact){
  var src=teamCrestSrc(team);
  return src?'<div class="team-identity"><img class="team-crest'+(compact?' compact':'')+'" src="'+src+'" alt="Emblema do Sub-8 de Figueiró"><span class="team-identity-label">Sub-8 · Figueiró</span></div>':'';
}
function stablePlayerRef(player){return String(player&&player.sync_id||player&&player.id||"");}
function playerByRef(players,ref){
  var wanted=String(ref||"");
  return players.find(function(p){return stablePlayerRef(p)===wanted||String(p.id)===wanted;})||null;
}
function linesFromText(value){
  return String(value||"").split(String.fromCharCode(10)).map(function(x){return x.trim();}).filter(Boolean);
}
function linesText(value){return Array.isArray(value)?value.join(String.fromCharCode(10)):"";}
function matchStructure(match){return VisionCalendar.normalizeMatch(match||{});}
function docTypeLabel(type){return WORKSPACE_DOC_LABELS[type]||"Documento";}
function docTypeShort(type){
  return {training_plan:"PT",match_analysis:"AJ",weekly_plan:"S",team_goal:"EE",season_index:"Ép",note:"N",brief:"B"}[type]||"D";
}

async function routeOnce(){
  var skipRemoteSync=skipNextRemoteSync;
  skipNextRemoteSync=false;
  var parts=(location.hash||"#/").slice(1).split("?")[0].split("/").filter(Boolean);
  var root=parts[0]||"";
  var navRoot=(root==="treinos"||root==="exercicios")?"planos":(root===""?"workspace":root);
  markNav(root==="jogo-visual"?"calendario":navRoot);
  try{
    if(!root) return viewWorkspace({skipRemoteSync:skipRemoteSync});
    if(root==="equipa"){
      if(parts[1]==="editar") return viewTeamForm();
      if(parts[1]==="jogador" && parts[2]==="novo") return viewPlayerForm();
      if(parts[1]==="jogador" && parts[2] && parts[3]==="editar") return viewPlayerForm(parts[2]);
      if(parts[1]==="jogador" && parts[2]) return viewPlayer(parts[2]);
      if(parts[1]==="jogo" && parts[2]==="novo") return viewMatchForm();
      if(parts[1]==="jogo" && parts[2] && parts[3]==="editar") return viewMatchForm(parts[2]);
      if(parts[1]==="jogo" && parts[2]) return viewMatch(parts[2]);
      return viewTeam();
    }
    if(root==="calendario") return viewCalendar();
    if(root==="evolucao") return viewTeamDevelopment();
    if(root==="epocas") return viewSeasons();
    if(root==="pesquisa") return viewSearch();
    if(root==="consulta"){
      return TrainingUI.viewTrainingConsultation(parts[1]||null,parts[2]||null);
    }
    if(root==="sessao") return TrainingSessionUI.view(parts[1]);
    if(root==="jogo-visual") return MatchVisualUI.view(parts[1]);
    if(root==="continuidade") return TrainingContinuityUI.view(parts[1]);
    if(root==="treinos"){
      if(parts[1] && parts[2]==="duplicar") return TrainingSessionUI.duplicateView(parts[1]);
      if(parts[1]==="novo" && parts[2]==="jogo" && parts[3]) return TrainingUI.viewTrainingForm(null,null,parts[3]);
      if(parts[1]==="novo") return TrainingUI.viewTrainingForm(null,parts[2]);
      if(parts[1] && parts[2]==="editar") return TrainingUI.viewTrainingForm(parts[1]);
      if(parts[1]) return TrainingUI.viewTraining(parts[1]);
      return TrainingUI.viewTrainings();
    }
    if(root==="exercicios"){
      if(parts[1]==="novo") return TrainingUI.viewExerciseForm();
      if(parts[1] && parts[2]==="editar") return TrainingUI.viewExerciseForm(parts[1]);
      if(parts[1]) return TrainingUI.viewExercise(parts[1]);
      return TrainingUI.viewExercises();
    }
    if(root==="planos"){
      if(parts[1]==="novo") return viewDocumentForm();
      if(parts[1] && parts[2]==="editar") return viewDocumentForm(parts[1]);
      if(parts[1]) return viewDocument(parts[1]);
      return viewDocuments({skipRemoteSync:skipRemoteSync});
    }
    if(root==="media"){
      if(parts[1]==="novo") return viewMediaForm(parts[2],parts[3]);
      if(parts[1] && parts[2]==="editar") return viewMediaForm(null,null,parts[1]);
      return viewMedia();
    }
    if(root==="timeline") return viewTimeline(parts[1]||null,parts[2]||null);
    if(root==="capturar") return viewCapture(parts[1],parts[2]);
    if(root==="definicoes") return viewSettings();
    return viewWorkspace();
  }catch(error){
    console.error(error);
    setView("Erro",'<div class="notice">Não foi possível abrir esta área: '+esc(error.message)+'</div>',"Sistema");
  }
}

var routerRunning=false;
var routerQueued=false;
var routerPromise=null;
function router(){
  if(routerRunning){
    routerQueued=true;
    return routerPromise||Promise.resolve();
  }
  routerRunning=true;
  routerPromise=(async function(){
    try{
      do{
        routerQueued=false;
        await routeOnce();
      }while(routerQueued);
    }finally{
      routerRunning=false;
      routerPromise=null;
    }
  })();
  return routerPromise;
}

quickCapture && quickCapture.addEventListener("click",function(){go("#/capturar");});
window.addEventListener("hashchange",router);
window.addEventListener("DOMContentLoaded",router);
if(document.readyState!=="loading") router();

window.addEventListener("visioncoach:sync-complete",async function(){
  remoteSyncFailed=false;
  refreshRemoteIndicator();
  if(app.querySelector('form[data-form]')) return;
  if(app.querySelector('[data-training-session], [data-session-duplicate], [data-training-continuity], [data-match-visual]')) return;
  if(document.querySelector('#exercise-image-viewer[open]')) return;
  var activeRoot=((location.hash||"#/").slice(1).split("?")[0].split("/").filter(Boolean)[0]||"");
  skipNextRemoteSync=true;
  var scrollX=window.scrollX;
  var scrollY=window.scrollY;
  await router();
  requestAnimationFrame(function(){ window.scrollTo(scrollX,scrollY); });
});
window.addEventListener("visioncoach:realtime-status",function(event){
  refreshRemoteIndicator();
  var realtimeHint=document.getElementById("remote-realtime-status");
  if(realtimeHint)realtimeHint.textContent=realtimeStatusMessage(event.detail?.status);
});
window.addEventListener("focus",function(){ RemoteWorkspace.scheduleSync(150); });
document.addEventListener("visibilitychange",function(){
  if(document.visibilityState==="visible") RemoteWorkspace.scheduleSync(150);
});

RemoteWorkspace.init().then(function(client){
  if(!client) return;
  RemoteWorkspace.scheduleSync(250);
  window.addEventListener("online",function(){ RemoteWorkspace.scheduleSync(150); });
  client.auth.onAuthStateChange(function(event,session){
    refreshRemoteIndicator();
    if(session && (event==="SIGNED_IN" || event==="INITIAL_SESSION" || event==="TOKEN_REFRESHED")){
      setTimeout(async function(){
        try{
          var consolidated=await RemoteWorkspace.consolidateIfNeeded();
          if(!consolidated) RemoteWorkspace.scheduleSync(0);
        }catch(error){
          console.warn("Consolidação automática adiada:",error.message);
          RemoteWorkspace.scheduleSync(250);
        }
      },0);
    }
    if(event==="SIGNED_IN" && session && new URLSearchParams(location.search).get("auth")==="1"){
      history.replaceState(null,"",location.pathname+"#/definicoes");
      router();
    }
  });
}).catch(function(){ /* modo local continua disponível */ });

function nextEventHTML(s){
  var rows=[];
  if(s.next_match){
    var m=s.next_match;
    rows.push('<a class="list-item row" href="#/equipa/jogo/'+m.id+'"><div class="grow"><div class="title">Jogo vs '+esc(m.adversario)+'</div><div class="meta">'+fmtDate(m.data)+(m.hora?' · '+esc(m.hora):'')+'</div></div><span class="badge">Jogo</span></a>');
  }
  if(s.next_training){
    var t=s.next_training;
    rows.push('<a class="list-item row" href="#/consulta/'+t.id+'"><div class="grow"><div class="title">Treino · '+esc(t.objetivo||t.escalao||"Sessão")+'</div><div class="meta">'+fmtDate(t.data)+(t.hora?' · '+esc(t.hora):'')+'</div></div><span class="badge ready">Consultar</span></a>');
  }
  return rows.length?'<div class="list">'+rows.join("")+'</div>':'<div class="empty">Ainda não existem próximos eventos.</div>';
}
function priorityHTML(items){
  if(!items.length) return '<div class="empty">Sem prioridades confirmadas. Regista uma observação e decide o foco quando houver evidência.</div>';
  return '<div class="list">'+items.map(function(item,i){
    return '<a class="list-item priority" href="#/timeline"><span class="priority-rank">'+(i+1)+'</span><span><span class="title">'+esc(item.title)+'</span><span class="meta">'+esc(item.content)+'</span></span><span class="badge">Foco</span></a>';
  }).join("")+'</div>';
}
function documentCard(doc){
  return '<a class="card doc-card" href="'+(doc.type==="weekly_plan"||doc.type==="team_goal"?'#/evolucao':doc.type==="season_index"?'#/epocas':'#/planos/'+doc.id)+'"><span class="doc-type">'+docTypeShort(doc.type)+'</span><span class="grow"><span class="row"><span class="title grow">'+esc(doc.title)+'</span>'+docStatusBadge(doc.status)+'</span><span class="meta">'+esc(docTypeLabel(doc.type))+(doc.target_date?' · '+fmtDate(doc.target_date):'')+'</span><span class="meta">'+esc(doc.created_by_label||HUMAN_LABEL)+'</span></span></a>';
}
async function refreshRemoteWorkspace(options){
  options=options||{};
  try{
    var status=await RemoteWorkspace.status();
    if(!options.skipRemoteSync&&navigator.onLine && status.signedIn && status.remoteTeamId){
      await RemoteWorkspace.syncNow();
      remoteSyncFailed=false;
      return await RemoteWorkspace.status();
    }
    return status;
  }catch(error){
    remoteSyncFailed=true;
    console.warn("Sincronização automática adiada:",error.message);
    try{return await RemoteWorkspace.status();}catch(_){return {signedIn:false,remoteTeamId:null};}
  }
}

function activityOriginNote(origin){
  if(!origin)return '';
  var labels={player:'atleta',match:'jogo',training:'treino',document:'documento',memory:'memória',exercise:'exercício',media:'media'};
  return '<span class="meta">Origem preservada sem ligação · '+esc(labels[origin.type]||origin.type||'registo')+' · referência original '+esc(origin.reference||'indisponível')+'</span>';
}
function activityHTML(rows,limit){
  limit=limit||6;
  var items=rows.slice(0,limit);
  if(!items.length) return '<div class="empty">Ainda sem atividade registada neste workspace.</div>';
  return '<div class="list">'+items.map(function(item){
    var origin=item.metadata&&item.metadata._vision_coach_unresolved_origin;
    return '<div class="list-item row"><span class="grow"><span class="title">'+esc(item.summary||item.action)+'</span><span class="meta">'+fmtDate(item.created_at)+'</span>'+activityOriginNote(origin)+'</span>'+actorBadge(item.actor,item.actor_label)+'</div>';
  }).join("")+'</div>';
}

async function viewWorkspace(options){
  options=options||{};
  var remoteStatus=await RemoteWorkspace.status();
  var s=await WorkspaceStore.buildSnapshot();
  var reportSeasonDocs=await WorkspaceStore.listDocuments(DEFAULT_TEAM_ID,{includeArchived:true}),reportSeasonState=VisionSeasons.state(reportSeasonDocs.find(function(d){return d.type==='season_index';})),reportSeason=reportSeasonState.items.find(function(x){return x.id===reportSeasonState.active_id;});
  var teamName=(s.team&&s.team.nome)||"Equipa";
  var context=[s.team&&s.team.clube,s.team&&s.team.escalao,s.team&&s.team.epoca].filter(Boolean).join(" · ");
  var recentDocs=s.recent_documents.length?s.recent_documents.map(documentCard).join(""):'<div class="empty">Ainda não existem planos ou análises partilhadas.</div>';
  var remoteReady=!!(remoteStatus.signedIn&&remoteStatus.remoteTeamId);
  var remoteLabel=remoteReady
    ? (remoteStatus.lastSyncAt ? "Workspace remoto ligado · última sincronização "+fmtDate(remoteStatus.lastSyncAt) : "Workspace remoto ligado · pronto para sincronizar")
    : "Modo local ativo · configura a ligação remota nas Definições";
  var unavailable=s.players.filter(function(p){return !PlayerStatus.isAvailable(p);});
  var pendingReviews=s.trainings.filter(function(t){return (t.status==="completed"||t.session?.status==="completed")&&t.review?.status!=="done";});
  var pendingTrainingProposals=s.trainings.filter(function(t){return t.continuity?.proposal?.status==="draft";}).map(function(t){return {kind:"training",id:t.id,date:t.data,title:t.continuity.proposal.objective||t.objetivo||"Proposta de treino"};});
  var pendingTeamProposals=reportSeasonDocs.filter(function(d){if(d.type!=="team_goal")return false;return TeamDevelopment.teamGoal(d).agent_proposal?.status==="proposed";}).map(function(d){var goal=TeamDevelopment.teamGoal(d);return {kind:"team",id:d.id,date:d.created_at,title:goal.title||d.title||"Prioridade da equipa"};});
  var matchProposalRows=new Map();(s.matches||[]).forEach(function(match){var analysis=VisionMatchAnalysis.fromMatch(match),proposal=analysis.agent_proposal;if(proposal?.status!=="proposed")return;var key=match.sync_id?"uuid:"+String(match.sync_id):"local:"+String(match.id),stamp=String(match.updated_at||match.sync_local_updated_at||"");var previous=matchProposalRows.get(key);if(!previous||stamp>=previous.stamp)matchProposalRows.set(key,{kind:"match",id:match.id,sync_id:match.sync_id||null,date:match.data,title:"Jogo vs "+(match.adversario||"adversário"),match:match,stamp:stamp,freshness:VisionMatchAnalysis.proposalFreshness(match)});});
  var allMatchProposals=Array.from(matchProposalRows.values()),pendingMatchProposals=allMatchProposals.filter(function(item){return item.freshness.fresh;}),staleMatchProposals=allMatchProposals.filter(function(item){return!item.freshness.fresh;}),pendingProposals=pendingTrainingProposals.concat(pendingTeamProposals,pendingMatchProposals);
  var pendingPlanApprovals=reportSeasonDocs.filter(function(d){return d.type==='training_plan'&&d.status==='ready';});
  var attention='<div class="grid cols-4">';
  attention+='<section class="panel"><h3>Indisponíveis · '+unavailable.length+'</h3>'+(unavailable.length?'<div class="list">'+unavailable.slice(0,4).map(function(p){return '<a class="list-item row" href="#/equipa/jogador/'+p.id+'"><span class="grow">'+esc(p.nome)+'</span><span class="badge">'+esc(PlayerStatus.label(p.estado_disponibilidade))+'</span></a>';}).join('')+'</div>':'<p class="empty">Nenhum atleta assinalado.</p>')+'</section>';
  attention+='<section class="panel"><h3>Avaliações por preencher · '+pendingReviews.length+'</h3>'+(pendingReviews.length?'<div class="list">'+pendingReviews.slice(0,4).map(function(t){return '<a class="list-item" href="#/treinos/'+t.id+'">'+fmtDate(t.data)+' · '+esc(t.objetivo||'Treino')+'</a>';}).join('')+'</div>':'<p class="empty">Sem avaliações pendentes.</p>')+'</section>';
  attention+='<section class="panel"><h3>Propostas por rever · '+pendingProposals.length+'</h3>'+(pendingProposals.length?'<div class="list">'+pendingProposals.slice(0,4).map(function(item){var href=item.kind==="team"?'#/evolucao':item.kind==="match"?'#/equipa/jogo/'+item.id+'?focus=after':'#/continuidade/'+item.id;return '<a class="list-item" '+(item.kind==="match"?'data-match-proposal-sync="'+esc(item.sync_id||'')+'"':'')+' href="'+href+'">'+(item.date?fmtDate(item.date)+' · ':'')+esc(item.title)+(item.kind==="match"?' · Proposta do Head Coach':'')+'</a>';}).join('')+'</div>':'<p class="empty">Sem propostas pendentes.</p>')+(staleMatchProposals.length?'<div class="notice"><strong>Propostas de jogo desatualizadas · '+staleMatchProposals.length+'</strong><p>As revisões da análise/lances mudaram ou uma evidência já não existe. Estas propostas precisam de atualização antes de poderem ser aprovadas.</p><div class="list">'+staleMatchProposals.slice(0,4).map(function(item){return '<a class="list-item" data-match-proposal-stale="'+esc(item.sync_id||'')+'" href="#/equipa/jogo/'+item.id+'?focus=after">'+(item.date?fmtDate(item.date)+' · ':'')+esc(item.title)+' · Desatualizada</a>';}).join('')+'</div></div>':'')+'</section>';
  attention+='<section class="panel"><h3>Planos por aprovar · '+pendingPlanApprovals.length+'</h3>'+(pendingPlanApprovals.length?'<div class="list">'+pendingPlanApprovals.slice(0,4).map(function(d){return '<a class="list-item" href="#/planos/'+d.id+'">'+esc(d.title)+(d.target_date?' · '+fmtDate(d.target_date):'')+'</a>';}).join('')+'</div>':'<p class="empty">Sem planos à espera de aprovação.</p>')+'</section>';
  attention+='<section class="panel"><h3>Conflitos de sincronização · '+(remoteStatus.conflicts||[]).length+'</h3>'+(remoteStatus.conflicts?.length?'<p class="notice">Há alterações que precisam de revisão para proteger trabalho dos dois dispositivos.</p><a class="btn secondary" href="#/definicoes">Rever workspace</a>':'<p class="empty">Sem conflitos sinalizados.</p>')+'</section></div>';
  var html='';
  html+='<div class="hero">';
  html+='<section class="panel hero-main">'+teamCrestHTML(s.team,true)+'<div class="kicker">Human–AI Shared Workspace</div><h2 class="display">O estado da equipa, num único lugar.</h2>';
  html+='<p class="lead">'+esc(context||"Configura a equipa para começar.")+' Dados, planos, media e decisões ficam disponíveis no mesmo workspace para treinador e agente.</p>';
  html+='<div class="toolbar" style="margin-top:18px"><a class="btn accent" href="#/consulta">Consultar treino</a><a class="btn secondary" href="#/pesquisa">Pesquisar histórico</a><a class="btn secondary" href="#/evolucao">Semana e evolução</a><a class="btn secondary" href="#/epocas">Épocas</a><button class="btn secondary" type="button" data-action="export-team-report" '+(reportSeason?'data-season="'+esc(reportSeason.id)+'"':'')+'>Relatório de equipa'+(reportSeason?' · '+esc(reportSeason.name):'')+'</button><a class="btn secondary" href="#/capturar">Registar observação</a><a class="btn secondary" href="#/planos/novo">Novo plano</a><a class="btn secondary" href="#/media/novo">Adicionar media</a></div>';
  html+='<div class="workspace-status '+(remoteReady?"connected":"")+'"><span class="dot"></span>'+esc(remoteLabel)+'</div></section>';
  if(remoteSyncFailed) html+='<p class="notice" role="status">Não foi possível confirmar a sincronização. As alterações continuam guardadas neste dispositivo; tenta novamente quando houver ligação.</p>';
  html+='<aside class="panel hero-side"><div class="section-head"><div><h2>Próximos</h2><p>Agenda operacional</p></div></div>'+nextEventHTML(s)+'</aside></div>';
  html+='<section class="section"><div class="section-head"><div><h2>Precisa de atenção</h2><p>Itens operacionais que dependem do treinador</p></div></div>'+attention+'</section>';
  html+='<div class="grid cols-4">';
  html+='<div class="panel metric"><div class="metric-label">Plantel</div><div class="metric-value">'+s.players.length+'</div><div class="metric-sub">jogadores</div></div>';
  html+='<div class="panel metric"><div class="metric-label">Planos</div><div class="metric-value">'+s.documents.length+'</div><div class="metric-sub">documentos ativos</div></div>';
  html+='<div class="panel metric"><div class="metric-label">Media</div><div class="metric-value">'+s.media.length+'</div><div class="metric-sub">ficheiros e links</div></div>';
  html+='<div class="panel metric"><div class="metric-label">Memória</div><div class="metric-value">'+s.memory.length+'</div><div class="metric-sub">registos operacionais</div></div></div>';
  html+='<section class="section"><div class="section-head"><div><h2>Prioridades atuais</h2><p>Foco confirmado para a equipa</p></div><a class="link" href="#/capturar">Adicionar contexto</a></div>'+priorityHTML(s.priorities)+'</section>';
  html+='<div class="grid cols-2 section"><section><div class="section-head"><div><h2>Planos recentes</h2><p>Produzidos pelo treinador ou agente</p></div><a class="link" href="#/planos">Ver todos</a></div><div class="list">'+recentDocs+'</div></section>';
  html+='<section><div class="section-head"><div><h2>Atividade partilhada</h2><p>Quem fez o quê</p></div><a class="link" href="#/timeline">Timeline</a></div>'+activityHTML(s.recent_activity)+'</section></div>';
  setView(teamName,html,"Workspace");
  if(!options.skipRemoteSync&&navigator.onLine&&remoteStatus.signedIn&&remoteStatus.remoteTeamId){
    RemoteWorkspace.syncNow().then(function(){remoteSyncFailed=false;}).catch(function(error){
      remoteSyncFailed=true;
      console.warn("Sincronização automática adiada:",error.message);
      var activeRoot=((location.hash||"#/").slice(1).split("?")[0].split("/").filter(Boolean)[0]||"");
      if(!activeRoot&&!app.querySelector('form[data-form]')){skipNextRemoteSync=true;router();}
    });
  }
}
async function viewTeamDevelopment(){
  var s=await WorkspaceStore.buildSnapshot(),docs=await WorkspaceStore.listDocuments(DEFAULT_TEAM_ID,{includeArchived:true});
  var weeks=docs.filter(function(d){return d.type==="weekly_plan"&&d.status!=="archived";}),goals=docs.filter(function(d){return d.type==="team_goal"&&d.status!=="archived";});
  var trainings=(s.trainings||[]).filter(function(x){return x.sync_id;}),matches=(s.matches||[]).filter(function(x){return x.sync_id;}),exercises=(await DB.porIndice("exercicios","team_id",DEFAULT_TEAM_ID)).filter(function(x){return x.sync_id;}),memories=await HeadCoachMemory.list(DEFAULT_TEAM_ID);
  function opts(rows,label){return '<option value="">— Sem associação —</option>'+rows.map(function(x){return '<option value="'+esc(x.sync_id)+'">'+esc(label(x))+' · '+fmtDate(x.data)+'</option>';}).join('');}
  var trainingOpts=opts(trainings,function(x){return x.objetivo||x.escalao||"Treino";}),matchOpts=opts(matches,function(x){return 'Jogo vs '+(x.adversario||"adversário");}),sessionOptions=trainings.map(function(x){return '<label class="player-choice"><input type="checkbox" name="session_refs" value="training:'+esc(x.sync_id)+'"><span><strong>'+esc(x.objetivo||x.escalao||'Treino')+'</strong><small>'+fmtDate(x.data)+'</small></span></label>';}).join('')+matches.map(function(x){return '<label class="player-choice"><input type="checkbox" name="session_refs" value="match:'+esc(x.sync_id)+'"><span><strong>Jogo vs '+esc(x.adversario||'adversário')+'</strong><small>'+fmtDate(x.data)+'</small></span></label>';}).join(''),memoryEvidenceOptions=memories.filter(function(x){return x.sync_id;}).map(function(x){return '<label class="player-choice"><input type="checkbox" name="evidence_refs" value="memory:'+esc(x.sync_id)+'"><span><strong>Observação · '+esc(x.title||'Observação')+'</strong><small>'+fmtDate(x.occurred_at)+'</small></span></label>';}).join('');
  function refInfo(ref){var row,href,label,dateValue='';if(ref.type==='training'){row=trainings.find(function(x){return String(x.sync_id)===String(ref.id);});if(row){href='#/consulta/'+row.id;label='Treino · '+(row.objetivo||row.escalao||'Sessão');dateValue=row.data;}}else if(ref.type==='match'){row=matches.find(function(x){return String(x.sync_id)===String(ref.id);});if(row){href='#/equipa/jogo/'+row.id;label='Jogo · '+(row.adversario||'Adversário');dateValue=row.data;}}else if(ref.type==='exercise'){row=exercises.find(function(x){return String(x.sync_id)===String(ref.id);});if(row){href='#/exercicios/'+row.id;label='Exercício · '+row.nome;dateValue=row.updated_at;}}else if(ref.type==='memory'){row=memories.find(function(x){return String(x.sync_id)===String(ref.id);});if(row){href='#/timeline/memory/'+row.id;label='Observação · '+row.title;dateValue=row.occurred_at;}}return{href:href,label:label||'Fonte ainda não sincronizada · '+ref.type+' · '+ref.id,date:dateValue?fmtDate(String(dateValue).slice(0,10)):''};}
  function refList(refs,empty){var rows=(refs||[]).map(refInfo);return rows.length?'<ul>'+rows.map(function(item){return '<li>'+(item.href?'<a href="'+item.href+'">'+esc(item.label)+'</a>':'<span>'+esc(item.label)+'</span>')+(item.date?' · '+esc(item.date):'')+'</li>';}).join('')+'</ul>':'<p class="meta">'+esc(empty)+'</p>';}
  function otherEvidence(value){var extras=(value.evidence||[]).filter(function(ref){return !(value.sessions||[]).some(function(session){return session.type===ref.type&&String(session.id)===String(ref.id);});});return extras.length?refList(extras,''):value.evidence?.length?'<p class="meta">As evidências registadas correspondem às sessões acima.</p>':'<p class="meta">Sem evidências adicionais registadas.</p>'; }
  function card(doc,kind){var value=kind==="week"?TeamDevelopment.week(doc):TeamDevelopment.teamGoal(doc);var title=kind==="week"?'Semana de '+fmtDate(value.week_start):value.title,pending=value.agent_proposal?.status==='proposed',hasProposal=!!value.agent_proposal,proposalStatus=pending?'Proposta do Head Coach · por rever · ':value.agent_proposal?.status==='accepted'?'Proposta aceite pelo treinador · ':value.agent_proposal?.status==='dismissed'?'Proposta rejeitada pelo treinador · ':'';var meta=kind==="week"?value.objective:((hasProposal?proposalStatus:'')+TeamDevelopment.labels[value.stage]+' · identificado '+fmtDate(value.identified_at)+' · '+value.sessions.length+' sessão(ões) associada(s) · '+value.exercises.length+(value.exercises.length===1?' exercício':' exercícios'));var proposal=hasProposal?'<div class="notice"><strong>Proposta do Head Coach · '+esc(value.agent_proposal.prepared_by||'Head Coach')+'</strong><p>'+esc(value.interpretation||value.agent_proposal.rationale||'')+'</p>'+(value.agent_proposal.evidence_refs||[]).map(function(ref){var source=ref.type==='match'?matches.find(function(x){return String(x.sync_id)===String(ref.id);}):trainings.find(function(x){return String(x.sync_id)===String(ref.id);}),href=source?(ref.type==='match'?'#/equipa/jogo/'+source.id:'#/consulta/'+source.id):null,label=(ref.type==='match'?'Jogo':'Treino')+' · '+ref.field+(ref.event_ref?' · '+ref.event_ref:'');return '<p>'+(href?'<a class="link" href="'+href+'">'+esc(label)+'</a>':'<span class="meta">'+esc(label)+' · fonte ainda não sincronizada neste dispositivo · UUID '+esc(ref.id)+'</span>')+'<br><span>'+esc(ref.quote||'')+'</span></p>';}).join('')+(pending?'<div class="toolbar"><button class="btn accent small" type="button" data-action="accept-team-proposal" data-id="'+doc.id+'">Aceitar como objetivo</button><button class="btn secondary small" type="button" data-action="dismiss-team-proposal" data-id="'+doc.id+'">Rejeitar proposta</button></div>':'')+'</div>':'';var weekRefs=[value.training1&&{type:'training',id:value.training1},value.training2&&{type:'training',id:value.training2},value.match&&{type:'match',id:value.match}].filter(Boolean),relationNotes=(value.links||[]).map(function(link){return link.note;}).filter(Boolean);if(value.relation_note)relationNotes=[value.relation_note];return '<article class="list-item"><div class="row"><div class="grow"><div class="title">'+esc(title)+'</div><div class="meta">'+esc(meta||'Sem foco descrito.')+'</div></div><button class="link" type="button" data-action="edit-team-record" data-kind="'+kind+'" data-id="'+doc.id+'">Editar</button><button class="link danger" type="button" data-action="delete-team-record" data-id="'+doc.id+'">Apagar</button></div>'+(kind==="goal"?proposal+'<div class="team-goal-detail"><h4>Sessões que originaram o objetivo</h4>'+refList(value.sessions,'Sem treino ou jogo associado.')+'<h4>Exercícios utilizados</h4>'+refList(value.exercises,'Sem exercício associado.')+'<h4>Evidências</h4>'+otherEvidence(value)+'<p><strong>Facto observado:</strong> '+esc(value.observations||'—')+'<br><strong>Interpretação:</strong> '+esc(value.interpretation||'—')+'<br><strong>Hipótese por confirmar:</strong> '+esc(value.hypothesis||'—')+'<br><strong>Avaliação do treinador:</strong> '+esc(value.evaluation||'Por preencher')+'<br><strong>Decisão do treinador:</strong> '+esc(value.coach_decision||'—')+'</p></div>':'<div class="team-week-detail"><h4>Sessões relacionadas</h4>'+refList(weekRefs,'Ainda sem treino ou jogo associado.')+(relationNotes.length?'<p><strong>Progressão planeada:</strong> '+esc(relationNotes.join(' · '))+'</p>':'')+'<p><strong>Avaliação final do treinador:</strong> '+esc(value.evaluation.summary||'Por preencher')+'</p>'+(value.evaluation.evidence?.length?'<h4>Evidências da avaliação</h4>'+refList(value.evaluation.evidence,'Sem evidências associadas.'):'')+'</div>')+'</article>';}
  var html='<section class="panel hero-main"><div class="kicker">Evolução da equipa</div><h2 class="display">Da semana ao que está a melhorar.</h2><p class="lead">Os treinos e jogos são ligados por referências estáveis. A evolução só muda quando o treinador regista a observação e a avaliação.</p><a class="btn secondary" href="#/calendario">Abrir calendário existente</a></section>';
  html+='<section class="section"><div class="section-head"><div><h2>Planos semanais</h2><p>Objetivo, progressão entre sessões, jogo e avaliação final</p></div></div><div class="list">'+(weeks.length?weeks.map(function(d){return card(d,'week');}).join(''):'<div class="empty">Ainda não há semanas planeadas.</div>')+'</div>';
  html+='<form class="panel form" data-form="team-week"><input type="hidden" name="doc_id"><input type="hidden" name="expected_revision" value="0"><input type="hidden" name="expected_updated_at"><h3>Planear semana</h3><div class="form-grid"><label class="field"><span>Segunda-feira da semana</span><input name="week_start" type="date" required value="'+TeamDevelopment.monday(today())+'"></label><label class="field"><span>Objetivo da semana</span><input name="objective" required maxlength="1000" placeholder="Ex.: criar apoio após passe"></label></div><div class="form-grid"><label class="field"><span>Treino 1</span><select name="training1">'+trainingOpts+'</select></label><label class="field"><span>Treino 2</span><select name="training2">'+trainingOpts+'</select></label><label class="field"><span>Jogo</span><select name="match">'+matchOpts+'</select></label></div><label class="field"><span>Como as sessões se relacionam</span><input name="relation_note" maxlength="500" placeholder="Segunda: princípio · quinta: progressão · jogo: observar"></label><label class="field"><span>Avaliação final da semana</span><textarea name="evaluation" maxlength="3000" placeholder="Preencher depois de observar; não é inferida pelo número de sessões."></textarea></label><div class="toolbar"><button class="btn accent" type="submit">Guardar semana</button><button class="btn secondary" type="button" data-action="cancel-team-edit" hidden>Cancelar edição</button></div><p class="notice" data-team-feedback hidden></p></form></section>';
  var stageOpts=TeamDevelopment.stages.map(function(x){return '<option value="'+x+'">'+esc(TeamDevelopment.labels[x])+'</option>';}).join('');
  html+='<section class="section"><div class="section-head"><div><h2>Objetivos da equipa</h2><p>Fluxo explícito: identificado → planeado → trabalhado → observado → avaliado → melhorou / continua</p></div></div><div class="list">'+(goals.length?goals.map(function(d){return card(d,'goal');}).join(''):'<div class="empty">Ainda não há objetivos de equipa.</div>')+'</div>';
  var exerciseOptions=exercises.map(function(x){return '<label class="player-choice"><input type="checkbox" name="exercise_refs" value="'+esc(x.sync_id)+'"><span><strong>'+esc(x.nome||'Exercício')+'</strong></span></label>';}).join('');
  html+='<form class="panel form" data-form="team-goal"><input type="hidden" name="doc_id"><input type="hidden" name="expected_revision" value="0"><input type="hidden" name="expected_updated_at"><h3>Registar objetivo</h3><div class="form-grid"><label class="field"><span>Objetivo</span><input name="title" required maxlength="200"></label><label class="field"><span>Identificado em</span><input name="identified_at" type="date" value="'+today()+'"></label><label class="field"><span>Estado decidido pelo treinador</span><select name="stage">'+stageOpts+'</select></label></div><fieldset class="field"><legend>Treinos e jogos relacionados</legend><div class="player-choice-grid">'+(sessionOptions||'<p class="empty">Ainda sem treinos ou jogos com UUID partilhado.</p>')+'</div></fieldset><fieldset class="field"><legend>Observações usadas como evidência</legend><div class="player-choice-grid">'+(memoryEvidenceOptions||'<p class="empty">Ainda sem observações ligadas à equipa.</p>')+'</div><small>As sessões relacionadas também ficam registadas como evidências. As observações são referências adicionais.</small></fieldset><fieldset class="field"><legend>Exercícios relacionados</legend><div class="player-choice-grid">'+(exerciseOptions||'<p class="empty">Ainda sem exercícios com UUID partilhado.</p>')+'</div></fieldset><label class="field"><span>Facto observado</span><textarea name="observations" maxlength="3000"></textarea></label><label class="field"><span>Interpretação</span><textarea name="interpretation" maxlength="3000"></textarea></label><label class="field"><span>Hipótese por confirmar</span><textarea name="hypothesis" maxlength="3000"></textarea></label><label class="field"><span>Avaliação do treinador</span><textarea name="evaluation" maxlength="3000" placeholder="O que foi observado ao trabalhar este objetivo?"></textarea></label><label class="field"><span>Decisão explícita do treinador</span><textarea name="coach_decision" maxlength="3000"></textarea></label><div class="toolbar"><button class="btn accent" type="submit">Guardar objetivo</button><button class="btn secondary" type="button" data-action="cancel-team-edit" hidden>Cancelar edição</button></div><p class="notice" data-team-feedback hidden></p></form></section>';
  setView('Semana e evolução',html,'Planeamento');
}
async function viewSeasons(){
  var team=await HeadCoachMemory.ensureTeam(),docs=await WorkspaceStore.listDocuments(DEFAULT_TEAM_ID,{includeArchived:true}),players=await DB.porIndice('jogadores','team_id',DEFAULT_TEAM_ID),trainings=await DB.porIndice('treinos','team_id',DEFAULT_TEAM_ID),matches=await DB.porIndice('jogos','team_id',DEFAULT_TEAM_ID),indexDoc=docs.find(x=>x.type==='season_index')||null,index=VisionSeasons.state(indexDoc),active=index.items.find(x=>x.id===index.active_id)||null;
  var eligible=players.filter(p=>p.sync_id&&/^[0-9a-f-]{36}$/i.test(p.sync_id));
  function seasonCard(season){var sTrain=trainings.filter(x=>VisionSeasons.includes(season,x.data)),sMatches=matches.filter(x=>VisionSeasons.includes(season,x.data)),roster=season.roster.map(x=>x.name).join(', ')||'Plantel sem atletas associados',isActive=season.id===index.active_id;return '<article class="list-item"><div class="row"><div class="grow"><div class="title">'+esc(season.name)+(isActive?' · Ativa':' · Anterior')+'</div><div class="meta">'+fmtDate(season.start_date)+' – '+fmtDate(season.end_date)+' · '+season.roster.length+' atletas · '+sTrain.length+' treinos · '+sMatches.length+' jogos</div></div><button class="link" type="button" data-action="edit-season" data-id="'+esc(season.id)+'">Editar</button><button class="btn secondary small" type="button" data-action="export-team-report" data-season="'+esc(season.id)+'">Relatório da equipa</button>'+(isActive?'':'<button class="btn secondary small" type="button" data-action="activate-season" data-id="'+esc(season.id)+'">Ativar época</button>')+'</div><div class="body-copy">Plantel da época: '+esc(roster)+'</div>'+(season.roster.map(function(p){return '<button class="link" type="button" data-action="export-season-player" data-player="'+esc(p.ref)+'" data-season="'+esc(season.id)+'">Relatório · '+esc(p.name)+'</button>';}).join(' '))+'</article>';}
  var rosterOptions=eligible.map(function(p){return '<label class="row"><input type="checkbox" name="roster_refs" value="'+esc(p.sync_id)+'" '+(PlayerStatus.inRoster(p)?'checked':'')+'><span>'+esc(p.nome)+(p.numero!=null?' · #'+esc(p.numero):'')+'</span></label>';}).join('');
  var html='<section class="panel hero-main"><div class="kicker">Épocas</div><h2 class="display">Histórico separado por período.</h2><p class="lead">Cada época guarda o seu plantel por UUID. Treinos, jogos e relatórios são apresentados dentro das respetivas datas; o histórico original mantém-se intacto.</p><div class="toolbar"><a class="btn secondary" href="#/calendario">Calendário</a><a class="btn secondary" href="#/evolucao">Semana e evolução</a></div></section>';
  html+='<section class="section"><div class="section-head"><div><h2>Ativa e anteriores</h2><p>'+(active?'Época ativa: '+esc(active.name):'Ainda não há uma época arquivada.')+'</p></div></div><div class="list">'+(index.items.length?index.items.slice().sort((a,b)=>b.start_date.localeCompare(a.start_date)).map(seasonCard).join(''):'<div class="empty">Cria uma época para começar o arquivo histórico.</div>')+'</div></section>';
  html+='<form class="panel form" data-form="season"><input type="hidden" name="doc_id" value="'+(indexDoc?.id||'')+'"><input type="hidden" name="expected_revision" value="'+index.revision+'"><input type="hidden" name="expected_updated_at" value="'+esc(indexDoc?.updated_at||'')+'"><input type="hidden" name="season_id"><h3>Guardar época</h3><div class="form-grid"><label class="field"><span>Nome</span><input name="name" required maxlength="60" placeholder="2026/27" value="'+esc(team.epoca||'')+'"></label><label class="field"><span>Início</span><input name="start_date" type="date" required value="'+new Date().getFullYear()+'-08-01"></label><label class="field"><span>Fim</span><input name="end_date" type="date" required value="'+(new Date().getFullYear()+1)+'-07-31"></label></div><fieldset class="field"><legend>Plantel desta época</legend><div class="player-choice-grid">'+(rosterOptions||'<p class="empty">Sem atletas com UUID partilhado para associar.</p>')+'</div></fieldset><label class="row"><input type="checkbox" name="activate" value="yes" '+(!active?'checked':'')+'><span>Definir como época ativa (a atual passa para histórico)</span></label><div class="toolbar"><button class="btn accent" type="submit">Guardar época</button><button class="btn secondary" type="button" data-action="cancel-season-edit" hidden>Cancelar edição</button></div><p class="notice" data-season-feedback hidden></p></form>';
  setView('Épocas',html,'Arquivo');
}
function calendarEventRow(event){
  var meta=(event.time?esc(event.time):"Hora por definir");
  if(event.type==="match"){
    var m=event.item||{};
    if(m.local) meta+=" · "+esc(m.local);
    if(m.hora_saida) meta+=" · saída "+esc(m.hora_saida);
    return '<a class="list-item row calendar-row" href="#/equipa/jogo/'+event.id+'"><span class="calendar-kind match">J</span><span class="grow"><span class="title">'+esc(event.title)+'</span><span class="meta">'+meta+'</span></span><span class="badge">'+esc(m.estado||"agendado")+'</span></a>';
  }
  var label=event.planned?"Treino previsto":"Treino";
  if(event.end_time) meta+="–"+esc(event.end_time);
  if(event.planned) return '<div class="list-item row calendar-row"><span class="calendar-kind training">T</span><span class="grow"><span class="title">'+esc(label)+'</span><span class="meta">'+meta+'</span></span><span class="badge draft">Horário</span></div>';
  return '<a class="list-item row calendar-row" href="#/consulta/'+event.id+'"><span class="calendar-kind training">T</span><span class="grow"><span class="title">'+esc(label)+'</span><span class="meta">'+meta+'</span></span><span class="badge ready">Consultar</span></a>';
}
async function viewCalendar(){
  var s=await WorkspaceStore.buildSnapshot();
  var events=VisionCalendar.events(s,{from:today(),weeks:6});
  var groups={};
  events.forEach(function(event){(groups[event.date]||(groups[event.date]=[])).push(event);});
  var body=Object.keys(groups).length?Object.keys(groups).map(function(date){
    return '<section class="calendar-day"><div class="calendar-date"><strong>'+fmtDate(date)+'</strong><span>'+groups[date].length+' evento(s)</span></div><div class="list">'+groups[date].map(calendarEventRow).join("")+'</div></section>';
  }).join(""):'<div class="empty">Ainda não existem eventos na agenda.</div>';
  var schedule=s.team&&s.team.horarios&&s.team.horarios.texto;
  var html='<div class="section-head"><div><h2>Agenda operacional</h2><p>Jogos, treinos registados e horário recorrente</p></div><a class="btn accent" href="#/equipa/jogo/novo">Novo jogo</a></div>';
  if(schedule) html+='<div class="notice calendar-note">'+esc(schedule)+'</div>';
  html+='<div class="calendar-list">'+body+'</div>';
  setView("Calendário",html,"Calendário");
}
async function viewTeam(){
  var s=await WorkspaceStore.buildSnapshot();
  var team=s.team||{};
  var allPlayers=await applyPlayerProfilePhotos((await DB.porIndice("jogadores","team_id",DEFAULT_TEAM_ID)).slice());
  allPlayers.sort(function(a,b){return String(a.nome).localeCompare(String(b.nome));});
  var players=allPlayers.filter(function(p){return PlayerStatus.inRoster(p);});
  var retiredPlayers=allPlayers.filter(function(p){return !PlayerStatus.inRoster(p);});
  var availableCount=players.filter(function(p){return PlayerStatus.isAvailable(p);}).length;
  var playerCards=players.length?players.map(function(p){
    var status=PlayerStatus.normalize(p.estado_disponibilidade);
    return '<a class="card player-card" href="#/equipa/jogador/'+p.id+'">'+avatarHTML(p)+'<span class="grow"><span class="title">'+esc(p.nome)+'</span><span class="meta">'+esc(p.posicao||p.escalao||"Jogador")+'</span></span><span class="badge '+PlayerStatus.badgeClass(status)+'">'+esc(PlayerStatus.label(status))+'</span></a>';
  }).join(""):'<div class="empty">Ainda não existem jogadores ativos.</div>';
  var retiredCards=retiredPlayers.length?retiredPlayers.map(function(p){
    return '<a class="card player-card" href="#/equipa/jogador/'+p.id+'">'+avatarHTML(p)+'<span class="grow"><span class="title">'+esc(p.nome)+'</span><span class="meta">Fora do plantel</span></span><span class="badge system">Retirado</span></a>';
  }).join(""):"";
  var html='<div class="profile-grid">';
  html+='<section class="panel hero-main">'+teamCrestHTML(team,true)+'<div class="kicker">Perfil da equipa</div><h2 class="display" style="font-size:28px">'+esc(team.nome||"Equipa")+'</h2><p class="lead">'+esc([team.clube,team.escalao,team.epoca,team.competicao,team.formato].filter(Boolean).join(" · ")||"Completa os dados base da equipa.")+'</p><div class="toolbar" style="margin-top:18px"><a class="btn secondary" href="#/equipa/editar">Editar equipa</a><a class="btn" href="#/equipa/jogador/novo">Adicionar jogador</a></div></section>';
  html+='<section class="panel hero-side"><div class="metric-label">Modelo de trabalho</div><p class="lead">A equipa é a fonte factual do workspace. O agente deve ler estes dados, nunca inventá-los.</p><div class="notice" style="margin-top:14px">A IA autorizada pode consultar os mesmos dados e preparar propostas através do MCP. Gere os acessos em <a class="link" href="#/definicoes">Definições</a>. As decisões e ações de jogo continuam a exigir confirmação do treinador.</div></section></div>';
  html+='<section class="section"><div class="section-head"><div><h2>Plantel</h2><p>'+players.length+' jogador(es) · '+availableCount+' disponível(eis) · '+(players.length-availableCount)+' não disponível(eis)</p></div><a class="link" href="#/equipa/jogador/novo">Adicionar</a></div><div class="player-grid">'+playerCards+'</div></section>';
  if(retiredPlayers.length) html+='<section class="section"><div class="section-head"><div><h2>Fora do plantel</h2><p>'+retiredPlayers.length+' jogador(es) retirado(s)</p></div></div><div class="player-grid">'+retiredCards+'</div></section>';

  setView(team.nome||"Equipa",html,"Equipa");
}

async function viewTeamForm(){
  var t=await HeadCoachMemory.ensureTeam();
  var html='<section class="panel hero-main" style="max-width:760px"><form class="form" data-form="team">';
  html+='<div class="form-grid"><label class="field"><span>Nome da equipa</span><input name="nome" required value="'+esc(t.nome)+'"></label><label class="field"><span>Clube</span><input name="clube" value="'+esc(t.clube)+'"></label></div>';
  html+='<div class="form-grid"><label class="field"><span>Escalão</span><input name="escalao" value="'+esc(t.escalao)+'"></label><label class="field"><span>Época</span><input name="epoca" placeholder="2026/27" value="'+esc(t.epoca)+'"></label></div>';
  html+='<div class="form-grid"><label class="field"><span>Competição</span><input name="competicao" value="'+esc(t.competicao)+'"></label><label class="field"><span>Formato</span><input name="formato" placeholder="5v5" value="'+esc(t.formato)+'"></label></div>';
  html+='<label class="field"><span>Horários / contexto</span><textarea name="horarios">'+esc(t.horarios&&t.horarios.texto)+'</textarea></label>';
  html+='<div class="toolbar"><button class="btn accent" type="submit">Guardar alterações</button><a class="btn secondary" href="#/equipa">Cancelar</a></div></form></section>';
  setView("Editar equipa",html,"Equipa");
}
async function viewPlayerForm(id){
  var player=id?await DB.obter("jogadores",id):null;
  var opts=['<option value="">—</option>'].concat(ESCALOES.map(function(e){
    return '<option value="'+esc(e)+'" '+(player&&player.escalao===e?"selected":"")+'>'+esc(e)+'</option>';
  })).join("");
  var statusCurrent=PlayerStatus.normalize(player&&player.estado_disponibilidade);
  var statusOpts=Object.keys(PlayerStatus.statuses).map(function(key){
    return '<option value="'+key+'" '+(statusCurrent===key?"selected":"")+'>'+esc(PlayerStatus.statuses[key])+'</option>';
  }).join("");
  var html='<section class="panel hero-main" style="max-width:760px"><form class="form" data-form="player" data-id="'+(id||"")+'">';
  html+='<div class="form-grid"><label class="field"><span>Nome</span><input name="nome" required value="'+esc(player&&player.nome)+'"></label><label class="field"><span>Número</span><input type="number" name="numero" min="1" value="'+esc(player&&player.numero!=null?player.numero:"")+'"></label></div>';
  html+='<div class="form-grid"><label class="field"><span>Escalão</span><select name="escalao">'+opts+'</select></label><label class="field"><span>Posição</span><input name="posicao" value="'+esc(player&&player.posicao)+'"></label></div>';
  html+='<label class="field"><span>Disponibilidade</span><select name="estado_disponibilidade">'+statusOpts+'</select><small>Usa apenas o estado operacional. Não registes diagnósticos médicos.</small></label>';
  html+='<label class="field"><span>Foto do atleta</span><input name="foto_file" type="file" accept="image/*"><small>Podes escolher uma fotografia da galeria ou tirar uma nova no telemóvel.</small></label>';
  if(player&&player.foto) html+='<div class="row" style="margin-bottom:12px">'+avatarHTML(player,72)+'<span class="meta">Foto atual</span></div>';
  html+='<label class="field"><span>Notas factuais</span><textarea name="notas">'+esc(player&&player.notas)+'</textarea></label>';
  html+='<div class="toolbar"><button class="btn accent" type="submit">Guardar</button><a class="btn secondary" href="'+(id?'#/equipa/jogador/'+id:'#/equipa')+'">Cancelar</a></div></form></section>';
  setView(id?"Editar jogador":"Novo jogador",html,"Equipa");
}
async function playerGoalsSection(player){
  var state=PlayerGoals.state(player),matches=await DB.porIndice("jogos","team_id",DEFAULT_TEAM_ID),trainings=await DB.porIndice("treinos","team_id",DEFAULT_TEAM_ID),memories=await HeadCoachMemory.list(DEFAULT_TEAM_ID,{subjectType:"player",subjectId:player.id}),exercises=await DB.porIndice("exercicios","team_id",DEFAULT_TEAM_ID);
  var refs=[];matches.forEach(function(x){if(x.sync_id)refs.push({key:"match:"+x.sync_id,label:"Jogo · "+fmtDate(x.data)+" · "+x.adversario});});trainings.forEach(function(x){if(x.sync_id)refs.push({key:"training:"+x.sync_id,label:"Treino · "+fmtDate(x.data)+" · "+(x.objetivo||'Sessão')});});memories.forEach(function(x){if(x.sync_id)refs.push({key:"observation:"+x.sync_id,label:"Observação · "+x.title});});
  function linkedRefs(list){return list&&list.length?'<ul>'+list.map(function(ref){var row,label,href;if(ref.type==='match'){row=matches.find(function(x){return String(x.sync_id)===String(ref.id);});if(row){label='Jogo · '+(row.adversario||'Adversário');href='#/equipa/jogo/'+row.id;}}else if(ref.type==='training'){row=trainings.find(function(x){return String(x.sync_id)===String(ref.id);});if(row){label='Treino · '+(row.objetivo||row.escalao||'Sessão');href='#/consulta/'+row.id;}}else if(ref.type==='observation'){row=memories.find(function(x){return String(x.sync_id)===String(ref.id);});if(row){label='Observação · '+row.title;href='#/timeline/memory/'+row.id;}}else if(ref.type==='exercise'){row=exercises.find(function(x){return String(x.sync_id)===String(ref.id);});if(row){label='Exercício · '+row.nome;href='#/exercicios/'+row.id;}}return '<li>'+(href?'<a class="link" href="'+href+'">'+esc(label)+'</a>':'<span class="meta">Origem ainda não sincronizada · '+esc(ref.type)+' · '+esc(ref.id)+'</span>')+'</li>';}).join('')+'</ul>':'<p class="meta">Sem registos associados.</p>';}
  var current=state.items.length?'<div class="list">'+state.items.map(function(g){var prior=(g.history||[]).map(function(snapshot){return '<li><strong>'+esc(PlayerGoals.states[snapshot.status]||snapshot.status||'Estado anterior')+'</strong> · '+esc(snapshot.title||g.title)+' · '+fmtDate(String(snapshot.updated_at||'').slice(0,10))+(snapshot.notes?'<br>'+esc(snapshot.notes):'')+(snapshot.evidence_refs?.length?linkedRefs(snapshot.evidence_refs):'')+(snapshot.exercise_refs?.length?linkedRefs(snapshot.exercise_refs.map(function(id){return{type:'exercise',id:id};})):'')+'</li>';}).join('');return '<article class="list-item" id="player-goal-'+esc(g.id)+'"><div class="row"><div class="grow"><div class="title">'+esc(g.title)+'</div><div class="meta">Desde '+fmtDate(g.started_at)+' · '+esc(PlayerGoals.states[g.status])+'</div></div><button class="link" type="button" data-action="edit-player-goal" data-player="'+player.id+'" data-goal="'+esc(g.id)+'">Editar</button><button class="link danger" type="button" data-action="delete-player-goal" data-player="'+player.id+'" data-goal="'+esc(g.id)+'">Apagar</button></div><div class="body-copy">'+esc(g.notes||'Sem notas.')+'</div><h4>Evidências</h4>'+linkedRefs(g.evidence_refs)+'<h4>Exercícios relacionados</h4>'+linkedRefs((g.exercise_refs||[]).map(function(id){return{type:'exercise',id:id};}))+(prior?'<h4>Histórico de alterações</h4><ol>'+prior+'</ol>':'')+'</article>';}).join('')+'</div>':'<div class="empty">Ainda sem objetivos individuais.</div>';
  return '<section class="section panel" id="player-goals"><div class="section-head"><div><h2>Objetivos individuais</h2><p>Histórico de trabalho e evidências; sem classificações entre atletas.</p></div></div>'+current+'<form class="form" data-form="player-goal" data-id="'+player.id+'"><input type="hidden" name="goal_id"><input type="hidden" name="expected_revision" value="'+state.revision+'"><label class="field"><span>Objetivo</span><input name="title" required maxlength="200"></label><div class="form-grid"><label class="field"><span>Data de início</span><input name="started_at" type="date" value="'+today()+'" required></label><label class="field"><span>Estado</span><select name="status">'+Object.entries(PlayerGoals.states).map(function(x){return '<option value="'+x[0]+'">'+esc(x[1])+'</option>';}).join('')+'</select></label></div><label class="field"><span>Evidências · jogos, treinos ou observações</span><div class="player-choice-grid">'+refs.map(function(x){return '<label class="row"><input type="checkbox" name="evidence_refs" value="'+esc(x.key)+'"><span>'+esc(x.label)+'</span></label>';}).join('')+'</div></label><label class="field"><span>Exercícios relacionados</span><div class="player-choice-grid">'+exercises.filter(function(x){return x.sync_id;}).map(function(x){return '<label class="row"><input type="checkbox" name="exercise_refs" value="'+esc(x.sync_id)+'"><span>'+esc(x.nome)+'</span></label>';}).join('')+'</div></label><label class="field"><span>Observações</span><textarea name="notes"></textarea></label><div class="toolbar"><button class="btn accent" type="submit">Guardar objetivo</button><button class="btn secondary" type="button" data-action="cancel-player-goal" hidden>Cancelar edição</button></div><p class="notice" data-goal-feedback hidden></p></form></section>';
}
async function playerTimelineSection(player){
  var ref=String(player.sync_id||""),matches=ref?await DB.porIndice("jogos","team_id",DEFAULT_TEAM_ID):[],trainings=ref?await DB.porIndice("treinos","team_id",DEFAULT_TEAM_ID):[],memories=await HeadCoachMemory.list(DEFAULT_TEAM_ID,{subjectType:"player",subjectId:player.id}),goals=PlayerGoals.state(player).items,items=[];
  function add(type,title,detail,date,href,id){if(!date||Number.isNaN(Date.parse(date)))return;items.push({type:type,title:title,detail:detail,date:new Date(date).toISOString(),href:href||null,id:id||type+":"+items.length});}
  if(ref){
    trainings.forEach(function(training){var attendance=(training.session&&training.session.attendance||[]).find(function(x){return String(x.player_ref)===ref&&x.status!=="unknown";});if(!attendance)return;var status=VisionTrainingSession.attendance[attendance.status]||attendance.status;add("Treino","Treino · "+(training.objetivo||"Sessão"),"Presença: "+status,training.data,"#/sessao/"+training.id,"training:"+(training.sync_id||training.id)+":"+ref);});
    matches.forEach(function(match){var state=VisionMatchVisual.state(match),called=(match.callup&&match.callup.player_ids||[]).some(function(x){return String(x)===ref;}),started=!!state.started_at,initial=started?(state.initial_slots||VisionMatchVisual.initialSlots(match)):null,starter=!!initial&&Object.values(initial).some(function(x){return String(x)===ref;}),events=state.events.filter(function(x){return x.type==="substitute"&&!x.voided_at;}),playerMoves=events.filter(function(x){return String(x.in_ref)===ref||String(x.out_ref)===ref;}).sort(function(a,b){return a.at_ms-b.at_ms;}),entries=playerMoves.filter(function(x){return String(x.in_ref)===ref;}),exits=playerMoves.filter(function(x){return String(x.out_ref)===ref;}),rostered=state.roster.some(function(x){return String(x.ref)===ref;});if(!called&&!rostered&&!starter&&!entries.length&&!exits.length)return;var detail=[];if(called)detail.push("Convocado");if(started&&starter)detail.push("Titular");playerMoves.forEach(function(x){detail.push((String(x.in_ref)===ref?"Entrou":"Saiu")+" aos "+Math.floor(x.at_ms/60000)+" min");});var played=started&&(rostered||starter||entries.length>0||exits.length>0),usage=played?VisionMatchVisual.replay(match).players.find(function(x){return String(x.ref)===ref;}):null;if(usage){var positions=VisionMatchVisual.positionsPlayed(match,ref).map(function(role){return VisionMatchVisual.roles[role];});detail.push("Utilização registada: "+VisionMatchVisual.format(usage.elapsed_ms)+(positions.length?" · "+positions.join(", "):""));}else if(called)detail.push("Minutos não registados");add("Jogo","Jogo · "+(match.adversario||"Adversário"),detail.join(" · ")||"Sem participação registada",match.data,"#/equipa/jogo/"+match.id,"match:"+(match.sync_id||match.id)+":"+ref);});
  }
  memories.forEach(function(memory){add("Observação",memory.title||"Observação",memory.content||"Sem detalhe registado.",memory.occurred_at,memory.id?"#/timeline/memory/"+memory.id:null,"memory:"+(memory.sync_id||memory.id));});
  goals.forEach(function(goal){add("Objetivo","Objetivo individual · "+goal.title,"Definido · "+(PlayerGoals.states[goal.status]||goal.status),goal.started_at,null,"goal:"+goal.id+":started");(goal.history||[]).forEach(function(snapshot){add("Objetivo","Objetivo atualizado · "+(snapshot.title||goal.title),PlayerGoals.states[snapshot.status]||snapshot.status,snapshot.updated_at,null,"goal:"+goal.id+":"+snapshot.updated_at);});if((goal.history||[]).length)add("Objetivo","Estado atual · "+goal.title,PlayerGoals.states[goal.status]||goal.status,goal.updated_at,null,"goal:"+goal.id+":current");});
  items.sort(function(a,b){return b.date.localeCompare(a.date)||a.type.localeCompare(b.type)||a.id.localeCompare(b.id);});
  var rows=items.length?'<ol class="list player-timeline">'+items.map(function(item){var origin=item.href?'<a class="link" href="'+esc(item.href)+'">Abrir origem</a>':item.type==="Objetivo"?'<button class="link" type="button" data-action="jump-player-goal" data-goal="'+esc(item.id.split(":")[1])+'">Ver objetivo</button>':'';return '<li class="list-item"><div class="row"><div class="grow"><time class="meta" datetime="'+esc(item.date)+'">'+fmtDate(item.date.slice(0,10))+'</time><div class="title">'+esc(item.title)+'</div><div class="body-copy">'+esc(item.detail)+'</div></div>'+origin+'</div></li>';}).join('')+'</ol>':'<p class="empty">Ainda não existem presenças, jogos, observações ou objetivos para mostrar.</p>';
  return '<section class="section" id="player-timeline"><div class="section-head"><div><h2>Histórico cronológico</h2><p>Presenças, jogos, observações e objetivos com ligação à origem quando disponível.</p></div></div>'+rows+'</section>';
}
async function viewPlayer(id){
  var player=await DB.obter("jogadores",id);
  if(!player) return go("#/equipa");
  player=(await applyPlayerProfilePhotos([player]))[0];
  var memory=await HeadCoachMemory.list(DEFAULT_TEAM_ID,{subjectType:"player",subjectId:id});
  var media=await HeadCoachMedia.listForSubject("player",id);
  var obs=memory.length?'<div class="list">'+memory.slice(0,8).map(function(m){
    return '<div class="list-item"><div class="row"><span class="title grow">'+esc(m.title)+'</span>'+actorBadge(m.metadata&&m.metadata.actor,m.metadata&&m.metadata.actor_label||m.source&&m.source.label)+'</div><div class="body-copy">'+esc(m.content)+'</div><div class="meta">'+fmtDate(m.occurred_at)+'</div></div>';
  }).join("")+'</div>':'<div class="empty">Sem observações deste jogador.</div>';
  var status=PlayerStatus.normalize(player.estado_disponibilidade);
  var inRoster=PlayerStatus.inRoster(player);
  var playerBadge=inRoster?('<span class="badge '+PlayerStatus.badgeClass(status)+'">'+esc(PlayerStatus.label(status))+'</span>'):'<span class="badge system">Fora do plantel</span>';
  var rosterButton=inRoster
    ? '<button class="btn secondary" type="button" data-action="retire-player" data-id="'+id+'" data-name="'+esc(player.nome)+'">Retirar do plantel</button>'
    : '<button class="btn secondary" type="button" data-action="restore-player" data-id="'+id+'" data-name="'+esc(player.nome)+'">Reintegrar no plantel</button>';
  var deleteButton='<button class="btn danger" type="button" data-action="delete-player-permanently" data-id="'+id+'" data-name="'+esc(player.nome)+'">Retirar definitivamente</button>';
  var html='<div class="profile-grid">';
  html+='<section class="panel hero-main"><div class="row">'+avatarHTML(player,64)+'<div class="grow"><div class="kicker">Jogador</div><h2 class="display" style="font-size:28px">'+esc(player.nome)+'</h2><p class="lead">'+esc([player.escalao,player.posicao,player.numero?'#'+player.numero:null].filter(Boolean).join(" · "))+'</p>'+playerBadge+'</div></div><div class="toolbar" style="margin-top:18px"><a class="btn secondary" href="#/equipa/jogador/'+id+'/editar">Editar</a><button class="btn secondary" type="button" data-action="export-player-report" data-id="'+id+'">Exportar relatório PDF</button><a class="btn" href="#/capturar/player/'+id+'">Registar observação</a><a class="btn secondary" href="#/media/novo/player/'+id+'">Adicionar media</a>'+rosterButton+deleteButton+'</div></section>';
  html+='<aside class="panel hero-side"><div class="metric-label">Contexto</div><div class="metric-value">'+memory.length+'</div><div class="metric-sub">registos na memória</div><div class="metric-value" style="margin-top:18px">'+media.length+'</div><div class="metric-sub">itens de media</div></aside></div>';
  html+='<section class="section"><div class="section-head"><div><h2>Últimas observações</h2><p>Contexto usado pelo workspace</p></div></div>'+obs+'</section>';
  html+=await playerTimelineSection(player);
  html+=await playerGoalsSection(player);
  html+=await TrainingSessionUI.history(player);
  html+=await MatchVisualUI.history(player);
  setView(player.nome,html,"Equipa");
}

async function viewMatchForm(id){
  var team=await HeadCoachMemory.ensureTeam();
  var match=matchStructure(id?await DB.obter("jogos",id):null);
  var html='<section class="panel hero-main" style="max-width:820px"><form class="form" data-form="match" data-id="'+(id||"")+'">';
  html+='<div class="form-grid"><label class="field"><span>Data</span><input type="date" name="data" required value="'+esc(match.data||today())+'"></label><label class="field"><span>Hora do jogo</span><input type="time" name="hora" value="'+esc(match.hora)+'"></label></div>';
  html+='<label class="field"><span>Adversário</span><input name="adversario" required value="'+esc(match.adversario)+'"></label>';
  html+='<div class="form-grid"><label class="field"><span>Casa / Fora</span><select name="casa_fora"><option value="casa" '+(match.casa_fora!=="fora"?"selected":"")+'>Casa</option><option value="fora" '+(match.casa_fora==="fora"?"selected":"")+'>Fora</option></select></label><label class="field"><span>Local</span><input name="local" value="'+esc(match.local)+'"></label></div>';
  html+='<div class="form-grid"><label class="field"><span>Hora de saída</span><input type="time" name="hora_saida" value="'+esc(match.hora_saida)+'"></label><label class="field"><span>Hora de concentração</span><input type="time" name="hora_concentracao" value="'+esc(match.hora_concentracao)+'"></label></div>';
  html+='<div class="form-grid"><label class="field"><span>Competição</span><input name="competicao" value="'+esc(match.competicao||team.competicao)+'"></label><label class="field"><span>Estado</span><select name="estado"><option value="agendado" '+(match.estado==="agendado"?"selected":"")+'>Agendado</option><option value="concluido" '+(match.estado==="concluido"?"selected":"")+'>Concluído</option><option value="cancelado" '+(match.estado==="cancelado"?"selected":"")+'>Cancelado</option></select></label></div>';
  html+='<div class="form-grid"><label class="field"><span>Golos a favor</span><input type="number" min="0" name="golos_favor" value="'+esc(match.golos_favor!=null?match.golos_favor:"")+'"></label><label class="field"><span>Golos contra</span><input type="number" min="0" name="golos_contra" value="'+esc(match.golos_contra!=null?match.golos_contra:"")+'"></label></div>';
  html+='<label class="field"><span>Notas gerais</span><textarea name="notas">'+esc(match.notas)+'</textarea></label>';
  html+='<div class="toolbar"><button class="btn accent" type="submit">Guardar jogo</button><a class="btn secondary" href="'+(id?'#/equipa/jogo/'+id:'#/calendario')+'">Cancelar</a></div></form></section>';
  setView(id?"Editar jogo":"Novo jogo",html,"Jogo");
}
function playerChecks(players,selected,name){
  var chosen=new Set((selected||[]).map(String));
  return players.map(function(p){
    var ref=stablePlayerRef(p);
    var available=PlayerStatus.isAvailable(p);
    var checked=available&&chosen.has(ref);
    var detail=available?(p.posicao||"Jogador"):(PlayerStatus.label(p.estado_disponibilidade)+" · não convocável");
    return '<label class="player-choice '+(available?"":"player-unavailable")+'"><input type="checkbox" name="'+name+'" value="'+esc(ref)+'" '+(checked?"checked":"")+' '+(available?"":"disabled")+'><span>'+avatarHTML(p,32)+'<span><strong>'+esc(p.nome)+'</strong><small>'+esc(detail)+'</small></span></span></label>';
  }).join("");
}
async function viewMatch(id){
  var raw=await DB.obter("jogos",id);
  if(!raw) return go("#/equipa");
  var match=matchStructure(raw);
  var allPlayers=(await DB.porIndice("jogadores","team_id",DEFAULT_TEAM_ID)).sort(function(a,b){return String(a.nome).localeCompare(String(b.nome));});
  var players=allPlayers.filter(function(p){return PlayerStatus.inRoster(p);});
  var memory=await HeadCoachMemory.list(DEFAULT_TEAM_ID,{subjectType:"match",subjectId:match.sync_id||id});
  var media=await HeadCoachMedia.listForSubject("match",id);
  var progress=VisionCalendar.matchProgress(match);
  var called=new Set(match.callup.player_ids.map(String));
  var unavailableCalled=players.filter(function(p){return called.has(stablePlayerRef(p))&&!PlayerStatus.isAvailable(p);});
  var retiredCalled=allPlayers.filter(function(p){return !PlayerStatus.inRoster(p)&&called.has(stablePlayerRef(p));});
  var visualSlots=VisionMatchVisual.initialSlots(match);
  var visualSystem=VisionMatchVisual.systemFor(match);
  var visualRoles=Object.entries(VisionMatchVisual.roles).map(function(entry){
    var ref=visualSlots[entry[0]],player=allPlayers.find(function(p){return String(p.sync_id||"")===String(ref||"");});
    return '<li>'+esc(entry[1])+': '+esc(player?player.nome:(ref?'Atleta indisponível':'Por definir'))+'</li>';
  }).join("");
  var context=memory.length?'<div class="list">'+memory.map(function(m){return '<div class="list-item"><div class="title">'+esc(m.title)+'</div><div class="body-copy">'+esc(m.content)+'</div></div>';}).join("")+'</div>':'<div class="empty">Ainda sem observações associadas.</div>';
  var html='<div class="profile-grid"><section class="panel hero-main"><div class="kicker">'+esc(match.casa_fora==="fora"?"Fora":"Casa")+' · '+fmtDate(match.data)+(match.hora?' · '+esc(match.hora):'')+'</div><h2 class="display">'+esc(match.adversario)+'</h2><div class="metric-value" style="margin-top:18px">'+resultText(match)+'</div><p class="lead">'+esc(match.local||"Local por definir")+(match.hora_saida?' · saída '+esc(match.hora_saida):'')+'</p><div class="toolbar" style="margin-top:18px"><a class="btn accent" href="#/jogo-visual/'+id+'">Jogo visual / substituições</a><button class="btn secondary" type="button" data-action="export-match-sheet" data-id="'+id+'">Exportar ficha de jogo</button><button class="btn secondary" type="button" data-action="export-match-report" data-id="'+id+'">Exportar relatório pós-jogo</button><a class="btn secondary" href="#/equipa/jogo/'+id+'/editar">Editar dados</a><a class="btn" href="#/capturar/match/'+id+'">Observação</a><a class="btn secondary" href="#/media/novo/match/'+id+'">Media</a><button class="btn danger" type="button" data-action="delete-match" data-id="'+id+'" data-name="'+esc(match.adversario||"jogo")+'">Apagar jogo</button></div></section>';
  html+='<aside class="panel hero-side"><div class="metric-label">Preparação</div><div class="match-progress"><span class="'+(progress.pre_game?"done":"")+'">Plano</span><span class="'+(progress.callup?"done":"")+'">Convocados</span><span class="'+(progress.lineup?"done":"")+'">5v5</span><span class="'+(progress.post_game?"done":"")+'">Análise</span></div><div class="meta" style="margin-top:16px">'+memory.length+' observações · '+media.length+' media</div></aside></div>';
  html+='<div class="match-stage-nav"><button type="button" data-action="jump-match" data-target="match-before">Antes</button><button type="button" data-action="jump-match" data-target="match-during">Durante</button><button type="button" data-action="jump-match" data-target="match-after">Depois</button></div>';
  html+='<section class="section match-stage" id="match-before"><div class="section-head"><div><h2>Antes do jogo</h2><p>Plano, convocatória e alinhamento</p></div></div><div class="grid cols-2">';
  html+='<form class="panel match-form form" data-form="match-pre" data-id="'+id+'"><h3>Plano pré-jogo</h3><label class="field"><span>Objetivo principal</span><input name="objetivo_principal" value="'+esc(match.pre_game.objetivo_principal)+'"></label><label class="field"><span>Plano de jogo</span><textarea name="plano_jogo">'+esc(match.pre_game.plano_jogo)+'</textarea></label><h4>Observação do adversário</h4><div class="form-grid"><label class="field"><span>Sistema observado</span><input name="adversario_sistema" maxlength="40" placeholder="Ex.: 1-2-1" value="'+esc(match.pre_game.adversario_sistema||'')+'"></label><label class="field"><span>Estilo observado</span><select name="adversario_estilo"><option value="">Ainda não observado</option>'+[['posse','Posse'],['direto','Jogo direto'],['pressao_alta','Pressão alta'],['bloco_baixo','Bloco baixo'],['transicoes','Transições']].map(function(x){return '<option value="'+x[0]+'" '+(match.pre_game.adversario_estilo===x[0]?'selected':'')+'>'+x[1]+'</option>';}).join('')+'</select></label></div><div class="form-grid"><label class="field"><span>Pontos fortes observados · um por linha</span><textarea name="adversario_pontos_fortes">'+esc(linesText(match.pre_game.adversario_pontos_fortes))+'</textarea></label><label class="field"><span>Vulnerabilidades observadas · um por linha</span><textarea name="adversario_vulnerabilidades">'+esc(linesText(match.pre_game.adversario_vulnerabilidades))+'</textarea></label></div><label class="field"><span>Notas do adversário</span><textarea name="adversario_notas">'+esc(match.pre_game.adversario_notas)+'</textarea></label><label class="field"><span>Pontos a observar · um por linha</span><textarea name="pontos_observar">'+esc(linesText(match.pre_game.pontos_observar))+'</textarea></label><button class="btn accent" type="submit">Guardar plano</button></form>';
  html+='<form class="panel match-form form" data-form="match-callup" data-id="'+id+'"><h3>Convocatória</h3>'+(retiredCalled.length?'<div class="notice">Histórico: '+retiredCalled.map(function(p){return esc(p.nome);}).join(", ")+' já não pertence ao plantel atual.</div>':'')+(unavailableCalled.length?'<div class="notice">'+unavailableCalled.map(function(p){return esc(p.nome)+" · "+esc(PlayerStatus.label(p.estado_disponibilidade));}).join("<br>")+'<br>Estes jogadores deixaram de estar disponíveis e serão retirados ao guardar a convocatória.</div>':'')+'<div class="player-choice-grid">'+playerChecks(players,match.callup.player_ids,"player_ids")+'</div><label class="field"><span>Notas</span><textarea name="notes">'+esc(match.callup.notes)+'</textarea></label><button class="btn accent" type="submit">Guardar convocatória</button></form></div>';
  html+='<section class="panel section" data-match-lineup-summary><div class="section-head"><div><h2>Alinhamento 5v5</h2><p>Sistema '+esc(visualSystem)+' · posições guardadas no quadro visual</p></div><a class="btn accent" href="#/jogo-visual/'+id+'">'+(match.visual_match?.started_at?'Ver jogo visual':'Editar alinhamento visual')+'</a></div><ul class="match-lineup-summary">'+visualRoles+'</ul><p class="hint">O quadro visual é o único local para alterar o sistema e as posições iniciais.</p></section></div></section>';
  html+='<section class="section match-stage" id="match-during"><div class="section-head"><div><h2>Durante</h2><p>Registo simples, sem distrair do jogo</p></div></div><form class="panel match-form form" data-form="match-during" data-id="'+id+'"><label class="field"><span>Resultado ao intervalo</span><input name="halftime_score" placeholder="Ex.: 2-1" value="'+esc(match.during.halftime_score)+'"></label><label class="field"><span>Notas rápidas · uma por linha</span><textarea name="notes">'+esc(linesText(match.during.notes))+'</textarea></label><button class="btn accent" type="submit">Guardar durante</button></form></section>';
  html+='<section class="section match-stage" id="match-after"><div class="section-head"><div><h2>Depois</h2><p>Análise estruturada · factos registados separados da leitura do treinador</p></div></div>'+matchAnalysisSection(match,players,id,memory)+(progress.post_game?'<a class="btn secondary section" href="#/treinos/novo/jogo/'+id+'">Preparar treino desta análise</a>':'')+'<div class="grid cols-2 section"><div><div class="section-head"><div><h2>Contexto associado</h2><p>Observações e decisões</p></div></div>'+context+'</div><div><div class="section-head"><div><h2>Media</h2><p>'+media.length+' item(ns)</p></div></div>'+renderMediaCards(media)+'</div></div></section>';
  if((location.hash||"").split("?")[0]!=="#/equipa/jogo/"+id)return;
  setView("Jogo vs "+match.adversario,html,"Jogo");
  var matchFocus=new URLSearchParams((location.hash.split("?")[1]||"")).get("focus");if(matchFocus==="after")requestAnimationFrame(function(){document.getElementById("match-after")?.scrollIntoView({behavior:"smooth",block:"start"});});
}
function matchAnalysisSection(match,players,id,memory){
  var A=VisionMatchAnalysis,a=A.fromMatch(match),events=VisionMatchEvents.state(match).events,stats=VisionMatchEvents.stats(match),legacy=match.post_game||{};
  var facts=[];
  if(match.golos_favor!=null&&match.golos_contra!=null) facts.push('<li>Resultado introduzido manualmente pelo treinador: '+esc(match.golos_favor)+'–'+esc(match.golos_contra)+'</li>');
  else facts.push('<li>Resultado: ainda não registado</li>');
  facts.push('<li>Lances registados: '+stats.event_count+' · golos '+stats.goals.for+'–'+stats.goals.against+' · remates à baliza '+stats.shots.on+' · fora '+stats.shots.off+' · perdas '+stats.losses.total+' · recuperações '+stats.recoveries.total+' · cantos '+stats.counts.corner_for+'–'+stats.counts.corner_against+' <small>(contagem dos lances registados)</small></li>');
  var evHtml=events.length?'<ol>'+events.map(function(e){var player=players.find(function(p){return p.sync_id===e.player_ref;});var minute=Math.floor(e.at_ms/60000)+':'+String(Math.floor(e.at_ms/1000)%60).padStart(2,'0');return '<li>'+esc(minute)+' · '+esc(VisionMatchEvents.types[e.type]||e.type)+(player?' · '+esc(player.nome):'')+(e.zone?' · '+esc(VisionMatchEvents.zones[e.zone]||e.zone):'')+(e.reason?' · '+esc(VisionMatchEvents.lossReasons[e.reason]||e.reason):'')+(e.note?' · '+esc(e.note):'')+'</li>';}).join('')+'</ol>':'<p class="empty">Sem lances registados; a análise não infere acontecimentos.</p>';
  var usage=match.visual_match&&match.visual_match.started_at?VisionMatchVisual.replay(match):null;
  var usageHtml=usage?'<ul>'+usage.players.map(function(p){return '<li>'+esc(p.name)+' · '+VisionMatchVisual.format(p.elapsed_ms)+' registados'+(p.keeper_ms?' · GR '+VisionMatchVisual.format(p.keeper_ms):'')+'</li>';}).join('')+'</ul>':'<p class="empty">Sem minutos registados.</p>';
  var agentProposal=a.agent_proposal,proposalSection='';
  if(agentProposal){
    var eventById=new Map(events.map(function(e){return[String(e.id),e];})),proposalRefs=Array.isArray(agentProposal.evidence_ids)?agentProposal.evidence_ids:[],proposalFresh=A.proposalFreshness(match).fresh;
    var proposalEvidence=proposalRefs.length?'<ul>'+proposalRefs.map(function(ref){var evidence=eventById.get(String(ref));if(!evidence)return'<li>Fonte '+esc(ref)+' já não existe neste jogo; a referência está desatualizada.</li>';var at=Math.floor(evidence.at_ms/60000)+':'+String(Math.floor(evidence.at_ms/1000)%60).padStart(2,'0');return'<li>'+esc(at+' · '+(VisionMatchEvents.types[evidence.type]||evidence.type))+(evidence.zone?' · '+esc(VisionMatchEvents.zones[evidence.zone]||evidence.zone):'')+(evidence.note?' · '+esc(evidence.note):'')+'</li>';}).join('')+'</ul>':'<p class="meta">Sem lances associados como evidência.</p>';
    var proposalStatus=agentProposal.status==='accepted'?'Aceite pelo treinador':agentProposal.status==='dismissed'?'Rejeitada pelo treinador':'Por rever pelo treinador';
    proposalSection='<section class="panel section" data-match-agent-proposal="'+esc(id)+'"><h3>Proposta do Head Coach · '+esc(proposalStatus)+'</h3><p class="meta">Rascunho separado dos factos e decisões do treinador. '+(proposalFresh?'As revisões e os lances citados continuam atuais.':agentProposal.status==='proposed'?'A origem mudou ou não pode ser verificada; prepara uma proposta atualizada antes de a aprovar.':'Proveniência guardada com a proposta.')+'</p>'+(agentProposal.summary?'<p><strong>Resumo proposto:</strong> '+esc(agentProposal.summary)+'</p>':'')+(agentProposal.hypotheses?.length?'<div><strong>Hipóteses por confirmar</strong><ul>'+agentProposal.hypotheses.map(function(x){return'<li>'+esc(x)+'</li>';}).join('')+'</ul></div>':'')+(agentProposal.next_priority?'<p><strong>Prioridade sugerida:</strong> '+esc(agentProposal.next_priority)+'</p>':'')+'<div><strong>Evidências citadas</strong>'+proposalEvidence+'</div>'+(agentProposal.status==='proposed'&&proposalFresh?'<p class="hint">Edita «Prioridade para os próximos treinos» e «Decisão do treinador» no formulário. Aceitar regista a aprovação, mas não cria o treino.</p><div class="toolbar">'+(agentProposal.next_priority?'<button type="button" class="btn secondary" data-action="copy-match-proposal-priority" data-match="'+esc(id)+'" data-proposal-revision="'+a.revision+'">Copiar prioridade para o campo editável</button>':'')+'<button type="button" class="btn accent" data-action="accept-match-proposal" data-match="'+esc(id)+'" data-updated-at="'+esc(match.updated_at||match.sync_local_updated_at||'')+'" data-proposal-revision="'+a.revision+'">Aceitar proposta</button><button type="button" class="btn secondary" data-action="dismiss-match-proposal" data-match="'+esc(id)+'" data-updated-at="'+esc(match.updated_at||match.sync_local_updated_at||'')+'" data-proposal-revision="'+a.revision+'">Rejeitar proposta</button></div><p class="notice" data-match-proposal-feedback hidden role="status"></p>':agentProposal.status==='proposed'?'<p class="notice">Esta proposta está desatualizada; não pode ser aprovada com as evidências atuais.</p><button type="button" class="btn secondary" data-action="dismiss-match-proposal" data-match="'+esc(id)+'" data-updated-at="'+esc(match.updated_at||match.sync_local_updated_at||'')+'" data-proposal-revision="'+a.revision+'">Rejeitar proposta desatualizada</button>':'')+'</section>';
  }
  var fields=Object.entries(A.fields).map(function(entry){var key=entry[0],label=entry[1];return '<label class="field"><span>'+esc(label)+'</span><textarea name="field_'+key+'" rows="2">'+esc(a.fields[key]||'')+'</textarea></label>';}).join('');
  var goalFields=events.filter(function(e){return e.type==='goal_against';}).map(function(e){var min=Math.floor(e.at_ms/60000)+':'+String(Math.floor(e.at_ms/1000)%60).padStart(2,'0');return '<label class="field"><span>Causa provável do golo sofrido · minuto '+esc(min)+' · hipótese</span><textarea name="goal_cause_'+esc(e.id)+'">'+esc(a.goals_conceded[e.id]||'')+'</textarea></label>';}).join('');
  var synced=a.memory_ref?'<p class="notice">Ligada à memória'+(a.memory_fingerprint!==A.fingerprint(a)?' · desatualizada face à análise atual':' · atualizada')+'.</p>':'<p class="meta">A análise só entra na memória quando escolheres explicitamente essa ação.</p>';
  var evidenceStats=VisionMatchEvents.stats(match),evidenceAnalysis=VisionMatchAnalysis.fromMatch(match),evidenceStatOptions=Object.entries(VisionMatchEvidence.statistics).map(function(x){var value=x[0].split(".").reduce(function(v,k){return v&&v[k];},evidenceStats);return '<option value="'+esc(x[0])+'">'+esc(x[1])+' · '+esc(value??0)+'</option>';}).join(""),evidenceObservationOptions=memory.filter(function(m){return/^[0-9a-f-]{36}$/i.test(m.sync_id||"");}).map(function(m){return '<option value="'+esc(m.sync_id)+'">'+esc(m.title)+' · '+fmtDate(m.occurred_at)+'</option>';}).join(""),evidenceProblemOptions=VisionMatchEvidence.problemFields.filter(function(k){return!!evidenceAnalysis.fields[k];}).map(function(k){return '<option value="'+esc(k)+'">'+esc(VisionMatchAnalysis.fields[k])+'</option>';}).join("");  function evidenceRelation(m){if(m.relation_type==="observation"){var ref=memory.find(function(x){return x.sync_id===m.relation_ref;});return ref?'<a class="link" href="#/timeline/memory/'+ref.id+'">Observação: '+esc(ref.title)+'</a>':'<span class="meta">Observação anteriormente associada</span>';}if(m.relation_type==="statistic")return '<span class="meta">Estatística: '+esc(VisionMatchEvidence.statistics[m.relation_ref]||m.relation_ref)+'</span>';if(m.relation_type==="problem")return '<span class="meta">Problema: '+esc(VisionMatchAnalysis.fields[m.relation_ref]||m.relation_ref)+'</span>';return "";}  var evidence=VisionMatchEvidence.state(match),evidenceHtml=evidence.moments.length?'<div class="list">'+evidence.moments.slice().sort(function(x,y){return x.seconds-y.seconds;}).map(function(m){var player=players.find(function(p){return p.sync_id===m.player_ref;});var momentUrl=VisionMatchEvidence.linkAtSeconds(m.url,m.seconds);return '<article class="list-item"><div class="title">'+Math.floor(m.seconds/60)+':'+String(m.seconds%60).padStart(2,'0')+' · '+esc(VisionMatchEvidence.categories[m.category])+'</div><div class="body-copy">'+esc(m.description)+(player?' · '+esc(player.nome):'')+(evidenceRelation(m)?' · '+evidenceRelation(m):'')+'</div><a class="link" href="'+esc(momentUrl)+'" target="_blank" rel="noopener">Abrir momento</a> <button class="link" type="button" data-action="edit-match-evidence" data-match="'+id+'" data-evidence="'+esc(m.id)+'">Editar</button> <button class="link danger" type="button" data-action="delete-match-evidence" data-match="'+id+'" data-evidence="'+esc(m.id)+'">Apagar</button></article>';}).join('')+'</div>':'<div class="empty">Ainda sem momentos de vídeo.</div>';
  var evidenceSection='<section class="panel match-form section"><h3>Vídeo e evidências</h3><p>Marca momentos manualmente. Não há reconhecimento automático de jogadores.</p>'+evidenceHtml+'<form class="form" data-form="match-evidence" data-id="'+id+'"><input type="hidden" name="evidence_id"><input type="hidden" name="expected_revision" value="'+evidence.revision+'"><label class="field"><span>URL do vídeo</span><input name="url" type="url" placeholder="https://…" required></label><div class="form-grid"><label class="field"><span>Minuto</span><input name="minutes" type="number" min="0" max="1440" step="1" value="0" required></label><label class="field"><span>Segundo</span><input name="seconds" type="number" min="0" max="59" step="1" value="0" required></label><label class="field"><span>Categoria</span><select name="category">'+Object.entries(VisionMatchEvidence.categories).map(function(x){return '<option value="'+x[0]+'">'+esc(x[1])+'</option>';}).join('')+'</select></label><label class="field"><span>Atleta (opcional)</span><select name="player_ref"><option value="">Sem atleta associado</option>'+players.map(function(p){return '<option value="'+esc(p.sync_id)+'">'+esc(p.nome)+'</option>';}).join('')+'</select></label></div><label class="field"><span>Descrição</span><textarea name="description" required></textarea></label><div class="form-grid"><label class="field"><span>Ligar a</span><select name="relation_type"><option value="none">Sem associação</option><option value="observation">Observação</option><option value="statistic">Estatística</option><option value="problem">Problema</option></select></label><label class="field"><span>Registo associado</span><select name="relation_ref"><option value="">Escolhe uma referência</option><optgroup label="Observações deste jogo" data-relation="observation" hidden>'+evidenceObservationOptions+'</optgroup><optgroup label="Estatísticas contadas" data-relation="statistic" hidden>'+evidenceStatOptions+'</optgroup><optgroup label="Problemas registados na análise" data-relation="problem" hidden>'+evidenceProblemOptions+'</optgroup></select></label></div><button class="btn accent" type="submit">Guardar momento</button><button class="btn secondary" type="button" data-action="cancel-match-evidence" hidden>Cancelar edição</button><p class="notice" data-evidence-feedback hidden></p></form></section>';
  return '<section class="panel match-form"><h3>Factos registados</h3><ul>'+facts.join('')+'</ul><h4>Lances</h4>'+evHtml+'<h4>Utilização</h4>'+usageHtml+'</section>'+proposalSection+evidenceSection+'<form class="panel match-form form section" data-form="match-analysis" data-id="'+id+'"><h3>Leitura do treinador</h3><p class="meta">Factos acima vêm dos registos do jogo. Observações, interpretações, hipóteses e decisões ficam separadas.</p>'+fields+goalFields+'<div class="form-grid"><label class="field"><span>Registo anterior · correu bem</span><textarea name="legacy_positives">'+esc(legacy.correu_bem||'')+'</textarea></label><label class="field"><span>Registo anterior · a melhorar</span><textarea name="legacy_improve">'+esc(legacy.melhorar||'')+'</textarea></label><label class="field"><span>Conclusões anteriores</span><textarea name="legacy_conclusions">'+esc(legacy.conclusoes||'')+'</textarea></label><label class="field"><span>Ações previstas · uma por linha</span><textarea name="legacy_actions">'+esc(linesText(legacy.acoes_proximo_treino))+'</textarea></label></div>'+synced+'<input type="hidden" name="expected_revision" value="'+a.revision+'"><p class="notice" data-analysis-feedback hidden></p><div class="toolbar"><button class="btn accent" type="submit" name="intent" value="save">Guardar análise</button><button class="btn secondary" type="submit" name="intent" value="memory">Guardar análise e atualizar memória</button></div></form>';
}
async function viewDocuments(options){
  await refreshRemoteWorkspace(options);
  var docs=await WorkspaceStore.listDocuments();
  var cards=docs.length?docs.map(documentCard).join(""):'<div class="empty">Ainda não existem planos ou análises. Cria o primeiro documento partilhado.</div>';
  var hub='<div class="grid cols-2"><a class="panel planner-hub-card" href="#/treinos"><div class="kicker">Sessões</div><h2>Planeador de treino</h2><p>Constrói treinos por blocos e reutiliza exercícios.</p></a><a class="panel planner-hub-card" href="#/exercicios"><div class="kicker">Biblioteca</div><h2>Exercícios</h2><p>Pesquisa, favoritos e exercícios partilhados com o Head Coach.</p></a></div>';
  var html=hub+'<section class="section"><div class="section-head"><div><h2>Documentos de trabalho</h2><p>Planos, análises, notas e briefings partilhados</p></div><a class="btn accent" href="#/planos/novo">Novo documento</a></div><div class="grid cols-2">'+cards+'</div></section>';
  setView("Planos",html,"Planos");
}
async function viewDocumentForm(id){
  var doc=id?await WorkspaceStore.getDocument(id):null;
  var typeOpts=WORKSPACE_DOC_TYPES.map(function(type){
    return '<option value="'+type+'" '+((doc&&doc.type||"training_plan")===type?"selected":"")+'>'+esc(docTypeLabel(type))+'</option>';
  }).join("");
  var statusLabels={draft:"Rascunho",ready:"Pronto",approved:"Aprovado"};
  var statusOpts=WORKSPACE_STATUSES.filter(function(s){return s!=="archived";}).map(function(s){
    return '<option value="'+s+'" '+((doc&&doc.status||"draft")===s?"selected":"")+'>'+statusLabels[s]+'</option>';
  }).join("");
  var html='<section class="panel hero-main" style="max-width:820px"><form class="form" data-form="document" data-id="'+(id||"")+'">';
  html+='<div class="form-grid"><label class="field"><span>Tipo</span><select name="type">'+typeOpts+'</select></label><label class="field"><span>Estado</span><select name="status">'+statusOpts+'</select></label></div>';
  html+='<label class="field"><span>Título</span><input name="title" required value="'+esc(doc&&doc.title)+'"></label>';
  html+='<label class="field"><span>Data alvo</span><input type="date" name="target_date" value="'+esc(doc&&doc.target_date)+'"></label>';
  html+='<label class="field"><span>Conteúdo</span><textarea name="body" style="min-height:320px" placeholder="Objetivo, estrutura, exercícios, observações, métricas...">'+esc(doc&&doc.body)+'</textarea></label>';
  html+='<div class="hint">A autoria fica registada. Quando o agente estiver ligado, poderá criar e editar estes mesmos documentos.</div>';
  html+='<div class="toolbar"><button class="btn accent" type="submit">Guardar documento</button><a class="btn secondary" href="'+(id?'#/planos/'+id:'#/planos')+'">Cancelar</a></div></form></section>';
  setView(id?"Editar documento":"Novo documento",html,"Planos");
}

function mediaPreview(item){
  var href=item.data_url||item.url;
  if(item.type==="photo"&&href) return '<div class="media-preview"><img src="'+esc(href)+'" alt=""></div>';
  return '<div class="media-preview">'+esc(item.type==="video"?"Vídeo":"Ficheiro")+'</div>';
}
function renderMediaCards(items){
  if(!items.length) return '<div class="empty">Ainda sem media.</div>';
  return '<div class="media-grid">'+items.map(function(item){
    var href=item.data_url||item.url||"#";
    var attrs=item.url?'target="_blank" rel="noopener"':'download="'+esc(item.file_name||item.title)+'"';
    return '<article class="panel media-card">'+mediaPreview(item)+'<div class="media-info"><div class="row"><div class="grow"><div class="title">'+esc(item.title)+'</div><div class="meta">'+esc(item.note||item.file_name||"Media")+'</div></div><a class="link" href="#/media/'+item.id+'/editar">Editar</a><button class="link" data-action="delete-media" data-id="'+item.id+'">Remover</button></div><a class="link" href="'+esc(href)+'" '+attrs+'>Abrir</a></div></article>';
  }).join("")+'</div>';
}
async function viewDocument(id){
  var doc=await WorkspaceStore.getDocument(id);
  if(!doc||doc.status==="archived") return go("#/planos");
  var media=await HeadCoachMedia.listForSubject("document",id);
  var html='<section class="panel hero-main">';
  html+='<div class="row"><div class="grow"><div class="kicker">'+esc(docTypeLabel(doc.type))+(doc.target_date?' · '+fmtDate(doc.target_date):'')+'</div><h2 class="display" style="font-size:30px">'+esc(doc.title)+'</h2></div>'+docStatusBadge(doc.status)+'</div>';
  html+='<div class="body-copy" style="font-size:14px;margin-top:22px">'+esc(doc.body||"Sem conteúdo.")+'</div>';
  var audit='<div class="row" style="margin-top:22px">'+actorBadge(doc.created_by,doc.created_by_label)+'<span class="meta">Criado por '+esc(doc.created_by_label||"Treinador")+'</span>';
  if((doc.updated_by||doc.created_by)!==doc.created_by || (doc.updated_by_label||doc.created_by_label)!==doc.created_by_label){
    audit+='<span class="meta">· última alteração por '+esc(doc.updated_by_label||"Treinador")+'</span>';
  }
  audit+='<span class="meta">· '+fmtDate(doc.updated_at)+'</span></div>';
  html+=audit;
  html+='<div class="toolbar" style="margin-top:18px"><a class="btn" href="#/planos/'+id+'/editar">Editar</a><a class="btn secondary" href="#/media/novo/document/'+id+'">Associar media</a><button class="btn danger" data-action="delete-document" data-id="'+id+'">Apagar</button></div></section>';
  html+='<section class="section"><div class="section-head"><div><h2>Media associado</h2><p>'+media.length+' item(ns)</p></div></div>'+renderMediaCards(media)+'</section>';
  setView(doc.title,html,"Planos");
}
async function viewMedia(){
  var items=(await DB.porIndice("media_items","team_id",DEFAULT_TEAM_ID)).sort(function(a,b){return String(b.created_at).localeCompare(String(a.created_at));});
  setView("Media",'<div class="section-head"><div><h2>Biblioteca partilhada</h2><p>Vídeos, fotografias e ficheiros com contexto</p></div><a class="btn accent" href="#/media/novo">Adicionar media</a></div>'+renderMediaCards(items),"Media");
}
async function subjectOptions(selectedType,selectedId){
  var data=await Promise.all([
    DB.porIndice("jogadores","team_id",DEFAULT_TEAM_ID),
    DB.porIndice("jogos","team_id",DEFAULT_TEAM_ID),
    DB.porIndice("treinos","team_id",DEFAULT_TEAM_ID),
    HeadCoachMemory.list(),
    WorkspaceStore.listDocuments(),
    DB.porIndice("exercicios","team_id",DEFAULT_TEAM_ID)
  ]);
  var selected=selectedType&&selectedId?selectedType+":"+selectedId:"";
  var options=['<option value="">Sem associação específica</option>'];
  data[0].forEach(function(x){options.push('<option value="player:'+x.id+'">Jogador · '+esc(x.nome)+'</option>');});
  data[1].forEach(function(x){options.push('<option value="match:'+x.id+'">Jogo · '+fmtDate(x.data)+' · '+esc(x.adversario)+'</option>');});
  data[2].forEach(function(x){options.push('<option value="training:'+x.id+'">Treino · '+fmtDate(x.data)+'</option>');});
  data[4].forEach(function(x){options.push('<option value="document:'+x.id+'">Documento · '+esc(x.title)+'</option>');});
  data[5].filter(function(x){return x.workspace_v2;}).forEach(function(x){options.push('<option value="exercise:'+x.id+'">Exercício · '+esc(x.nome)+'</option>');});
  data[3].slice(0,30).forEach(function(x){options.push('<option value="memory:'+x.id+'">Memória · '+esc(x.title)+'</option>');});
  return options.join("").replace('value="'+esc(selected)+'"','value="'+esc(selected)+'" selected');
}
function mediaSubjectHref(item){
  if(!item)return "#/media";
  if(item.subject_type==="player")return "#/equipa/jogador/"+item.subject_id;
  if(item.subject_type==="match")return "#/equipa/jogo/"+item.subject_id;
  if(item.subject_type==="training")return "#/treinos/"+item.subject_id;
  if(item.subject_type==="document")return "#/planos/"+item.subject_id;
  if(item.subject_type==="exercise")return "#/exercicios/"+item.subject_id;
  return "#/media";
}
async function viewMediaForm(subjectType,subjectId,itemId){
  var item=itemId?await DB.obter("media_items",Number(itemId)):null;
  if(itemId&&!item)return go("#/media");
  var editing=!!item;
  var options=editing?"":await subjectOptions(subjectType,subjectId);
  var typeOptions=[["photo","Fotografia"],["video","Vídeo"],["file","Ficheiro"]].map(function(x){return '<option value="'+x[0]+'" '+((item?.type||"photo")===x[0]?"selected":"")+'>'+x[1]+'</option>';}).join("");
  var html='<section class="panel hero-main" style="max-width:760px"><form class="form" data-form="'+(editing?"media-edit":"media")+'" '+(editing?'data-id="'+item.id+'"':'')+'>';
  if(editing){
    html+='<input type="hidden" name="expected_updated_at" value="'+esc(item.updated_at||"")+'"><p class="meta">A media continua associada ao mesmo registo do workspace.</p>';
  }else html+='<label class="field"><span>Associar a</span><select name="subject_key">'+options+'</select></label>';
  html+='<div class="form-grid"><label class="field"><span>Tipo</span><select name="type">'+typeOptions+'</select></label><label class="field"><span>Título</span><input name="title" required value="'+esc(item?.title||"")+'"></label></div>';
  if(!editing)html+='<label class="field"><span>Link externo</span><input name="url" type="url" placeholder="https://..."><small class="hint">Usa links para vídeos grandes.</small></label>';
  else if(!item.storage_path&&!item.data_url)html+='<label class="field"><span>Link externo</span><input name="url" type="url" placeholder="https://..." value="'+esc(item.url||"")+'"></label>';
  else html+='<p class="hint">O ficheiro fica no armazenamento privado. Aqui podes corrigir os metadados sem alterar os bytes.</p>';
  if(!editing)html+='<label class="field"><span>Ou ficheiro local</span><input name="file" type="file"><small class="hint">Sem backend remoto: até 5 MB no dispositivo. Com remoto ligado, ficheiros maiores seguem diretamente para Storage privado.</small></label>';
  html+='<label class="field"><span>Nota / contexto</span><textarea name="note">'+esc(item?.note||"")+'</textarea></label>';
  html+='<div class="toolbar"><button class="btn accent" type="submit">'+(editing?"Guardar alterações":"Guardar media")+'</button><a class="btn secondary" href="'+(editing?mediaSubjectHref(item):"#/media")+'">Cancelar</a></div><p class="notice" data-media-feedback role="alert" hidden></p></form></section>';
  setView(editing?"Editar media":"Adicionar media",html,"Media");
}

function timelineLabel(row){
  return {activity:"Atividade",document:"Documento",memory:"Memória",match:"Jogo",training:"Treino",exercise:"Exercício"}[row.type]||row.type;
}
async function viewTimeline(selectedType,selectedId){
  var s=await WorkspaceStore.buildSnapshot();
  var rows=s.timeline.length?s.timeline.map(function(row){
    var href=row.type==="memory"?'#/timeline/memory/'+row.ref.id:row.type==="document"?(row.ref.type==="season_index"?'#/epocas':row.ref.type==="team_goal"||row.ref.type==="weekly_plan"?'#/evolucao':'#/planos/'+row.ref.id):row.type==="match"?'#/equipa/jogo/'+row.ref.id:row.type==="training"?'#/treinos/'+row.ref.id:null;
    var origin=row.type==='activity'&&row.ref?.metadata?._vision_coach_unresolved_origin;
    var originNote=activityOriginNote(origin);
    return '<div class="timeline-item"><span class="timeline-dot"></span><div class="card"><div class="row"><span class="badge">'+esc(timelineLabel(row))+'</span><span class="grow"></span>'+actorBadge(row.actor,row.actor_label)+'</div>'+(href?'<a class="title" style="display:block;margin-top:9px" href="'+esc(href)+'">'+esc(row.title)+'</a>':'<div class="title" style="margin-top:9px">'+esc(row.title)+'</div>')+'<div class="meta">'+fmtDate(row.date)+'</div>'+originNote+'</div></div>';
  }).join(""):'<div class="empty">Ainda não existe histórico.</div>';
  var detail="";if(selectedType==="memory"&&selectedId){var memory=await HeadCoachMemory.get(Number(selectedId));if(memory)detail='<section class="panel"><div class="row"><span class="badge">Observação · '+esc(memory.source?.label||"Treinador")+'</span><span class="grow"></span><span class="meta">'+fmtDate(memory.occurred_at)+'</span></div><h2>'+esc(memory.title)+'</h2><p>'+esc(memory.content).replace(/\n/g,"<br>")+'</p><a class="link" href="#/timeline">Voltar à timeline</a></section>';}
  setView("Timeline",detail+'<div class="section-head"><div><h2>Histórico do workspace</h2><p>Dados, decisões e alterações num único fluxo</p></div><div class="toolbar"><a class="btn secondary" href="#/pesquisa">Pesquisar histórico</a><a class="btn secondary" href="#/capturar">Registar observação</a></div></div><div class="timeline">'+rows+'</div>',"Timeline");
}
async function captureSubjectOptions(type,id){
  var data=await Promise.all([
    DB.porIndice("jogadores","team_id",DEFAULT_TEAM_ID),
    DB.porIndice("jogos","team_id",DEFAULT_TEAM_ID),
    WorkspaceStore.listDocuments()
  ]);
  var selected=type&&id?type+":"+id:"";
  var options=['<option value="">Equipa em geral</option>'];
  data[0].forEach(function(x){options.push('<option value="player:'+x.id+'">Jogador · '+esc(x.nome)+'</option>');});
  data[1].forEach(function(x){options.push('<option value="match:'+x.id+'">Jogo · '+fmtDate(x.data)+' · '+esc(x.adversario)+'</option>');});
  data[2].forEach(function(x){options.push('<option value="document:'+x.id+'">Documento · '+esc(x.title)+'</option>');});
  return options.join("").replace('value="'+esc(selected)+'"','value="'+esc(selected)+'" selected');
}
async function viewCapture(subjectType,subjectId){
  var options=await captureSubjectOptions(subjectType,subjectId);
  var html='<section class="panel hero-main" style="max-width:760px"><div class="kicker">Captura rápida</div><h2 style="font-size:22px;margin:8px 0 16px">Guarda contexto para ti e para o futuro agente.</h2>';
  html+='<form class="form" data-form="observation"><label class="field"><span>Associar a</span><select name="subject_key">'+options+'</select></label>';
  html+='<label class="field"><span>Título</span><input name="title" required placeholder="Ex.: dificuldade na saída sob pressão"></label>';
  html+='<label class="field"><span>Observação</span><textarea name="content" required placeholder="O que viste, sem transformar opinião em facto."></textarea></label>';
  html+='<label class="field"><span>Data</span><input type="date" name="occurred_at" value="'+today()+'"></label>';
  html+='<div class="toolbar"><button class="btn accent" type="submit">Guardar observação</button><a class="btn secondary" href="#/">Cancelar</a></div></form></section>';
  setView("Registar observação",html,"Workspace");
}
function remoteConflictCardHTML(conflict){
  var reasons={delete_version_mismatch:"A cópia remota mudou depois da eliminação offline; ambas as versões foram preservadas.",remote_deleted_local_dirty:"O registo foi apagado no servidor, mas contém alterações locais pendentes. A cópia local foi preservada.",version_mismatch:"O mesmo registo foi alterado neste dispositivo e no remoto. As duas versões estão preservadas.",duplicate_identity:"Foi encontrada outra identidade para este registo; não foi criada uma cópia adicional.",invalid_local_sync_id:"O identificador guardado neste dispositivo não é um UUID remoto. Os dados ficaram preservados e não foram enviados; é necessária reconciliação.",remote_team_unknown:"Não foi possível confirmar a equipa de origem deste registo; os dados ficaram preservados.",invalid_subject_id:"A atividade referencia um ID antigo sem correspondência. A atividade continua preservada e não foi ligada a outro registo.",ambiguous_external_reference:"A referência corresponde a mais de um registo local. Nenhum foi escolhido automaticamente.",subject_not_found_locally:"O registo de origem da atividade não está neste dispositivo; a atividade continua preservada.",subject_other_team:"O registo de origem pertence a outra equipa; a atividade não foi enviada.",subject_uuid_not_in_team:"A UUID de origem não pertence ao workspace selecionado; a atividade continua preservada.",storage_path_team_mismatch:"O caminho do ficheiro pertence a outro workspace; não foi enviado nem assinado.",storage_signed_url_failed:"O ficheiro continua privado, mas não foi possível abrir uma ligação temporária. A sincronização tentará novamente."};
  var stores={jogadores:"Atleta",jogos:"Jogo",treinos:"Treino",exercicios:"Exercício",workspace_documents:"Documento",head_coach_memory:"Memória",media_items:"Media",teams:"Equipa",activity_items:"Atividade"};
  var label=conflict.reason==='delete_version_mismatch'?'Eliminação offline em conflito':conflict.reason==='remote_deleted_local_dirty'?'Eliminação remota em conflito':conflict.reason==='storage_signed_url_failed'?'Media temporariamente indisponível':'Conflito de sincronização';
  var html='<article class="list-item" data-conflict-card="'+esc(conflict.sync_id||'')+'" data-conflict-store="'+esc(conflict.store||'')+'"><strong>'+label+' · '+esc(conflict.display_name||stores[conflict.store]||'Registo')+'</strong><p>'+esc(reasons[conflict.reason]||'A sincronização detetou versões diferentes e não substituiu os dados locais.')+'</p>';
  html+='<details class="section"><summary>Detalhes técnicos</summary><p class="meta">Tipo: '+esc(stores[conflict.store]||conflict.store||'desconhecido')+' · ID remoto: '+esc(conflict.sync_id||'indisponível')+' · versão local vista: '+esc(conflict.expected_updated_at||'sem versão')+' · versão remota: '+esc(conflict.remote_updated_at||'indisponível')+'</p></details>';
  if(conflict.reason==='version_mismatch')html+='<button class="btn secondary" type="button" data-action="review-version-conflict" data-sync-id="'+esc(conflict.sync_id)+'" data-store="'+esc(conflict.store)+'">Comparar versões</button><div class="conflict-review section" data-conflict-review hidden></div>';
  if(conflict.reason==='delete_version_mismatch')html+='<div class="toolbar"><button class="btn secondary" type="button" data-action="resolve-delete-conflict" data-sync-id="'+esc(conflict.sync_id)+'" data-resolution="keep_remote">Manter versão remota</button><button class="btn secondary" type="button" data-action="resolve-delete-conflict" data-sync-id="'+esc(conflict.sync_id)+'" data-resolution="delete_remote">Confirmar eliminação remota</button></div>';
  if(conflict.reason==='remote_deleted_local_dirty')html+='<div class="toolbar"><button class="btn secondary" type="button" data-action="restore-local-conflict" data-sync-id="'+esc(conflict.sync_id)+'">Restaurar edição local no remoto</button></div>';
  return html+'</article>';
}
function remoteConflictQueueHTML(conflicts){
  if(!conflicts||!conflicts.length)return '';
  var decisions=conflicts.filter(function(item){return ['version_mismatch','delete_version_mismatch','remote_deleted_local_dirty'].includes(item.reason);}).length;
  var retry=conflicts.filter(function(item){return item.reason==='storage_signed_url_failed';}).length;
  var investigate=conflicts.length-decisions-retry;
  var summary=[];
  if(decisions)summary.push(decisions+' '+(decisions===1?'alteração requer':'alterações requerem')+' escolha do treinador');
  if(investigate)summary.push(investigate+' '+(investigate===1?'registo aguarda':'registos aguardam')+' correção');
  if(retry)summary.push(retry===1?'1 falha temporária será repetida automaticamente':retry+' falhas temporárias serão repetidas automaticamente');
  return '<div class="notice" style="margin-top:12px"><strong>'+conflicts.length+' ocorrências detetadas</strong><p>'+summary.join(' · ')+'. As versões locais e remotas continuam preservadas.</p></div><div class="list section">'+conflicts.map(remoteConflictCardHTML).join('')+'</div>';
}
function remoteConflictReviewHTML(versions){
  return '<div class="notice"><strong>Revê as duas versões · '+esc(versions.store)+'</strong><p>A versão local mantém as alterações deste dispositivo. A versão remota é a última gravação do workspace. A decisão só é aplicada se nenhuma delas tiver mudado desde esta comparação.</p></div><div class="grid cols-2"><section><h4>Neste dispositivo</h4><pre class="conflict-preview">'+esc(JSON.stringify(versions.local,null,2))+'</pre></section><section><h4>No workspace remoto</h4><pre class="conflict-preview">'+esc(JSON.stringify(versions.remote,null,2))+'</pre></section></div><div class="toolbar"><button class="btn secondary" type="button" data-action="resolve-version-conflict" data-resolution="keep_local" data-sync-id="'+esc(versions.sync_id)+'" data-store="'+esc(versions.store)+'" data-remote-version="'+esc(versions.remote_updated_at)+'" data-local-version="'+esc(versions.local_updated_at||'')+'">Manter versão deste dispositivo</button><button class="btn secondary" type="button" data-action="resolve-version-conflict" data-resolution="keep_remote" data-sync-id="'+esc(versions.sync_id)+'" data-store="'+esc(versions.store)+'" data-remote-version="'+esc(versions.remote_updated_at)+'" data-local-version="'+esc(versions.local_updated_at||'')+'">Usar versão do workspace remoto</button></div>';
}
function remoteAccountHTML(status,teams,options){
  if(!status.configured){
    return '<h2 style="font-size:22px;margin:8px 0">Ainda local</h2><p class="lead">Guarda primeiro o Project URL e a publishable key.</p>';
  }
  if(!status.signedIn){
    return '<h2 style="font-size:22px;margin:8px 0">Iniciar sessão</h2><p class="lead">Recebe um link seguro no teu email.</p><form class="form" data-form="remote-login" style="margin-top:16px"><label class="field"><span>Email</span><input name="email" type="email" required value="'+esc(status.email)+'"></label><button class="btn accent" type="submit">Enviar link de acesso</button></form>';
  }
  var html='<h2 style="font-size:22px;margin:8px 0">Conta ligada</h2><div class="row"><span class="badge ready">Ligado</span><span class="meta">'+esc(status.email||"Sessão ativa")+'</span></div>';
  html+='<div class="form" style="margin-top:16px">';
  if(teams.length){
    html+='<label class="field"><span>Workspace remoto</span><select id="remote-team-select"><option value="">Escolher…</option>'+options+'</select></label>';
    html+='<button class="btn secondary" type="button" data-action="remote-use-team">Usar equipa selecionada</button>';
  }
  html+='<button class="btn secondary" type="button" data-action="remote-create-team">Criar a partir desta equipa</button>';
  if(status.remoteTeamId){
    html+='<div class="row" style="margin:4px 0 8px"><span class="badge ready">Sync automático</span><span class="meta">Este dispositivo usa o workspace remoto partilhado.</span></div>';
    html+='<div class="toolbar"><button class="btn accent" type="button" data-action="remote-sync">Sincronizar agora</button><button class="btn secondary" type="button" data-action="remote-consolidate">Consolidar dispositivos</button></div>';
    html+='<div class="hint" id="remote-realtime-status" role="status">'+esc(realtimeStatusMessage(status.realtimeStatus))+'</div>';
    html+='<div class="hint">Consolidar faz uma união segura dos dados locais deste dispositivo com o workspace remoto, sem apagar conteúdo durante a reconciliação.</div>';
    html+='<div class="hint">ID remoto: '+esc(status.remoteTeamId)+'</div>';
    if(status.lastSyncAt) html+='<div class="hint">Última sincronização: '+esc(new Date(status.lastSyncAt).toLocaleString("pt-PT"))+'</div>';
    if(status.conflicts&&status.conflicts.length) html+=remoteConflictQueueHTML(status.conflicts);
  }
  html+='<button class="link" type="button" data-action="remote-logout">Terminar sessão</button></div>';
  return html;
}
function mcpConnectorsHTML(status,data,error){
  var html='<section class="panel hero-main section mcp-panel"><div class="kicker">Ligações IA</div><h2 style="font-size:22px;margin:8px 0">Vision Coach MCP</h2>';
  html+='<p class="lead">Liga uma IA compatível com MCP ao teu workspace sem partilhar a chave privada do Supabase. Cada ligação tem token próprio, permissões e revogação independente.</p>';
  if(!status.signedIn){
    return html+'<div class="notice" style="margin-top:16px">Inicia sessão no workspace remoto para criar uma ligação IA.</div></section>';
  }
  if(!status.remoteTeamId){
    return html+'<div class="notice" style="margin-top:16px">Escolhe primeiro o workspace remoto desta equipa.</div></section>';
  }
  if(error){
    return html+'<div class="notice" style="margin-top:16px">'+esc(error)+'</div></section>';
  }

  var credential=MCPConnectors.lastCredential();
  if(credential){
    html+='<div class="mcp-credential"><div class="row"><div class="grow"><div class="title">Credencial criada agora</div><div class="meta">Copia o token já. Depois de atualizares a página ele deixa de estar disponível.</div></div><span class="badge ready">Uma vez</span></div>';
    html+='<label class="field"><span>URL MCP</span><div class="copy-field"><input id="mcp-url-once" readonly value="'+esc(credential.mcp_url)+'"><button class="btn secondary small" type="button" data-action="copy-mcp-value" data-copy-target="mcp-url-once">Copiar</button></div></label>';
    html+='<label class="field"><span>Token Bearer</span><div class="copy-field"><input id="mcp-token-once" readonly value="'+esc(credential.token)+'"><button class="btn secondary small" type="button" data-action="copy-mcp-value" data-copy-target="mcp-token-once">Copiar</button></div></label>';
    html+='<div class="notice">Este token dá acesso ao workspace com as permissões escolhidas. Não o publiques nem o envies em mensagens.</div>';
    html+='<button class="link" type="button" data-action="clear-mcp-credential">Já guardei o token</button></div>';
  }

  var mcpUrl=data&&data.mcp_url?data.mcp_url:(RemoteWorkspace.getConfig().url+"/functions/v1/vision-coach-mcp");
  html+='<div class="mcp-instructions"><strong>Como ligar noutra IA</strong><span>1. Adiciona um servidor MCP.</span><span>2. Usa a URL abaixo.</span><span>3. No campo Authorization/Bearer Token, cola o token criado aqui.</span></div>';
  html+='<label class="field"><span>URL do servidor MCP</span><div class="copy-field"><input id="mcp-server-url" readonly value="'+esc(mcpUrl)+'"><button class="btn secondary small" type="button" data-action="copy-mcp-value" data-copy-target="mcp-server-url">Copiar</button></div></label>';

  html+='<form class="form mcp-create-form" data-form="mcp-connector-create">';
  html+='<div class="form-grid"><label class="field"><span>Nome da ligação</span><input name="label" required maxlength="80" placeholder="Ex.: Claude no portátil"></label><label class="field"><span>Validade</span><select name="expires_in_days"><option value="30">30 dias</option><option value="365" selected>1 ano</option><option value="3650">10 anos</option></select></label></div>';
  html+='<div class="field"><span>Permissões</span><div class="scope-grid"><label><input type="checkbox" name="scopes" value="read" checked> Ler workspace</label><label><input type="checkbox" name="scopes" value="write" checked> Criar/alterar</label><label><input type="checkbox" name="scopes" value="media"> Media externo</label></div></div>';
  html+='<button class="btn accent" type="submit">Criar ligação IA</button></form>';

  var connectors=(data&&Array.isArray(data.connectors))?data.connectors:[];
  html+='<div class="section-head" style="margin-top:22px"><div><h2>Ligações existentes</h2><p>'+connectors.length+' ligação(ões)</p></div></div>';
  if(!connectors.length){
    html+='<div class="empty">Ainda não existem ligações MCP.</div>';
  }else{
    html+='<div class="list">'+connectors.map(function(item){
      var active=item.enabled&&!item.revoked_at&&( !item.expires_at || new Date(item.expires_at)>new Date() );
      var scopeText=(item.scopes||[]).join(' · ');
      var last=item.last_used_at?new Date(item.last_used_at).toLocaleString("pt-PT"):"Nunca usada";
      var expires=item.expires_at?new Date(item.expires_at).toLocaleDateString("pt-PT"):"Sem validade";
      return '<div class="list-item row"><div class="grow"><div class="row"><span class="title">'+esc(item.label)+'</span><span class="badge '+(active?'ready':'system')+'">'+(active?'Ativa':'Inativa')+'</span></div><div class="meta">'+esc(item.token_prefix)+'… · '+esc(scopeText)+'</div><div class="meta">Último uso: '+esc(last)+' · validade: '+esc(expires)+'</div></div>'+(active?'<button class="btn danger small" type="button" data-action="revoke-mcp-connector" data-id="'+esc(item.id)+'">Revogar</button>':'')+'</div>';
    }).join('')+'</div>';
  }
  return html+'</section>';
}
async function viewSettings(){
  var s=await WorkspaceStore.buildSnapshot();
  var status=await RemoteWorkspace.status();
  status.conflicts=await Promise.all((status.conflicts||[]).map(async function(conflict){
    if(conflict.local_id==null)return conflict;
    try{
      var row=await DB.obter(conflict.store,conflict.local_id);
      var name=row&&(row.nome||row.adversario||row.title||row.titulo||row.objetivo||row.name);
      return name?Object.assign({},conflict,{display_name:String(name).slice(0,120)}):conflict;
    }catch(_){return conflict;}
  }));
  var config=RemoteWorkspace.getConfig();
  var teams=[], remoteError="", mcpData=null, mcpError="";
  if(status.signedIn){
    try{ teams=await RemoteWorkspace.listTeams(); }catch(error){ remoteError=error.message; }
    if(status.remoteTeamId){
      try{ mcpData=await MCPConnectors.list(status.remoteTeamId); }catch(error){ mcpError=error.message; }
    }
  }
  var options=teams.map(function(team){
    return '<option value="'+esc(team.id)+'" '+(team.id===status.remoteTeamId?"selected":"")+'>'+esc(team.name)+'</option>';
  }).join("");
  var html='<div class="grid cols-2">';
  html+='<section class="panel hero-main"><div class="kicker">Backend remoto</div><h2 style="font-size:22px;margin:8px 0">Supabase</h2>';
  html+='<p class="lead">A configuração pública fica apenas neste browser. Nunca coloques uma secret key aqui.</p>';
  html+='<form class="form" data-form="remote-config" style="margin-top:16px"><label class="field"><span>Project URL</span><input name="url" type="url" placeholder="https://xxxxx.supabase.co" value="'+esc(config.url)+'" required></label>';
  html+='<label class="field"><span>Publishable key</span><input name="publishable_key" type="password" value="'+esc(config.publishableKey)+'" required autocomplete="off"></label><button class="btn secondary" type="submit">Guardar configuração</button></form>';
  if(remoteError) html+='<div class="notice" style="margin-top:12px">'+esc(remoteError)+'</div>';
  html+='</section>';
  html+='<section class="panel hero-main"><div class="kicker">Conta e sincronização</div>'+remoteAccountHTML(status,teams,options)+'</section></div>';
  html+=mcpConnectorsHTML(status,mcpData,mcpError);
  html+='<div class="grid cols-2 section"><section class="panel hero-main"><div class="kicker">Dados</div><h2 style="font-size:22px;margin:8px 0">Backup local</h2><p class="lead">Mantém uma cópia independente do backend remoto.</p><div class="toolbar" style="margin-top:18px"><button class="btn" data-action="export-backup">Exportar backup</button><label class="btn secondary">Importar backup<input hidden type="file" accept="application/json" data-action="import-backup"></label></div></section>';
  html+='<section class="panel hero-main"><div class="kicker">Agente</div><h2 style="font-size:22px;margin:8px 0">Contrato preparado</h2><p class="lead">Depois da sincronização estar ativa, o servidor do agente poderá trabalhar sobre estes mesmos dados com permissões separadas e auditáveis.</p></section></div>';
  html+='<section class="section"><div class="grid cols-4"><div class="panel metric"><div class="metric-label">Jogadores</div><div class="metric-value">'+s.players.length+'</div></div><div class="panel metric"><div class="metric-label">Documentos</div><div class="metric-value">'+s.documents.length+'</div></div><div class="panel metric"><div class="metric-label">Media</div><div class="metric-value">'+s.media.length+'</div></div><div class="panel metric"><div class="metric-label">Atividade</div><div class="metric-value">'+s.activity.length+'</div></div></div></section>';
  setView("Definições",html,"Sistema");
}
function fileToDataURL(file,maxBytes){
  maxBytes=maxBytes||5*1024*1024;
  return new Promise(function(resolve,reject){
    if(!file||!file.size) return resolve(null);
    if(file.size>maxBytes) return reject(new Error("O ficheiro excede 5 MB. Usa um link para ficheiros grandes."));
    var reader=new FileReader();
    reader.onload=function(){resolve(reader.result);};
    reader.onerror=function(){reject(new Error("Não foi possível ler o ficheiro."));};
    reader.readAsDataURL(file);
  });
}
function splitSubject(value){
  var raw=String(value||"");
  if(raw.indexOf(":")<0) return {type:null,id:null};
  var at=raw.indexOf(":");
  return {type:raw.slice(0,at),id:raw.slice(at+1)};
}
async function logHuman(action,summary,entityType,entityId){
  return WorkspaceStore.logActivity({actor:"human",actor_label:HUMAN_LABEL,action:action,summary:summary,entity_type:entityType,entity_id:entityId});
}
async function saveRecord(store,id,data){
  if(id){
    var old=await DB.obter(store,id);
    await DB.atualizar(store,Object.assign({},old||{},data,{id:Number(id)}));
    return Number(id);
  }
  return DB.criar(store,data);
}
async function removePlayerFromOpenMatches(player){
  var ref=stablePlayerRef(player);
  var matches=await DB.porIndice("jogos","team_id",DEFAULT_TEAM_ID);
  var changedMatches=0;
  for(var i=0;i<matches.length;i++){
    var match=matchStructure(matches[i]);
    if(match.estado==="concluido"||match.visual_match?.started_at) continue;
    var changed=false;
    var callup=match.callup.player_ids.filter(function(x){return String(x)!==ref;});
    if(callup.length!==match.callup.player_ids.length){match.callup.player_ids=callup;changed=true;}
    var starters=match.lineup.starters.filter(function(x){return String(x)!==ref;});
    var substitutes=match.lineup.substitutes.filter(function(x){return String(x)!==ref;});
    if(starters.length!==match.lineup.starters.length){match.lineup.starters=starters;changed=true;}
    if(substitutes.length!==match.lineup.substitutes.length){match.lineup.substitutes=substitutes;changed=true;}
    if(String(match.lineup.goalkeeper_id||"")===ref){match.lineup.goalkeeper_id=null;changed=true;}
    if(changed){
      match.callup.status=match.callup.player_ids.length?"ready":"draft";
      match.lineup.status=(match.lineup.goalkeeper_id&&match.lineup.starters.length===4)?"ready":"draft";
      await DB.modificar("jogos",match.id,current=>current.visual_match?.started_at?current:{...current,callup:match.callup,lineup:match.lineup});
      changedMatches++;
    }
  }
  return changedMatches;
}
async function retirePlayerFromRoster(id){
  var player=await DB.obter("jogadores",id);
  if(!player) throw new Error("Jogador não encontrado.");
  await removePlayerFromOpenMatches(player);
  await DB.atualizar("jogadores",Object.assign({},player,{
    plantel_ativo:false,
    estado_disponibilidade:"indisponivel",
    retirado_em:new Date().toISOString()
  }));
  await logHuman("retired_player","Retirou jogador do plantel · "+player.nome,"player",player.sync_id||id);
  return player;
}
async function restorePlayerToRoster(id){
  var player=await DB.obter("jogadores",id);
  if(!player) throw new Error("Jogador não encontrado.");
  await DB.atualizar("jogadores",Object.assign({},player,{
    plantel_ativo:true,
    estado_disponibilidade:PlayerStatus.normalize(player.estado_disponibilidade),
    retirado_em:null
  }));
  await logHuman("restored_player","Reintegrou jogador no plantel · "+player.nome,"player",player.sync_id||id);
  return player;
}
async function deletePlayerPermanently(id){
  var player=await DB.obter("jogadores",id);
  if(!player) throw new Error("Jogador não encontrado.");
  await removePlayerFromOpenMatches(player);
  await DB.apagar("jogadores",id);
  await logHuman("deleted_player","Retirou jogador definitivamente · "+player.nome,"player",player.sync_id||id);
  return player;
}

app.addEventListener("click",async function(event){
  var target=event.target.closest("[data-action]");
  if(!target) return;
  var action=target.dataset.action;
  if(action==="review-version-conflict"){
    target.disabled=true;
    try{var versions=await RemoteWorkspace.readVersionConflict(target.dataset.syncId,target.dataset.store);var reviewBox=target.closest('[data-conflict-card]').querySelector('[data-conflict-review]');reviewBox.innerHTML=remoteConflictReviewHTML(versions);reviewBox.hidden=false;}
    catch(error){alert("Não foi possível comparar as versões: "+error.message);}
    finally{target.disabled=false;}
    return;
  }
  if(action==="resolve-version-conflict"){
    var keepLocal=target.dataset.resolution==="keep_local";
    var message=keepLocal?"Manter a versão deste dispositivo e sincronizá-la sobre a versão remota? A outra versão deixará de ser a ativa, mas a escrita será recusada se o remoto tiver mudado desde a comparação.":"Usar a versão remota neste dispositivo? As alterações locais em conflito serão substituídas depois de confirmar que as duas versões continuam iguais às comparadas.";
    if(!confirm(message))return;
    target.disabled=true;
    try{var resolved=await RemoteWorkspace.resolveVersionConflict(target.dataset.syncId,target.dataset.store,target.dataset.resolution,target.dataset.remoteVersion,target.dataset.localVersion||null);var resolvedMessage=resolved.conflicts.length?"A sincronização encontrou novos conflitos. As versões mantêm-se preservadas.":keepLocal?"Versão deste dispositivo sincronizada.":"Versão remota aplicada neste dispositivo.";alert(resolvedMessage);return router();}
    catch(error){alert("Não foi possível resolver o conflito: "+error.message);return;}
    finally{target.disabled=false;}
  }
  if(action==="restore-local-conflict"){
    if(!confirm("Restaurar o registo apagado no remoto e sincronizar as alterações locais pendentes?"))return;
    target.disabled=true;
    try{var restoredConflict=await RemoteWorkspace.restoreLocallyEditedRecord(target.dataset.syncId);var restoreMessage=restoredConflict.conflicts.length?"A versão remota mudou durante o restauro; o conflito continua preservado.":"Edição local restaurada e sincronizada.";alert(restoreMessage);return router();}
    catch(error){alert("Não foi possível restaurar: "+error.message);return;}
    finally{target.disabled=false;}
  }
  if(action==="resolve-delete-conflict"){
    if(target.dataset.resolution==="delete_remote"&&!confirm("Apagar a versão remota atual deste registo? A alteração feita noutro dispositivo será removida."))return;
    target.disabled=true;
    try{var conflictResult=await RemoteWorkspace.resolveDeleteConflict(target.dataset.syncId,target.dataset.resolution);var conflictMessage=target.dataset.resolution==="keep_remote"?"Versão remota mantida e carregada neste dispositivo.":"Eliminação confirmada e sincronizada.";if(conflictResult.conflicts.length)conflictMessage+=" Ainda há conflitos que precisam de revisão.";alert(conflictMessage);return router();}
    catch(error){alert("Não foi possível reconciliar: "+error.message);return;}
    finally{target.disabled=false;}
  }
  if(action==="edit-season"){
    var seasonDoc=(await WorkspaceStore.listDocuments(DEFAULT_TEAM_ID,{includeArchived:true})).find(x=>x.type==="season_index");if(!seasonDoc)return;var seasonState=VisionSeasons.state(seasonDoc),season=seasonState.items.find(x=>x.id===target.dataset.id),form=app.querySelector('form[data-form="season"]');if(!season||!form)return;form.elements.namedItem("season_id").value=season.id;form.elements.namedItem("name").value=season.name;form.elements.namedItem("start_date").value=season.start_date;form.elements.namedItem("end_date").value=season.end_date;form.elements.namedItem("expected_revision").value=seasonState.revision;form.elements.namedItem("expected_updated_at").value=seasonDoc.updated_at||"";form.elements.namedItem("activate").checked=seasonState.active_id===season.id;form.querySelectorAll('[name="roster_refs"]').forEach(function(x){x.checked=season.roster.some(function(p){return p.ref===x.value;});});form.querySelector('[data-action="cancel-season-edit"]').hidden=false;form.scrollIntoView({behavior:"smooth",block:"center"});return;
  }
  if(action==="cancel-season-edit")return router();
  if(action==="activate-season"){
    var seasonIndexDoc=(await WorkspaceStore.listDocuments(DEFAULT_TEAM_ID,{includeArchived:true})).find(x=>x.type==="season_index");if(!seasonIndexDoc)return;try{var activated=await DB.modificar("workspace_documents",seasonIndexDoc.id,current=>({...current,body:JSON.stringify(VisionSeasons.activate(current,target.dataset.id,{expected_revision:VisionSeasons.state(seasonIndexDoc).revision})),updated_at:new Date().toISOString()}));var activeSeason=VisionSeasons.state(activated).items.find(x=>x.id===target.dataset.id);await DB.modificar("teams",DEFAULT_TEAM_ID,current=>({...current,epoca:activeSeason.name}));return router();}catch(error){alert(error.message);return;}
  }
  if(action==="export-season-player"){var seasonPlayer=(await DB.porIndice("jogadores","team_id",DEFAULT_TEAM_ID)).find(x=>x.sync_id===target.dataset.player);if(!seasonPlayer)return;try{await ReportExporter.open("player",seasonPlayer.id,{seasonId:target.dataset.season});}catch(error){alert(error.message);}return;}
  if(action==="export-team-report"){try{await ReportExporter.open("team",null,{seasonId:target.dataset.season||null});}catch(error){alert(error.message);}return;}
  if(action==="edit-team-record"){
    var teamDoc=await WorkspaceStore.getDocument(Number(target.dataset.id));if(!teamDoc)return;var form=app.querySelector('form[data-form="'+(target.dataset.kind==="week"?"team-week":"team-goal")+'"]');if(!form)return;var value=target.dataset.kind==="week"?TeamDevelopment.week(teamDoc):TeamDevelopment.teamGoal(teamDoc);var parsed=JSON.parse(teamDoc.body||"{}");
    form.elements.namedItem("doc_id").value=teamDoc.id;form.elements.namedItem("expected_revision").value=value.revision;form.elements.namedItem("expected_updated_at").value=teamDoc.updated_at||"";
    if(target.dataset.kind==="week"){form.elements.namedItem("week_start").value=value.week_start;form.elements.namedItem("objective").value=value.objective;form.elements.namedItem("training1").value=value.training1||"";form.elements.namedItem("training2").value=value.training2||"";form.elements.namedItem("match").value=value.match||"";form.elements.namedItem("relation_note").value=parsed.relation_note||"";form.elements.namedItem("evaluation").value=value.evaluation.summary||"";}
    else{form.elements.namedItem("title").value=value.title;form.elements.namedItem("identified_at").value=value.identified_at;form.elements.namedItem("stage").value=value.stage;form.querySelectorAll('[name="session_refs"]').forEach(function(input){var parts=input.value.split(":");input.checked=value.sessions.some(function(x){return x.type===parts[0]&&x.id===parts.slice(1).join(":");});});form.querySelectorAll('[name="evidence_refs"]').forEach(function(input){var parts=input.value.split(":");input.checked=(value.evidence||[]).some(function(x){return x.type===parts[0]&&x.id===parts.slice(1).join(":");});});form.querySelectorAll('[name="exercise_refs"]').forEach(function(input){input.checked=value.exercises.some(function(x){return x.id===input.value;});});form.elements.namedItem("observations").value=value.observations;form.elements.namedItem("interpretation").value=value.interpretation;form.elements.namedItem("hypothesis").value=value.hypothesis;form.elements.namedItem("evaluation").value=value.evaluation||"";form.elements.namedItem("coach_decision").value=value.coach_decision;}
    form.querySelector('[data-action="cancel-team-edit"]').hidden=false;form.scrollIntoView({behavior:"smooth",block:"center"});return;
  }
  if(action==="accept-team-proposal"||action==="dismiss-team-proposal"){
    var proposalDoc=await WorkspaceStore.getDocument(Number(target.dataset.id));if(!proposalDoc)return;var proposalValue=TeamDevelopment.teamGoal(proposalDoc);if(proposalValue.agent_proposal?.status!=="proposed"){alert("Esta proposta já foi decidida noutro dispositivo.");return router();}if(action==="accept-team-proposal"&&!String(proposalValue.coach_decision||"").trim()){alert("Revê e edita a proposta. Preenche «Decisão do treinador» antes de a aceitar.");var proposalForm=app.querySelector('form[data-form="team-goal"]');proposalForm?.scrollIntoView({behavior:"smooth",block:"center"});proposalForm?.elements.namedItem("coach_decision")?.focus();return;}var accepting=action==="accept-team-proposal";if(!confirm(accepting?"Aceitar esta proposta como objetivo identificado? Não será criado nenhum treino.":"Rejeitar esta proposta? O histórico e as evidências serão preservados."))return;try{var decided=TeamDevelopment.saveGoal(proposalDoc,{...proposalValue,agent_proposal:{...proposalValue.agent_proposal,status:accepting?"accepted":"dismissed"}},{expected_revision:proposalValue.revision});await DB.modificar("workspace_documents",proposalDoc.id,current=>{if(!proposalDoc.updated_at||current.updated_at!==proposalDoc.updated_at)throw new Error("A proposta mudou noutro dispositivo. Atualiza e revê antes de decidir.");return Object.assign({},current,{body:JSON.stringify(decided),updated_at:new Date().toISOString(),updated_by:"human",updated_by_label:HUMAN_LABEL});});await logHuman(accepting?"accepted_team_priority_proposal":"dismissed_team_priority_proposal",(accepting?"Aceitou":"Rejeitou")+" proposta do Head Coach · "+proposalValue.title,"document",proposalDoc.sync_id||proposalDoc.id);return router();}catch(error){alert(error.message);return;}
  }
  if(action==="cancel-team-edit")return router();
  if(action==="delete-team-record"){
    if(!confirm("Apagar este registo de planeamento/evolução? A ação é sincronizada e não pode ser desfeita."))return;await DB.apagar("workspace_documents",Number(target.dataset.id));await logHuman("deleted_team_development","Apagou registo de planeamento da equipa","document",target.dataset.id);return router();
  }
  if(action==="jump-match"){
    var section=document.getElementById(target.dataset.target);
    if(section) section.scrollIntoView({behavior:"smooth",block:"start"});
    return;
  }
  if(action==="delete-document"){
    if(!confirm("Apagar este documento? Esta ação remove-o da lista e sincroniza a remoção.")) return;
    await DB.apagar("workspace_documents",Number(target.dataset.id));
    await logHuman("deleted_document","Apagou documento","document",target.dataset.id);
    return go("#/planos");
  }
  if(action==="delete-match"){
    var matchId=Number(target.dataset.id);
    var matchRow=await DB.obter("jogos",matchId);
    if(!matchRow) return go("#/calendario");
    if(!confirm("Apagar o jogo contra "+(matchRow.adversario||"este adversário")+"?")) return;
    await DB.apagar("jogos",matchId);
    await logHuman("deleted_match","Apagou jogo · "+(matchRow.adversario||"Jogo"),"match",matchRow.sync_id||matchId);
    return go("#/calendario");
  }
  if(action==="copy-match-proposal-priority"){
    var copyProposalMatch=await DB.obter("jogos",Number(target.dataset.match)),copyProposal=copyProposalMatch&&VisionMatchAnalysis.fromMatch(copyProposalMatch),copyAgentProposal=copyProposal?.agent_proposal;
    if(!copyProposalMatch||!copyAgentProposal||copyAgentProposal.status!=="proposed"||copyProposal.revision!==Number(target.dataset.proposalRevision)||!VisionMatchAnalysis.proposalFreshness(copyProposalMatch).fresh){alert("A proposta mudou ou ficou desatualizada. Reabre o jogo e revê as fontes.");return;}
    if(!copyAgentProposal.next_priority)return;
    var copyAnalysisForm=app.querySelector('form[data-form="match-analysis"]'),copyPriority=copyAnalysisForm?.elements.namedItem("field_next_priority");if(!copyPriority)return;
    copyPriority.value=copyAgentProposal.next_priority;copyAnalysisForm.dataset.dirty="true";var copyFeedback=app.querySelector('[data-match-proposal-feedback]');if(copyFeedback){copyFeedback.textContent="Prioridade copiada para o campo editável. Revê e guarda a tua análise; ainda não foi aprovada nem criado um treino.";copyFeedback.hidden=false;}copyPriority.focus();copyPriority.scrollIntoView({behavior:"smooth",block:"center"});return;
  }
  if(action==="accept-match-proposal"||action==="dismiss-match-proposal"){
    var proposalMatchId=Number(target.dataset.match),proposalMatch=await DB.obter("jogos",proposalMatchId);if(!proposalMatch)return;
    var proposalAnalysis=VisionMatchAnalysis.fromMatch(proposalMatch),agentProposal=proposalAnalysis.agent_proposal,acceptingMatchProposal=action==="accept-match-proposal";
    if(!agentProposal||agentProposal.status!=="proposed"){alert("Esta proposta já foi decidida noutro dispositivo.");return router();}
    if(!target.dataset.updatedAt||(proposalMatch.updated_at||proposalMatch.sync_local_updated_at)!==target.dataset.updatedAt||proposalAnalysis.revision!==Number(target.dataset.proposalRevision)){alert("O jogo mudou noutro dispositivo. O teu texto continua no formulário; atualiza as fontes e revê a proposta.");return;}
    var proposalForm=app.querySelector('form[data-form="match-analysis"]'),proposalFormData=proposalForm?new FormData(proposalForm):null,proposalFields={},proposalCauses={};
    if(acceptingMatchProposal){
      if(!VisionMatchAnalysis.proposalFreshness(proposalMatch).fresh){alert("A proposta ficou desatualizada. Prepara uma nova proposta com as fontes atuais.");return;}
      Object.keys(VisionMatchAnalysis.fields).forEach(function(key){proposalFields[key]=proposalFormData?.get("field_"+key)||"";});
      if(!String(proposalFields.next_priority||"").trim()||!String(proposalFields.decisions||"").trim()){alert("Revê a proposta, preenche «Prioridade para os próximos treinos» e «Decisão do treinador» no formulário e volta a aceitar.");var missingField=proposalForm?.elements.namedItem(!String(proposalFields.next_priority||"").trim()?"field_next_priority":"field_decisions");missingField?.focus();missingField?.scrollIntoView({behavior:"smooth",block:"center"});return;}
      if(proposalForm){proposalForm.querySelectorAll('textarea[name^="goal_cause_"]').forEach(function(input){proposalCauses[input.name.slice("goal_cause_".length)]=input.value;});}
    }
    if(!confirm(acceptingMatchProposal?"Aceitar a proposta depois de guardar a tua prioridade e decisão? Isto não cria um treino nem atualiza a memória.":"Rejeitar a proposta do Head Coach? O texto e as evidências ficam preservados."))return;
    try{
      await DB.modificar("jogos",proposalMatchId,function(current){
        if(!target.dataset.updatedAt||(current.updated_at||current.sync_local_updated_at)!==target.dataset.updatedAt)throw new Error("O jogo mudou noutro dispositivo. Atualiza e compara antes de decidir.");
        var currentAnalysis=VisionMatchAnalysis.fromMatch(current);if(currentAnalysis.revision!==Number(target.dataset.proposalRevision)||currentAnalysis.agent_proposal?.status!=="proposed")throw new Error("A análise ou a proposta mudou. Atualiza antes de decidir.");
        if(acceptingMatchProposal&&!VisionMatchAnalysis.proposalFreshness(current).fresh)throw new Error("As fontes mudaram. Prepara uma proposta atualizada antes de a aceitar.");
        var savedAnalysis=VisionMatchAnalysis.save(current,acceptingMatchProposal?{fields:proposalFields,goals_conceded:proposalCauses}:{fields:currentAnalysis.fields,goals_conceded:currentAnalysis.goals_conceded},{expected_revision:currentAnalysis.revision,actor:"Treinador"}),savedProposal={...currentAnalysis.agent_proposal,status:acceptingMatchProposal?"accepted":"dismissed",decided_at:new Date().toISOString(),decided_by:"Treinador"};
        if(acceptingMatchProposal)savedProposal.coach_decision=String(proposalFields.decisions).trim();
        savedAnalysis.post_game.analysis={...savedAnalysis.post_game.analysis,agent_proposal:savedProposal};return savedAnalysis;
      });
      await logHuman(acceptingMatchProposal?"accepted_match_analysis_proposal":"dismissed_match_analysis_proposal",(acceptingMatchProposal?"Aceitou":"Rejeitou")+" proposta do Head Coach · "+(proposalMatch.adversario||"jogo"),"match",proposalMatch.sync_id||proposalMatchId);
      return router();
    }catch(error){alert(error.message);return;}
  }
  if(action==="edit-match-evidence"){
    var evidenceMatch=await DB.obter("jogos",Number(target.dataset.match));var evidenceForm=app.querySelector('form[data-form="match-evidence"]');var moment=VisionMatchEvidence.state(evidenceMatch).moments.find(function(x){return x.id===target.dataset.evidence;});if(!moment||!evidenceForm)return;
    var put=function(name,value){var el=evidenceForm.elements.namedItem(name);if(el)el.value=value??"";};put("evidence_id",moment.id);put("url",moment.url);put("minutes",Math.floor(moment.seconds/60));put("seconds",moment.seconds%60);put("category",moment.category);put("player_ref",moment.player_ref);put("description",moment.description);put("relation_type",moment.relation_type);put("relation_ref",moment.relation_ref);evidenceForm.querySelectorAll('[data-relation]').forEach(function(g){g.hidden=g.dataset.relation!==moment.relation_type;});put("expected_revision",VisionMatchEvidence.state(evidenceMatch).revision);evidenceForm.querySelector('[data-action="cancel-match-evidence"]').hidden=false;evidenceForm.scrollIntoView({behavior:"smooth",block:"center"});return;
  }
  if(action==="cancel-match-evidence") return router();
  if(action==="delete-match-evidence"){
    if(!confirm("Apagar este momento de vídeo?"))return;var matchEvidenceId=Number(target.dataset.match),matchEvidence=await DB.obter("jogos",matchEvidenceId);try{await DB.modificar("jogos",matchEvidenceId,current=>VisionMatchEvidence.apply(current,{type:"delete",id:target.dataset.evidence,confirmed:true,expected_revision:VisionMatchEvidence.state(matchEvidence).revision}));return router();}catch(error){alert(error.message);return;}
  }
  if(action==="delete-media"){
    if(!confirm("Remover este item da biblioteca partilhada? O ficheiro binário continua guardado no armazenamento privado para preservar o histórico; esta ação não o elimina fisicamente.")) return;
    await HeadCoachMedia.remove(target.dataset.id);
    await logHuman("removed_media","Removeu um item de media","media",target.dataset.id);
    return router();
  }
  if(action==="retire-player"){
    var playerName=target.dataset.name||"jogador";
    if(!confirm("Retirar "+playerName+" do plantel ativo? O histórico será preservado e podes reintegrá-lo depois.")) return;
    try{
      await retirePlayerFromRoster(Number(target.dataset.id));
      return go("#/equipa");
    }catch(error){ alert("Não foi possível retirar o jogador: "+error.message); return; }
  }
  if(action==="restore-player"){
    try{
      await restorePlayerToRoster(Number(target.dataset.id));
      return go("#/equipa/jogador/"+target.dataset.id);
    }catch(error){ alert("Não foi possível reintegrar o jogador: "+error.message); return; }
  }
  if(action==="delete-player-permanently"){
    var deleteName=target.dataset.name||"jogador";
    if(!confirm("Retirar "+deleteName+" definitivamente? Esta ação remove o jogador da equipa e não poderá ser desfeita pela app.")) return;
    var typed=prompt("Para confirmar a remoção definitiva, escreve exatamente o nome do jogador:\n"+deleteName);
    if(typed!==deleteName){ if(typed!==null) alert("Nome diferente. O jogador não foi removido."); return; }
    try{
      await deletePlayerPermanently(Number(target.dataset.id));
      return go("#/equipa");
    }catch(error){ alert("Não foi possível remover definitivamente: "+error.message); return; }
  }
  if(action==="edit-player-goal"){
    var goalPlayer=await DB.obter("jogadores",Number(target.dataset.player)),goalState=PlayerGoals.state(goalPlayer),goal=goalState.items.find(function(x){return x.id===target.dataset.goal;}),goalForm=app.querySelector('form[data-form="player-goal"]');if(!goal||!goalForm)return;
    goalForm.elements.namedItem("goal_id").value=goal.id;goalForm.elements.namedItem("expected_revision").value=goalState.revision;goalForm.elements.namedItem("title").value=goal.title;goalForm.elements.namedItem("started_at").value=goal.started_at;goalForm.elements.namedItem("status").value=goal.status;goalForm.elements.namedItem("notes").value=goal.notes||"";goalForm.querySelectorAll('[name="evidence_refs"]').forEach(function(el){el.checked=goal.evidence_refs.some(function(ref){return el.value===ref.type+":"+ref.id;});});goalForm.querySelectorAll('[name="exercise_refs"]').forEach(function(el){el.checked=goal.exercise_refs.includes(el.value);});goalForm.querySelector('[data-action="cancel-player-goal"]').hidden=false;goalForm.scrollIntoView({behavior:"smooth",block:"center"});return;
  }
  if(action==="jump-player-goal"){var goalCard=document.getElementById("player-goal-"+target.dataset.goal);goalCard?.scrollIntoView({behavior:"smooth",block:"center"});return;}
  if(action==="cancel-player-goal")return router();
  if(action==="delete-player-goal"){
    if(!confirm("Apagar este objetivo e as respetivas associações?"))return;var gpId=Number(target.dataset.player),gp=await DB.obter("jogadores",gpId);try{await DB.modificar("jogadores",gpId,current=>PlayerGoals.apply(current,{type:"delete",id:target.dataset.goal,confirmed:true,expected_revision:PlayerGoals.state(gp).revision}));return router();}catch(error){alert(error.message);return;}
  }
  if(action==="export-player-report"){
    try{await ReportExporter.open("player",target.dataset.id);}catch(error){alert(error.message);}return;
  }
  if(action==="export-training-report"){
    try{await ReportExporter.open("training",target.dataset.id);}catch(error){alert(error.message);}return;
  }
  if(action==="export-match-sheet"||action==="export-match-report"){
    try{await ReportExporter.open(action==="export-match-sheet"?"match-sheet":"match-report",target.dataset.id);}catch(error){alert(error.message);}return;
  }
  if(action==="remote-logout"){
    await RemoteWorkspace.signOut();
    await refreshRemoteIndicator();
    return router();
  }
  if(action==="remote-create-team"){
    try{
      var createdTeam=await RemoteWorkspace.createTeamFromLocal();
      alert("Workspace remoto criado: "+createdTeam.name);
      return router();
    }catch(error){ alert("Não foi possível criar: "+error.message); return; }
  }
  if(action==="remote-use-team"){
    var select=document.getElementById("remote-team-select");
    if(!select?.value){ alert("Escolhe uma equipa remota."); return; }
    try{await RemoteWorkspace.useTeam(select.value);}catch(error){alert("Não foi possível trocar de workspace: "+error.message);return;}
    return router();
  }
  if(action==="remote-consolidate"){
    target.disabled=true;
    try{
      var consolidateResult=await RemoteWorkspace.consolidateNow();
      var consolidateMsg="Consolidação concluída: "+consolidateResult.repaired+" registo(s) local(is) reparado(s), "+consolidateResult.pushed+" enviados e "+consolidateResult.pulled+" recebidos.";
      if(consolidateResult.conflicts.length) consolidateMsg+=" "+consolidateResult.conflicts.length+" conflito(s) ficaram preservados para revisão.";
      alert(consolidateMsg);
      return router();
    }catch(error){ alert("Consolidação falhou: "+error.message); return; }
    finally{ target.disabled=false; }
  }
  if(action==="remote-sync"){
    target.disabled=true;
    try{
      var syncResult=await RemoteWorkspace.syncNow();
      var msg="Sincronização concluída: "+syncResult.pushed+" enviados, "+syncResult.pulled+" recebidos.";
      if(syncResult.conflicts.length) msg+=" "+syncResult.conflicts.length+" conflito(s) mantidos para revisão.";
      alert(msg);
      return router();
    }catch(error){ alert("Sincronização falhou: "+error.message); return; }
    finally{ target.disabled=false; }
  }
  if(action==="copy-mcp-value"){
    var source=document.getElementById(target.dataset.copyTarget);
    if(!source) return;
    try{
      await navigator.clipboard.writeText(source.value||source.textContent||"");
      var oldText=target.textContent;
      target.textContent="Copiado";
      setTimeout(function(){target.textContent=oldText;},1200);
    }catch(error){ alert("Não foi possível copiar automaticamente."); }
    return;
  }
  if(action==="clear-mcp-credential"){
    MCPConnectors.clearCredential();
    return router();
  }
  if(action==="revoke-mcp-connector"){
    if(!confirm("Revogar esta ligação IA? A IA deixa de conseguir aceder imediatamente.")) return;
    try{
      var mcpStatus=await RemoteWorkspace.status();
      await MCPConnectors.revoke(mcpStatus.remoteTeamId,target.dataset.id);
      return router();
    }catch(error){ alert("Não foi possível revogar: "+error.message); return; }
  }
  if(action==="export-backup") return exportBackup();
});
app.addEventListener("change",async function(event){
  if(event.target.matches('form[data-form="match-evidence"] [name="relation_type"]')){var form=event.target.form,type=event.target.value,ref=form.elements.namedItem("relation_ref");ref.value="";form.querySelectorAll('[data-relation]').forEach(function(g){g.hidden=g.dataset.relation!==type;});return;}
  if(event.target.dataset.action==="import-backup") await importBackup(event.target.files[0]);
});

async function saveTeamDevelopmentDocument(form,type,payload,title,targetDate,refs){
  var docId=Number(form.elements.namedItem("doc_id").value)||null,expectedUpdated=form.elements.namedItem("expected_updated_at").value||null;
  var all=await WorkspaceStore.listDocuments(DEFAULT_TEAM_ID,{includeArchived:true}),existing=docId?await WorkspaceStore.getDocument(docId):null;
  var externalKey=type==="weekly_plan"?"team-week:"+payload.week_start:null;
  if(!existing&&externalKey&&all.some(function(d){return d.external_key===externalKey&&d.status!=="archived";}))throw new Error("Já existe um plano para esta semana. Abre-o para editar, sem criar duplicados.");
  var stamp=new Date().toISOString(),actor={created_by:"human",created_by_label:HUMAN_LABEL,updated_by:"human",updated_by_label:HUMAN_LABEL};
  if(existing){
    await DB.modificar("workspace_documents",docId,function(current){if(!expectedUpdated||current.updated_at!==expectedUpdated)throw new Error("Este registo mudou noutro dispositivo. Reabre-o e compara antes de guardar.");return Object.assign({},current,{type,title,body:JSON.stringify(payload),status:"ready",target_date:targetDate,refs,updated_at:stamp,updated_by:"human",updated_by_label:HUMAN_LABEL});});
  }else{
    await DB.criar("workspace_documents",Object.assign({team_id:DEFAULT_TEAM_ID,type,title,body:JSON.stringify(payload),status:"ready",target_date:targetDate,refs,created_at:stamp,updated_at:stamp,external_key:externalKey,sync_id:crypto.randomUUID()},actor));
  }
  await WorkspaceStore.logActivity({team_id:DEFAULT_TEAM_ID,actor:"human",actor_label:HUMAN_LABEL,action:existing?"updated_document":"created_document",summary:(existing?"Atualizou ":"Criou ")+WORKSPACE_DOC_LABELS[type].toLowerCase()+" · "+title,entity_type:"document",entity_id:docId||externalKey});
}
async function viewSearch(){
  var params=new URLSearchParams((location.hash.split("?")[1]||"")),query=(params.get("q")||"").trim(),kind=params.get("kind")||"all",from=params.get("from")||"",to=params.get("to")||"",seasonId=params.get("season")||"",s=await WorkspaceStore.buildSnapshot(),docs=await WorkspaceStore.listDocuments(DEFAULT_TEAM_ID,{includeArchived:true}),memory=await HeadCoachMemory.list(DEFAULT_TEAM_ID,{includeArchived:true}),players=await DB.porIndice("jogadores","team_id",DEFAULT_TEAM_ID),exercises=await DB.porIndice("exercicios","team_id",DEFAULT_TEAM_ID),seasonsDoc=docs.find(x=>x.type==="season_index"),seasonState=VisionSeasons.state(seasonsDoc),season=seasonState.items.find(x=>x.id===seasonId)||null,rows=[];
  function searchable(v){if(v==null)return"";if(typeof v==="string"||typeof v==="number"||typeof v==="boolean")return String(v);if(Array.isArray(v))return v.map(searchable).join(" ");if(typeof v==="object")return Object.entries(v).filter(([k])=>!/image|photo|avatar|data_url|storage_path|sync_|updated_at|created_at|external_key|revision|id$/i.test(k)).map(function(x){return searchable(x[1]);}).join(" ");return"";}
  function add(type,title,date,href,source,filter,seasonPlayerRef){rows.push({type,title:String(title||"Registo sem título"),date:String(date||"").slice(0,10),href,source,haystack:searchable(source)+" "+String(title||"")+" "+String(date||""),filter:filter||type,seasonPlayerRef:seasonPlayerRef||null});}
  players.forEach(function(p){add("Atleta",p.nome,p.created_at,"#/equipa/jogador/"+p.id,{nome:p.nome,numero:p.numero,posicao:p.posicao,disponibilidade:p.estado_disponibilidade,goals:PlayerGoals.state(p).items},"player",p.sync_id);PlayerGoals.state(p).items.forEach(function(g){add("Objetivo individual",g.title,g.started_at,"#/equipa/jogador/"+p.id,{...g,atleta:p.nome},"objective",p.sync_id);});});
  s.matches.forEach(function(m){add("Jogo · "+(m.adversario||"Adversário"),m.adversario,m.data,"#/equipa/jogo/"+m.id,{...m,events:VisionMatchEvents.state(m).events,evidence:VisionMatchEvidence.state(m).moments},"match");});
  s.trainings.forEach(function(t){add("Treino",t.objetivo||t.escalao,t.data,"#/consulta/"+t.id,{...t,blocks:t.blocos},"training");});
  exercises.filter(function(e){return e.workspace_v2;}).forEach(function(e){add("Exercício",e.nome,e.updated_at,"#/exercicios/"+e.id,e,"exercise");});
  docs.forEach(function(d){var target=d.type==="season_index"?"#/epocas":d.type==="weekly_plan"||d.type==="team_goal"?"#/evolucao":"#/planos/"+d.id,category=d.type==="team_goal"?"objective":d.type==="weekly_plan"?"training":"document";add(WORKSPACE_DOC_LABELS[d.type]||"Documento",d.title,d.target_date||d.updated_at,target,{...d,body:d.body},category);});
  memory.forEach(function(m){var refs=m.subject_refs||[],sourceType=m.source?.ref_type,sourceId=m.source?.ref_id,origin=sourceType&&sourceId?{type:sourceType,id:sourceId}:refs.find(x=>x.type==="match"||x.type==="training"),linkedMatch=origin?.type==="match"&&s.matches.find(x=>String(x.sync_id)===String(origin.id)),linkedTraining=origin?.type==="training"&&s.trainings.find(x=>String(x.sync_id)===String(origin.id)),subject=refs.find(x=>x.type==="player"),player=subject&&players.find(p=>String(p.sync_id)===String(subject.id)),href=linkedMatch?"#/equipa/jogo/"+linkedMatch.id:linkedTraining?"#/treinos/"+linkedTraining.id:player?"#/equipa/jogador/"+player.id:"#/timeline/memory/"+m.id;add("Observação",m.title,m.occurred_at,href,m,"observation",player?.sync_id);});
  s.media.forEach(function(m){add("Media",m.title,m.created_at,"#/media",m,"media");});
  function inSelectedSeason(r){if(!season)return false;var playerRef=r.seasonPlayerRef||(r.type==="Atleta"?players.find(x=>String(x.id)===r.href.split("/").pop())?.sync_id:null);if(playerRef&&!season.roster.some(p=>String(p.ref)===String(playerRef)))return false;if(r.type==="Atleta")return true;return !!r.date&&VisionSeasons.includes(season,r.date);}
  var tokens=query.toLocaleLowerCase("pt-PT").split(/\s+/).filter(Boolean),hasFilter=!!(tokens.length||kind!=="all"||from||to||seasonId),matches=hasFilter?rows.filter(function(r){if(kind!=="all"&&r.filter!==kind)return false;if(from&&(!r.date||r.date<from))return false;if(to&&(!r.date||r.date>to))return false;if(seasonId&&(!season||!inSelectedSeason(r)))return false;var hay=(r.title+" "+r.haystack).toLocaleLowerCase("pt-PT");return tokens.every(function(t){return hay.includes(t);});}).sort((a,b)=>b.date.localeCompare(a.date)).slice(0,100):[];
  var typeOptions=[["all","Tudo"],["player","Atletas"],["match","Jogos"],["training","Treinos"],["exercise","Exercícios"],["objective","Objetivos"],["observation","Observações"],["document","Documentos"],["media","Media"]].map(x=>'<option value="'+x[0]+'" '+(kind===x[0]?"selected":"")+'>'+x[1]+'</option>').join(""),seasonOptions='<option value="">Todas as épocas</option>'+(seasonId&&!season?'<option value="'+esc(seasonId)+'" selected>Época indisponível</option>':'')+seasonState.items.map(x=>'<option value="'+esc(x.id)+'" '+(seasonId===x.id?"selected":"")+'>'+esc(x.name)+'</option>').join("");
  var form='<form class="panel form" data-form="workspace-search"><div class="form-grid"><label class="field"><span>Pesquisar</span><input name="q" value="'+esc(query)+'" placeholder="Atleta, adversário, exercício, observação…" autofocus></label><label class="field"><span>Tipo</span><select name="kind">'+typeOptions+'</select></label><label class="field"><span>Desde</span><input name="from" type="date" value="'+esc(from)+'"></label><label class="field"><span>Até</span><input name="to" type="date" value="'+esc(to)+'"></label><label class="field"><span>Época</span><select name="season">'+seasonOptions+'</select></label></div><div class="toolbar"><button class="btn accent" type="submit">Pesquisar</button><a class="btn secondary" href="#/pesquisa">Limpar filtros</a></div></form>';
  var resultHtml=matches.map(function(r){return '<a class="list-item row" href="'+esc(r.href)+'"><span class="badge">'+esc(r.type)+'</span><span class="grow"><span class="title">'+esc(r.title)+'</span><span class="meta">'+(r.date?fmtDate(r.date):"Data não registada")+'</span></span><span aria-hidden="true">›</span></a>';}).join("")||'<div class="empty">'+(hasFilter?'Sem resultados para estes filtros.':'Escreve um termo ou escolhe filtros para pesquisar o workspace.')+'</div>';
  setView("Pesquisa e histórico",'<section class="panel hero-main"><div class="kicker">Pesquisa transversal</div><h2 class="display">Encontra o registo e abre a sua origem.</h2><p class="lead">Pesquisa atletas, jogos, treinos, exercícios, objetivos, observações, documentos e media. Os filtros por data e época mantêm os períodos separados.</p></section>'+form+'<section class="section"><div class="section-head"><div><h2>Resultados · '+matches.length+'</h2><p>Até 100 correspondências, por data mais recente</p></div></div><div class="list">'+resultHtml+'</div></section>',"Histórico");
}

app.addEventListener("submit",async function(event){
  var form=event.target.closest("form[data-form]");
  if(!form) return;
  event.preventDefault();
  var fd=new FormData(form);
  if(form.dataset.form==="workspace-search"){var params=new URLSearchParams();["q","kind","from","to","season"].forEach(function(k){var v=String(fd.get(k)||"").trim();if(v&&!(k==="kind"&&v==="all"))params.set(k,v);});location.hash="#/pesquisa"+(params.size?"?"+params.toString():"");return;}
  if(event.submitter&&event.submitter.name) fd.set(event.submitter.name,event.submitter.value);
  var type=form.dataset.form;
  var id=form.dataset.id?Number(form.dataset.id):null;
  function numberOrNull(v){return v===""||v==null?null:Number(v);}

  if(type==="team-week"){
    try{var oldDoc=fd.get("doc_id")?await WorkspaceStore.getDocument(Number(fd.get("doc_id"))):null,oldWeek=TeamDevelopment.week(oldDoc),weekStart=TeamDevelopment.monday(fd.get("week_start")),weekData=TeamDevelopment.saveWeek(oldDoc,{week_start:weekStart,objective:fd.get("objective"),training1:fd.get("training1"),training2:fd.get("training2"),match:fd.get("match"),links:[{from:fd.get("training1"),to:fd.get("training2"),note:fd.get("relation_note")},{from:fd.get("training2"),to:fd.get("match"),note:fd.get("relation_note")}],evaluation:{summary:fd.get("evaluation"),evidence:[]}}, {expected_revision:Number(fd.get("expected_revision"))});weekData.relation_note=String(fd.get("relation_note")||"").slice(0,500);var weekRefs=[weekData.training1&&{type:"training",id:weekData.training1},weekData.training2&&{type:"training",id:weekData.training2},weekData.match&&{type:"match",id:weekData.match}].filter(Boolean);await saveTeamDevelopmentDocument(form,"weekly_plan",weekData,"Semana · "+fmtDate(weekStart),weekStart,weekRefs);return router();}catch(error){var weekFeedback=form.querySelector("[data-team-feedback]");weekFeedback.textContent=error.message;weekFeedback.hidden=false;return;}
  }
  if(type==="team-goal"){
    try{var goalDoc=fd.get("doc_id")?await WorkspaceStore.getDocument(Number(fd.get("doc_id"))):null,sessionRefs=fd.getAll("session_refs").map(function(v){var i=v.indexOf(":");return{type:v.slice(0,i),id:v.slice(i+1)};}),memoryRows=await HeadCoachMemory.list(DEFAULT_TEAM_ID),extraEvidence=fd.getAll("evidence_refs").map(function(v){var i=v.indexOf(":");return{type:v.slice(0,i),id:v.slice(i+1)};}).filter(function(ref){return ref.type==="memory"&&memoryRows.some(function(x){return String(x.sync_id)===String(ref.id);});}),exerciseRows=await DB.porIndice("exercicios","team_id",DEFAULT_TEAM_ID),exerciseRefs=fd.getAll("exercise_refs").filter(function(ref){return exerciseRows.some(function(x){return String(x.sync_id)===String(ref);});}).map(function(ref){return{type:"exercise",id:ref};}),goalData=TeamDevelopment.saveGoal(goalDoc,{title:fd.get("title"),identified_at:fd.get("identified_at"),stage:fd.get("stage"),sessions:sessionRefs,evidence:sessionRefs.concat(extraEvidence),exercises:exerciseRefs,observations:fd.get("observations"),interpretation:fd.get("interpretation"),hypothesis:fd.get("hypothesis"),evaluation:fd.get("evaluation"),coach_decision:fd.get("coach_decision")},{expected_revision:Number(fd.get("expected_revision"))});var goalRefs=sessionRefs.concat(extraEvidence,exerciseRefs);await saveTeamDevelopmentDocument(form,"team_goal",goalData,goalData.title,goalData.identified_at,goalRefs);return router();}catch(error){var goalFeedback=form.querySelector("[data-team-feedback]");goalFeedback.textContent=error.message;goalFeedback.hidden=false;return;}
  }
  if(type==="season"){
    try{
      var seasonDoc=fd.get("doc_id")?await WorkspaceStore.getDocument(Number(fd.get("doc_id"))):null;
      if(!seasonDoc)seasonDoc=(await WorkspaceStore.listDocuments(DEFAULT_TEAM_ID,{includeArchived:true})).find(x=>x.type==="season_index")||null;
      var currentIndex=VisionSeasons.state(seasonDoc),rosterRefs=fd.getAll("roster_refs"),allPlayers=await DB.porIndice("jogadores","team_id",DEFAULT_TEAM_ID);
      var roster=rosterRefs.map(function(ref){var p=allPlayers.find(function(x){return x.sync_id===ref;});return p?{ref:p.sync_id,name:p.nome,number:p.numero??null}:null;}).filter(Boolean);
      var seasonData=VisionSeasons.save(seasonDoc,{id:fd.get("season_id")||null,name:fd.get("name"),start_date:fd.get("start_date"),end_date:fd.get("end_date"),roster:roster,activate:fd.get("activate")==="yes"||!currentIndex.active_id},{expected_revision:Number(fd.get("expected_revision"))});
      var stamp=new Date().toISOString();
      if(seasonDoc){
        await DB.modificar("workspace_documents",seasonDoc.id,function(current){
          if(!fd.get("expected_updated_at")||current.updated_at!==fd.get("expected_updated_at"))throw new Error("O arquivo de épocas mudou noutro dispositivo. Reabre e compara antes de guardar.");
          return Object.assign({},current,{body:JSON.stringify(seasonData),updated_at:stamp,title:"Arquivo de épocas",target_date:seasonData.items.find(function(x){return x.id===seasonData.active_id;})?.start_date||null,updated_by:"human",updated_by_label:HUMAN_LABEL});
        });
      }else{
        var newSeasonDocId=await DB.criar("workspace_documents",{team_id:DEFAULT_TEAM_ID,type:"season_index",title:"Arquivo de épocas",body:JSON.stringify(seasonData),status:"ready",target_date:seasonData.items.find(function(x){return x.id===seasonData.active_id;})?.start_date||null,created_at:stamp,updated_at:stamp,external_key:"season-index:"+DEFAULT_TEAM_ID,sync_id:await VisionSeasons.stableIndexId(DEFAULT_TEAM_ID),created_by:"human",created_by_label:HUMAN_LABEL,updated_by:"human",updated_by_label:HUMAN_LABEL});
        seasonDoc=await DB.obter("workspace_documents",newSeasonDocId);
      }
      var activeSeason=seasonData.items.find(function(x){return x.id===seasonData.active_id;});
      if(activeSeason)await DB.modificar("teams",DEFAULT_TEAM_ID,current=>({...current,epoca:activeSeason.name}));
      await WorkspaceStore.logActivity({team_id:DEFAULT_TEAM_ID,actor:"human",actor_label:HUMAN_LABEL,action:"updated_seasons",summary:"Atualizou o arquivo de épocas · "+(activeSeason?.name||fd.get("name")),entity_type:"document",entity_id:seasonDoc?.sync_id||seasonDoc?.id});
      return router();
    }catch(error){var seasonFeedback=form.querySelector("[data-season-feedback]");seasonFeedback.textContent=error.message;seasonFeedback.hidden=false;return;}
  }

  if(type==="remote-config"){
    try{
      RemoteWorkspace.saveConfig({
        url:fd.get("url"),
        publishableKey:fd.get("publishable_key")
      });
      alert("Configuração remota guardada.");
      await refreshRemoteIndicator();
      return router();
    }catch(error){ alert(error.message); return; }
  }
  if(type==="remote-login"){
    try{
      await RemoteWorkspace.signInWithEmail(fd.get("email"));
      alert("Enviei um link de acesso para o teu email.");
      return router();
    }catch(error){ alert("Não foi possível enviar o link: "+error.message); return; }
  }
  if(type==="mcp-connector-create"){
    try{
      var mcpStatus=await RemoteWorkspace.status();
      var scopes=fd.getAll("scopes").map(String);
      if(!scopes.length){ alert("Escolhe pelo menos uma permissão."); return; }
      await MCPConnectors.create(mcpStatus.remoteTeamId,{
        label:fd.get("label"),
        scopes:scopes,
        expires_in_days:Number(fd.get("expires_in_days")||365)
      });
      return router();
    }catch(error){ alert("Não foi possível criar a ligação: "+error.message); return; }
  }

  if(type==="team"){
    var currentTeam=await HeadCoachMemory.ensureTeam();
    var currentSchedule=currentTeam.horarios||{};
    await HeadCoachMemory.saveTeam({
      id:DEFAULT_TEAM_ID,
      nome:fd.get("nome"),
      clube:fd.get("clube")||null,
      escalao:fd.get("escalao")||null,
      epoca:fd.get("epoca")||null,
      competicao:fd.get("competicao")||null,
      formato:fd.get("formato")||null,
      horarios:Object.assign({},currentSchedule,{texto:fd.get("horarios")||null})
    });
    await logHuman("updated_team","Atualizou o perfil da equipa","team",DEFAULT_TEAM_ID);
    return go("#/equipa");
  }
  if(type==="player"){
    var previousPlayer=id?await DB.obter("jogadores",id):null;
    var nextAvailability=PlayerStatus.normalize(fd.get("estado_disponibilidade"));
    var playerId=await saveRecord("jogadores",id,{
      team_id:DEFAULT_TEAM_ID,
      nome:fd.get("nome"),
      numero:numberOrNull(fd.get("numero")),
      escalao:fd.get("escalao")||null,
      posicao:fd.get("posicao")||null,
      estado_disponibilidade:nextAvailability,
      notas:fd.get("notas")||null
    });
    var savedPlayer=await DB.obter("jogadores",playerId);
    var photoFile=fd.get("foto_file");
    if(photoFile&&photoFile.size){
      if(!String(photoFile.type||"").startsWith("image/")){
        alert("Escolhe um ficheiro de imagem para a foto do atleta.");
        return;
      }
      var localPhoto=await fileToDataURL(photoFile,5*1024*1024);
      await DB.atualizar("jogadores",Object.assign({},savedPlayer,{foto:localPhoto}));
      savedPlayer=await DB.obter("jogadores",playerId);
      var saveLocalPlayerPhoto=async function(){
        await HeadCoachMedia.create({
          team_id:DEFAULT_TEAM_ID,
          subject_type:"player",
          subject_id:playerId,
          type:"photo",
          title:"Foto · "+fd.get("nome"),
          data_url:localPhoto,
          file_name:photoFile.name||null,
          mime_type:photoFile.type||null,
          size:photoFile.size,
          note:"Foto de perfil do atleta"
        });
      };
      var uploadError=null,uploadedRemotely=false;
      try{
        if(await RemoteWorkspace.canUpload()){
          await RemoteWorkspace.uploadFileMedia(photoFile,{
            subject_type:"player",
            subject_id:playerId,
            type:"photo",
            title:"Foto · "+fd.get("nome"),
            note:"Foto de perfil do atleta"
          });
          uploadedRemotely=true;
        }
      }catch(error){uploadError=error;}
      if(!uploadedRemotely&&!uploadError) await saveLocalPlayerPhoto();
      if(uploadError&&!uploadError.remoteMediaSaved){
        await saveLocalPlayerPhoto();
        alert("A fotografia ficou guardada neste dispositivo e será sincronizada quando a ligação estiver disponível.");
      }else if(uploadError){
        alert("A fotografia chegou ao workspace remoto, mas este dispositivo não confirmou a cópia local. Abre a app com Internet para a sincronizar.");
      }
      await logHuman("updated_player_photo","Atualizou foto do atleta · "+fd.get("nome"),"player",savedPlayer.sync_id||playerId);
    }
    if(id&&previousPlayer&&PlayerStatus.normalize(previousPlayer.estado_disponibilidade)!==nextAvailability){
      if(nextAvailability!=="disponivel") await removePlayerFromOpenMatches(savedPlayer);
      await logHuman("updated_player_availability","Alterou disponibilidade · "+fd.get("nome")+" · "+PlayerStatus.label(nextAvailability),"player",savedPlayer.sync_id||playerId);
    }
    await logHuman(id?"updated_player":"created_player",(id?"Atualizou jogador · ":"Adicionou jogador · ")+fd.get("nome"),"player",playerId);
    return go("#/equipa/jogador/"+playerId);
  }
  if(type==="player-goal"){
    var playerId=Number(id),player=await DB.obter("jogadores",playerId),evidenceRefs=fd.getAll("evidence_refs").map(function(value){var split=value.split(":");return{type:split.shift(),id:split.join(":")};}),goalId=fd.get("goal_id")||crypto.randomUUID();
    try{await DB.modificar("jogadores",playerId,current=>PlayerGoals.apply(current,{type:"save",expected_revision:Number(fd.get("expected_revision")),goal:{id:goalId,title:fd.get("title"),started_at:fd.get("started_at"),status:fd.get("status"),evidence_refs:evidenceRefs,exercise_refs:fd.getAll("exercise_refs"),notes:fd.get("notes")} }));await logHuman("updated_player_goal","Atualizou objetivo individual · "+fd.get("title"),"player",player.sync_id||playerId);return router();}catch(error){var goalFeedback=form.querySelector("[data-goal-feedback]");if(goalFeedback){goalFeedback.textContent=error.message;goalFeedback.hidden=false;}else alert(error.message);return;}
  }
  if(type==="match"){
    var team=await HeadCoachMemory.ensureTeam();
    var existing=matchStructure(id?await DB.obter("jogos",id):null);
    var externalKey=existing.external_key||("match:"+fd.get("data")+":"+String(fd.get("adversario")||"").toLowerCase());
    var matchData={
      team_id:DEFAULT_TEAM_ID,
      data:fd.get("data"),
      hora:fd.get("hora")||null,
      escalao:team.escalao||null,
      adversario:fd.get("adversario"),
      casa_fora:fd.get("casa_fora"),
      local:fd.get("local")||null,
      hora_saida:fd.get("hora_saida")||null,
      hora_concentracao:fd.get("hora_concentracao")||null,
      competicao:fd.get("competicao")||team.competicao||null,
      estado:fd.get("estado")||"agendado",
      golos_favor:numberOrNull(fd.get("golos_favor")),
      golos_contra:numberOrNull(fd.get("golos_contra")),
      notas:fd.get("notas")||null,
      external_key:externalKey,
      pre_game:existing.pre_game,
      callup:existing.callup,
      lineup:existing.lineup,
      during:existing.during,
      post_game:existing.post_game
    };
    var matchId;
    if(id){for(const key of ["pre_game","callup","lineup","during","post_game"])delete matchData[key];await DB.modificar("jogos",id,current=>({...current,...matchData}));matchId=id;}
    else matchId=await DB.criar("jogos",matchData);
    await logHuman(id?"updated_match":"created_match",(id?"Atualizou jogo · ":"Criou jogo · ")+fd.get("adversario"),"match",matchId);
    return go("#/equipa/jogo/"+matchId);
  }
  if(type==="match-pre"){
    var preMatch=matchStructure(await DB.obter("jogos",id));
    preMatch.pre_game={
      status:"ready",
      objetivo_principal:fd.get("objetivo_principal")||null,
      plano_jogo:fd.get("plano_jogo")||null,
      adversario_notas:fd.get("adversario_notas")||null,
      adversario_sistema:fd.get("adversario_sistema")||null,
      adversario_estilo:fd.get("adversario_estilo")||null,
      adversario_pontos_fortes:linesFromText(fd.get("adversario_pontos_fortes")),
      adversario_vulnerabilidades:linesFromText(fd.get("adversario_vulnerabilidades")),
      pontos_observar:linesFromText(fd.get("pontos_observar"))
    };
    await DB.modificar("jogos",id,current=>({...current,pre_game:preMatch.pre_game}));
    await logHuman("updated_match_pre_game","Atualizou plano pré-jogo · "+preMatch.adversario,"match",id);
    return router();
  }
  if(type==="match-callup"){
    var callMatch=matchStructure(await DB.obter("jogos",id));
    var calledIds=fd.getAll("player_ids").map(String);
    callMatch.callup={status:calledIds.length?"ready":"draft",player_ids:calledIds,notes:fd.get("notes")||null};
    callMatch.lineup.starters=callMatch.lineup.starters.filter(function(ref){return calledIds.includes(String(ref));});
    callMatch.lineup.substitutes=callMatch.lineup.substitutes.filter(function(ref){return calledIds.includes(String(ref));});
    if(callMatch.lineup.goalkeeper_id&&!calledIds.includes(String(callMatch.lineup.goalkeeper_id))) callMatch.lineup.goalkeeper_id=null;
    if(callMatch.lineup.positions){
      var retainedPositions=new Set();
      callMatch.lineup.positions=Object.fromEntries(Object.entries(callMatch.lineup.positions).filter(function(entry){
        var ref=String(entry[1]||"");
        if(!calledIds.includes(ref)||retainedPositions.has(ref))return false;
        retainedPositions.add(ref);return true;
      }));
    }
    try{await DB.modificar("jogos",id,current=>{
      if(current.visual_match?.started_at)throw new Error("O alinhamento e a convocatória iniciais já estão preservados. Usa o Jogo visual para registar substituições.");
      return {...current,callup:callMatch.callup,lineup:callMatch.lineup};
    });}catch(error){alert(error.message);return;}
    await logHuman("updated_match_callup","Atualizou convocatória · "+callMatch.adversario,"match",id);
    return router();
  }
  if(type==="match-lineup"){
    alert("O alinhamento é editado no Jogo visual, que guarda o sistema e as posições no mesmo registo.");
    return go("#/jogo-visual/"+id);
  }
  if(type==="match-during"){
    var liveMatch=matchStructure(await DB.obter("jogos",id));
    liveMatch.during={...liveMatch.during,halftime_score:fd.get("halftime_score")||null,notes:linesFromText(fd.get("notes"))};
    await DB.modificar("jogos",id,current=>({...current,during:liveMatch.during}));
    await logHuman("updated_match_during","Atualizou registo durante o jogo · "+liveMatch.adversario,"match",id);
    return router();
  }
  if(type==="match-post"){
    var postMatch=matchStructure(await DB.obter("jogos",id));
    postMatch.post_game={status:"done",correu_bem:fd.get("correu_bem")||null,melhorar:fd.get("melhorar")||null,conclusoes:fd.get("conclusoes")||null,acoes_proximo_treino:linesFromText(fd.get("acoes"))};
    await DB.modificar("jogos",id,current=>({...current,post_game:postMatch.post_game}));
    await logHuman("updated_match_post_game","Atualizou análise pós-jogo · "+postMatch.adversario,"match",id);
    return router();
  }
  if(type==="match-evidence"){
    try{var evidenceId=Number(id),evidenceRow=await DB.obter("jogos",evidenceId),relationType=fd.get("relation_type"),relationRef=fd.get("relation_ref"),evidenceItem={id:fd.get("evidence_id")||crypto.randomUUID(),url:fd.get("url"),seconds:Number(fd.get("minutes")||0)*60+Number(fd.get("seconds")||0),category:fd.get("category"),player_ref:fd.get("player_ref")||null,description:fd.get("description"),relation_type:relationType,relation_ref:relationRef,observation:relationType==="observation"?relationRef:""},evidenceType=fd.get("evidence_id")?"edit":"add";if(evidenceItem.player_ref){var evidencePlayers=await DB.porIndice("jogadores","team_id",DEFAULT_TEAM_ID);if(!evidencePlayers.some(function(p){return p.sync_id===evidenceItem.player_ref;}))throw new Error("Escolhe um atleta pertencente a esta equipa.");}if(relationType==="statistic"&&!Object.hasOwn(VisionMatchEvidence.statistics,relationRef||""))throw new Error("Escolhe uma estatística registada.");if(relationType==="problem"&&(!VisionMatchEvidence.problemFields.includes(relationRef)||!VisionMatchAnalysis.fromMatch(evidenceRow).fields[relationRef]))throw new Error("Escolhe um problema com conteúdo na análise deste jogo.");if(relationType==="observation"){var linkedMemory=await HeadCoachMemory.list(DEFAULT_TEAM_ID,{subjectType:"match",subjectId:evidenceRow.sync_id||evidenceId});if(!linkedMemory.some(function(m){return m.sync_id===relationRef;}))throw new Error("Escolhe uma observação associada a este jogo.");}await DB.modificar("jogos",evidenceId,current=>VisionMatchEvidence.apply(current,{type:evidenceType,id:evidenceItem.id,item:evidenceItem,expected_revision:Number(fd.get("expected_revision"))}));await logHuman("updated_match_evidence",(evidenceType==="add"?"Adicionou":"Atualizou")+" momento de vídeo · "+evidenceItem.description,"match",evidenceRow.sync_id||evidenceId);return router();}
    catch(error){var evidenceFeedback=form.querySelector("[data-evidence-feedback]");if(evidenceFeedback){evidenceFeedback.textContent=error.message;evidenceFeedback.hidden=false;}else alert(error.message);return;}
  }
  if(type==="match-analysis"){
    try{
      var analysisMatch=matchStructure(await DB.obter("jogos",id));
      var analysisFields={};Object.keys(VisionMatchAnalysis.fields).forEach(function(key){analysisFields[key]=fd.get("field_"+key)||"";});
      var causes={};VisionMatchEvents.state(analysisMatch).events.filter(function(e){return e.type==="goal_against";}).forEach(function(e){causes[e.id]=fd.get("goal_cause_"+e.id)||"";});
      var saveIntent=fd.get("intent")==="memory";
      await MatchAnalysisStore.commit(id,{fields:analysisFields,goals_conceded:causes},{expected_revision:Number(fd.get("expected_revision")),save_memory:saveIntent,legacy:{correu_bem:fd.get("legacy_positives")||null,melhorar:fd.get("legacy_improve")||null,conclusoes:fd.get("legacy_conclusions")||null,acoes_proximo_treino:linesFromText(fd.get("legacy_actions"))},actor:"Treinador"});
      await logHuman("updated_match_analysis","Atualizou análise pós-jogo · "+analysisMatch.adversario,"match",analysisMatch.sync_id||id);
      return router();
    }catch(error){var feedback=form.querySelector("[data-analysis-feedback]");if(feedback){feedback.textContent=error.message;feedback.hidden=false;}else alert(error.message);return;}
  }
  if(type==="document"){
    var docId=await WorkspaceStore.saveDocument({
      id:id,
      team_id:DEFAULT_TEAM_ID,
      type:fd.get("type"),
      title:fd.get("title"),
      body:fd.get("body"),
      status:fd.get("status"),
      target_date:fd.get("target_date")||null,
      created_by:"human",
      created_by_label:HUMAN_LABEL
    });
    return go("#/planos/"+docId);
  }
  if(type==="observation"){
    var subject=splitSubject(fd.get("subject_key"));
    if(subject.type==="player"){var observationPlayer=await DB.obter("jogadores",Number(subject.id));if(observationPlayer)subject.id=observationPlayer.sync_id||subject.id;}
    if(subject.type==="match"){var observationMatch=await DB.obter("jogos",Number(subject.id));if(observationMatch)subject.id=observationMatch.sync_id||subject.id;}
    if(subject.type==="document"){var observationDocument=await WorkspaceStore.getDocument(Number(subject.id));if(observationDocument)subject.id=observationDocument.sync_id||subject.id;}
    await WorkspaceStore.captureObservation({
      actor:"human",
      actor_label:HUMAN_LABEL,
      title:fd.get("title"),
      content:fd.get("content"),
      occurred_at:fd.get("occurred_at"),
      refs:subject.type?[{type:subject.type,id:subject.id}]:[]
    });
    return go("#/");
  }
  if(type==="media-edit"){
    var existingMedia=await DB.obter("media_items",Number(id));
    if(!existingMedia)return go("#/media");
    try{
      await HeadCoachMedia.update(id,{
        type:fd.get("type"),
        title:fd.get("title"),
        note:fd.get("note"),
        url:fd.get("url"),
      },{expectedUpdatedAt:fd.get("expected_updated_at")});
      await logHuman("updated_media","Editou media · "+fd.get("title"),"media",existingMedia.sync_id||id);
      return go(mediaSubjectHref(existingMedia));
    }catch(error){
      var mediaFeedback=form.querySelector("[data-media-feedback]");
      if(mediaFeedback){mediaFeedback.textContent=error.message;mediaFeedback.hidden=false;}
      else alert(error.message);
      return;
    }
  }
  if(type==="media"){
    var mediaSubject=splitSubject(fd.get("subject_key"));
    var file=fd.get("file");
    if(!mediaSubject.type){
      alert("Escolhe a entidade a que este media pertence.");
      return;
    }
    try{
      var mediaId;
      if(file&&file.size&&await RemoteWorkspace.canUpload()){
        mediaId=await RemoteWorkspace.uploadFileMedia(file,{
          subject_type:mediaSubject.type,
          subject_id:mediaSubject.id,
          type:fd.get("type"),
          title:fd.get("title"),
          note:fd.get("note")||null
        });
      }else{
        var dataUrl=file&&file.size?await fileToDataURL(file):null;
        mediaId=await HeadCoachMedia.create({
          team_id:DEFAULT_TEAM_ID,
          subject_type:mediaSubject.type,
          subject_id:mediaSubject.id,
          type:fd.get("type"),
          title:fd.get("title"),
          url:fd.get("url")||null,
          data_url:dataUrl,
          file_name:file&&file.size?file.name:null,
          mime_type:file&&file.size?file.type:null,
          size:file&&file.size?file.size:null,
          note:fd.get("note")||null
        });
      }
      await logHuman("added_media","Adicionou media · "+fd.get("title"),"media",mediaId);
      return go("#/media");
    }catch(error){
      alert(error.message);
      return;
    }
  }
});

async function exportBackup(){
  var payload=await DB.exportarTudo();
  var blob=new Blob([JSON.stringify(payload,null,2)],{type:"application/json"});
  var url=URL.createObjectURL(blob);
  var a=document.createElement("a");
  a.href=url;
  a.download="vision-coach-workspace-"+today()+".json";
  a.click();
  URL.revokeObjectURL(url);
  await logHuman("exported_backup","Exportou uma cópia de segurança","workspace",DEFAULT_TEAM_ID);
}
async function importBackup(file){
  if(!file) return;
  if(!confirm("Importar esta cópia substitui os dados atuais. Continuar?")) return;
  try{
    var payload=JSON.parse(await file.text());
    await DB.importarTudo(payload,true);
    alert("Backup importado.");
    return router();
  }catch(error){
    alert("Não foi possível importar: "+error.message);
  }
}
