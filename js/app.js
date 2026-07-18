"use strict";

// ---------- constantes (espelham o backend) ----------
const CATEGORIAS = [
  "Coordenação / motricidade", "Domínio e condução de bola", "Passe e receção",
  "Remate / finalização", "Jogos reduzidos (SSG)", "Jogo final", "Jogos lúdicos",
];
const POSICOES = ["Guarda-redes", "Defesa", "Médio", "Avançado"];
const PES = ["Direito", "Esquerdo", "Ambos"];
const ESTADOS = [["presente", "P", "p"], ["ausente", "A", "a"], ["justificado", "J", "j"]];
const FASES = ["Aquecimento", "Técnica", "Jogo reduzido", "Jogo final"];

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
const state = { fj: null, fcat: null, fesc: null }; // filtros

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
    if (p[0] === "dados") return viewDados();
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
      <a class="tile" href="#/treinos/novo"><span class="ic">🆕</span><span class="t">Novo treino</span><span class="s">Planear uma sessão</span></a>
      <a class="tile" href="#/jogadores/novo"><span class="ic">➕</span><span class="t">Novo jogador</span><span class="s">Adicionar ao plantel</span></a>
      <a class="tile" href="#/dados"><span class="ic">💾</span><span class="t">Dados</span><span class="s">Cópia de segurança</span></a>
    </div>`);
}

// ---------- JOGADORES ----------
async function viewJogadores() {
  const todos = (await DB.listar("jogadores")).sort((a, b) => a.nome.localeCompare(b.nome));
  const lista = state.fj ? todos.filter((j) => escalaoDeJogador(j) === state.fj) : todos;
  const pills = ESCALOES.map((e) =>
    `<button class="pill ${state.fj === e ? "on" : ""}" data-action="fj" data-e="${e}">${e}</button>`).join("");
  const rows = lista.length ? `<ul class="list">${lista.map((j) => {
    const ini = j.numero != null ? j.numero : (j.nome[0] || "?").toUpperCase();
    const escal = escalaoDeJogador(j) || "sem escalão";
    return `<li><a class="row card" href="#/jogadores/${j.id}">
      <span class="avatar">${esc(ini)}</span>
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
  const ini = j.numero != null ? j.numero : (j.nome[0] || "?").toUpperCase();
  setView(j.nome, `
    <div class="card" style="margin-bottom:16px">
      <div class="row" style="margin-bottom:12px">
        <span class="avatar" style="width:56px;height:56px;font-size:20px">${esc(ini)}</span>
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
      <button class="btn danger" data-action="apagar-jogador" data-id="${j.id}">Apagar</button>
    </div>
    ${await secaoAvaliacoes(j)}`);
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

// Gerar treino de 90 min por IA (escalão + foco opcional).
async function viewGerarTreino() {
  const temChave = !!iaConfig().key;
  setView("Gerar treino (IA)", `
    <p class="muted" style="margin-bottom:16px">A IA monta um treino de 90 min a partir da tua biblioteca de exercícios, adaptado ao escalão. Precisa de internet; depois fica gravado e usável offline.</p>
    ${temChave ? "" : `<div class="card" style="margin-bottom:16px;border-color:var(--amber)">
      ⚠️ Falta a chave OpenRouter. Configura em <a href="#/dados">Dados → IA</a> antes de gerar.</div>`}
    <form class="stack" data-form="gerar-treino">
      <label class="field"><span>Escalão *</span><select name="escalao" required>
        ${ESCALOES.map((e) => `<option>${e}</option>`).join("")}</select></label>
      <label class="field"><span>Foco (opcional)</span>
        <input name="foco" placeholder="ex.: passe, condução, finalização…" list="focos-sugeridos">
        <datalist id="focos-sugeridos">${CATEGORIAS.map((c) => `<option value="${c}">`).join("")}</datalist>
        <div class="hint">Vazio → a IA equilibra as categorias.</div></label>
      <label class="field"><span>Nº de jogadores (opcional)</span>
        <input type="number" name="n_jogadores" min="1" placeholder="automático (conta o plantel do escalão)">
        <div class="hint">A IA adapta os exercícios ao número que tens. Vazio → conta o teu plantel.</div></label>
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
  setView(id ? "Editar treino" : "Novo treino", `
    <form class="stack" data-form="treino" data-id="${id || ""}">
      <label class="field"><span>Data *</span><input type="date" name="data" required value="${esc(t?.data) || hoje}"></label>
      <label class="field"><span>Escalão *</span><select name="escalao" required>
        ${ESCALOES.map((e) => `<option ${t?.escalao === e ? "selected" : ""}>${e}</option>`).join("")}</select></label>
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

async function viewTreinoDetalhe(id) {
  const t = await DB.obter("treinos", id);
  if (!t) return go("#/treinos");
  const exercicios = (await DB.listar("exercicios")).sort((a, b) => a.titulo.localeCompare(b.titulo));
  const exMap = Object.fromEntries(exercicios.map((e) => [e.id, e]));
  const itens = (await DB.porIndice("treino_itens", "treino_id", Number(id))).sort((a, b) => a.ordem - b.ordem);
  const total = itens.reduce((s, it) => s + durItem(it, exMap[it.exercicio_id]), 0);

  const jogadores = (await DB.listar("jogadores"))
    .filter((j) => escalaoDeJogador(j) === t.escalao)
    .sort((a, b) => a.nome.localeCompare(b.nome));
  const presencas = await DB.porIndice("presencas", "treino_id", Number(id));
  const presMap = Object.fromEntries(presencas.map((p) => [p.jogador_id, p.estado]));
  const cont = { presente: 0, ausente: 0, justificado: 0 };
  presencas.forEach((p) => { if (cont[p.estado] != null) cont[p.estado]++; });

  const itensHtml = itens.length ? `<ol class="list" style="margin-bottom:12px">${itens.map((it, i) => {
    const ex = exMap[it.exercicio_id];
    const dur = it.duracao_min != null ? it.duracao_min : (ex && ex.duracao_min != null ? ex.duracao_min : "—");
    return `<li class="card item">
      <span class="num">${i + 1}</span>
      <span class="grow">${ex ? `<a class="t" href="#/exercicios/${ex.id}" style="text-decoration:none;color:inherit">${esc(ex.titulo)}</a><span class="s">${esc(it.bloco || ex.categoria || "sem categoria")}</span>${it.nota ? `<span class="s" style="color:var(--slate-400);font-style:italic">${esc(it.nota)}</span>` : ""}` : `<span class="t" style="color:var(--slate-400)">(exercício apagado)</span>`}</span>
      <span class="dur">${dur}′</span>
      <span class="reorder">
        <button data-action="mover" data-item="${it.id}" data-dir="cima" ${i === 0 ? "disabled" : ""}>▲</button>
        <button data-action="mover" data-item="${it.id}" data-dir="baixo" ${i === itens.length - 1 ? "disabled" : ""}>▼</button>
      </span>
      <button class="x" data-action="apagar-item" data-item="${it.id}">✕</button>
    </li>`;
  }).join("")}</ol>` : `<p class="muted" style="margin-bottom:12px">Ainda sem exercícios no plano.</p>`;

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
    return `<li class="card row"><span class="grow" style="font-weight:500">${esc(j.nome)}</span><span class="pbtns">${btns}</span></li>`;
  }).join("")}</ul>` : `<p class="muted">Sem jogadores no escalão ${esc(t.escalao)}. <a class="btn-link" href="#/jogadores/novo">Adiciona ao plantel</a>.</p>`;

  setView("Treino", `
    <div class="card" style="margin-bottom:16px">
      <div class="row"><div class="grow"><div style="font-weight:700;font-size:18px">${fmtData(t.data)}</div><div class="muted">${esc(t.escalao)}</div></div>
        <a class="btn-link" href="#/treinos/${t.id}/editar">Editar</a></div>
      ${t.notas ? `<p class="muted" style="margin-top:8px">${esc(t.notas)}</p>` : ""}
    </div>
    <section style="margin-bottom:24px">
      <div class="head"><h2>Plano da sessão</h2><span class="total">${total} min</span></div>
      <p class="muted" style="font-size:12px;margin-bottom:12px">Sugestão: ${FASES.join(" → ")}</p>
      ${itensHtml}${addHtml}
    </section>
    <section>
      <div class="head"><h2>Presenças</h2>
        <span class="muted count"><span class="p">${cont.presente}P</span> · <span class="a">${cont.ausente}A</span> · <span class="j">${cont.justificado}J</span></span></div>
      <p class="muted" style="font-size:12px;margin-bottom:8px">P = Presente · A = Ausente · J = Justificado</p>
      ${presHtml}
    </section>
    <div class="divider"><button class="btn-link red" data-action="apagar-treino" data-id="${t.id}">Apagar treino</button></div>`);
}

// ---------- DADOS (cópia de segurança) ----------
async function viewDados() {
  const c = {};
  for (const s of ["jogadores", "exercicios", "treinos"]) c[s] = (await DB.listar(s)).length;
  setView("Dados", `
    <div class="card" style="margin-bottom:16px">
      <h2 style="font-weight:700;margin-bottom:8px">Cópia de segurança</h2>
      <p class="muted" style="margin-bottom:4px">Os dados vivem só neste dispositivo. Exporta com frequência para não perder nada.</p>
      <dl class="info" style="margin-top:8px">
        <dt>Jogadores</dt><dd>${c.jogadores}</dd><dt>Exercícios</dt><dd>${c.exercicios}</dd><dt>Treinos</dt><dd>${c.treinos}</dd>
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
    </div>`);
}

// ---------- ações (delegação de eventos) ----------
app.addEventListener("click", async (ev) => {
  const alvo = ev.target.closest("[data-action]");
  if (!alvo) return;
  const a = alvo.dataset.action;
  if (a === "fj") { ev.preventDefault(); state.fj = alvo.dataset.e || null; return viewJogadores(); }
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
  if (a === "importar") { await importar(ev.target.files[0]); }
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
    const obj = { nome: fd.get("nome"), escalao: fd.get("escalao"), data_nasc: txt(fd.get("data_nasc")),
      posicao: txt(fd.get("posicao")), pe: txt(fd.get("pe")), numero: num(fd.get("numero")), notas: txt(fd.get("notas")) };
    const novoId = await salvar("jogadores", id, obj);
    return go("#/jogadores/" + novoId);
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
    const obj = { data: fd.get("data"), escalao: fd.get("escalao"), notas: txt(fd.get("notas")) };
    const novoId = await salvar("treinos", id, obj);
    return go("#/treinos/" + novoId);
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
    const itens = await DB.porIndice("treino_itens", "treino_id", treinoId);
    const ordem = itens.reduce((m, it) => Math.max(m, it.ordem), -1) + 1;
    await DB.criar("treino_itens", { treino_id: treinoId, exercicio_id: num(fd.get("exercicio_id")), ordem, duracao_min: num(fd.get("duracao_min")) });
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
    try {
      const treinoId = await gerarTreinoIA(fd.get("escalao"), txt(fd.get("foco")), num(fd.get("n_jogadores")));
      return go("#/treinos/" + treinoId);
    } catch (e) {
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
  const itens = (await DB.porIndice("treino_itens", "treino_id", item.treino_id)).sort((a, b) => a.ordem - b.ordem);
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

// ---------- arranque ----------
window.addEventListener("hashchange", router);
window.addEventListener("DOMContentLoaded", router);
if (document.readyState !== "loading") router();
