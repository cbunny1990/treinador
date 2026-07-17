// Camada de dados offline (IndexedDB). Sem servidor: tudo vive no telemóvel.
const DB_NOME = "treinador";
const DB_VERSAO = 1;
const STORES = ["jogadores", "exercicios", "treinos", "treino_itens", "presencas"];

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
