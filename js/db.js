// Camada de dados offline (IndexedDB). Sem servidor: tudo vive no telemóvel.
const DB_NOME = "treinador";
const DB_VERSAO = 3;
const STORES = ["jogadores", "exercicios", "treinos", "treino_itens", "presencas", "avaliacoes", "jogos"];

let _db = null;

function abrirDB() {
  return new Promise((resolve, reject) => {
    if (_db) return resolve(_db);
    const req = indexedDB.open(DB_NOME, DB_VERSAO);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains("jogadores"))
        db.createObjectStore("jogadores", { keyPath: "id", autoIncrement: true });
      if (!db.objectStoreNames.contains("exercicios"))
        db.createObjectStore("exercicios", { keyPath: "id", autoIncrement: true });
      if (!db.objectStoreNames.contains("treinos"))
        db.createObjectStore("treinos", { keyPath: "id", autoIncrement: true });
      if (!db.objectStoreNames.contains("treino_itens")) {
        const s = db.createObjectStore("treino_itens", { keyPath: "id", autoIncrement: true });
        s.createIndex("treino_id", "treino_id", { unique: false });
      }
      if (!db.objectStoreNames.contains("presencas")) {
        const s = db.createObjectStore("presencas", { keyPath: "id", autoIncrement: true });
        s.createIndex("treino_id", "treino_id", { unique: false });
      }
      if (!db.objectStoreNames.contains("avaliacoes")) {
        const s = db.createObjectStore("avaliacoes", { keyPath: "id", autoIncrement: true });
        s.createIndex("jogador_id", "jogador_id", { unique: false });
      }
      if (!db.objectStoreNames.contains("jogos"))
        db.createObjectStore("jogos", { keyPath: "id", autoIncrement: true });
    };
    req.onsuccess = () => { _db = req.result; resolve(_db); };
    req.onerror = () => reject(req.error);
  });
}

function _tx(store, modo) {
  return abrirDB().then((db) => db.transaction(store, modo).objectStore(store));
}
function _prom(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

const DB = {
  async listar(store) {
    const os = await _tx(store, "readonly");
    return _prom(os.getAll());
  },
  async obter(store, id) {
    const os = await _tx(store, "readonly");
    return _prom(os.get(Number(id)));
  },
  async criar(store, obj) {
    const os = await _tx(store, "readwrite");
    const id = await _prom(os.add(obj));
    return id;
  },
  async atualizar(store, obj) {
    const os = await _tx(store, "readwrite");
    return _prom(os.put(obj));
  },
  async apagar(store, id) {
    const os = await _tx(store, "readwrite");
    return _prom(os.delete(Number(id)));
  },
  async porIndice(store, indice, valor) {
    const os = await _tx(store, "readonly");
    return _prom(os.index(indice).getAll(valor));
  },
  // Exportar/importar toda a base de dados (cópia de segurança).
  async exportarTudo() {
    const dados = {};
    for (const s of STORES) dados[s] = await this.listar(s);
    return { versao: DB_VERSAO, exportado_em: new Date().toISOString(), dados };
  },
  async importarTudo(payload, substituir = true) {
    const db = await abrirDB();
    const tx = db.transaction(STORES, "readwrite");
    for (const s of STORES) {
      const os = tx.objectStore(s);
      if (substituir) os.clear();
      for (const registo of (payload.dados[s] || [])) os.put(registo);
    }
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  },
};

// ------- avaliações (escala 1-4 em 4 dimensões) -------
const DIMENSOES = [
  ["tecnica", "Técnica"],
  ["tatica", "Tática"],
  ["fisico", "Físico"],
  ["psico", "Psico-social"],
];
const NIVEIS = [
  [1, "Insuficiente"],
  [2, "Em desenvolvimento"],
  [3, "Bom"],
  [4, "Muito bom"],
];
function mediaAvaliacao(a) {
  if (!a) return null;
  const vs = DIMENSOES.map(([k]) => a[k]).filter((v) => typeof v === "number");
  if (!vs.length) return null;
  return vs.reduce((s, v) => s + v, 0) / vs.length;
}

// ------- regras de escalão (mesma lógica do backend, critério FPF) -------
const EPOCA_ANO_INICIO = 2025; // atualizar a cada nova época desportiva
const ESCALOES = ["sub-7", "sub-8", "sub-9", "sub-10"];
const _ESCALAO_POR_IDADE = { 7: "sub-7", 8: "sub-8", 9: "sub-9", 10: "sub-10" };

function escalaoDeDataNasc(dataNascISO) {
  if (!dataNascISO) return null;
  const ano = new Date(dataNascISO).getFullYear();
  return _ESCALAO_POR_IDADE[EPOCA_ANO_INICIO - ano + 1] || null;
}
// O escalão é definido pelo treinador. Registos antigos (sem campo) recuam à data de nascimento.
function escalaoDeJogador(j) {
  if (!j) return null;
  return j.escalao || escalaoDeDataNasc(j.data_nasc);
}
function idadeDeDataNasc(dataNascISO) {
  if (!dataNascISO) return null;
  const n = new Date(dataNascISO), h = new Date();
  let idade = h.getFullYear() - n.getFullYear();
  if (h.getMonth() < n.getMonth() || (h.getMonth() === n.getMonth() && h.getDate() < n.getDate())) idade--;
  return idade;
}

// ------- jogos: resultado, calendário, Google Calendar -------
function resultadoJogo(j) {
  const gf = j ? j.golos_favor : null, gc = j ? j.golos_contra : null;
  if (gf == null || gc == null) return { texto: null, estado: "por_jogar", cor: "var(--slate-400)" };
  const texto = `${gf}-${gc}`;
  if (gf > gc) return { texto, estado: "vitoria", cor: "var(--grama)" };
  if (gf < gc) return { texto, estado: "derrota", cor: "var(--red)" };
  return { texto, estado: "empate", cor: "var(--amber)" };
}

// Junta treinos e jogos numa lista ordenada por data (e hora), ascendente.
function eventosCalendario(treinos, jogos) {
  const evs = [];
  for (const t of (treinos || [])) evs.push({ tipo: "treino", data: t.data, hora: null, ref: t });
  for (const j of (jogos || [])) evs.push({ tipo: "jogo", data: j.data, hora: j.hora || null, ref: j });
  return evs.sort((a, b) =>
    a.data !== b.data ? (a.data < b.data ? -1 : 1)
      : ((a.hora || "") < (b.hora || "") ? -1 : (a.hora || "") > (b.hora || "") ? 1 : 0));
}

// URL para adicionar ao Google Calendar (sem API nem login — abre pré-preenchido).
function googleCalendarUrl({ titulo, data, hora, detalhes, local, duracaoMin = 90 }) {
  const so = (n) => String(n).padStart(2, "0");
  const [Y, M, D] = data.split("-").map(Number);
  let dates;
  if (hora) {
    const [h, mi] = hora.split(":").map(Number);
    const ini = new Date(Y, M - 1, D, h, mi);
    const fim = new Date(ini.getTime() + duracaoMin * 60000);
    const fmt = (d) => `${d.getFullYear()}${so(d.getMonth() + 1)}${so(d.getDate())}T${so(d.getHours())}${so(d.getMinutes())}00`;
    dates = `${fmt(ini)}/${fmt(fim)}`;
  } else {
    const fim = new Date(Y, M - 1, D + 1); // all-day: fim exclusivo = dia seguinte
    dates = `${data.replace(/-/g, "")}/${fim.getFullYear()}${so(fim.getMonth() + 1)}${so(fim.getDate())}`;
  }
  const p = new URLSearchParams({ action: "TEMPLATE", text: titulo || "Evento", dates });
  if (detalhes) p.set("details", detalhes);
  if (local) p.set("location", local);
  return "https://calendar.google.com/calendar/render?" + p.toString();
}

// ------- self-check (corre só em Node) -------
if (typeof window === "undefined" && typeof process !== "undefined") {
  const assert = (c, m) => { if (!c) { console.error("FALHOU:", m); process.exit(1); } };
  assert(resultadoJogo({ golos_favor: 3, golos_contra: 1 }).estado === "vitoria", "3-1 vitória");
  assert(resultadoJogo({ golos_favor: 1, golos_contra: 2 }).estado === "derrota", "1-2 derrota");
  assert(resultadoJogo({ golos_favor: 2, golos_contra: 2 }).estado === "empate", "2-2 empate");
  assert(resultadoJogo({ golos_favor: null, golos_contra: 1 }).estado === "por_jogar", "incompleto = por jogar");
  const evs = eventosCalendario(
    [{ data: "2026-08-01" }, { data: "2026-07-20" }],
    [{ data: "2026-07-20", hora: "15:00" }, { data: "2026-07-20", hora: "10:00" }]);
  assert(evs.length === 4, "4 eventos");
  assert(evs[0].data === "2026-07-20" && evs[3].data === "2026-08-01", "ordenado por data");
  assert(evs[1].hora === "10:00" && evs[2].hora === "15:00", "mesmo dia ordenado por hora (treino sem hora primeiro)");
  const u1 = googleCalendarUrl({ titulo: "Jogo sub-8", data: "2026-07-20", hora: "15:00", local: "Campo A" });
  assert(u1.includes("20260720T150000%2F20260720T163000"), "datas com hora +90min: " + u1);
  assert(/text=Jogo\+sub-8/.test(u1) && /location=Campo\+A/.test(u1), "titulo e local codificados");
  const u2 = googleCalendarUrl({ titulo: "Treino", data: "2026-07-20" });
  assert(u2.includes("20260720%2F20260721"), "all-day fim exclusivo = dia seguinte: " + u2);
  console.log("ok db jogos: resultado V/E/D, eventos ordenados, googleCalendarUrl (hora + all-day)");
}
