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
function docTypeLabel(type){return WORKSPACE_DOC_LABELS[type]||"Documento";}
function docTypeShort(type){
  return {training_plan:"PT",match_analysis:"AJ",note:"N",brief:"B"}[type]||"D";
}

async function routeOnce(){
  var parts=(location.hash||"#/").slice(1).split("/").filter(Boolean);
  var root=parts[0]||"";
  markNav(root===""?"workspace":root);
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

RemoteWorkspace.init().then(function(client){
  if(!client) return;
  RemoteWorkspace.scheduleSync(600);
  window.addEventListener("online",function(){ RemoteWorkspace.scheduleSync(500); });
  client.auth.onAuthStateChange(function(event,session){
    refreshRemoteIndicator();
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
function activityHTML(rows,limit){
  limit=limit||6;
  var items=rows.slice(0,limit);
  if(!items.length) return '<div class="empty">Ainda sem atividade registada neste workspace.</div>';
  return '<div class="list">'+items.map(function(item){
    return '<div class="list-item row"><span class="grow"><span class="title">'+esc(item.summary||item.action)+'</span><span class="meta">'+fmtDate(item.created_at)+'</span></span>'+actorBadge(item.actor,item.actor_label)+'</div>';
  }).join("")+'</div>';
}

async function viewWorkspace(){
  var s=await WorkspaceStore.buildSnapshot();
  var remoteStatus=await RemoteWorkspace.status();
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
async function viewTeam(){
  var s=await WorkspaceStore.buildSnapshot();
  var team=s.team||{};
  var players=s.players.slice().sort(function(a,b){return String(a.nome).localeCompare(String(b.nome));});
  var playerCards=players.length?players.map(function(p){
    return '<a class="card player-card" href="#/equipa/jogador/'+p.id+'">'+avatarHTML(p)+'<span class="grow"><span class="title">'+esc(p.nome)+'</span><span class="meta">'+esc(p.posicao||p.escalao||"Jogador")+'</span></span></a>';
  }).join(""):'<div class="empty">Ainda não existem jogadores.</div>';
  var games=s.matches.slice().sort(function(a,b){return String(b.data).localeCompare(String(a.data));}).slice(0,8);
  var gameRows=games.length?games.map(function(m){
    return '<tr><td>'+fmtDate(m.data)+'</td><td><a class="link" href="#/equipa/jogo/'+m.id+'">'+esc(m.adversario||"Jogo")+'</a></td><td>'+esc(m.casa_fora==="fora"?"Fora":"Casa")+'</td><td>'+resultText(m)+'</td></tr>';
  }).join(""):'<tr><td colspan="4">Sem jogos registados.</td></tr>';
  var html='<div class="profile-grid">';
  html+='<section class="panel hero-main"><div class="kicker">Perfil da equipa</div><h2 class="display" style="font-size:28px">'+esc(team.nome||"Equipa")+'</h2><p class="lead">'+esc([team.clube,team.escalao,team.epoca,team.competicao,team.formato].filter(Boolean).join(" · ")||"Completa os dados base da equipa.")+'</p><div class="toolbar" style="margin-top:18px"><a class="btn secondary" href="#/equipa/editar">Editar equipa</a><a class="btn" href="#/equipa/jogador/novo">Adicionar jogador</a></div></section>';
  html+='<section class="panel hero-side"><div class="metric-label">Modelo de trabalho</div><p class="lead">A equipa é a fonte factual do workspace. O agente deve ler estes dados, nunca inventá-los.</p><div class="notice" style="margin-top:14px">A ligação externa do agente ainda não está ativa. Esta estrutura já está preparada para autoria separada.</div></section></div>';
  html+='<section class="section"><div class="section-head"><div><h2>Plantel</h2><p>'+players.length+' jogador(es)</p></div><a class="link" href="#/equipa/jogador/novo">Adicionar</a></div><div class="player-grid">'+playerCards+'</div></section>';
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
  var html='<section class="panel hero-main" style="max-width:760px"><form class="form" data-form="player" data-id="'+(id||"")+'">';
  html+='<div class="form-grid"><label class="field"><span>Nome</span><input name="nome" required value="'+esc(player&&player.nome)+'"></label><label class="field"><span>Número</span><input type="number" name="numero" min="1" value="'+esc(player&&player.numero!=null?player.numero:"")+'"></label></div>';
  html+='<div class="form-grid"><label class="field"><span>Escalão</span><select name="escalao">'+opts+'</select></label><label class="field"><span>Posição</span><input name="posicao" value="'+esc(player&&player.posicao)+'"></label></div>';
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
  var html='<div class="profile-grid">';
  html+='<section class="panel hero-main"><div class="row">'+avatarHTML(player,64)+'<div class="grow"><div class="kicker">Jogador</div><h2 class="display" style="font-size:28px">'+esc(player.nome)+'</h2><p class="lead">'+esc([player.escalao,player.posicao,player.numero?'#'+player.numero:null].filter(Boolean).join(" · "))+'</p></div></div><div class="toolbar" style="margin-top:18px"><a class="btn secondary" href="#/equipa/jogador/'+id+'/editar">Editar</a><a class="btn" href="#/capturar/player/'+id+'">Registar observação</a><a class="btn secondary" href="#/media/novo/player/'+id+'">Adicionar media</a></div></section>';
  html+='<aside class="panel hero-side"><div class="metric-label">Contexto</div><div class="metric-value">'+memory.length+'</div><div class="metric-sub">registos na memória</div><div class="metric-value" style="margin-top:18px">'+media.length+'</div><div class="metric-sub">itens de media</div></aside></div>';
  html+='<section class="section"><div class="section-head"><div><h2>Últimas observações</h2><p>Contexto usado pelo workspace</p></div></div>'+obs+'</section>';
  setView(player.nome,html,"Equipa");
}

async function viewMatchForm(id){
  var match=id?await DB.obter("jogos",id):null;
  var html='<section class="panel hero-main" style="max-width:760px"><form class="form" data-form="match" data-id="'+(id||"")+'">';
  html+='<div class="form-grid"><label class="field"><span>Data</span><input type="date" name="data" required value="'+esc(match&&match.data||today())+'"></label><label class="field"><span>Hora</span><input type="time" name="hora" value="'+esc(match&&match.hora)+'"></label></div>';
  html+='<label class="field"><span>Adversário</span><input name="adversario" required value="'+esc(match&&match.adversario)+'"></label>';
  html+='<div class="form-grid"><label class="field"><span>Casa / Fora</span><select name="casa_fora"><option value="casa" '+(!(match&&match.casa_fora==="fora")?"selected":"")+'>Casa</option><option value="fora" '+(match&&match.casa_fora==="fora"?"selected":"")+'>Fora</option></select></label><label class="field"><span>Local</span><input name="local" value="'+esc(match&&match.local)+'"></label></div>';
  html+='<div class="form-grid"><label class="field"><span>Golos a favor</span><input type="number" min="0" name="golos_favor" value="'+esc(match&&match.golos_favor!=null?match.golos_favor:"")+'"></label><label class="field"><span>Golos contra</span><input type="number" min="0" name="golos_contra" value="'+esc(match&&match.golos_contra!=null?match.golos_contra:"")+'"></label></div>';
  html+='<label class="field"><span>Notas</span><textarea name="notas">'+esc(match&&match.notas)+'</textarea></label>';
  html+='<div class="toolbar"><button class="btn accent" type="submit">Guardar jogo</button><a class="btn secondary" href="'+(id?'#/equipa/jogo/'+id:'#/equipa')+'">Cancelar</a></div></form></section>';
  setView(id?"Editar jogo":"Novo jogo",html,"Equipa");
}
async function viewMatch(id){
  var match=await DB.obter("jogos",id);
  if(!match) return go("#/equipa");
  var memory=await HeadCoachMemory.list(DEFAULT_TEAM_ID,{subjectType:"match",subjectId:id});
  var media=await HeadCoachMedia.listForSubject("match",id);
  var context=memory.length?'<div class="list">'+memory.map(function(m){
    return '<div class="list-item"><div class="title">'+esc(m.title)+'</div><div class="body-copy">'+esc(m.content)+'</div></div>';
  }).join("")+'</div>':'<div class="empty">Ainda sem observações associadas.</div>';
  var html='<div class="profile-grid">';
  html+='<section class="panel hero-main"><div class="kicker">'+esc(match.casa_fora==="fora"?"Fora":"Casa")+' · '+fmtDate(match.data)+'</div><h2 class="display">'+esc(match.adversario)+'</h2><div class="metric-value" style="margin-top:18px">'+resultText(match)+'</div><p class="lead">'+esc(match.local||"")+(match.notas?' · '+esc(match.notas):'')+'</p><div class="toolbar" style="margin-top:18px"><a class="btn secondary" href="#/equipa/jogo/'+id+'/editar">Editar</a><a class="btn" href="#/capturar/match/'+id+'">Observação</a><a class="btn secondary" href="#/media/novo/match/'+id+'">Media</a></div></section>';
  html+='<aside class="panel hero-side"><div class="metric-label">Contexto associado</div><div class="metric-value">'+memory.length+'</div><div class="metric-sub">observações / decisões</div><div class="metric-value" style="margin-top:18px">'+media.length+'</div><div class="metric-sub">itens de media</div></aside></div>';
  html+='<section class="section"><div class="section-head"><div><h2>Contexto do jogo</h2><p>Informação disponível ao workspace</p></div></div>'+context+'</section>';
  setView("Jogo vs "+match.adversario,html,"Equipa");
}
async function viewDocuments(){
  var docs=await WorkspaceStore.listDocuments();
  var cards=docs.length?docs.map(documentCard).join(""):'<div class="empty">Ainda não existem planos ou análises. Cria o primeiro documento partilhado.</div>';
  setView("Planos",'<div class="section-head"><div><h2>Documentos de trabalho</h2><p>Planos, análises, notas e briefings partilhados</p></div><a class="btn accent" href="#/planos/novo">Novo documento</a></div><div class="grid cols-2">'+cards+'</div>',"Planos");
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
    WorkspaceStore.listDocuments()
  ]);
  var selected=selectedType&&selectedId?selectedType+":"+selectedId:"";
  var options=['<option value="">Sem associação específica</option>'];
  data[0].forEach(function(x){options.push('<option value="player:'+x.id+'">Jogador · '+esc(x.nome)+'</option>');});
  data[1].forEach(function(x){options.push('<option value="match:'+x.id+'">Jogo · '+fmtDate(x.data)+' · '+esc(x.adversario)+'</option>');});
  data[2].forEach(function(x){options.push('<option value="training:'+x.id+'">Treino · '+fmtDate(x.data)+'</option>');});
  data[4].forEach(function(x){options.push('<option value="document:'+x.id+'">Documento · '+esc(x.title)+'</option>');});
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
  return {activity:"Atividade",document:"Documento",memory:"Memória",match:"Jogo",training:"Treino"}[row.type]||row.type;
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
    html+='<button class="btn accent" type="button" data-action="remote-sync">Sincronizar agora</button>';
    html+='<div class="hint">ID remoto: '+esc(status.remoteTeamId)+'</div>';
    if(status.lastSyncAt) html+='<div class="hint">Última sincronização: '+esc(new Date(status.lastSyncAt).toLocaleString("pt-PT"))+'</div>';
  }
  html+='<button class="link" type="button" data-action="remote-logout">Terminar sessão</button></div>';
  return html;
}
async function viewSettings(){
  var s=await WorkspaceStore.buildSnapshot();
  var status=await RemoteWorkspace.status();
  var config=RemoteWorkspace.getConfig();
  var teams=[], remoteError="";
  if(status.signedIn){
    try{ teams=await RemoteWorkspace.listTeams(); }catch(error){ remoteError=error.message; }
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

app.addEventListener("click",async function(event){
  var target=event.target.closest("[data-action]");
  if(!target) return;
  var action=target.dataset.action;
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

  if(type==="team"){
    await HeadCoachMemory.saveTeam({
      id:DEFAULT_TEAM_ID,
      nome:fd.get("nome"),
      clube:fd.get("clube")||null,
      escalao:fd.get("escalao")||null,
      epoca:fd.get("epoca")||null,
      competicao:fd.get("competicao")||null,
      formato:fd.get("formato")||null,
      horarios:fd.get("horarios")?{texto:fd.get("horarios")}:null
    });
    await logHuman("updated_team","Atualizou o perfil da equipa","team",DEFAULT_TEAM_ID);
    return go("#/equipa");
  }
  if(type==="player"){
    var playerId=await saveRecord("jogadores",id,{
      team_id:DEFAULT_TEAM_ID,
      nome:fd.get("nome"),
      numero:numberOrNull(fd.get("numero")),
      escalao:fd.get("escalao")||null,
      posicao:fd.get("posicao")||null,
      notas:fd.get("notas")||null
    });
    await logHuman(id?"updated_player":"created_player",(id?"Atualizou jogador · ":"Adicionou jogador · ")+fd.get("nome"),"player",playerId);
    return go("#/equipa/jogador/"+playerId);
  }
  if(type==="match"){
    var team=await HeadCoachMemory.ensureTeam();
    var matchId=await saveRecord("jogos",id,{
      team_id:DEFAULT_TEAM_ID,
      data:fd.get("data"),
      hora:fd.get("hora")||null,
      escalao:team.escalao||null,
      adversario:fd.get("adversario"),
      casa_fora:fd.get("casa_fora"),
      local:fd.get("local")||null,
      golos_favor:numberOrNull(fd.get("golos_favor")),
      golos_contra:numberOrNull(fd.get("golos_contra")),
      notas:fd.get("notas")||null
    });
    await logHuman(id?"updated_match":"created_match",(id?"Atualizou jogo · ":"Criou jogo · ")+fd.get("adversario"),"match",matchId);
    return go("#/equipa/jogo/"+matchId);
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
