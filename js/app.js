"use strict";

// ---------- constantes (espelham o backend) ----------
const CATEGORIAS = [
  "Coordenação / motricidade", "Domínio e condução de bola", "Passe e receção",
  "Remate / finalização", "Jogos reduzidos (SSG)", "Jogo final", "Jogos lúdicos",
  "Guarda-redes",
];
const POSICOES = ["Guarda-redes", "Defesa", "Médio", "Avançado"];
const PES = ["Direito", "Esquerdo", "Ambos"];
const ESTADOS = [["presente", "P", "p"], ["ausente", "A", "a"]];
const FASES = ["Aquecimento", "Técnica", "Jogo reduzido", "Jogo final"];
const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const DIAS_SEMANA = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

// ---------- utilidades ----------
const app = document.getElementById("app");
const elTitulo = document.getElementById("titulo");
function esc(s) {
  return (s == null ? "" : String(s)).replace(/[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function setView(titulo, html) {
  elTitulo.textContent = titulo;
  app.innerHTML = html;
  window.scrollTo(0, 0);
}
function go(hash) { location.hash = hash; }
function fmtData(iso) {
  if (!iso) return "";
  const [a, m, d] = iso.split("-");
  return `${d}/${m}/${a}`;
}
const state = { fj: null, fcat: null, fesc: null, fmem: null }; // filtros

// Foto do jogador: reduz a 256px e guarda como dataURL JPEG no próprio registo do jogador
// (sem store novo, sem migração). ~15 KB cada; entra no backup exportado.
function fotoRedimensionar(file, max = 256) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const escala = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * escala);
      c.height = Math.round(img.height * escala);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL("image/jpeg", 0.72));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("imagem inválida")); };
    img.src = url;
  });
}
// Avatar: foto se existir, senão número/inicial (como era antes).
function avatarHTML(j, px) {
  const st = px ? ` style="width:${px}px;height:${px}px;font-size:${Math.round(px * 0.36)}px"` : "";
  if (j && j.foto) return `<span class="avatar"${st}><img src="${esc(j.foto)}" alt=""></span>`;
  const ini = j && j.numero != null ? j.numero : ((j && j.nome && j.nome[0]) || "?").toUpperCase();
  return `<span class="avatar"${st}>${esc(ini)}</span>`;
}

function ficheiroDataURL(file, maxBytes = 5 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    if (!file || !file.size) return resolve(null);
    if (file.size > maxBytes) return reject(new Error("O ficheiro local excede 5 MB. Para vídeos grandes, usa um link."));
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Não foi possível ler o ficheiro."));
    reader.readAsDataURL(file);
  });
}
function subjectHref(type, id) {
  return type === "player" ? "#/jogadores/" + id : type === "training" ? "#/treinos/" + id :
    type === "match" ? "#/jogos/" + id : type === "memory" ? "#/head-coach/memoria/" + id : "#/head-coach";
}
function mediaIcon(type) { return type === "photo" ? "📷" : type === "video" ? "🎥" : "📎"; }
async function renderMediaSection(subjectType, subjectId) {
  const items = await HeadCoachMedia.listForSubject(subjectType, subjectId);
  const rows = items.length ? items.map((m) => {
    const href = m.data_url || m.url;
    const preview = m.type === "photo" && href ? `<img src="${esc(href)}" alt="" class="media-thumb">` : `<span class="media-kind">${mediaIcon(m.type)}</span>`;
    return `<div class="card media-row"><a class="row grow" href="${esc(href)}" ${m.url ? 'target="_blank" rel="noopener"' : `download="${esc(m.file_name || m.title)}"`}>${preview}<span class="grow"><span class="t">${esc(m.title)}</span><span class="s">${esc(m.note || m.file_name || (m.url ? "Link externo" : "Guardado no dispositivo"))}</span></span></a><button class="x" data-action="apagar-media" data-id="${m.id}">✕</button></div>`;
  }).join("") : `<p class="muted">Ainda sem fotografias, vídeos ou ficheiros associados.</p>`;
  return `<section class="divider"><div class="head"><h2>Media</h2><a class="btn sm ghost" href="#/media/novo/${subjectType}/${subjectId}">+ Associar</a></div>${rows}</section>`;
}

// ---------- ROUTER ----------
async function router() {
  const h = (location.hash || "#/").slice(1); // ex: "/jogadores/5/editar"
  const p = h.split("/").filter(Boolean);     // ["jogadores","5","editar"]
  marcarTab(p[0] || "home");
  try {
    if (p.length === 0) return viewHome();
    if (p[0] === "jogadores") {
      if (p[1] === "novo") return viewJogadorForm();
      if (p[1] && p[2] === "editar") return viewJogadorForm(p[1]);
      if (p[1] && p[2] === "avaliar") return viewAvaliacaoForm(p[1]);
      if (p[1] && p[2] === "avaliacoes" && p[3] && p[4] === "editar") return viewAvaliacaoForm(p[1], p[3]);
      if (p[1]) return viewJogadorDetalhe(p[1]);
      return viewJogadores();
    }
    if (p[0] === "exercicios") {
      if (p[1] === "novo") return viewExercicioForm();
      if (p[1] && p[2] === "editar") return viewExercicioForm(p[1]);
      if (p[1]) return viewExercicioDetalhe(p[1]);
      return viewExercicios();
    }
    if (p[0] === "treinos") {
      if (p[1] === "novo") return viewTreinoForm();
      if (p[1] === "gerar") return viewGerarTreino();
      if (p[1] && p[2] === "editar") return viewTreinoForm(p[1]);
      if (p[1]) return viewTreinoDetalhe(p[1]);
      return viewTreinos();
    }
    if (p[0] === "calendario") return viewCalendario();
    if (p[0] === "jogos") {
      if (p[1] === "novo") return viewJogoForm();
      if (p[1] && p[2] === "editar") return viewJogoForm(p[1]);
      if (p[1]) return viewJogoDetalhe(p[1]);
      return viewCalendario();
    }
    if (p[0] === "dados") return viewDados();
    if (p[0] === "media" && p[1] === "novo") return viewMediaForm(p[2], p[3]);
    if (p[0] === "head-coach") {
      if (p[1] === "equipa") return viewTeamForm();
      if (p[1] === "modelo") return viewGameModelForm();
      if (p[1] === "chat") return viewHeadCoachChat(p[2]);
      if (p[1] === "ciclos") return viewLearningCycles();
      if (p[1] === "memoria") {
        if (p[2] === "novo" && p[3] === "from") return viewMemoryForm(null, null, null, p[4], p[5]);
        if (p[2] === "novo") return viewMemoryForm(null, p[3], p[4], null, p[5]);
        if (p[2] && p[3] === "editar") return viewMemoryForm(p[2]);
        if (p[2]) return viewMemoryDetail(p[2]);
        return viewHeadCoachMemory();
      }
      return viewHeadCoachDashboard();
    }
    viewHome();
  } catch (e) {
    app.innerHTML = `<div class="card">Erro: ${esc(e.message)}</div>`;
    console.error(e);
  }
}
function marcarTab(tab) {
  document.querySelectorAll("nav.tab a").forEach((a) =>
    a.classList.toggle("ativo", a.dataset.tab === tab));
}

// ---------- HOME ----------
function viewHome() {
  setView("Início", `
    <p class="muted" style="margin-bottom:16px">Futebol de formação (sub-7 a sub-10).</p>
    <div class="tiles">
      <a class="tile" href="#/jogadores"><span class="ic">👦</span><span class="t">Plantel</span><span class="s">Ver e gerir jogadores</span></a>
      <a class="tile" href="#/exercicios"><span class="ic">📋</span><span class="t">Exercícios</span><span class="s">Biblioteca de treino</span></a>
      <a class="tile" href="#/treinos"><span class="ic">🗓️</span><span class="t">Treinos</span><span class="s">Planos e presenças</span></a>
      <a class="tile" href="#/calendario"><span class="ic">📅</span><span class="t">Calendário</span><span class="s">Treinos e jogos</span></a>
      <a class="tile" href="#/jogos/novo"><span class="ic">⚽</span><span class="t">Novo jogo</span><span class="s">Registar um jogo</span></a>
      <a class="tile" href="#/jogadores/novo"><span class="ic">➕</span><span class="t">Novo jogador</span><span class="s">Adicionar ao plantel</span></a>
      <a class="tile" href="#/dados"><span class="ic">💾</span><span class="t">Dados</span><span class="s">Cópia de segurança</span></a>
      <a class="tile" href="#/head-coach"><span class="ic">🧠</span><span class="t">Memória da equipa</span><span class="s">Evidência e decisões do Head Coach</span></a>
    </div>`);
}

// ---------- JOGADORES ----------
async function viewJogadores() {
  const todos = (await DB.listar("jogadores")).sort((a, b) => a.nome.localeCompare(b.nome));
  const lista = state.fj ? todos.filter((j) => escalaoDeJogador(j) === state.fj) : todos;
  const pills = ESCALOES.map((e) =>
    `<button class="pill ${state.fj === e ? "on" : ""}" data-action="fj" data-e="${e}">${e}</button>`).join("");
  const rows = lista.length ? `<ul class="list">${lista.map((j) => {
    const escal = escalaoDeJogador(j) || "sem escalão";
    return `<li><a class="row card" href="#/jogadores/${j.id}">
      ${avatarHTML(j)}
      <span class="grow"><span class="t">${esc(j.nome)}</span>
      <span class="s">${escal}${j.posicao ? " · " + esc(j.posicao) : ""}</span></span>
      <span class="chev">›</span></a></li>`;
  }).join("")}</ul>` : `<div class="empty"><div class="big">👦</div>Ainda sem jogadores${state.fj ? " em " + state.fj : ""}.
      <div><a class="btn-link" href="#/jogadores/novo">Adicionar o primeiro</a></div></div>`;
  setView("Plantel", `
    <div class="head">
      <div class="pills"><button class="pill ${!state.fj ? "on" : ""}" data-action="fj" data-e="">Todos</button>${pills}</div>
      <a class="btn sm" href="#/jogadores/novo">+ Novo</a>
    </div>${rows}`);
}

async function viewJogadorForm(id) {
  const j = id ? await DB.obter("jogadores", id) : null;
  setView(id ? "Editar jogador" : "Novo jogador", `
    <form class="stack" data-form="jogador" data-id="${id || ""}">
      <div class="field"><span>Foto</span>
        <div class="row" style="gap:12px;align-items:center">
          ${avatarHTML(j, 56)}
          <input type="file" name="foto" accept="image/*" data-action="foto" style="flex:1;min-width:0">
        </div>
        ${j?.foto
          ? `<label class="hint" style="display:flex;gap:6px;align-items:center;margin-top:6px">
              <input type="checkbox" name="foto_remover"> Remover a foto atual</label>`
          : `<div class="hint">Fica só neste dispositivo, dentro do backup que exportas.</div>`}
      </div>
      <label class="field"><span>Nome *</span><input name="nome" required value="${esc(j?.nome)}"></label>
      <label class="field"><span>Escalão *</span>
        <select name="escalao" required>
          <option value="">— escolher —</option>
          ${ESCALOES.map((e) => `<option ${escalaoDeJogador(j) === e ? "selected" : ""}>${e}</option>`).join("")}
        </select>
        <div class="hint">És tu que defines o escalão do jogador.</div></label>
      <label class="field"><span>Data de nascimento</span>
        <input type="date" name="data_nasc" value="${esc(j?.data_nasc)}"></label>
      <div class="grid2">
        <label class="field"><span>Posição</span><select name="posicao">
          <option value="">—</option>${POSICOES.map((p) => `<option ${j?.posicao === p ? "selected" : ""}>${p}</option>`).join("")}
        </select></label>
        <label class="field"><span>Pé preferido</span><select name="pe">
          <option value="">—</option>${PES.map((p) => `<option ${j?.pe === p ? "selected" : ""}>${p}</option>`).join("")}
        </select></label>
      </div>
      <label class="field"><span>Número</span><input type="number" name="numero" min="1" value="${j?.numero ?? ""}"></label>
      <label class="field"><span>Notas</span><textarea name="notas" rows="3">${esc(j?.notas)}</textarea></label>
      <div class="actions">
        <button class="btn" type="submit">Guardar</button>
        <a class="btn ghost" href="${id ? "#/jogadores/" + id : "#/jogadores"}">Cancelar</a>
      </div>
    </form>`);
}

async function viewJogadorDetalhe(id) {
  const j = await DB.obter("jogadores", id);
  if (!j) return go("#/jogadores");
  const escal = escalaoDeJogador(j) || "sem escalão";
  const idade = idadeDeDataNasc(j.data_nasc);
  setView(j.nome, `
    <div class="card" style="margin-bottom:16px">
      <div class="row" style="margin-bottom:12px">
        ${avatarHTML(j, 56)}
        <div><div style="font-weight:700;font-size:18px">${esc(j.nome)}</div>
        <div class="muted">${escal}${idade != null ? " · " + idade + " anos" : ""}</div></div>
      </div>
      <dl class="info">
        <dt>Data nasc.</dt><dd>${fmtData(j.data_nasc) || "—"}</dd>
        <dt>Posição</dt><dd>${esc(j.posicao) || "—"}</dd>
        <dt>Pé preferido</dt><dd>${esc(j.pe) || "—"}</dd>
        <dt>Número</dt><dd>${j.numero ?? "—"}</dd>
      </dl>
      ${j.notas ? `<p class="muted" style="margin-top:12px">${esc(j.notas)}</p>` : ""}
    </div>
    <div class="actions">
      <a class="btn" href="#/jogadores/${j.id}/editar">Editar</a>
      <a class="btn ghost" href="#/head-coach/memoria/novo/player/${j.id}">🧠 Observar</a>
      <button class="btn danger" data-action="apagar-jogador" data-id="${j.id}">Apagar</button>
    </div>
    ${await secaoAvaliacoes(j)}\n    ${await renderMediaSection("player", j.id)}`);
}

// ---------- AVALIAÇÕES ----------
// Barra horizontal 1-4 para uma dimensão.
function barraDim(label, valor) {
  const pct = valor ? (valor / 4) * 100 : 0;
  const cor = valor >= 3.5 ? "var(--grama)" : valor >= 2.5 ? "var(--emerald)" : valor >= 1.5 ? "var(--amber)" : "var(--red)";
  return `<div class="dim">
    <span class="dim-l">${label}</span>
    <span class="dim-bar"><span class="dim-fill" style="width:${pct}%;background:${cor}"></span></span>
    <span class="dim-v">${valor ?? "—"}</span></div>`;
}

// Gráfico de evolução da média (SVG puro, escala 1-4). pontos = [{data, valor}] por ordem cronológica.
function graficoEvolucao(pontos) {
  if (pontos.length < 2) return "";
  const W = 320, H = 140, mL = 26, mR = 10, mT = 12, mB = 22;
  const iW = W - mL - mR, iH = H - mT - mB;
  const x = (i) => mL + (pontos.length === 1 ? iW / 2 : (i / (pontos.length - 1)) * iW);
  const y = (v) => mT + (1 - (v - 1) / 3) * iH; // 1 em baixo, 4 em cima
  const grelha = [1, 2, 3, 4].map((v) =>
    `<line x1="${mL}" y1="${y(v)}" x2="${W - mR}" y2="${y(v)}" stroke="var(--slate-200)" stroke-width="1"/>
     <text x="${mL - 6}" y="${y(v) + 3}" text-anchor="end" font-size="9" fill="var(--slate-400)">${v}</text>`).join("");
  const linha = pontos.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.valor).toFixed(1)}`).join(" ");
  const bolas = pontos.map((p, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(p.valor).toFixed(1)}" r="3.5" fill="var(--grama)"/>`).join("");
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Evolução da média">
    ${grelha}
    <path d="${linha}" fill="none" stroke="var(--grama)" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
    ${bolas}
  </svg>`;
}

async function secaoAvaliacoes(j) {
  const avals = (await DB.porIndice("avaliacoes", "jogador_id", Number(j.id)))
    .sort((a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : a.id - b.id));
  const cab = `<div class="head" style="margin-top:24px"><h2>Avaliações</h2>
    <a class="btn sm" href="#/jogadores/${j.id}/avaliar">+ Avaliar</a></div>`;
  if (!avals.length) {
    return cab + `<div class="empty"><div class="big">📈</div>Ainda sem avaliações.
      <div><a class="btn-link" href="#/jogadores/${j.id}/avaliar">Registar a primeira</a></div></div>`;
  }
  const ultima = avals[avals.length - 1];
  const mUlt = mediaAvaliacao(ultima);
  const pontos = avals.map((a) => ({ data: a.data, valor: mediaAvaliacao(a) })).filter((p) => p.valor != null);
  const graf = graficoEvolucao(pontos);

  const cardUltima = `<div class="card" style="margin-bottom:16px">
    <div class="row" style="margin-bottom:10px"><div class="grow">
      <div class="s" style="font-size:11px;text-transform:uppercase;color:var(--slate-400);font-weight:600">Última avaliação · ${fmtData(ultima.data)}</div></div>
      <span class="media-badge">${mUlt != null ? mUlt.toFixed(1) : "—"}</span></div>
    ${DIMENSOES.map(([k, lbl]) => barraDim(lbl, ultima[k])).join("")}
    ${ultima.notas ? `<p class="muted" style="margin-top:10px;white-space:pre-line">${esc(ultima.notas)}</p>` : ""}</div>`;

  const cardGraf = graf ? `<div class="card" style="margin-bottom:16px">
    <div class="s" style="font-size:11px;text-transform:uppercase;color:var(--slate-400);font-weight:600;margin-bottom:8px">Evolução da média (${pontos.length} avaliações)</div>
    ${graf}</div>` : "";

  const historico = `<ul class="list">${avals.slice().reverse().map((a) => {
    const m = mediaAvaliacao(a);
    return `<li class="card row">
      <span class="media-badge sm">${m != null ? m.toFixed(1) : "—"}</span>
      <span class="grow"><span class="t">${fmtData(a.data)}</span>
      <span class="s">${DIMENSOES.map(([k, lbl]) => `${lbl.slice(0, 3)} ${a[k] ?? "—"}`).join(" · ")}</span></span>
      <a class="btn-link" href="#/jogadores/${j.id}/avaliacoes/${a.id}/editar">Editar</a>
      <button class="x" data-action="apagar-avaliacao" data-id="${a.id}" data-jog="${j.id}">✕</button></li>`;
  }).join("")}</ul>`;

  return cab + cardUltima + cardGraf + historico;
}

async function viewAvaliacaoForm(jogadorId, avId) {
  const j = await DB.obter("jogadores", jogadorId);
  if (!j) return go("#/jogadores");
  const a = avId ? await DB.obter("avaliacoes", avId) : null;
  const hoje = new Date().toISOString().slice(0, 10);
  const seletorNivel = (k) => `<div class="niveis">${NIVEIS.map(([v, lbl]) =>
    `<label class="nivel"><input type="radio" name="${k}" value="${v}" ${a?.[k] === v ? "checked" : ""} required>
      <span class="n-v">${v}</span><span class="n-l">${lbl}</span></label>`).join("")}</div>`;
  setView(avId ? "Editar avaliação" : `Avaliar · ${j.nome}`, `
    <form class="stack" data-form="avaliacao" data-id="${avId || ""}" data-jog="${j.id}">
      <label class="field"><span>Data *</span><input type="date" name="data" required value="${esc(a?.data) || hoje}"></label>
      ${DIMENSOES.map(([k, lbl]) => `<div class="field"><span>${lbl} *</span>${seletorNivel(k)}</div>`).join("")}
      <label class="field"><span>Notas</span><textarea name="notas" rows="3" placeholder="Pontos fortes, a melhorar…">${esc(a?.notas)}</textarea></label>
      <div class="actions">
        <button class="btn" type="submit">Guardar</button>
        <a class="btn ghost" href="#/jogadores/${j.id}">Cancelar</a>
      </div>
    </form>`);
}

// ---------- EXERCÍCIOS ----------
async function viewExercicios() {
  let lista = (await DB.listar("exercicios")).sort((a, b) => a.titulo.localeCompare(b.titulo));
  if (state.fcat) lista = lista.filter((e) => e.categoria === state.fcat);
  if (state.fesc) lista = lista.filter((e) => (e.escaloes || []).includes(state.fesc));
  const rows = lista.length ? `<ul class="list">${lista.map((e) => `
    <li><a class="card" style="display:block" href="#/exercicios/${e.id}">
      <div class="row"><span class="grow"><span class="t">${esc(e.titulo)}</span></span>
      ${e.duracao_min ? `<span class="tag">${e.duracao_min} min</span>` : ""}</div>
      <div class="s" style="margin-top:2px;color:var(--slate-500);font-size:12px">
        ${esc(e.categoria) || "sem categoria"}${(e.n_jogadores_min || e.n_jogadores_max) ?
          " · " + (e.n_jogadores_min || "?") + (e.n_jogadores_max && e.n_jogadores_max !== e.n_jogadores_min ? "–" + e.n_jogadores_max : "") + " jog." : ""}
        ${(e.escaloes || []).length ? " · " + e.escaloes.join(", ") : ""}
      </div></a></li>`).join("")}</ul>`
    : (state.fcat || state.fesc)
      ? `<div class="empty"><div class="big">📋</div>Nenhum exercício com estes filtros.</div>`
      : `<div class="empty"><div class="big">📋</div>Ainda sem exercícios.
         <div style="margin-top:16px;display:flex;flex-direction:column;gap:8px;align-items:center">
           <button class="btn" data-action="carregar-base">📚 Carregar biblioteca de formação</button>
           <a class="btn-link" href="#/exercicios/novo">ou criar um exercício</a>
         </div></div>`;
  setView("Exercícios", `
    <div class="head"><span class="muted">${lista.length} exercício(s)</span><a class="btn sm" href="#/exercicios/novo">+ Novo</a></div>
    <div class="grid2" style="margin-bottom:16px">
      <select data-action="fcat"><option value="">Todas as categorias</option>
        ${CATEGORIAS.map((c) => `<option ${state.fcat === c ? "selected" : ""}>${c}</option>`).join("")}</select>
      <select data-action="fesc"><option value="">Todos os escalões</option>
        ${ESCALOES.map((e) => `<option ${state.fesc === e ? "selected" : ""}>${e}</option>`).join("")}</select>
    </div>${rows}`);
}

async function viewExercicioForm(id) {
  const e = id ? await DB.obter("exercicios", id) : null;
  const escSel = (x) => (e?.escaloes || []).includes(x) ? "checked" : "";
  setView(id ? "Editar exercício" : "Novo exercício", `
    <form class="stack" data-form="exercicio" data-id="${id || ""}">
      <label class="field"><span>Título *</span><input name="titulo" required value="${esc(e?.titulo)}"></label>
      <label class="field"><span>Objetivo</span><input name="objetivo" value="${esc(e?.objetivo)}"></label>
      <label class="field"><span>Categoria</span><select name="categoria"><option value="">—</option>
        ${CATEGORIAS.map((c) => `<option ${e?.categoria === c ? "selected" : ""}>${c}</option>`).join("")}</select></label>
      <div class="grid3">
        <label class="field"><span>Jog. mín.</span><input type="number" name="n_jogadores_min" min="1" value="${e?.n_jogadores_min ?? ""}"></label>
        <label class="field"><span>Jog. máx.</span><input type="number" name="n_jogadores_max" min="1" value="${e?.n_jogadores_max ?? ""}"></label>
        <label class="field"><span>Duração</span><input type="number" name="duracao_min" min="1" value="${e?.duracao_min ?? ""}"></label>
      </div>
      <label class="field"><span>Escalões-alvo</span>
        <div class="pills">${ESCALOES.map((x) => `<label class="pill"><input type="checkbox" name="escaloes" value="${x}" ${escSel(x)} style="width:auto;margin-right:6px">${x}</label>`).join("")}</div></label>
      <label class="field"><span>Descrição</span><textarea name="descricao" rows="4">${esc(e?.descricao)}</textarea></label>
      <label class="field"><span>Material</span><input name="material" value="${esc(e?.material)}"></label>
      <div class="actions">
        <button class="btn" type="submit">Guardar</button>
        <a class="btn ghost" href="${id ? "#/exercicios/" + id : "#/exercicios"}">Cancelar</a>
      </div>
    </form>`);
}

async function viewExercicioDetalhe(id) {
  const e = await DB.obter("exercicios", id);
  if (!e) return go("#/exercicios");
  const tags = [];
  if (e.categoria) tags.push(`<span class="tag grama">${esc(e.categoria)}</span>`);
  if (e.duracao_min) tags.push(`<span class="tag">${e.duracao_min} min</span>`);
  if (e.n_jogadores_min || e.n_jogadores_max)
    tags.push(`<span class="tag">${e.n_jogadores_min || "?"}${e.n_jogadores_max && e.n_jogadores_max !== e.n_jogadores_min ? "–" + e.n_jogadores_max : ""} jogadores</span>`);
  (e.escaloes || []).forEach((x) => tags.push(`<span class="tag">${x}</span>`));
  setView("Exercício", `
    <div class="card" style="margin-bottom:16px">
      <h2 style="font-size:18px;font-weight:700">${esc(e.titulo)}</h2>
      ${e.objetivo ? `<p class="muted" style="margin-top:4px">${esc(e.objetivo)}</p>` : ""}
      <div class="pills" style="margin-top:12px">${tags.join("")}</div>
      ${e.descricao ? `<div class="divider"><div class="s" style="text-transform:uppercase;font-size:11px;font-weight:600;color:var(--slate-400);margin-bottom:4px">Descrição</div><p style="white-space:pre-line">${esc(e.descricao)}</p></div>` : ""}
      ${e.material ? `<div class="divider"><div class="s" style="text-transform:uppercase;font-size:11px;font-weight:600;color:var(--slate-400);margin-bottom:4px">Material</div><p>${esc(e.material)}</p></div>` : ""}
    </div>
    <div class="actions">
      <a class="btn" href="#/exercicios/${e.id}/editar">Editar</a>
      <button class="btn danger" data-action="apagar-exercicio" data-id="${e.id}">Apagar</button>
    </div>`);
}

// ---------- TREINOS ----------
async function viewTreinos() {
  const treinos = (await DB.listar("treinos")).sort((a, b) => (a.data < b.data ? 1 : -1));
  const rows = treinos.length ? `<ul class="list">${treinos.map((t) => {
    const [a, m, d] = t.data.split("-");
    return `<li><a class="row card" href="#/treinos/${t.id}">
      <span class="avatar" style="border-radius:12px;flex-direction:column;line-height:1">
        <span style="font-size:18px;font-weight:700">${d}</span><span style="font-size:10px">${m}/${a}</span></span>
      <span class="grow"><span class="t">${esc(t.escalao)}</span><span class="s">${esc(t.notas) || "sem notas"}</span></span>
      <span class="chev">›</span></a></li>`;
  }).join("")}</ul>` : `<div class="empty"><div class="big">🗓️</div>Ainda sem treinos.
      <div><a class="btn-link" href="#/treinos/novo">Planear o primeiro</a></div></div>`;
  setView("Treinos", `
    <div class="head"><span class="muted">${treinos.length} treino(s)</span>
      <span style="display:flex;gap:8px"><a class="btn sm ghost" href="#/treinos/gerar">🤖 Gerar</a><a class="btn sm" href="#/treinos/novo">+ Novo</a></span></div>${rows}`);
}

// Gerar treino por IA (escalão, duração e foco opcional).
async function viewGerarTreino() {
  const temChave = !!iaConfig().key;
  const escalaoDefeito = ESCALOES.includes("sub-8") ? "sub-8" : ESCALOES[0];
  const focoSug = focoDoUltimoTreino(await DB.listar("treinos"), escalaoDefeito) || "";
  setView("Gerar treino (IA)", `
    <p class="muted" style="margin-bottom:16px">A IA monta um treino com no máximo 5 a 6 exercícios (equipa e guarda-redes), a partir da tua biblioteca de exercícios, adaptado ao escalão e à duração escolhida. Precisa de internet; depois fica gravado e usável offline.</p>
    ${temChave ? "" : `<div class="card" style="margin-bottom:16px;border-color:var(--amber)">
      ⚠️ Falta a chave OpenRouter. Configura em <a href="#/dados">Dados → IA</a> antes de gerar.</div>`}
    <form class="stack" data-form="gerar-treino">
      <div class="grid2">
        <label class="field"><span>Data *</span><input type="date" name="data" required value="${new Date().toISOString().slice(0, 10)}"></label>
        <label class="field"><span>Hora</span><input type="time" name="hora"></label>
      </div>
      <div class="grid2">
        <label class="field"><span>Escalão *</span><select name="escalao" required data-action="escalao-gerar">
          ${ESCALOES.map((e) => `<option ${e === escalaoDefeito ? "selected" : ""}>${e}</option>`).join("")}</select></label>
        <label class="field"><span>Duração (min) *</span><input type="number" name="duracao_min" required min="30" max="120" step="5" value="70">
          <div class="hint">Normal: 60 a 75. Muda à vontade.</div></label>
      </div>
      <label class="field"><span>Foco (opcional)</span>
        <select name="foco">
          <option value="">— sem foco específico (a IA equilibra) —</option>
          ${[...new Set([...DIFICULDADES, ...CATEGORIAS])].map((f) => `<option ${f === focoSug ? "selected" : ""}>${esc(f)}</option>`).join("")}
        </select>
        <div class="hint">${focoSug ? "Sugerido pela última dificuldade registada. " : ""}Muda à vontade; vazio → a IA usa as dificuldades recentes.</div></label>
      <label class="field"><span>Nº de jogadores (opcional)</span>
        <input type="number" name="n_jogadores" min="1" placeholder="automático (conta o plantel do escalão)">
        <div class="hint">A IA adapta os exercícios ao número que tens. Vazio → conta o teu plantel.</div></label>
      <div class="hint">🧤 O guarda-redes é sempre incluído: participa nos exercícios com baliza e tem um treino individual à parte.</div>
      <div class="actions">
        <button class="btn" type="submit" ${temChave ? "" : "disabled"}>🤖 Gerar treino</button>
        <a class="btn ghost" href="#/treinos">Cancelar</a>
      </div>
      <p class="muted iaerro" style="color:var(--red);display:none"></p>
    </form>`);
}

async function viewTreinoForm(id) {
  const t = id ? await DB.obter("treinos", id) : null;
  const hoje = new Date().toISOString().slice(0, 10);
  const escalaoDefeito = t?.escalao || (ESCALOES.includes("sub-8") ? "sub-8" : ESCALOES[0]);
  setView(id ? "Editar treino" : "Novo treino", `
    <form class="stack" data-form="treino" data-id="${id || ""}">
      <div class="grid2">
        <label class="field"><span>Data *</span><input type="date" name="data" required value="${esc(t?.data) || hoje}"></label>
        <label class="field"><span>Hora</span><input type="time" name="hora" value="${esc(t?.hora)}"></label>
      </div>
      <label class="field"><span>Escalão *</span><select name="escalao" required>
        ${ESCALOES.map((e) => `<option ${e === escalaoDefeito ? "selected" : ""}>${e}</option>`).join("")}</select></label>
      <label class="field"><span>Notas</span><textarea name="notas" rows="3">${esc(t?.notas)}</textarea></label>
      <div class="actions">
        <button class="btn" type="submit">Guardar</button>
        <a class="btn ghost" href="${id ? "#/treinos/" + id : "#/treinos"}">Cancelar</a>
      </div>
    </form>`);
}

function durItem(item, ex) {
  if (item.duracao_min != null) return item.duracao_min;
  if (ex && ex.duracao_min != null) return ex.duracao_min;
  return 0;
}

// Secção de registo de dificuldades (evolução). store = "treinos" | "jogos".
function secaoDificuldades(store, registo) {
  const sel = new Set(registo.dificuldades || []);
  return `<form class="card" data-form="dificuldades" data-store="${store}" data-id="${registo.id}" style="margin-bottom:16px">
    <h2 style="font-weight:700;margin-bottom:6px">Dificuldades notadas</h2>
    <p class="muted" style="font-size:12px;margin-bottom:10px">Marca o que correu pior. Isto passa a ser o foco sugerido no próximo treino gerado.</p>
    <div class="pills" style="margin-bottom:10px">${DIFICULDADES.map((t) =>
      `<label class="pill">${sel.has(t) ? "✓ " : ""}<input type="checkbox" name="dif" value="${esc(t)}" ${sel.has(t) ? "checked" : ""} style="width:auto;margin-right:6px">${esc(t)}</label>`).join("")}</div>
    <textarea name="dif_nota" rows="2" placeholder="nota (opcional): ex. perdem a bola na saída">${esc(registo.dif_nota)}</textarea>
    <div class="actions" style="margin-top:10px"><button class="btn sm" type="submit">Guardar dificuldades</button></div>
  </form>`;
}

async function viewTreinoDetalhe(id) {
  const t = await DB.obter("treinos", id);
  if (!t) return go("#/treinos");
  const exercicios = (await DB.listar("exercicios")).sort((a, b) => a.titulo.localeCompare(b.titulo));
  const exMap = Object.fromEntries(exercicios.map((e) => [e.id, e]));
  const todosItens = (await DB.porIndice("treino_itens", "treino_id", Number(id))).sort((a, b) => a.ordem - b.ordem);
  const itens = todosItens.filter((it) => it.parte !== "gr");
  const itensGR = todosItens.filter((it) => it.parte === "gr");
  const total = itens.reduce((s, it) => s + durItem(it, exMap[it.exercicio_id]), 0);
  const totalGR = itensGR.reduce((s, it) => s + durItem(it, exMap[it.exercicio_id]), 0);

  const jogadores = (await DB.listar("jogadores"))
    .filter((j) => escalaoDeJogador(j) === t.escalao)
    .sort((a, b) => a.nome.localeCompare(b.nome));
  const presencas = await DB.porIndice("presencas", "treino_id", Number(id));
  const presMap = Object.fromEntries(presencas.map((p) => [p.jogador_id, p.estado]));
  const cont = { presente: 0, ausente: 0 };
  presencas.forEach((p) => { if (cont[p.estado] != null) cont[p.estado]++; });

  const listaItensHtml = (lista) => lista.length ? `<ol class="list" style="margin-bottom:12px">${lista.map((it, i) => {
    const ex = exMap[it.exercicio_id];
    const dur = it.duracao_min != null ? it.duracao_min : (ex && ex.duracao_min != null ? ex.duracao_min : "—");
    return `<li class="card item">
      <span class="num">${i + 1}</span>
      <span class="grow">${ex ? `<a class="t" href="#/exercicios/${ex.id}" style="text-decoration:none;color:inherit">${esc(ex.titulo)}</a><span class="s">${esc(it.bloco || ex.categoria || "sem categoria")}</span>${it.nota ? `<span class="s" style="color:var(--slate-400);font-style:italic">${esc(it.nota)}</span>` : ""}${it.com_gr ? `<span class="s" style="color:var(--grama);font-weight:600">🧤 com guarda-redes</span>` : ""}` : `<span class="t" style="color:var(--slate-400)">(exercício apagado)</span>`}</span>
      <span class="dur">${dur}′</span>
      <span class="reorder">
        <button data-action="mover" data-item="${it.id}" data-dir="cima" ${i === 0 ? "disabled" : ""}>▲</button>
        <button data-action="mover" data-item="${it.id}" data-dir="baixo" ${i === lista.length - 1 ? "disabled" : ""}>▼</button>
      </span>
      <button class="x" data-action="apagar-item" data-item="${it.id}">✕</button>
    </li>`;
  }).join("")}</ol>` : `<p class="muted" style="margin-bottom:12px">Ainda sem exercícios no plano.</p>`;
  const itensHtml = listaItensHtml(itens);
  const grHtml = itensGR.length ? `
    <section style="margin-bottom:24px">
      <div class="head"><h2>🧤 Guarda-redes (treino individual)</h2><span class="total">${totalGR} min</span></div>
      ${listaItensHtml(itensGR)}
    </section>` : "";

  const addHtml = exercicios.length ? `
    <form class="card item" data-form="add-item" style="gap:8px;align-items:flex-end">
      <label class="field grow"><span style="font-size:12px;color:var(--slate-500)">Adicionar exercício</span>
        <select name="exercicio_id" required>${exercicios.map((e) => `<option value="${e.id}">${esc(e.titulo)}${e.categoria ? " · " + esc(e.categoria) : ""}</option>`).join("")}</select></label>
      <label class="field" style="width:64px"><span style="font-size:12px;color:var(--slate-500)">Min.</span><input type="number" name="duracao_min" min="1" placeholder="auto"></label>
      <button class="btn" type="submit" style="padding:10px 16px">+</button>
    </form>`
    : `<p class="muted">Sem exercícios na biblioteca. <a class="btn-link" href="#/exercicios/novo">Cria um</a> para o poderes adicionar.</p>`;

  const presHtml = jogadores.length ? `<ul class="list">${jogadores.map((j) => {
    const est = presMap[j.id];
    const btns = ESTADOS.map(([e, letra, cls]) =>
      `<button class="pbtn ${est === e ? "on " + cls : ""}" data-action="presenca" data-jog="${j.id}" data-est="${e}">${letra}</button>`).join("");
    return `<li class="card row">${avatarHTML(j, 32)}<span class="grow" style="font-weight:500">${esc(j.nome)}</span><span class="pbtns">${btns}</span></li>`;
  }).join("")}</ul>` : `<p class="muted">Sem jogadores no escalão ${esc(t.escalao)}. <a class="btn-link" href="#/jogadores/novo">Adiciona ao plantel</a>.</p>`;

  setView("Treino", `
    <div class="card" style="margin-bottom:16px">
      <div class="row"><div class="grow"><div style="font-weight:700;font-size:18px">${fmtData(t.data)}${t.hora ? " · " + esc(t.hora) : ""}</div><div class="muted">${esc(t.escalao)}</div></div>
        <a class="btn-link" href="#/treinos/${t.id}/editar">Editar</a></div>
      ${notasLimpas(t.notas) ? `<p class="muted" style="margin-top:8px;white-space:pre-line">${esc(notasLimpas(t.notas))}</p>` : ""}
      <div style="display:flex;gap:8px;margin-top:12px">
        <button class="btn" data-action="partilhar-treino" data-id="${t.id}" style="flex:1">📲 Partilhar</button>
        <button class="btn ghost" data-action="gcal-treino" data-id="${t.id}" style="flex:1">📅 Google Calendar</button>
      </div>
      <a class="btn ghost" href="#/head-coach/memoria/novo/training/${t.id}" style="width:100%;margin-top:8px">🧠 Registar observação</a>
    </div>
    <section style="margin-bottom:24px">
      <div class="head"><h2>Plano da sessão</h2><span class="total">${total} min</span></div>
      <p class="muted" style="font-size:12px;margin-bottom:12px">Sugestão: ${FASES.join(" → ")}</p>
      ${itensHtml}${addHtml}
    </section>
    ${grHtml}
    <section>
      <div class="head"><h2>Presenças</h2>
        <span class="muted count"><span class="p">${cont.presente}P</span> · <span class="a">${cont.ausente}A</span></span></div>
      <p class="muted" style="font-size:12px;margin-bottom:8px">P = Presente · A = Ausente</p>
      ${presHtml}
    </section>
    ${await renderMediaSection("training", t.id)}
    ${secaoDificuldades("treinos", t)}
    <div class="divider"><button class="btn danger" data-action="apagar-treino" data-id="${t.id}" style="width:100%">🗑️ Apagar treino</button></div>`);
}

// ---------- CALENDÁRIO / JOGOS ----------
async function viewCalendario() {
  const eventos = eventosCalendario(await DB.listar("treinos"), await DB.listar("jogos"));
  const hoje = new Date().toISOString().slice(0, 10);
  const proximos = eventos.filter((e) => e.data >= hoje);
  const passados = eventos.filter((e) => e.data < hoje).reverse(); // mais recente primeiro

  const linhaEvento = (e) => {
    const [Y, M, D] = e.data.split("-").map(Number);
    const dow = DIAS_SEMANA[new Date(Y, M - 1, D).getDay()];
    const cabeca = (bg) => `<span class="avatar" style="border-radius:12px;flex-direction:column;line-height:1;background:${bg};color:#fff">
      <span style="font-size:18px;font-weight:700">${D}</span><span style="font-size:10px">${dow}</span></span>`;
    if (e.tipo === "treino") {
      const t = e.ref;
      return `<li><a class="row card" href="#/treinos/${t.id}">${cabeca("var(--slate-400)")}
        <span class="grow"><span class="t">🗓️ Treino · ${esc(t.escalao)}</span>
        <span class="s">${t.hora ? esc(t.hora) + " · " : ""}${esc((t.notas || "").split("\n")[0]) || "sessão"}</span></span>
        <span class="chev">›</span></a></li>`;
    }
    const j = e.ref, r = resultadoJogo(j);
    const badge = r.texto ? `<span class="tag" style="background:${r.cor};color:#fff">${r.texto}</span>` : `<span class="tag">por jogar</span>`;
    return `<li><a class="row card" href="#/jogos/${j.id}">${cabeca("var(--grama)")}
      <span class="grow"><span class="t">⚽ ${esc(j.adversario || "Jogo")} <span class="s" style="font-weight:400">(${j.casa_fora === "fora" ? "fora" : "casa"})</span></span>
      <span class="s">${esc(j.escalao)}${j.hora ? " · " + esc(j.hora) : ""}${j.local ? " · " + esc(j.local) : ""}</span></span>
      ${badge}<span class="chev">›</span></a></li>`;
  };
  const grupos = (lista) => {
    if (!lista.length) return `<p class="muted" style="margin:8px 0">Nada por aqui.</p>`;
    let html = "", mes = "";
    for (const e of lista) {
      const [Y, M] = e.data.split("-").map(Number);
      const chave = `${MESES[M - 1]} ${Y}`;
      if (chave !== mes) { if (mes) html += "</ul>"; mes = chave;
        html += `<h2 style="text-transform:uppercase;font-size:12px;letter-spacing:.5px;color:var(--slate-400);margin:16px 0 8px">${chave}</h2><ul class="list">`; }
      html += linhaEvento(e);
    }
    return html + "</ul>";
  };
  setView("Calendário", `
    <div class="head"><span class="muted">${eventos.length} evento(s)</span>
      <span style="display:flex;gap:8px"><a class="btn sm ghost" href="#/treinos">+ Treino</a><a class="btn sm" href="#/jogos/novo">+ Jogo</a></span></div>
    <h3 style="margin:4px 0 0;font-size:14px">Próximos</h3>${grupos(proximos)}
    <h3 style="margin:24px 0 0;font-size:14px;color:var(--slate-500)">Passados</h3>${grupos(passados)}`);
}

async function viewJogoForm(id) {
  const j = id ? await DB.obter("jogos", id) : null;
  const hoje = new Date().toISOString().slice(0, 10);
  setView(id ? "Editar jogo" : "Novo jogo", `
    <form class="stack" data-form="jogo" data-id="${id || ""}">
      <div class="grid2">
        <label class="field"><span>Data *</span><input type="date" name="data" required value="${esc(j?.data) || hoje}"></label>
        <label class="field"><span>Hora</span><input type="time" name="hora" value="${esc(j?.hora)}"></label>
      </div>
      <label class="field"><span>Escalão *</span><select name="escalao" required>
        ${ESCALOES.map((e) => `<option ${j?.escalao === e ? "selected" : ""}>${e}</option>`).join("")}</select></label>
      <label class="field"><span>Adversário *</span><input name="adversario" required value="${esc(j?.adversario)}"></label>
      <label class="field"><span>Local</span><div class="grid2">
        <select name="casa_fora">
          <option value="casa" ${j?.casa_fora !== "fora" ? "selected" : ""}>Casa</option>
          <option value="fora" ${j?.casa_fora === "fora" ? "selected" : ""}>Fora</option>
        </select>
        <input name="local" placeholder="campo / recinto" value="${esc(j?.local)}">
      </div></label>
      <label class="field"><span>Resultado (golos)</span><div class="grid2">
        <input type="number" name="golos_favor" min="0" placeholder="a favor" value="${j?.golos_favor ?? ""}">
        <input type="number" name="golos_contra" min="0" placeholder="contra" value="${j?.golos_contra ?? ""}">
      </div><div class="hint">Deixa vazio enquanto o jogo não foi jogado.</div></label>
      <label class="field"><span>Notas</span><textarea name="notas" rows="3">${esc(j?.notas)}</textarea></label>
      <div class="actions">
        <button class="btn" type="submit">Guardar</button>
        <a class="btn ghost" href="${id ? "#/jogos/" + id : "#/calendario"}">Cancelar</a>
      </div>
    </form>`);
}

async function viewJogoDetalhe(id) {
  const j = await DB.obter("jogos", id);
  if (!j) return go("#/calendario");
  const r = resultadoJogo(j);
  const rotulo = { vitoria: "Vitória", empate: "Empate", derrota: "Derrota", por_jogar: "Por jogar" }[r.estado];
  setView("Jogo", `
    <div class="card" style="margin-bottom:16px">
      <div class="row"><div class="grow">
        <div style="font-weight:700;font-size:18px">⚽ ${esc(j.adversario)}</div>
        <div class="muted">${esc(j.escalao)} · ${j.casa_fora === "fora" ? "fora" : "casa"}${j.local ? " · " + esc(j.local) : ""}</div>
        <div class="muted">${fmtData(j.data)}${j.hora ? " · " + esc(j.hora) : ""}</div>
      </div><a class="btn-link" href="#/jogos/${j.id}/editar">Editar</a></div>
      <div style="text-align:center;margin:16px 0">
        <div style="font-size:32px;font-weight:800;color:${r.cor}">${r.texto || "—"}</div>
        <div class="muted" style="font-weight:600">${rotulo}</div>
      </div>
      ${j.notas ? `<p class="muted" style="white-space:pre-line">${esc(j.notas)}</p>` : ""}
    </div>
    <div class="actions" style="flex-direction:column;gap:10px">
      <button class="btn" data-action="partilhar-jogo" data-id="${j.id}" style="width:100%">📲 Partilhar (WhatsApp)</button>
      <button class="btn ghost" data-action="gcal-jogo" data-id="${j.id}" style="width:100%">📅 Adicionar ao Google Calendar</button>
      <a class="btn ghost" href="#/head-coach/memoria/novo/match/${j.id}" style="width:100%">🧠 Registar observação na memória</a>
    </div>
    ${await renderMediaSection("match", j.id)}
    ${secaoDificuldades("jogos", j)}
    <div class="divider"><button class="btn danger" data-action="apagar-jogo" data-id="${j.id}" style="width:100%">🗑️ Apagar jogo</button></div>`);
}

async function viewMediaForm(subjectType, subjectId) {
  if (!HEAD_COACH_MEDIA_SUBJECTS.includes(subjectType) || !subjectId) return go("#/head-coach");
  let subject = null;
  if (subjectType === "player") subject = await DB.obter("jogadores", subjectId);
  if (subjectType === "training") subject = await DB.obter("treinos", subjectId);
  if (subjectType === "match") subject = await DB.obter("jogos", subjectId);
  if (subjectType === "memory") subject = await HeadCoachMemory.get(subjectId);
  if (!subject) return go("#/head-coach");
  const label = subjectType === "player" ? subject.nome : subjectType === "training" ? "Treino " + fmtData(subject.data) :
    subjectType === "match" ? "Jogo vs " + subject.adversario : (subject.title || "Memória");
  setView("Associar media", `
    <div class="card" style="margin-bottom:16px"><div class="s">Associar a</div><div class="t">${esc(label)}</div></div>
    <form class="stack" data-form="media" data-subject-type="${esc(subjectType)}" data-subject-id="${esc(subjectId)}">
      <label class="field"><span>Tipo *</span><select name="type" required>
        <option value="photo">Fotografia</option><option value="video">Vídeo</option><option value="file">Ficheiro</option>
      </select></label>
      <label class="field"><span>Título</span><input name="title" placeholder="Ex.: lance da saída de bola"></label>
      <label class="field"><span>Link</span><input name="url" type="url" placeholder="https://...">
        <div class="hint">Recomendado para vídeos grandes (YouTube, Drive, etc.).</div></label>
      <label class="field"><span>Ou ficheiro local</span><input name="file" type="file">
        <div class="hint">Até 5 MB fica guardado no dispositivo e entra no backup. Para vídeos maiores, usa um link.</div></label>
      <label class="field"><span>Nota</span><textarea name="note" rows="3" placeholder="O que deve ser observado neste media?"></textarea></label>
      <div class="actions"><button class="btn" type="submit">Guardar media</button>
        <a class="btn ghost" href="${subjectHref(subjectType, subjectId)}">Cancelar</a></div>
    </form>`);
}

async function viewLearningCycles() {
  const memory = await HeadCoachMemory.list(DEFAULT_TEAM_ID, { includeArchived: true });
  const cycles = construirCiclosAprendizagem(memory);
  const renderStep = (item) => item ? `<a class="btn-link" href="#/head-coach/memoria/${item.id}">${esc(MEMORY_KIND_LABELS[item.kind])}: ${esc(item.title)}</a>` : `<span class="muted">—</span>`;
  const completed = cycles.completed.length ? cycles.completed.map((c) => `
    <div class="card cycle-card">
      <div class="row"><span class="tag grama">Concluído</span><span class="grow"></span><span class="s">${fmtData((c.result.occurred_at || "").slice(0,10))}</span></div>
      <div class="cycle-steps">${renderStep(c.observation)}<span>→</span>${renderStep(c.diagnosis)}<span>→</span>${renderStep(c.decision)}<span>→</span>${renderStep(c.intervention)}<span>→</span>${renderStep(c.result)}</div>
      <div class="divider"><div class="s">Aprendizagem operacional</div><p>${esc(c.result.content)}</p></div>
      ${c.complete ? "" : '<div class="hint">Cadeia parcial: falta pelo menos um passo estruturado antes do resultado.</div>'}
    </div>`).join("") : '<div class="empty">Ainda não há ciclos com resultado medido.</div>';
  const open = cycles.open.length ? cycles.open.map((c) => `
    <div class="card cycle-card">
      <div class="row"><span class="tag">A medir</span><span class="grow"></span><a class="btn sm" href="#/head-coach/memoria/novo/from/${c.intervention.id}/result">+ Resultado</a></div>
      <div class="cycle-steps">${renderStep(c.diagnosis)}<span>→</span>${renderStep(c.decision)}<span>→</span>${renderStep(c.intervention)}</div>
      <p class="muted" style="margin-top:8px">Regista o efeito observado para fechar o ciclo e transformar a intervenção em aprendizagem.</p>
    </div>`).join("") : '<p class="muted">Não existem intervenções por medir.</p>';
  setView("Ciclos de aprendizagem", `
    <div class="head"><a class="btn-link" href="#/head-coach">← Dashboard</a><a class="btn sm ghost" href="#/head-coach/memoria">Memória</a></div>
    <section style="margin-bottom:24px"><div class="head"><h2>Intervenções por medir</h2><span class="tag">${cycles.open.length}</span></div>${open}</section>
    <section><div class="head"><h2>Aprendizagem registada</h2><span class="tag grama">${cycles.completed.length}</span></div>${completed}</section>`);
}

// ---------- HEAD COACH: MEMÓRIA DA EQUIPA ----------
function dashboardMemoryLink(item, prefix = "") {
  if (!item) return "";
  return `<a class="btn-link" href="#/head-coach/memoria/${item.id}">${prefix}${esc(item.title)}</a>`;
}

async function viewHeadCoachDashboard() {
  const d = await HeadCoachDashboard.load();
  const team = d.team || { nome: "Equipa principal" };
  const priorities = d.priorities.length ? d.priorities.map((p) => `<li class="card row">
    <span class="avatar" style="width:34px;height:34px">${p.rank}</span><span class="grow"><span class="t">${esc(p.title)}</span>
    <span class="s">${p.explicit ? "Prioridade definida" : "Sugestão baseada na evidência — confirmar"} · ${esc(MEMORY_KIND_LABELS[p.kind])}</span></span>
    <a class="chev" href="#/head-coach/memoria/${p.id}">›</a></li>`).join("")
    : `<li class="empty">Ainda sem problemas ou prioridades registados.</li>`;
  const next = d.next_training;
  const nextExercises = next.exercises.length ? `<ol style="padding-left:20px;margin-top:8px">${next.exercises.map((x) => `<li style="margin:5px 0">${esc(x.exercise?.titulo || "Exercício removido")} ${x.duracao_min ? `· ${x.duracao_min} min` : ""}</li>`).join("")}</ol>` : `<p class="muted" style="margin-top:8px">Ainda sem exercícios associados.</p>`;
  const nextTrainingHtml = next.event ? `<div class="card">
      <div class="row"><div class="grow"><div class="t">${fmtData(next.event.data)}${next.event.hora ? " · " + esc(next.event.hora) : ""}</div><div class="s">${esc(next.event.escalao)}</div></div><a class="btn-link" href="#/treinos/${next.event.id}">Abrir treino</a></div>
      <div class="divider"><div class="s">Objetivo recomendado</div><p>${esc(next.objective) || "Definir a partir da prioridade principal."}</p>${next.source_id ? dashboardMemoryLink({ id: next.source_id, title: "Ver evidência" }) : ""}</div>
      ${nextExercises}
      ${next.observe ? `<div class="divider"><div class="s">O que observar</div><p>${esc(next.observe)}</p></div>` : ""}
      ${next.measure ? `<div class="divider"><div class="s">Como medir</div><p>${esc(next.measure)}</p></div>` : ""}
    </div>` : `<div class="card"><p class="muted">Ainda não existe um próximo treino no calendário.</p><div class="actions" style="margin-top:10px"><a class="btn" href="#/treinos/novo">Planear treino</a><a class="btn ghost" href="#/treinos/gerar">Gerar com IA</a></div></div>`;
  const last = d.last_match;
  const lastMatchHtml = last ? `<div class="card"><div class="row"><div class="grow"><div class="t">${esc(last.adversario)}</div><div class="s">${fmtData(last.data)} · ${last.casa_fora === "fora" ? "fora" : "casa"}</div></div><span class="media-badge">${last.golos_favor}-${last.golos_contra}</span></div>
      ${last.dificuldades?.length ? `<div class="pills" style="margin-top:10px">${last.dificuldades.map((x) => `<span class="tag">${esc(x)}</span>`).join("")}</div>` : ""}
      ${d.match_change ? `<p class="muted" style="margin-top:10px">${esc(d.match_change)}</p>` : ""}<a class="btn-link" href="#/jogos/${last.id}">Abrir jogo</a></div>`
    : `<div class="card"><p class="muted">Ainda não existe um jogo concluído no calendário.</p><a class="btn-link" href="#/jogos/novo">Registar jogo</a></div>`;
  const players = d.players_attention.length ? `<ul class="list">${d.players_attention.map((x) => `<li class="card row">${avatarHTML(x.player, 34)}<span class="grow"><span class="t">${esc(x.player.nome)}</span><span class="s">${x.count} registo(s) recente(s) · ${esc(x.latest.title)}</span></span><a class="chev" href="#/jogadores/${x.player.id}">›</a></li>`).join("")}</ul>`
    : `<div class="empty">Sem jogadores sinalizados pela memória.</div>`;
  const observations = d.latest_observations.length ? `<ul class="list">${d.latest_observations.map((x) => `<li class="card"><div class="s">${fmtData((x.occurred_at || "").slice(0, 10))} · ${esc(x.source?.label || "—")}</div>${dashboardMemoryLink(x)}</li>`).join("")}</ul>` : `<div class="empty">Ainda sem observações.</div>`;
  const results = d.latest_results.length ? d.latest_results.map((x) => `<div class="card" style="margin-bottom:8px">${dashboardMemoryLink(x)}</div>`).join("") : `<p class="muted">Ainda sem resultados medidos. O dashboard mostrará evolução quando uma intervenção tiver resultado.</p>`;
  const cycles = construirCiclosAprendizagem(await HeadCoachMemory.list(DEFAULT_TEAM_ID, { includeArchived: true }));
  const learning = cycles.completed.length ? `<div class="card"><div class="row"><span class="media-badge">${cycles.completed.length}</span><span class="grow"><span class="t">ciclo(s) com resultado</span><span class="s">${cycles.open.length} intervenção(ões) ainda por medir</span></span><a class="btn-link" href="#/head-coach/ciclos">Abrir</a></div><p class="muted" style="margin-top:10px">${esc(resumoCiclo(cycles.completed[0]))}</p></div>` :
    `<div class="card"><p class="muted">${cycles.open.length ? cycles.open.length + " intervenção(ões) aguardam resultado." : "Ainda não existe um ciclo completo de aprendizagem."}</p><a class="btn-link" href="#/head-coach/ciclos">Ver ciclos</a></div>`;

  setView("Head Coach", `
    <div class="card" style="margin-bottom:16px"><div class="row"><div class="grow"><div class="t">${esc(team.nome)}</div><div class="s">${esc(team.clube) || "Clube por definir"}${team.escalao ? " · " + esc(team.escalao) : ""}</div></div><a class="btn-link" href="#/head-coach/equipa">Configurar</a></div>
      <div class="divider"><div class="s">Estado atual</div><p style="font-weight:600">${esc(d.state.text)}</p></div>
      <div class="s">Modelo de jogo: ${d.game_model ? esc(d.game_model.name) : "não definido"} · <a class="btn-link" href="#/head-coach/modelo">${d.game_model ? "Editar" : "Criar"}</a></div></div>
    <div class="actions" style="margin-bottom:20px"><a class="btn" href="#/head-coach/chat">💬 Perguntar ao Head Coach</a><a class="btn ghost" href="#/head-coach/memoria/novo">+ Evidência</a><a class="btn ghost" href="#/head-coach/memoria">Memória</a></div>
    <section style="margin-bottom:24px"><div class="head"><h2>Prioridades</h2></div><ul class="list">${priorities}</ul></section>
    <section style="margin-bottom:24px"><div class="head"><h2>Próximo treino</h2></div>${nextTrainingHtml}</section>
    <section style="margin-bottom:24px"><div class="head"><h2>Último jogo</h2></div>${lastMatchHtml}</section>
    <section style="margin-bottom:24px"><div class="head"><h2>Jogadores que precisam de atenção</h2></div>${players}</section>
    <section style="margin-bottom:24px"><div class="head"><h2>Evolução</h2></div>${results}</section>
    <section style="margin-bottom:24px"><div class="head"><h2>Ciclo de aprendizagem</h2><a class="btn-link" href="#/head-coach/ciclos">Todos</a></div>${learning}</section>
    <section><div class="head"><h2>Últimas observações</h2><a class="btn-link" href="#/head-coach/memoria">Todas</a></div>${observations}</section>`);
}

async function viewHeadCoachMemory() {
  const team = await HeadCoachMemory.ensureTeam();
  const gameModel = await HeadCoachMemory.currentGameModel(team.id);
  const items = await HeadCoachMemory.list(team.id, { kind: state.fmem });
  const pills = MEMORY_KINDS.map((k) => `<button class="pill ${state.fmem === k ? "on" : ""}" data-action="fmem" data-kind="${k}">${MEMORY_KIND_LABELS[k]}</button>`).join("");
  const rows = items.length ? `<ul class="list">${items.map((m) => `
    <li><a class="card" style="display:block" href="#/head-coach/memoria/${m.id}">
      <div class="row"><span class="tag grama">${esc(MEMORY_KIND_LABELS[m.kind])}</span><span class="grow"></span><span class="s">${fmtData((m.occurred_at || "").slice(0, 10))}</span></div>
      <div class="t" style="margin-top:8px">${esc(m.title)}</div>
      <div class="s" style="margin-top:3px">Fonte: ${esc(m.source?.label || m.source?.type || "—")}</div>
    </a></li>`).join("")}</ul>` : `<div class="empty"><div class="big">🧠</div>Ainda sem registos${state.fmem ? " desta classificação" : ""}.</div>`;
  setView("Memória da equipa", `
    <div class="card" style="margin-bottom:16px">
      <div class="row"><div class="grow"><div class="t">${esc(team.nome)}</div><div class="s">${esc(team.clube) || "Clube por definir"}${team.escalao ? " · " + esc(team.escalao) : ""}</div></div>
        <a class="btn-link" href="#/head-coach/equipa">Configurar</a></div>
      <div class="divider"><div class="s">Modelo de jogo</div><div>${gameModel ? esc(gameModel.name) : "Ainda não definido"} · <a class="btn-link" href="#/head-coach/modelo">${gameModel ? "Editar" : "Criar"}</a></div></div>
    </div>
    <div class="head"><a class="btn-link" href="#/head-coach">← Dashboard</a><a class="btn sm" href="#/head-coach/memoria/novo">+ Registar</a></div>
    <div class="muted" style="margin-bottom:10px">${items.length} registo(s)</div>
    <div class="pills" style="margin-bottom:16px"><button class="pill ${!state.fmem ? "on" : ""}" data-action="fmem" data-kind="">Todos</button>${pills}</div>
    ${rows}
    <div class="card" style="margin-top:16px">
      <h2 style="font-weight:700;margin-bottom:6px">Importação privada</h2>
      <p class="muted" style="font-size:12px;margin-bottom:10px">Faz merge de um pacote ${HEAD_COACH_MEMORY_SCHEMA}; não substitui o backup atual.</p>
      <label class="btn ghost" style="width:100%;cursor:pointer">Importar dados da equipa
        <input type="file" accept="application/json" data-action="importar-equipa" hidden></label>
    </div>`);
}

async function viewTeamForm() {
  const t = await HeadCoachMemory.ensureTeam();
  setView("Configurar equipa", `<form class="stack" data-form="team" data-id="${esc(t.id)}">
    <label class="field"><span>Nome da equipa *</span><input name="nome" required value="${esc(t.nome)}"></label>
    <label class="field"><span>Clube</span><input name="clube" value="${esc(t.clube)}"></label>
    <div class="grid2"><label class="field"><span>Escalão</span><input name="escalao" value="${esc(t.escalao)}"></label>
      <label class="field"><span>Época</span><input name="epoca" placeholder="2026/27" value="${esc(t.epoca)}"></label></div>
    <div class="grid2"><label class="field"><span>Competição</span><input name="competicao" value="${esc(t.competicao)}"></label>
      <label class="field"><span>Formato</span><input name="formato" placeholder="5v5" value="${esc(t.formato)}"></label></div>
    <label class="field"><span>Horários</span><textarea name="horarios" rows="3" placeholder="Segunda e quinta, 19:15–20:30">${esc(t.horarios?.texto)}</textarea></label>
    <div class="actions"><button class="btn" type="submit">Guardar</button><a class="btn ghost" href="#/head-coach">Cancelar</a></div>
  </form>`);
}

async function viewGameModelForm() {
  const team = await HeadCoachMemory.ensureTeam();
  const m = await HeadCoachMemory.currentGameModel(team.id);
  setView("Modelo de jogo", `<form class="stack" data-form="game-model" data-id="${m?.id || ""}">
    <label class="field"><span>Nome *</span><input name="name" required value="${esc(m?.name || "Modelo de jogo")}"></label>
    <label class="field"><span>Em vigor desde</span><input type="date" name="effective_from" value="${esc(m?.effective_from || new Date().toISOString().slice(0, 10))}"></label>
    <label class="field"><span>Com bola</span><textarea name="with_ball" rows="6" placeholder="Um princípio concreto por linha">${esc(m?.with_ball)}</textarea></label>
    <label class="field"><span>Sem bola</span><textarea name="without_ball" rows="6" placeholder="Um princípio concreto por linha">${esc(m?.without_ball)}</textarea></label>
    <label class="field"><span>Princípios gerais</span><textarea name="principles" rows="4" placeholder="Um princípio por linha">${esc((m?.principles || []).join("\n"))}</textarea></label>
    <div class="actions"><button class="btn" type="submit">Guardar</button><a class="btn ghost" href="#/head-coach">Cancelar</a></div>
  </form>`);
}

function memorySubjectLabel(type) {
  return { player: "Jogador", training: "Treino", match: "Jogo", team: "Equipa" }[type] || type;
}

async function viewMemoryForm(id, subjectType, subjectId, seedId, forcedKind) {
  const item = id ? await HeadCoachMemory.get(id) : null;
  const seed = seedId ? await HeadCoachMemory.get(seedId) : null;
  if ((id && !item) || (seedId && !seed)) return go("#/head-coach");
  const kindDefault = MEMORY_KINDS.includes(forcedKind) ? forcedKind : (item?.kind || "observation");
  const seeded = prepararLigacaoSeguinte(seed, kindDefault);
  const active = (await HeadCoachMemory.list()).filter((m) => !item || m.id !== item.id);
  const selectedEvidence = new Set([...(item?.evidence_ids || []), ...seeded.evidence_ids]);
  const selectedRelated = new Set([...(item?.related_ids || []), ...seeded.related_ids]);
  const ref = item?.subject_refs?.[0] || seeded.subject_refs[0] ||
    (subjectType && subjectId ? { type: subjectType, id: subjectId, relation: "about" } : null);
  const [players, trainings, matches] = await Promise.all([
    DB.porIndice("jogadores", "team_id", DEFAULT_TEAM_ID),
    DB.porIndice("treinos", "team_id", DEFAULT_TEAM_ID),
    DB.porIndice("jogos", "team_id", DEFAULT_TEAM_ID),
  ]);
  const currentSubject = ref ? ref.type + ":" + ref.id : "";
  const subjectOptions = [
    '<option value="">Equipa (geral)</option>',
    ...players.sort((a,b) => a.nome.localeCompare(b.nome)).map((p) => `<option value="player:${p.id}">Jogador · ${esc(p.nome)}</option>`),
    ...trainings.sort((a,b) => String(b.data).localeCompare(String(a.data))).map((t) => `<option value="training:${t.id}">Treino · ${fmtData(t.data)} · ${esc(t.escalao)}</option>`),
    ...matches.sort((a,b) => String(b.data).localeCompare(String(a.data))).map((m) => `<option value="match:${m.id}">Jogo · ${fmtData(m.data)} vs ${esc(m.adversario)}</option>`),
  ].join("").replace(`value="${esc(currentSubject)}"`, `value="${esc(currentSubject)}" selected`);
  const links = active.length ? active.map((m) => `<label class="pill memory-choice"><input type="checkbox" name="evidence_ids" value="${m.id}" ${selectedEvidence.has(m.id) ? "checked" : ""}>${MEMORY_KIND_LABELS[m.kind]} · ${esc(m.title)}</label>`).join("") : '<span class="muted">Ainda não existem outros registos.</span>';
  const related = active.length ? active.map((m) => `<label class="pill memory-choice"><input type="checkbox" name="related_ids" value="${m.id}" ${selectedRelated.has(m.id) ? "checked" : ""}>${MEMORY_KIND_LABELS[m.kind]} · ${esc(m.title)}</label>`).join("") : '<span class="muted">Ainda não existem outros registos.</span>';
  const chainRoot = item?.metadata?.chain_root_id || seeded.chain_root_id || "";
  setView(id ? "Rever memória" : "Novo registo", `<form class="stack" data-form="memory" data-id="${id || ""}">
    ${seed ? `<div class="card"><div class="s">Continuação do ciclo</div><a class="btn-link" href="#/head-coach/memoria/${seed.id}">${esc(MEMORY_KIND_LABELS[seed.kind])} · ${esc(seed.title)}</a></div>` : ""}
    <label class="field"><span>Classificação *</span><select name="kind" required>${MEMORY_KINDS.map((k) => `<option value="${k}" ${kindDefault === k ? "selected" : ""}>${MEMORY_KIND_LABELS[k]}</option>`).join("")}</select>
      <div class="hint">Observação → Diagnóstico → Decisão → Intervenção → Resultado. Um facto exige fonte confirmável.</div></label>
    <label class="field"><span>Associado a</span><select name="subject_key">${subjectOptions}</select></label>
    <label class="field"><span>Título</span><input name="title" value="${esc(item?.title || "")}"></label>
    <label class="field"><span>Conteúdo *</span><textarea name="content" rows="5" required>${esc(item?.content || "")}</textarea></label>
    <div class="grid2"><label class="field"><span>Data *</span><input type="date" name="occurred_at" required value="${esc((item?.occurred_at || new Date().toISOString()).slice(0, 10))}"></label>
      <label class="field"><span>Fonte *</span><input name="source_label" required value="${esc(item?.source?.label || "Treinador")}"></label></div>
    <label class="field"><span>Prioridade do Head Coach</span><select name="priority"><option value="">— ainda não definida —</option>${[1,2,3].map((n) => `<option value="${n}" ${Number(item?.metadata?.priority) === n ? "selected" : ""}>Prioridade ${n}</option>`).join("")}</select></label>
    <input type="hidden" name="source_type" value="${esc(item?.source?.type || "coach")}">
    <input type="hidden" name="chain_root_id" value="${esc(chainRoot)}">
    <div class="field"><span>Evidência</span><div class="pills memory-options">${links}</div>
      <div class="hint">Diagnóstico exige pelo menos uma evidência. O sistema preserva a origem e os IDs usados.</div></div>
    <div class="field"><span>Cadeia anterior</span><div class="pills memory-options">${related}</div>
      <div class="hint">Usa para ligar Decisão, Intervenção e Resultado aos passos anteriores.</div></div>
    <div class="actions"><button class="btn" type="submit">${id ? "Guardar revisão" : "Guardar"}</button><a class="btn ghost" href="${id ? "#/head-coach/memoria/" + id : "#/head-coach"}">Cancelar</a></div>
  </form>`);
}

async function viewMemoryDetail(id) {
  const m = await HeadCoachMemory.get(id);
  if (!m) return go("#/head-coach");
  const loadLinks = async (ids) => (await Promise.all((ids || []).map((x) => HeadCoachMemory.get(x)))).filter(Boolean);
  const [evidence, related] = await Promise.all([loadLinks(m.evidence_ids), loadLinks(m.related_ids)]);
  const linkList = (title, xs) => xs.length ? `<div class="divider"><div class="s" style="margin-bottom:6px">${title}</div>${xs.map((x) => `<a class="btn-link" style="display:block;margin:5px 0" href="#/head-coach/memoria/${x.id}">${esc(MEMORY_KIND_LABELS[x.kind])} · ${esc(x.title)}</a>`).join("")}</div>` : "";
  const next = proximoPassoMemoria(m.kind);
  const nextLabel = next ? MEMORY_KIND_LABELS[next] : null;
  const media = await renderMediaSection("memory", m.id);
  setView(MEMORY_KIND_LABELS[m.kind], `<div class="card" style="margin-bottom:16px">
    <div class="row"><span class="tag grama">${esc(MEMORY_KIND_LABELS[m.kind])}</span><span class="grow"></span><span class="s">${fmtData((m.occurred_at || "").slice(0, 10))}</span></div>
    <h2 style="font-weight:700;margin-top:12px">${esc(m.title)}</h2><p style="white-space:pre-line;margin-top:8px">${esc(m.content)}</p>
    <div class="divider"><dl class="info"><dt>Fonte</dt><dd>${esc(m.source?.label || "—")}</dd><dt>Estado</dt><dd>${esc(m.status)}</dd></dl></div>
    ${(m.subject_refs || []).map((r) => `<div class="s">${esc(memorySubjectLabel(r.type))} #${esc(r.id)}</div>`).join("")}
    ${linkList("Evidência", evidence)}${linkList("Cadeia relacionada", related)}
  </div>
  ${m.status === "active" ? `<div class="actions">${next ? `<a class="btn" href="#/head-coach/memoria/novo/from/${m.id}/${next}">→ ${esc(nextLabel)}</a>` : ""}<a class="btn ghost" href="#/head-coach/memoria/${m.id}/editar">Rever</a><button class="btn danger" data-action="arquivar-memoria" data-id="${m.id}">Arquivar</button></div>` : ""}
  ${media}`);
}

function chatClaimLabel(kind) {
  return { fact: "Facto", observation: "Observação", hypothesis: "Hipótese", diagnosis: "Diagnóstico" }[kind] || kind;
}

function chatMessageHTML(message) {
  if (message.role === "user") return `<div class="card" style="margin:0 0 12px 28px;background:var(--slate-100)"><div class="s">Treinador</div><p style="white-space:pre-line">${esc(message.text)}</p></div>`;
  const r = message.response || { summary: message.text, claims: [], uncertainties: [], questions: [], recommendations: [] };
  const claims = (r.claims || []).map((c) => `<div class="card" style="margin-top:8px"><span class="tag grama">${esc(chatClaimLabel(c.kind))}</span><p style="margin-top:6px">${esc(c.text)}</p>${c.evidence_ids?.length ? `<div class="s">Evidência: ${c.evidence_ids.map((id) => `<a class="btn-link" href="#/head-coach/memoria/${id}">#${id}</a>`).join(", ")}</div>` : ""}</div>`).join("");
  const uncertainties = r.uncertainties?.length ? `<div class="divider"><div class="s">O que ainda não sabemos</div><ul style="padding-left:20px">${r.uncertainties.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>` : "";
  const questions = r.questions?.length ? `<div class="divider"><div class="s">Perguntas úteis</div><ul style="padding-left:20px">${r.questions.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>` : "";
  const recs = (r.recommendations || []).map((rec) => {
    const done = rec.status !== "proposed";
    const status = { accepted: "Aceite", changed: "Alterada e aceite", rejected: "Rejeitada" }[rec.status] || "Proposta";
    return `<div class="card" style="margin-top:10px;border-color:var(--grama)"><div class="row"><span class="t grow">${esc(rec.title)}</span><span class="tag">${status}</span></div>
      <p style="margin-top:6px">${esc(rec.action)}</p>${rec.rationale ? `<p class="muted" style="margin-top:5px">${esc(rec.rationale)}</p>` : ""}
      ${rec.measurement ? `<div class="divider"><div class="s">Como medir</div><p>${esc(rec.measurement)}</p></div>` : ""}
      ${done ? (rec.memory_id ? `<a class="btn-link" href="#/head-coach/memoria/${rec.memory_id}">Ver decisão na memória</a>` : "") : `<div class="actions" style="margin-top:10px"><button class="btn sm" data-action="chat-rec" data-message="${message.id}" data-rec="${esc(rec.id)}" data-decision="accept">Aceitar</button><button class="btn sm ghost" data-action="chat-rec" data-message="${message.id}" data-rec="${esc(rec.id)}" data-decision="change" data-text="${esc(rec.action)}">Alterar</button><button class="btn sm danger" data-action="chat-rec" data-message="${message.id}" data-rec="${esc(rec.id)}" data-decision="reject">Rejeitar</button></div>`}
    </div>`;
  }).join("");
  return `<div class="card" style="margin:0 28px 16px 0"><div class="s">Head Coach IA</div><p style="white-space:pre-line;font-weight:600;margin-top:5px">${esc(r.summary)}</p>${claims}${uncertainties}${questions}${recs}</div>`;
}

async function viewHeadCoachChat(conversationId) {
  const conversations = await HeadCoachEngine.listConversations();
  const conversation = conversationId ? await HeadCoachEngine.getConversation(conversationId) : null;
  if (conversationId && !conversation) return go("#/head-coach/chat");
  const messages = conversation ? await HeadCoachEngine.getMessages(conversation.id) : [];
  const configured = !!iaConfig().key;
  const consented = localStorage.getItem("head_coach_context_consent") === "1";
  const history = conversations.length ? `<div class="pills" style="margin-bottom:14px"><a class="pill ${!conversation ? "on" : ""}" href="#/head-coach/chat">Nova</a>${conversations.slice(0, 8).map((c) => `<a class="pill ${conversation?.id === c.id ? "on" : ""}" href="#/head-coach/chat/${c.id}">${esc(c.title)}</a>`).join("")}</div>` : "";
  const consent = consented ? `<div class="hint">🔒 O contexto relevante será enviado ao provider configurado. As conversas ficam guardadas neste dispositivo.</div>` : `<label class="card" style="display:flex;gap:8px;align-items:flex-start"><input type="checkbox" name="consent" value="1" required style="width:auto;margin-top:3px"><span><b>Autorizar envio de contexto</b><br><span class="s">A pergunta, nomes e observações relevantes podem ser enviados ao OpenRouter. Fotografias e o backup completo não são enviados.</span></span></label>`;
  setView("Perguntar ao Head Coach", `
    <div class="head"><a class="btn-link" href="#/head-coach">← Dashboard</a><a class="btn-link" href="#/dados">Configurar IA</a></div>
    ${history}
    ${configured ? "" : `<div class="card" style="margin-bottom:14px;border-color:var(--amber)">Falta a chave OpenRouter. <a class="btn-link" href="#/dados">Configurar em Dados → IA</a>.</div>`}
    <div class="chat-history">${messages.length ? messages.map(chatMessageHTML).join("") : `<div class="empty"><div class="big">💬</div>Pergunta sobre a equipa, um jogo, um treino ou um jogador. O contexto relevante é escolhido automaticamente.</div>`}</div>
    <form class="stack" data-form="head-coach-chat" data-conversation="${conversation?.id || ""}" style="margin-top:16px">
      <label class="field"><span>Pergunta</span><textarea name="question" rows="3" required placeholder="Ex.: O que devo trabalhar no próximo treino?"></textarea></label>
      ${consent}
      <button class="btn" type="submit" ${configured ? "" : "disabled"}>Enviar ao Head Coach</button>
      <p class="muted chat-error" style="color:var(--red);display:none"></p>
    </form>`);
}

// ---------- DADOS (cópia de segurança) ----------
async function viewDados() {
  const c = {};
  for (const s of ["jogadores", "exercicios", "treinos", "jogos", "memory_items", "media_items"]) c[s] = (await DB.listar(s)).length;
  setView("Dados", `
    <div class="card" style="margin-bottom:16px">
      <h2 style="font-weight:700;margin-bottom:8px">Cópia de segurança</h2>
      <p class="muted" style="margin-bottom:4px">Os dados vivem só neste dispositivo. Exporta com frequência para não perder nada.</p>
      <dl class="info" style="margin-top:8px">
        <dt>Jogadores</dt><dd>${c.jogadores}</dd><dt>Exercícios</dt><dd>${c.exercicios}</dd><dt>Treinos</dt><dd>${c.treinos}</dd><dt>Jogos</dt><dd>${c.jogos}</dd><dt>Memória</dt><dd>${c.memory_items}</dd><dt>Media</dt><dd>${c.media_items}</dd>
      </dl>
    </div>
    <div class="actions" style="flex-direction:column;gap:10px">
      <button class="btn" data-action="exportar" style="width:100%">⬇️ Exportar cópia (ficheiro)</button>
      <label class="btn ghost" style="width:100%;cursor:pointer">⬆️ Importar cópia
        <input type="file" accept="application/json" data-action="importar" hidden></label>
    </div>
    <p class="muted" style="font-size:12px;margin-top:12px">Importar substitui todos os dados atuais por os do ficheiro.</p>
    <div class="card" style="margin-top:16px">
      <h2 style="font-weight:700;margin-bottom:8px">Biblioteca de formação</h2>
      <p class="muted" style="margin-bottom:12px">Exercícios prontos para os sub-7 a sub-10 (jogos reduzidos, condução, passe, lúdicos…). Adicionar não apaga nem substitui os teus.</p>
      <button class="btn ghost" data-action="carregar-base" style="width:100%">📚 Adicionar biblioteca-base de exercícios</button>
    </div>
    <div class="card" style="margin-top:16px">
      <h2 style="font-weight:700;margin-bottom:8px">IA — gerar treinos</h2>
      <p class="muted" style="margin-bottom:12px">A chave fica só neste dispositivo (nunca no backup nem online). Cria uma em <b>openrouter.ai</b>. Cada treino gerado custa cêntimos.</p>
      <form class="stack" data-form="ia-config">
        <label class="field"><span>Chave OpenRouter</span>
          <input type="password" name="key" placeholder="${iaConfig().key ? "•••••••• (guardada)" : "sk-or-..."}" autocomplete="off"></label>
        <label class="field"><span>Modelo</span><input name="modelo" value="${esc(iaConfig().modelo)}"></label>
        <button class="btn" type="submit" style="width:100%">Guardar definições de IA</button>
      </form>
      <button class="btn ghost" data-action="ia-testar" style="width:100%;margin-top:8px">🔑 Testar chave</button>
    </div>`);
}

// ---------- ações (delegação de eventos) ----------
app.addEventListener("click", async (ev) => {
  const alvo = ev.target.closest("[data-action]");
  if (!alvo) return;
  const a = alvo.dataset.action;
  if (a === "fj") { ev.preventDefault(); state.fj = alvo.dataset.e || null; return viewJogadores(); }
  if (a === "fmem") { ev.preventDefault(); state.fmem = alvo.dataset.kind || null; return viewHeadCoachMemory(); }
  if (a === "ia-testar") {
    alvo.disabled = true; alvo.textContent = "🔑 A testar…";
    try { alert(await iaTestarChave()); } catch (e) { alert("Erro de rede: " + e.message); }
    alvo.disabled = false; alvo.textContent = "🔑 Testar chave";
    return;
  }
  if (a === "apagar-jogador") {
    if (confirm("Apagar este jogador?")) { await apagarJogadorCascata(alvo.dataset.id); go("#/jogadores"); }
  }
  if (a === "apagar-avaliacao") {
    if (confirm("Apagar esta avaliação?")) { await DB.apagar("avaliacoes", alvo.dataset.id); router(); }
  }
  if (a === "apagar-exercicio") {
    if (confirm("Apagar este exercício?")) { await DB.apagar("exercicios", alvo.dataset.id); go("#/exercicios"); }
  }
  if (a === "apagar-treino") {
    if (confirm("Apagar este treino?")) { await apagarTreinoCascata(alvo.dataset.id); go("#/treinos"); }
  }
  if (a === "apagar-item") {
    await DB.apagar("treino_itens", alvo.dataset.item); router();
  }
  if (a === "mover") { await moverItem(alvo.dataset.item, alvo.dataset.dir); router(); }
  if (a === "presenca") { await marcarPresenca(alvo.dataset.jog, alvo.dataset.est); router(); }
  if (a === "exportar") { await exportar(); }
  if (a === "partilhar-treino") { await partilharTreino(alvo.dataset.id); }
  if (a === "gcal-treino") { await gcalTreino(alvo.dataset.id); }
  if (a === "partilhar-jogo") { await partilharJogo(alvo.dataset.id); }
  if (a === "gcal-jogo") { await gcalJogo(alvo.dataset.id); }
  if (a === "apagar-jogo") {
    if (confirm("Apagar este jogo?")) { await DB.apagar("jogos", alvo.dataset.id); go("#/calendario"); }
  }
  if (a === "arquivar-memoria") {
    if (confirm("Arquivar este registo? O histórico será preservado.")) { await HeadCoachMemory.archive(alvo.dataset.id); go("#/head-coach"); }
  }
  if (a === "apagar-media") {
    if (confirm("Remover este media associado?")) { await HeadCoachMedia.remove(alvo.dataset.id); return router(); }
  }
  if (a === "chat-rec") {
    const decision = alvo.dataset.decision;
    let changed = null;
    if (decision === "change") {
      changed = prompt("Altera a recomendação antes de a guardar como decisão:", alvo.dataset.text || "");
      if (changed == null) return;
    }
    await HeadCoachEngine.actOnRecommendation(alvo.dataset.message, alvo.dataset.rec, decision, changed);
    return router();
  }
  if (a === "carregar-base") {
    const n = (typeof EXERCICIOS_BASE !== "undefined") ? EXERCICIOS_BASE.length : 0;
    if (!confirm(`Adicionar a biblioteca-base de exercícios de formação (${n})? Não apaga nem substitui os teus.`)) return;
    alvo.disabled = true;
    const add = await carregarBibliotecaBase();
    alert(add ? `${add} exercício(s) adicionado(s).` : "Já tens todos os exercícios da biblioteca-base.");
    router();
  }
});

app.addEventListener("change", async (ev) => {
  const a = ev.target.dataset.action;
  if (a === "fcat") { state.fcat = ev.target.value || null; viewExercicios(); }
  if (a === "fesc") { state.fesc = ev.target.value || null; viewExercicios(); }
  if (a === "escalao-gerar") {
    const top = focoDoUltimoTreino(await DB.listar("treinos"), ev.target.value) || "";
    const foco = ev.target.closest("form").querySelector('[name="foco"]');
    if (foco) foco.value = top;
  }
  if (a === "foto") {
    const f = ev.target.files[0];
    if (!f) return;
    try {
      const url = await fotoRedimensionar(f);
      ev.target.dataset.url = url; // o submit lê daqui (já reduzida)
      const av = ev.target.closest(".field").querySelector(".avatar");
      if (av) av.innerHTML = `<img src="${esc(url)}" alt="">`;
      const rm = ev.target.closest(".field").querySelector('[name="foto_remover"]');
      if (rm) rm.checked = false;
    } catch (_) { alert("Não consegui ler essa imagem. Tenta outra."); }
  }
  if (a === "importar") { await importar(ev.target.files[0]); }
  if (a === "importar-equipa") { await importarPacoteEquipa(ev.target.files[0]); }
});

app.addEventListener("submit", async (ev) => {
  const form = ev.target.closest("form[data-form]");
  if (!form) return;
  ev.preventDefault();
  const tipo = form.dataset.form;
  const id = form.dataset.id ? Number(form.dataset.id) : null;
  const fd = new FormData(form);
  const num = (v) => (v === "" || v == null ? null : Number(v));
  const txt = (v) => (v === "" || v == null ? null : v);

  if (tipo === "jogador") {
    // a foto não vem no FormData já reduzida: o handler de change guardou-a em dataset.url.
    // sem foto nova e sem remoção, preserva a que lá está (senão editar o jogador apagava-a).
    const atual = id ? await DB.obter("jogadores", id) : null;
    const inpFoto = form.querySelector('[name="foto"]');
    const foto = fd.get("foto_remover") ? null : ((inpFoto && inpFoto.dataset.url) || atual?.foto || null);
    const obj = { nome: fd.get("nome"), escalao: fd.get("escalao"), data_nasc: txt(fd.get("data_nasc")),
      posicao: txt(fd.get("posicao")), pe: txt(fd.get("pe")), numero: num(fd.get("numero")), notas: txt(fd.get("notas")),
      foto };
    const novoId = await salvar("jogadores", id, obj);
    return go("#/jogadores/" + novoId);
  }
  if (tipo === "team") {
    await HeadCoachMemory.saveTeam({ id: form.dataset.id || DEFAULT_TEAM_ID, nome: fd.get("nome"), clube: txt(fd.get("clube")),
      escalao: txt(fd.get("escalao")), epoca: txt(fd.get("epoca")), competicao: txt(fd.get("competicao")),
      formato: txt(fd.get("formato")), horarios: txt(fd.get("horarios")) ? { texto: fd.get("horarios") } : null });
    return go("#/head-coach");
  }
  if (tipo === "game-model") {
    await HeadCoachMemory.saveGameModel({ id, team_id: DEFAULT_TEAM_ID, name: fd.get("name"), effective_from: fd.get("effective_from"),
      with_ball: txt(fd.get("with_ball")), without_ball: txt(fd.get("without_ball")),
      principles: String(fd.get("principles") || "").split(/\r?\n/).map((x) => x.trim()).filter(Boolean) });
    return go("#/head-coach");
  }
  if (tipo === "media") {
    const subjectType = form.dataset.subjectType, subjectId = form.dataset.subjectId;
    const f = fd.get("file");
    try {
      const dataUrl = f && f.size ? await ficheiroDataURL(f) : null;
      await HeadCoachMedia.create({
        team_id: DEFAULT_TEAM_ID, subject_type: subjectType, subject_id: subjectId,
        type: fd.get("type"), title: txt(fd.get("title")), url: txt(fd.get("url")), data_url: dataUrl,
        file_name: f && f.size ? f.name : null, mime_type: f && f.size ? f.type : null,
        size: f && f.size ? f.size : null, note: txt(fd.get("note")),
      });
      return go(subjectHref(subjectType, subjectId));
    } catch (e) { alert(e.message); return; }
  }
  if (tipo === "memory") {
    const subjectKey = txt(fd.get("subject_key"));
    let subjectType = null, subjectId = null;
    if (subjectKey && subjectKey.includes(":")) {
      const cut = subjectKey.indexOf(":");
      subjectType = subjectKey.slice(0, cut);
      subjectId = subjectKey.slice(cut + 1);
    }
    const atual = id ? await HeadCoachMemory.get(id) : null;
    const metadata = { ...(atual?.metadata || {}) };
    const priority = num(fd.get("priority")), chainRoot = num(fd.get("chain_root_id"));
    if (priority) metadata.priority = priority; else delete metadata.priority;
    if (chainRoot) metadata.chain_root_id = chainRoot;
    const obj = {
      team_id: DEFAULT_TEAM_ID, kind: fd.get("kind"), title: txt(fd.get("title")), content: fd.get("content"),
      occurred_at: fd.get("occurred_at"),
      source: { type: fd.get("source_type") || "coach", label: fd.get("source_label"),
        ref_type: subjectType, ref_id: subjectId },
      subject_refs: subjectType && subjectId ? [{ type: subjectType, id: subjectId, relation: "about" }] : [],
      evidence_ids: fd.getAll("evidence_ids"), related_ids: fd.getAll("related_ids"), metadata,
    };
    try {
      const novoId = id ? await HeadCoachMemory.revise(id, obj) : await HeadCoachMemory.create(obj);
      return go("#/head-coach/memoria/" + novoId);
    } catch (e) { alert(e.message); return; }
  }
  if (tipo === "head-coach-chat") {
    const question = fd.get("question"), alreadyConsented = localStorage.getItem("head_coach_context_consent") === "1";
    const consent = alreadyConsented || fd.get("consent") === "1";
    const btn = form.querySelector('button[type="submit"]'), erro = form.querySelector(".chat-error");
    btn.disabled = true; btn.textContent = "A analisar contexto…"; erro.style.display = "none";
    const ac = new AbortController();
    const cancel = () => ac.abort(); window.addEventListener("hashchange", cancel, { once: true });
    try {
      const out = await HeadCoachEngine.ask({ conversationId: num(form.dataset.conversation), question, consent, signal: ac.signal });
      if (!alreadyConsented && consent) localStorage.setItem("head_coach_context_consent", "1");
      window.removeEventListener("hashchange", cancel);
      const target = "#/head-coach/chat/" + out.conversationId;
      if (location.hash === target) return viewHeadCoachChat(out.conversationId);
      return go(target);
    } catch (e) {
      window.removeEventListener("hashchange", cancel);
      if (e.name === "AbortError") return;
      erro.textContent = "Erro: " + e.message; erro.style.display = "block";
      btn.disabled = false; btn.textContent = "Enviar ao Head Coach";
    }
    return;
  }
  if (tipo === "exercicio") {
    const obj = { titulo: fd.get("titulo"), objetivo: txt(fd.get("objetivo")), categoria: txt(fd.get("categoria")),
      n_jogadores_min: num(fd.get("n_jogadores_min")), n_jogadores_max: num(fd.get("n_jogadores_max")),
      duracao_min: num(fd.get("duracao_min")), escaloes: fd.getAll("escaloes"),
      descricao: txt(fd.get("descricao")), material: txt(fd.get("material")) };
    const novoId = await salvar("exercicios", id, obj);
    return go("#/exercicios/" + novoId);
  }
  if (tipo === "treino") {
    const obj = { data: fd.get("data"), hora: txt(fd.get("hora")), escalao: fd.get("escalao"), notas: txt(fd.get("notas")) };
    const novoId = await salvar("treinos", id, obj);
    return go("#/treinos/" + novoId);
  }
  if (tipo === "dificuldades") {
    const store = form.dataset.store;
    const reg = await DB.obter(store, id);
    if (reg) { reg.dificuldades = fd.getAll("dif"); reg.dif_nota = txt(fd.get("dif_nota")); await DB.atualizar(store, reg); }
    alert("Dificuldades guardadas.");
    return router();
  }
  if (tipo === "jogo") {
    const obj = { data: fd.get("data"), hora: txt(fd.get("hora")), escalao: fd.get("escalao"),
      adversario: fd.get("adversario"), casa_fora: fd.get("casa_fora"), local: txt(fd.get("local")),
      golos_favor: num(fd.get("golos_favor")), golos_contra: num(fd.get("golos_contra")), notas: txt(fd.get("notas")) };
    const novoId = await salvar("jogos", id, obj);
    return go("#/jogos/" + novoId);
  }
  if (tipo === "avaliacao") {
    const jogId = Number(form.dataset.jog);
    const obj = { jogador_id: jogId, data: fd.get("data"), notas: txt(fd.get("notas")) };
    DIMENSOES.forEach(([k]) => { obj[k] = num(fd.get(k)); });
    await salvar("avaliacoes", id, obj);
    return go("#/jogadores/" + jogId);
  }
  if (tipo === "add-item") {
    const treinoId = Number(location.hash.split("/")[2]);
    const itens = (await DB.porIndice("treino_itens", "treino_id", treinoId)).filter((it) => it.parte !== "gr");
    const ordem = itens.reduce((m, it) => Math.max(m, it.ordem), -1) + 1;
    await DB.criar("treino_itens", { treino_id: treinoId, parte: "equipa", exercicio_id: num(fd.get("exercicio_id")), ordem, duracao_min: num(fd.get("duracao_min")) });
    return router();
  }
  if (tipo === "ia-config") {
    iaGuardarConfig(txt(fd.get("key")), fd.get("modelo")); // key vazia -> não sobrescreve a guardada
    alert("Definições de IA guardadas.");
    return viewDados();
  }
  if (tipo === "gerar-treino") {
    const btn = form.querySelector('button[type="submit"]');
    const erroEl = form.querySelector(".iaerro");
    btn.disabled = true; btn.textContent = "🤖 A gerar… (pode demorar uns segundos)";
    erroEl.style.display = "none";
    // se o utilizador sair deste ecrã antes de a IA responder, cancela o pedido em vez de
    // deixá-lo terminar mais tarde a apontar para um formulário que já não está visível.
    const ac = new AbortController();
    const cancelarAoSair = () => ac.abort();
    window.addEventListener("hashchange", cancelarAoSair, { once: true });
    try {
      const treinoId = await gerarTreinoIA(fd.get("escalao"), txt(fd.get("foco")), num(fd.get("n_jogadores")), fd.get("data"), txt(fd.get("hora")), num(fd.get("duracao_min")), ac.signal);
      window.removeEventListener("hashchange", cancelarAoSair);
      return go("#/treinos/" + treinoId);
    } catch (e) {
      window.removeEventListener("hashchange", cancelarAoSair);
      if (e.name === "AbortError") return; // já saiu deste ecrã; nada para mostrar
      erroEl.textContent = "Erro: " + e.message; erroEl.style.display = "block";
      btn.disabled = false; btn.textContent = "🤖 Gerar treino";
    }
    return;
  }
});

// ---------- helpers de dados ----------
async function salvar(store, id, obj) {
  if (id) { obj.id = id; await DB.atualizar(store, obj); return id; }
  return await DB.criar(store, obj);
}
async function apagarJogadorCascata(id) {
  id = Number(id);
  for (const av of await DB.porIndice("avaliacoes", "jogador_id", id)) await DB.apagar("avaliacoes", av.id);
  for (const p of await DB.listar("presencas")) if (p.jogador_id === id) await DB.apagar("presencas", p.id);
  await DB.apagar("jogadores", id);
}
async function apagarTreinoCascata(id) {
  id = Number(id);
  for (const it of await DB.porIndice("treino_itens", "treino_id", id)) await DB.apagar("treino_itens", it.id);
  for (const p of await DB.porIndice("presencas", "treino_id", id)) await DB.apagar("presencas", p.id);
  await DB.apagar("treinos", id);
}
async function moverItem(itemId, dir) {
  const item = await DB.obter("treino_itens", itemId);
  const parte = item.parte || "equipa";
  const itens = (await DB.porIndice("treino_itens", "treino_id", item.treino_id))
    .filter((i) => (i.parte || "equipa") === parte).sort((a, b) => a.ordem - b.ordem);
  const idx = itens.findIndex((i) => i.id === item.id);
  const alvo = dir === "cima" ? idx - 1 : idx + 1;
  if (alvo < 0 || alvo >= itens.length) return;
  const o = itens[idx].ordem; itens[idx].ordem = itens[alvo].ordem; itens[alvo].ordem = o;
  await DB.atualizar("treino_itens", itens[idx]);
  await DB.atualizar("treino_itens", itens[alvo]);
}
async function marcarPresenca(jogId, estado) {
  const treinoId = Number(location.hash.split("/")[2]);
  jogId = Number(jogId);
  const existentes = await DB.porIndice("presencas", "treino_id", treinoId);
  const p = existentes.find((x) => x.jogador_id === jogId);
  if (p) { p.estado = estado; await DB.atualizar("presencas", p); }
  else { await DB.criar("presencas", { treino_id: treinoId, jogador_id: jogId, estado }); }
}

// ---------- biblioteca-base de exercícios ----------
// Carrega os exercícios de formação embutidos (js/exercicios_base.js), sem duplicar.
// A deduplicação usa a `chave` estável (recuo: título) — reexecutar só adiciona os que faltam.
async function carregarBibliotecaBase() {
  const base = (typeof EXERCICIOS_BASE !== "undefined") ? EXERCICIOS_BASE : [];
  if (!base.length) { alert("Biblioteca-base indisponível."); return 0; }
  const existentes = await DB.listar("exercicios");
  const chaves = new Set(existentes.map((e) => e.chave).filter(Boolean));
  const titulos = new Set(existentes.map((e) => e.titulo));
  let adicionados = 0;
  for (const ex of base) {
    if (chaves.has(ex.chave) || titulos.has(ex.titulo)) continue;
    await DB.criar("exercicios", { ...ex });
    adicionados++;
  }
  return adicionados;
}

// ---------- partilhar treino (texto -> WhatsApp/outros via Web Share; fallback wa.me) ----------
// Tira a linha de metadados da IA (🤖) das notas — não vai na mensagem partilhada.
function notasLimpas(notas) {
  return (notas || "").split("\n").filter((l) => !l.trimStart().startsWith("🤖")).join("\n").trim();
}
function linhaTreino(it, i, exMap) {
  const ex = exMap[it.exercicio_id];
  const dur = it.duracao_min != null ? it.duracao_min : (ex && ex.duracao_min != null ? ex.duracao_min : "");
  let l = `${i + 1}. ${it.bloco ? "[" + it.bloco + "] " : ""}${ex ? ex.titulo : "(exercício apagado)"} — ${dur}′${it.com_gr ? " 🧤" : ""}`;
  if (it.nota) l += `\n   • ${it.nota}`;
  return l;
}
function textoTreino(t, itens, itensGR, exMap, total, totalGR) {
  const equipa = itens.map((it, i) => linhaTreino(it, i, exMap)).join("\n");
  const gr = itensGR.length
    ? `\n\n🧤 Guarda-redes (treino individual) — ${totalGR} min:\n${itensGR.map((it, i) => linhaTreino(it, i, exMap)).join("\n")}`
    : "";
  const resumo = notasLimpas(t.notas);
  return `🗓️ Treino ${t.escalao} — ${fmtData(t.data)}${t.hora ? " " + t.hora : ""}\n${resumo ? resumo + "\n" : ""}\nPlano (${total} min):\n${equipa}${gr}\n`;
}
async function partilharTreino(id) {
  const t = await DB.obter("treinos", id);
  if (!t) return;
  const exMap = Object.fromEntries((await DB.listar("exercicios")).map((e) => [e.id, e]));
  const todos = (await DB.porIndice("treino_itens", "treino_id", Number(id))).sort((a, b) => a.ordem - b.ordem);
  const itens = todos.filter((it) => it.parte !== "gr");
  const itensGR = todos.filter((it) => it.parte === "gr");
  const total = itens.reduce((s, it) => s + durItem(it, exMap[it.exercicio_id]), 0);
  const totalGR = itensGR.reduce((s, it) => s + durItem(it, exMap[it.exercicio_id]), 0);
  const texto = textoTreino(t, itens, itensGR, exMap, total, totalGR);
  try {
    if (navigator.share) { await navigator.share({ title: `Treino ${t.escalao}`, text: texto }); return; }
  } catch (e) {
    if (e && e.name === "AbortError") return; // utilizador cancelou a partilha
  }
  window.open("https://wa.me/?text=" + encodeURIComponent(texto), "_blank"); // fallback (ex.: desktop)
}
async function gcalTreino(id) {
  const t = await DB.obter("treinos", id);
  if (!t) return;
  window.open(googleCalendarUrl({ titulo: `🗓️ Treino ${t.escalao}`, data: t.data, hora: t.hora, detalhes: notasLimpas(t.notas) }), "_blank");
}

// ---------- partilhar jogo (WhatsApp + Google Calendar) ----------
function textoJogo(j) {
  const r = resultadoJogo(j);
  const rotulo = { vitoria: "Vitória", empate: "Empate", derrota: "Derrota", por_jogar: "Por jogar" }[r.estado];
  const quando = `${fmtData(j.data)}${j.hora ? " " + j.hora : ""}`;
  const onde = `${j.casa_fora === "fora" ? "fora" : "casa"}${j.local ? " · " + j.local : ""}`;
  const res = r.texto ? `Resultado: ${r.texto} (${rotulo})` : "Ainda por jogar";
  return `⚽ ${j.escalao} vs ${j.adversario}\n${quando} · ${onde}\n${res}${j.notas ? "\n" + j.notas : ""}`;
}
async function partilharJogo(id) {
  const j = await DB.obter("jogos", id);
  if (!j) return;
  const texto = textoJogo(j);
  try {
    if (navigator.share) { await navigator.share({ title: `Jogo vs ${j.adversario}`, text: texto }); return; }
  } catch (e) { if (e && e.name === "AbortError") return; }
  window.open("https://wa.me/?text=" + encodeURIComponent(texto), "_blank");
}
async function gcalJogo(id) {
  const j = await DB.obter("jogos", id);
  if (!j) return;
  window.open(googleCalendarUrl({
    titulo: `⚽ ${j.escalao} vs ${j.adversario}`,
    data: j.data, hora: j.hora, detalhes: textoJogo(j), local: j.local || "", duracaoMin: 120,
  }), "_blank");
}

// ---------- backup ----------
async function exportar() {
  const payload = await DB.exportarTudo();
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `treinador-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}
async function importar(file) {
  if (!file) return;
  if (!confirm("Importar substitui todos os dados atuais. Continuar?")) return;
  try {
    const payload = JSON.parse(await file.text());
    if (!payload.dados) throw new Error("Ficheiro inválido.");
    await DB.importarTudo(payload, true);
    alert("Dados importados com sucesso.");
    viewDados();
  } catch (e) { alert("Erro ao importar: " + e.message); }
}

async function importarPacoteEquipa(file) {
  if (!file) return;
  try {
    const payload = JSON.parse(await file.text());
    const p = HeadCoachMemory.previewPackage(payload);
    const resumo = `${p.players} jogador(es), ${p.game_models} modelo(s) de jogo e ${p.memory_items} registo(s) de memória`;
    if (!confirm(`Importar por merge ${resumo}? Os dados atuais não serão apagados.`)) return;
    const c = await HeadCoachMemory.importPackage(payload);
    alert(`Importação concluída: ${c.players} jogador(es), ${c.game_models} modelo(s) e ${c.memory_items} memória(s).`);
    state.fmem = null;
    await viewHeadCoachMemory();
  } catch (e) { alert("Erro ao importar equipa: " + e.message); }
}

// ---------- arranque ----------
window.addEventListener("hashchange", router);
window.addEventListener("DOMContentLoaded", router);
if (document.readyState !== "loading") router();
