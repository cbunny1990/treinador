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
function today(){return new Date().toISOString().slice(0,10);}
function go(hash){location.hash=hash;}
function setView(title,html,eyebrow){
  titleEl.textContent=title;
  eyebrowEl.textContent=eyebrow||"Workspace";
  app.innerHTML=html;
  window.scrollTo(0,0);
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
      remoteDetailEl.textContent = status.lastSyncAt ? "Sincronizado " + fmtDate(status.lastSyncAt) : "Pronto para sincronizar";
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
function resultText(match){
  if(match && (match.golos_favor==null || match.golos_contra==null)) return "Por jogar";
  return String(match.golos_favor)+"–"+String(match.golos_contra);
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
  return {training_plan:"PT",match_analysis:"AJ",note:"N",brief:"B"}[type]||"D";
}

async function routeOnce(){
  var parts=(location.hash||"#/").slice(1).split("/").filter(Boolean);
  var root=parts[0]||"";
  var navRoot=(root==="treinos"||root==="exercicios")?"planos":(root===""?"workspace":root);
  markNav(navRoot);
  try{
    if(!root) return viewWorkspace();
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
    if(root==="treinos"){
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
      return viewDocuments();
    }
    if(root==="media"){
      if(parts[1]==="novo") return viewMediaForm(parts[2],parts[3]);
      return viewMedia();
    }
    if(root==="timeline") return viewTimeline();
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
async function router(){
  if(routerRunning){
    routerQueued=true;
    return;
  }
  routerRunning=true;
  try{
    do{
      routerQueued=false;
      await routeOnce();
    }while(routerQueued);
  }finally{
    routerRunning=false;
  }
}

quickCapture && quickCapture.addEventListener("click",function(){go("#/capturar");});
window.addEventListener("hashchange",router);
window.addEventListener("DOMContentLoaded",router);
if(document.readyState!=="loading") router();

window.addEventListener("visioncoach:sync-complete",async function(){
  refreshRemoteIndicator();
  if(app.querySelector('form[data-form]')) return;
  var scrollX=window.scrollX;
  var scrollY=window.scrollY;
  await router();
  requestAnimationFrame(function(){ window.scrollTo(scrollX,scrollY); });
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
      setTimeout(function(){ RemoteWorkspace.scheduleSync(0); },0);
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
    rows.push('<div class="list-item row"><div class="grow"><div class="title">Treino '+esc(t.escalao||"")+'</div><div class="meta">'+fmtDate(t.data)+(t.hora?' · '+esc(t.hora):'')+'</div></div><span class="badge">Sessão</span></div>');
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
  return '<a class="card doc-card" href="#/planos/'+doc.id+'"><span class="doc-type">'+docTypeShort(doc.type)+'</span><span class="grow"><span class="row"><span class="title grow">'+esc(doc.title)+'</span>'+docStatusBadge(doc.status)+'</span><span class="meta">'+esc(docTypeLabel(doc.type))+(doc.target_date?' · '+fmtDate(doc.target_date):'')+'</span><span class="meta">'+esc(doc.created_by_label||HUMAN_LABEL)+'</span></span></a>';
}
async function refreshRemoteWorkspace(){
  try{
    var status=await RemoteWorkspace.status();
    if(navigator.onLine && status.signedIn && status.remoteTeamId){
      await RemoteWorkspace.syncNow();
      return await RemoteWorkspace.status();
    }
    return status;
  }catch(error){
    console.warn("Sincronização automática adiada:",error.message);
    try{return await RemoteWorkspace.status();}catch(_){return {signedIn:false,remoteTeamId:null};}
  }
}

function activityHTML(rows,limit){
  limit=limit||6;
  var items=rows.slice(0,limit);
  if(!items.length) return '<div class="empty">Ainda sem atividade registada neste workspace.</div>';
  return '<div class="list">'+items.map(function(item){
    return '<div class="list-item row"><span class="grow"><span class="title">'+esc(item.summary||item.action)+'</span><span class="meta">'+fmtDate(item.created_at)+'</span></span>'+actorBadge(item.actor,item.actor_label)+'</div>';
  }).join("")+'</div>';
}

async function viewWorkspace(){
  var remoteStatus=await refreshRemoteWorkspace();
  var s=await WorkspaceStore.buildSnapshot();
  var teamName=(s.team&&s.team.nome)||"Equipa";
  var context=[s.team&&s.team.clube,s.team&&s.team.escalao,s.team&&s.team.epoca].filter(Boolean).join(" · ");
  var recentDocs=s.recent_documents.length?s.recent_documents.map(documentCard).join(""):'<div class="empty">Ainda não existem planos ou análises partilhadas.</div>';
  var remoteReady=!!(remoteStatus.signedIn&&remoteStatus.remoteTeamId);
  var remoteLabel=remoteReady
    ? (remoteStatus.lastSyncAt ? "Workspace remoto ligado · última sincronização "+fmtDate(remoteStatus.lastSyncAt) : "Workspace remoto ligado · pronto para sincronizar")
    : "Modo local ativo · configura a ligação remota nas Definições";
  var html='';
  html+='<div class="hero">';
  html+='<section class="panel hero-main"><div class="kicker">Human–AI Shared Workspace</div><h2 class="display">O estado da equipa, num único lugar.</h2>';
  html+='<p class="lead">'+esc(context||"Configura a equipa para começar.")+' Dados, planos, media e decisões ficam disponíveis no mesmo workspace para treinador e agente.</p>';
  html+='<div class="toolbar" style="margin-top:18px"><a class="btn accent" href="#/capturar">Registar observação</a><a class="btn secondary" href="#/planos/novo">Novo plano</a><a class="btn secondary" href="#/media/novo">Adicionar media</a></div>';
  html+='<div class="workspace-status '+(remoteReady?"connected":"")+'"><span class="dot"></span>'+esc(remoteLabel)+'</div></section>';
  html+='<aside class="panel hero-side"><div class="section-head"><div><h2>Próximos</h2><p>Agenda operacional</p></div></div>'+nextEventHTML(s)+'</aside></div>';
  html+='<div class="grid cols-4">';
  html+='<div class="panel metric"><div class="metric-label">Plantel</div><div class="metric-value">'+s.players.length+'</div><div class="metric-sub">jogadores</div></div>';
  html+='<div class="panel metric"><div class="metric-label">Planos</div><div class="metric-value">'+s.documents.length+'</div><div class="metric-sub">documentos ativos</div></div>';
  html+='<div class="panel metric"><div class="metric-label">Media</div><div class="metric-value">'+s.media.length+'</div><div class="metric-sub">ficheiros e links</div></div>';
  html+='<div class="panel metric"><div class="metric-label">Memória</div><div class="metric-value">'+s.memory.length+'</div><div class="metric-sub">registos operacionais</div></div></div>';
  html+='<section class="section"><div class="section-head"><div><h2>Prioridades atuais</h2><p>Foco confirmado para a equipa</p></div><a class="link" href="#/capturar">Adicionar contexto</a></div>'+priorityHTML(s.priorities)+'</section>';
  html+='<div class="grid cols-2 section"><section><div class="section-head"><div><h2>Planos recentes</h2><p>Produzidos pelo treinador ou agente</p></div><a class="link" href="#/planos">Ver todos</a></div><div class="list">'+recentDocs+'</div></section>';
  html+='<section><div class="section-head"><div><h2>Atividade partilhada</h2><p>Quem fez o quê</p></div><a class="link" href="#/timeline">Timeline</a></div>'+activityHTML(s.recent_activity)+'</section></div>';
  setView(teamName,html,"Workspace");
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
  return '<div class="list-item row calendar-row"><span class="calendar-kind training">T</span><span class="grow"><span class="title">'+esc(label)+'</span><span class="meta">'+meta+'</span></span>'+(event.planned?'<span class="badge draft">Horário</span>':'<span class="badge ready">Registado</span>')+'</div>';
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
  var allPlayers=(await DB.porIndice("jogadores","team_id",DEFAULT_TEAM_ID)).slice().sort(function(a,b){return String(a.nome).localeCompare(String(b.nome));});
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
  var games=s.matches.slice().sort(function(a,b){return String(b.data).localeCompare(String(a.data));}).slice(0,8);
  var gameRows=games.length?games.map(function(m){
    return '<tr><td>'+fmtDate(m.data)+'</td><td><a class="link" href="#/equipa/jogo/'+m.id+'">'+esc(m.adversario||"Jogo")+'</a></td><td>'+esc(m.casa_fora==="fora"?"Fora":"Casa")+'</td><td>'+resultText(m)+'</td></tr>';
  }).join(""):'<tr><td colspan="4">Sem jogos registados.</td></tr>';
  var html='<div class="profile-grid">';
  html+='<section class="panel hero-main"><div class="kicker">Perfil da equipa</div><h2 class="display" style="font-size:28px">'+esc(team.nome||"Equipa")+'</h2><p class="lead">'+esc([team.clube,team.escalao,team.epoca,team.competicao,team.formato].filter(Boolean).join(" · ")||"Completa os dados base da equipa.")+'</p><div class="toolbar" style="margin-top:18px"><a class="btn secondary" href="#/equipa/editar">Editar equipa</a><a class="btn" href="#/equipa/jogador/novo">Adicionar jogador</a></div></section>';
  html+='<section class="panel hero-side"><div class="metric-label">Modelo de trabalho</div><p class="lead">A equipa é a fonte factual do workspace. O agente deve ler estes dados, nunca inventá-los.</p><div class="notice" style="margin-top:14px">A ligação externa do agente ainda não está ativa. Esta estrutura já está preparada para autoria separada.</div></section></div>';
  html+='<section class="section"><div class="section-head"><div><h2>Plantel</h2><p>'+players.length+' jogador(es) · '+availableCount+' disponível(eis) · '+(players.length-availableCount)+' não disponível(eis)</p></div><a class="link" href="#/equipa/jogador/novo">Adicionar</a></div><div class="player-grid">'+playerCards+'</div></section>';
  if(retiredPlayers.length) html+='<section class="section"><div class="section-head"><div><h2>Fora do plantel</h2><p>'+retiredPlayers.length+' jogador(es) retirado(s)</p></div></div><div class="player-grid">'+retiredCards+'</div></section>';
  html+='<section class="section"><div class="section-head"><div><h2>Jogos</h2><p>Calendário e resultados</p></div><a class="btn small" href="#/equipa/jogo/novo">Novo jogo</a></div><div class="table-wrap"><table><thead><tr><th>Data</th><th>Adversário</th><th>Local</th><th>Resultado</th></tr></thead><tbody>'+gameRows+'</tbody></table></div></section>';
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
async function viewPlayer(id){
  var player=await DB.obter("jogadores",id);
  if(!player) return go("#/equipa");
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
  html+='<section class="panel hero-main"><div class="row">'+avatarHTML(player,64)+'<div class="grow"><div class="kicker">Jogador</div><h2 class="display" style="font-size:28px">'+esc(player.nome)+'</h2><p class="lead">'+esc([player.escalao,player.posicao,player.numero?'#'+player.numero:null].filter(Boolean).join(" · "))+'</p>'+playerBadge+'</div></div><div class="toolbar" style="margin-top:18px"><a class="btn secondary" href="#/equipa/jogador/'+id+'/editar">Editar</a><a class="btn" href="#/capturar/player/'+id+'">Registar observação</a><a class="btn secondary" href="#/media/novo/player/'+id+'">Adicionar media</a>'+rosterButton+deleteButton+'</div></section>';
  html+='<aside class="panel hero-side"><div class="metric-label">Contexto</div><div class="metric-value">'+memory.length+'</div><div class="metric-sub">registos na memória</div><div class="metric-value" style="margin-top:18px">'+media.length+'</div><div class="metric-sub">itens de media</div></aside></div>';
  html+='<section class="section"><div class="section-head"><div><h2>Últimas observações</h2><p>Contexto usado pelo workspace</p></div></div>'+obs+'</section>';
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
  var availablePlayers=players.filter(function(p){return PlayerStatus.isAvailable(p);});
  var memory=await HeadCoachMemory.list(DEFAULT_TEAM_ID,{subjectType:"match",subjectId:id});
  var media=await HeadCoachMedia.listForSubject("match",id);
  var progress=VisionCalendar.matchProgress(match);
  var called=new Set(match.callup.player_ids.map(String));
  var unavailableCalled=players.filter(function(p){return called.has(stablePlayerRef(p))&&!PlayerStatus.isAvailable(p);});
  var retiredCalled=allPlayers.filter(function(p){return !PlayerStatus.inRoster(p)&&called.has(stablePlayerRef(p));});
  var lineupPlayers=called.size?availablePlayers.filter(function(p){return called.has(stablePlayerRef(p));}):availablePlayers;
  var keeperOptions='<option value="">Por definir</option>'+lineupPlayers.map(function(p){var ref=stablePlayerRef(p);return '<option value="'+esc(ref)+'" '+(String(match.lineup.goalkeeper_id||"")===ref?"selected":"")+'>'+esc(p.nome)+'</option>';}).join("");
  var context=memory.length?'<div class="list">'+memory.map(function(m){return '<div class="list-item"><div class="title">'+esc(m.title)+'</div><div class="body-copy">'+esc(m.content)+'</div></div>';}).join("")+'</div>':'<div class="empty">Ainda sem observações associadas.</div>';
  var html='<div class="profile-grid"><section class="panel hero-main"><div class="kicker">'+esc(match.casa_fora==="fora"?"Fora":"Casa")+' · '+fmtDate(match.data)+(match.hora?' · '+esc(match.hora):'')+'</div><h2 class="display">'+esc(match.adversario)+'</h2><div class="metric-value" style="margin-top:18px">'+resultText(match)+'</div><p class="lead">'+esc(match.local||"Local por definir")+(match.hora_saida?' · saída '+esc(match.hora_saida):'')+'</p><div class="toolbar" style="margin-top:18px"><a class="btn secondary" href="#/equipa/jogo/'+id+'/editar">Editar dados</a><a class="btn" href="#/capturar/match/'+id+'">Observação</a><a class="btn secondary" href="#/media/novo/match/'+id+'">Media</a></div></section>';
  html+='<aside class="panel hero-side"><div class="metric-label">Preparação</div><div class="match-progress"><span class="'+(progress.pre_game?"done":"")+'">Plano</span><span class="'+(progress.callup?"done":"")+'">Convocados</span><span class="'+(progress.lineup?"done":"")+'">5v5</span><span class="'+(progress.post_game?"done":"")+'">Análise</span></div><div class="meta" style="margin-top:16px">'+memory.length+' observações · '+media.length+' media</div></aside></div>';
  html+='<div class="match-stage-nav"><button type="button" data-action="jump-match" data-target="match-before">Antes</button><button type="button" data-action="jump-match" data-target="match-during">Durante</button><button type="button" data-action="jump-match" data-target="match-after">Depois</button></div>';
  html+='<section class="section match-stage" id="match-before"><div class="section-head"><div><h2>Antes do jogo</h2><p>Plano, convocatória e alinhamento</p></div></div><div class="grid cols-2">';
  html+='<form class="panel match-form form" data-form="match-pre" data-id="'+id+'"><h3>Plano pré-jogo</h3><label class="field"><span>Objetivo principal</span><input name="objetivo_principal" value="'+esc(match.pre_game.objetivo_principal)+'"></label><label class="field"><span>Plano de jogo</span><textarea name="plano_jogo">'+esc(match.pre_game.plano_jogo)+'</textarea></label><label class="field"><span>Notas do adversário</span><textarea name="adversario_notas">'+esc(match.pre_game.adversario_notas)+'</textarea></label><label class="field"><span>Pontos a observar · um por linha</span><textarea name="pontos_observar">'+esc(linesText(match.pre_game.pontos_observar))+'</textarea></label><button class="btn accent" type="submit">Guardar plano</button></form>';
  html+='<form class="panel match-form form" data-form="match-callup" data-id="'+id+'"><h3>Convocatória</h3>'+(retiredCalled.length?'<div class="notice">Histórico: '+retiredCalled.map(function(p){return esc(p.nome);}).join(", ")+' já não pertence ao plantel atual.</div>':'')+(unavailableCalled.length?'<div class="notice">'+unavailableCalled.map(function(p){return esc(p.nome)+" · "+esc(PlayerStatus.label(p.estado_disponibilidade));}).join("<br>")+'<br>Estes jogadores deixaram de estar disponíveis e serão retirados ao guardar a convocatória.</div>':'')+'<div class="player-choice-grid">'+playerChecks(players,match.callup.player_ids,"player_ids")+'</div><label class="field"><span>Notas</span><textarea name="notes">'+esc(match.callup.notes)+'</textarea></label><button class="btn accent" type="submit">Guardar convocatória</button></form></div>';
  html+='<form class="panel match-form form section" data-form="match-lineup" data-id="'+id+'"><div class="section-head"><div><h2>Alinhamento 5v5</h2><p>Base 1-2-1 · guarda-redes + 4 jogadores de campo</p></div></div><div class="form-grid"><label class="field"><span>Sistema</span><select name="system"><option value="1-2-1" selected>1-2-1</option></select></label><label class="field"><span>Guarda-redes</span><select name="goalkeeper_id">'+keeperOptions+'</select></label></div><div class="field"><span>Titulares de campo · máximo 4</span><div class="player-choice-grid">'+playerChecks(lineupPlayers,match.lineup.starters,"starter_ids")+'</div></div><button class="btn accent" type="submit">Guardar alinhamento</button></form></section>';
  html+='<section class="section match-stage" id="match-during"><div class="section-head"><div><h2>Durante</h2><p>Registo simples, sem distrair do jogo</p></div></div><form class="panel match-form form" data-form="match-during" data-id="'+id+'"><label class="field"><span>Resultado ao intervalo</span><input name="halftime_score" placeholder="Ex.: 2-1" value="'+esc(match.during.halftime_score)+'"></label><label class="field"><span>Notas rápidas · uma por linha</span><textarea name="notes">'+esc(linesText(match.during.notes))+'</textarea></label><button class="btn accent" type="submit">Guardar durante</button></form></section>';
  html+='<section class="section match-stage" id="match-after"><div class="section-head"><div><h2>Depois</h2><p>Aprendizagem e ligação ao próximo treino</p></div></div><form class="panel match-form form" data-form="match-post" data-id="'+id+'"><div class="form-grid"><label class="field"><span>O que correu bem</span><textarea name="correu_bem">'+esc(match.post_game.correu_bem)+'</textarea></label><label class="field"><span>O que melhorar</span><textarea name="melhorar">'+esc(match.post_game.melhorar)+'</textarea></label></div><label class="field"><span>Conclusões</span><textarea name="conclusoes">'+esc(match.post_game.conclusoes)+'</textarea></label><label class="field"><span>Ações para o próximo treino · uma por linha</span><textarea name="acoes">'+esc(linesText(match.post_game.acoes_proximo_treino))+'</textarea></label><button class="btn accent" type="submit">Guardar análise</button></form>';
  html+='<div class="grid cols-2 section"><div><div class="section-head"><div><h2>Contexto associado</h2><p>Observações e decisões</p></div></div>'+context+'</div><div><div class="section-head"><div><h2>Media</h2><p>'+media.length+' item(ns)</p></div></div>'+renderMediaCards(media)+'</div></div></section>';
  setView("Jogo vs "+match.adversario,html,"Jogo");
}
async function viewDocuments(){
  await refreshRemoteWorkspace();
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
    return '<article class="panel media-card">'+mediaPreview(item)+'<div class="media-info"><div class="row"><div class="grow"><div class="title">'+esc(item.title)+'</div><div class="meta">'+esc(item.note||item.file_name||"Media")+'</div></div><button class="link" data-action="delete-media" data-id="'+item.id+'">Remover</button></div><a class="link" href="'+esc(href)+'" '+attrs+'>Abrir</a></div></article>';
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
  html+='<div class="toolbar" style="margin-top:18px"><a class="btn" href="#/planos/'+id+'/editar">Editar</a><a class="btn secondary" href="#/media/novo/document/'+id+'">Associar media</a><button class="btn danger" data-action="archive-document" data-id="'+id+'">Arquivar</button></div></section>';
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
async function viewMediaForm(subjectType,subjectId){
  var options=await subjectOptions(subjectType,subjectId);
  var html='<section class="panel hero-main" style="max-width:760px"><form class="form" data-form="media">';
  html+='<label class="field"><span>Associar a</span><select name="subject_key">'+options+'</select></label>';
  html+='<div class="form-grid"><label class="field"><span>Tipo</span><select name="type"><option value="photo">Fotografia</option><option value="video">Vídeo</option><option value="file">Ficheiro</option></select></label><label class="field"><span>Título</span><input name="title" required></label></div>';
  html+='<label class="field"><span>Link externo</span><input name="url" type="url" placeholder="https://..."><small class="hint">Usa links para vídeos grandes.</small></label>';
  html+='<label class="field"><span>Ou ficheiro local</span><input name="file" type="file"><small class="hint">Sem backend remoto: até 5 MB no dispositivo. Com remoto ligado, ficheiros maiores seguem diretamente para Storage privado.</small></label>';
  html+='<label class="field"><span>Nota / contexto</span><textarea name="note"></textarea></label>';
  html+='<div class="toolbar"><button class="btn accent" type="submit">Guardar media</button><a class="btn secondary" href="#/media">Cancelar</a></div></form></section>';
  setView("Adicionar media",html,"Media");
}

function timelineLabel(row){
  return {activity:"Atividade",document:"Documento",memory:"Memória",match:"Jogo",training:"Treino",exercise:"Exercício"}[row.type]||row.type;
}
async function viewTimeline(){
  var s=await WorkspaceStore.buildSnapshot();
  var rows=s.timeline.length?s.timeline.map(function(row){
    return '<div class="timeline-item"><span class="timeline-dot"></span><div class="card"><div class="row"><span class="badge">'+esc(timelineLabel(row))+'</span><span class="grow"></span>'+actorBadge(row.actor,row.actor_label)+'</div><div class="title" style="margin-top:9px">'+esc(row.title)+'</div><div class="meta">'+fmtDate(row.date)+'</div></div></div>';
  }).join(""):'<div class="empty">Ainda não existe histórico.</div>';
  setView("Timeline",'<div class="section-head"><div><h2>Histórico do workspace</h2><p>Dados, decisões e alterações num único fluxo</p></div><a class="btn secondary" href="#/capturar">Registar observação</a></div><div class="timeline">'+rows+'</div>',"Timeline");
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
    html+='<button class="btn accent" type="button" data-action="remote-sync">Sincronizar agora</button>';
    html+='<div class="hint">ID remoto: '+esc(status.remoteTeamId)+'</div>';
    if(status.lastSyncAt) html+='<div class="hint">Última sincronização: '+esc(new Date(status.lastSyncAt).toLocaleString("pt-PT"))+'</div>';
    if(status.conflicts&&status.conflicts.length) html+='<div class="notice" style="margin-top:12px">'+status.conflicts.length+' conflito(s) aguardam revisão. Nenhum dado foi sobrescrito.</div>';
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
    if(match.estado==="concluido") continue;
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
      await DB.atualizar("jogos",match);
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
  if(action==="jump-match"){
    var section=document.getElementById(target.dataset.target);
    if(section) section.scrollIntoView({behavior:"smooth",block:"start"});
    return;
  }
  if(action==="archive-document"){
    if(!confirm("Arquivar este documento?")) return;
    await WorkspaceStore.archiveDocument(target.dataset.id,"human");
    return go("#/planos");
  }
  if(action==="delete-media"){
    if(!confirm("Remover este item de media?")) return;
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
    await RemoteWorkspace.useTeam(select.value);
    return router();
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
  if(event.target.dataset.action==="import-backup") await importBackup(event.target.files[0]);
});

app.addEventListener("submit",async function(event){
  var form=event.target.closest("form[data-form]");
  if(!form) return;
  event.preventDefault();
  var fd=new FormData(form);
  var type=form.dataset.form;
  var id=form.dataset.id?Number(form.dataset.id):null;
  function numberOrNull(v){return v===""||v==null?null:Number(v);}

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
      if(await RemoteWorkspace.canUpload()){
        await RemoteWorkspace.uploadFileMedia(photoFile,{
          subject_type:"player",
          subject_id:playerId,
          type:"photo",
          title:"Foto · "+fd.get("nome"),
          note:"Foto de perfil do atleta"
        });
      }else{
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
  if(type==="match"){
    var team=await HeadCoachMemory.ensureTeam();
    var existing=matchStructure(id?await DB.obter("jogos",id):null);
    var externalKey=existing.external_key||("match:"+fd.get("data")+":"+String(fd.get("adversario")||"").toLowerCase());
    var matchId=await saveRecord("jogos",id,{
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
    });
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
      pontos_observar:linesFromText(fd.get("pontos_observar"))
    };
    await DB.atualizar("jogos",preMatch);
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
    await DB.atualizar("jogos",callMatch);
    await logHuman("updated_match_callup","Atualizou convocatória · "+callMatch.adversario,"match",id);
    return router();
  }
  if(type==="match-lineup"){
    var lineMatch=matchStructure(await DB.obter("jogos",id));
    var starters=fd.getAll("starter_ids").map(String);
    var keeper=String(fd.get("goalkeeper_id")||"");
    starters=starters.filter(function(ref){return ref!==keeper;});
    if(starters.length>4){alert("No 5v5 escolhe no máximo 4 jogadores de campo.");return;}
    var pool=lineMatch.callup.player_ids.length?lineMatch.callup.player_ids.map(String):[];
    var substitutes=pool.filter(function(ref){return ref!==keeper&&!starters.includes(ref);});
    lineMatch.lineup={status:(keeper&&starters.length===4)?"ready":"draft",system:fd.get("system")||"1-2-1",goalkeeper_id:keeper||null,starters:starters,substitutes:substitutes};
    await DB.atualizar("jogos",lineMatch);
    await logHuman("updated_match_lineup","Atualizou alinhamento 5v5 · "+lineMatch.adversario,"match",id);
    return router();
  }
  if(type==="match-during"){
    var liveMatch=matchStructure(await DB.obter("jogos",id));
    liveMatch.during={...liveMatch.during,halftime_score:fd.get("halftime_score")||null,notes:linesFromText(fd.get("notes"))};
    await DB.atualizar("jogos",liveMatch);
    await logHuman("updated_match_during","Atualizou registo durante o jogo · "+liveMatch.adversario,"match",id);
    return router();
  }
  if(type==="match-post"){
    var postMatch=matchStructure(await DB.obter("jogos",id));
    postMatch.post_game={status:"done",correu_bem:fd.get("correu_bem")||null,melhorar:fd.get("melhorar")||null,conclusoes:fd.get("conclusoes")||null,acoes_proximo_treino:linesFromText(fd.get("acoes"))};
    await DB.atualizar("jogos",postMatch);
    await logHuman("updated_match_post_game","Atualizou análise pós-jogo · "+postMatch.adversario,"match",id);
    return router();
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
