// Camada de dados offline (IndexedDB). Sem servidor: tudo vive no telemóvel.
const DB_NOME = "treinador";
const DB_VERSAO = 13;
const DEFAULT_TEAM_ID = "default";
const STORES = [
  "jogadores", "exercicios", "treinos", "treino_itens", "presencas", "avaliacoes", "jogos",
  "teams", "game_models", "memory_items",
  "head_coach_conversations", "head_coach_messages", "media_items",
  "workspace_documents", "activity_items", "sync_tombstones",
];
const SYNCABLE_STORES = new Set(["teams", "jogadores", "exercicios", "jogos", "treinos", "game_models", "memory_items", "workspace_documents", "activity_items", "media_items"]);

function _operationalIndexFields(store, row) {
  const next = { ...row };
  if (store === "activity_items") {
    next.operational_timeline_date = String(row?.created_at || "");
  } else if (store === "workspace_documents") {
    next.operational_timeline_date = String(row?.updated_at || row?.created_at || "");
  } else if (store === "memory_items") {
    next.operational_timeline_date = String(row?.occurred_at || row?.created_at || "");
  } else if (store === "jogos") {
    next.operational_timeline_date = String(row?.data || "");
    next.operational_proposal_status = row?.post_game?.analysis?.agent_proposal?.status || null;
  } else if (store === "treinos") {
    next.operational_timeline_date = String(row?.data || "");
    const completed = row?.status === "completed" || row?.session?.status === "completed";
    const review = row?.review || row?.session?.review;
    next.operational_needs_review = completed && review?.status !== "done" ? "pending" : "not_pending";
    next.operational_proposal_status = row?.continuity?.proposal?.status || null;
  }
  return next;
}

let _db = null;

function abrirDB() {
  return new Promise((resolve, reject) => {
    if (_db) return resolve(_db);
    const req = indexedDB.open(DB_NOME, DB_VERSAO);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains("jogadores"))
        db.createObjectStore("jogadores", { keyPath: "id", autoIncrement: true });
      let exercises;
      if (!db.objectStoreNames.contains("exercicios")) {
        exercises = db.createObjectStore("exercicios", { keyPath: "id", autoIncrement: true });
        exercises.createIndex("team_id", "team_id", { unique: false });
        exercises.createIndex("external_key", "external_key", { unique: false });
      } else {
        exercises = e.target.transaction.objectStore("exercicios");
        if (!exercises.indexNames.contains("team_id")) exercises.createIndex("team_id", "team_id", { unique: false });
        if (!exercises.indexNames.contains("external_key")) exercises.createIndex("external_key", "external_key", { unique: false });
      }
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

      let teams;
      if (!db.objectStoreNames.contains("teams")) {
        teams = db.createObjectStore("teams", { keyPath: "id" });
      } else teams = e.target.transaction.objectStore("teams");

      let gameModels;
      if (!db.objectStoreNames.contains("game_models")) {
        gameModels = db.createObjectStore("game_models", { keyPath: "id", autoIncrement: true });
        gameModels.createIndex("team_id", "team_id", { unique: false });
        gameModels.createIndex("external_key", "external_key", { unique: false });
      } else gameModels = e.target.transaction.objectStore("game_models");

      let memoryItems;
      if (!db.objectStoreNames.contains("memory_items")) {
        memoryItems = db.createObjectStore("memory_items", { keyPath: "id", autoIncrement: true });
        memoryItems.createIndex("team_id", "team_id", { unique: false });
        memoryItems.createIndex("team_kind", ["team_id", "kind"], { unique: false });
        memoryItems.createIndex("external_key", "external_key", { unique: false });
      } else memoryItems = e.target.transaction.objectStore("memory_items");

      if (!db.objectStoreNames.contains("head_coach_conversations")) {
        const conversations = db.createObjectStore("head_coach_conversations", { keyPath: "id", autoIncrement: true });
        conversations.createIndex("team_id", "team_id", { unique: false });
      }
      if (!db.objectStoreNames.contains("head_coach_messages")) {
        const messages = db.createObjectStore("head_coach_messages", { keyPath: "id", autoIncrement: true });
        messages.createIndex("conversation_id", "conversation_id", { unique: false });
      }
      if (!db.objectStoreNames.contains("media_items")) {
        const media = db.createObjectStore("media_items", { keyPath: "id", autoIncrement: true });
        media.createIndex("team_id", "team_id", { unique: false });
        media.createIndex("subject_key", "subject_key", { unique: false });
      }
      if (!db.objectStoreNames.contains("workspace_documents")) {
        const docs = db.createObjectStore("workspace_documents", { keyPath: "id", autoIncrement: true });
        docs.createIndex("team_id", "team_id", { unique: false });
        docs.createIndex("team_type", ["team_id", "type"], { unique: false });
      }
      if (!db.objectStoreNames.contains("activity_items")) {
        const activity = db.createObjectStore("activity_items", { keyPath: "id", autoIncrement: true });
        activity.createIndex("team_id", "team_id", { unique: false });
        activity.createIndex("entity_key", "entity_key", { unique: false });
      }
      if (!db.objectStoreNames.contains("sync_tombstones")) {
        const tombstones = db.createObjectStore("sync_tombstones", { keyPath: "id", autoIncrement: true });
        tombstones.createIndex("sync_id", "sync_id", { unique: false });
      }

      // A migração decorre na própria transação de upgrade: ou fica toda aplicada, ou nada muda.
      if (e.oldVersion < 4) {
        teams.put({
          id: DEFAULT_TEAM_ID, nome: "Equipa principal", clube: null, escalao: "sub-8",
          epoca: null, formato: null, competicao: null, horarios: null,
          created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
        });
      }
      for (const nome of ["jogadores", "treinos", "jogos", "memory_items", "workspace_documents", "activity_items"]) {
        const os = e.target.transaction.objectStore(nome);
        if (!os.indexNames.contains("team_id")) os.createIndex("team_id", "team_id", { unique: false });
        if ((nome === "treinos" || nome === "jogos") && !os.indexNames.contains("team_data")) {
          os.createIndex("team_data", ["team_id", "data"], { unique: false });
        }
        if (nome === "treinos") {
          if (!os.indexNames.contains("team_completed_review")) os.createIndex("team_completed_review", ["team_id", "operational_needs_review"], { unique: false });
        }
        if ((nome === "treinos" || nome === "jogos") && !os.indexNames.contains("team_proposal_status")) {
          os.createIndex("team_proposal_status", ["team_id", "operational_proposal_status"], { unique: false });
        }
        if (["activity_items", "jogos", "treinos"].includes(nome) && !os.indexNames.contains("team_timeline")) {
          os.createIndex("team_timeline", ["team_id", "operational_timeline_date"], { unique: false });
        }
        if (["memory_items", "workspace_documents"].includes(nome) && !os.indexNames.contains("team_status_timeline")) {
          os.createIndex("team_status_timeline", ["team_id", "status", "operational_timeline_date"], { unique: false });
        }
        os.openCursor().onsuccess = (ev) => {
          const cursor = ev.target.result;
          if (!cursor) return;
          const registo = cursor.value;
          const original = JSON.stringify(registo);
          if (!registo.team_id) registo.team_id = DEFAULT_TEAM_ID;
          const indexed = _operationalIndexFields(nome, registo);
          if (JSON.stringify(indexed) !== original) cursor.update(indexed);
          cursor.continue();
        };
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
function _syncUuid() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0, v = c === "x" ? r : (r & 3 | 8);
    return v.toString(16);
  });
}
function _selectedRemoteTeamId() {
  try { return JSON.parse(globalThis.localStorage?.getItem("treinador.remote.supabase.v1") || "{}").remoteTeamId || null; }
  catch (_) { return null; }
}
function _visibleInSelectedRemoteWorkspace(row) {
  const selected = _selectedRemoteTeamId();
  return !selected || !row?.remote_team_id || row.remote_team_id === selected;
}
function _prepareSyncRecord(store, obj, options = {}) {
  const indexed = _operationalIndexFields(store, obj);
  if (!SYNCABLE_STORES.has(store) || options.remote) return indexed;
  if (store === "exercicios" && !obj.workspace_v2 && !obj.sync_id) return indexed;
  const now = new Date().toISOString();
  const next = {
    ...indexed,
    sync_id: obj.sync_id || _syncUuid(),
    sync_dirty: true,
    sync_local_updated_at: now,
  };
  if (store === "teams") delete next.remote_team_id;
  else next.remote_team_id = obj.remote_team_id || _selectedRemoteTeamId() || null;
  if (store !== "activity_items") {
    next.sync_actor_type = "human";
    next.sync_actor_label = "Treinador";
  }
  return next;
}
function _notifyRemoteSync(store, options = {}) {
  if (options.remote || !SYNCABLE_STORES.has(store)) return;
  if (globalThis.RemoteWorkspace?.scheduleSync) globalThis.RemoteWorkspace.scheduleSync();
}
function _remoteTeamIdForTombstone(record) {
  try {
    return record?.remote_team_id || JSON.parse(globalThis.localStorage?.getItem("treinador.remote.supabase.v1") || "{}").remoteTeamId || null;
  } catch (_) { return null; }
}

const DB = {
  async listar(store) {
    const os = await _tx(store, "readonly");
    return _prom(os.getAll());
  },
  async obter(store, id) {
    const os = await _tx(store, "readonly");
    const row = await _prom(os.get(store === "teams" ? String(id) : Number(id)));
    return store === "teams" || _visibleInSelectedRemoteWorkspace(row) ? row : undefined;
  },
  async criar(store, obj, options = {}) {
    const os = await _tx(store, "readwrite");
    const id = await _prom(os.add(_prepareSyncRecord(store, obj, options)));
    _notifyRemoteSync(store, options);
    return id;
  },
  async criarWorkspaceDocumentSeAusente(obj) {
    if (!obj?.team_id || !obj?.type || !obj?.sync_id) throw new Error("Documento partilhado precisa de equipa, tipo e UUID estável.");
    const db = await abrirDB();
    let created = false;
    const result = await new Promise((resolve, reject) => {
      const tx = db.transaction("workspace_documents", "readwrite"), os = tx.objectStore("workspace_documents");
      let id, failure = null;
      const cursor = os.index("team_type").openCursor(IDBKeyRange.only([obj.team_id, obj.type]));
      cursor.onsuccess = () => {
        const row = cursor.result;
        if (row) {
          if (_visibleInSelectedRemoteWorkspace(row.value) && row.value.sync_id === obj.sync_id) { id = row.primaryKey; return; }
          row.continue();
          return;
        }
        try { created = true; const add = os.add(_prepareSyncRecord("workspace_documents", obj)); add.onsuccess = () => { id = add.result; }; add.onerror = () => { failure = add.error; }; }
        catch (error) { failure = error; tx.abort(); }
      };
      cursor.onerror = () => { failure = cursor.error; };
      tx.oncomplete = () => resolve({ id, created });
      tx.onabort = () => reject(failure || tx.error || new Error("Não foi possível guardar o documento partilhado."));
      tx.onerror = () => { failure = failure || tx.error; };
    });
    if (result.created) _notifyRemoteSync("workspace_documents");
    return result;
  },
  async atualizar(store, obj, options = {}) {
    const os = await _tx(store, "readwrite");
    const result = await _prom(os.put(_prepareSyncRecord(store, obj, options)));
    _notifyRemoteSync(store, options);
    return result;
  },
  async modificar(store, id, transform, options = {}) {
    const db=await abrirDB();
    return new Promise((resolve,reject)=>{
      const tx=db.transaction(store,"readwrite"),os=tx.objectStore(store);
      let result,failure;
      const req=os.get(store==="teams"?String(id):Number(id));
      req.onsuccess=()=>{
        try{
          if(!req.result) throw new Error("O registo foi apagado ou já não existe.");
          if(store!=="teams"&&!options.remote&&!_visibleInSelectedRemoteWorkspace(req.result)) throw new Error("O registo pertence a outro workspace remoto.");
          result=_prepareSyncRecord(store,transform(req.result),options);
          if(!result||result.id!==req.result.id||result.then) throw new Error("Alteração local inválida.");
          os.put(result);
        }catch(error){failure=error;tx.abort();}
      };
      tx.oncomplete=()=>{_notifyRemoteSync(store,options);resolve(result);};
      tx.onabort=()=>reject(failure||tx.error||new Error("Não foi possível guardar a alteração."));
      tx.onerror=()=>{failure=failure||tx.error;};
    });
  },
  async apagar(store, id, options = {}) {
    const key = store === "teams" ? String(id) : Number(id);
    const keepTombstone = SYNCABLE_STORES.has(store) && !options.remote;
    const db = await abrirDB();
    return new Promise((resolve, reject) => {
      const names = keepTombstone ? [store, "sync_tombstones"] : [store];
      const tx = db.transaction(names, "readwrite");
      const os = tx.objectStore(store);
      let failure = null;
      const remove = (anterior) => {
        try {
          if (options.expected && JSON.stringify(anterior) !== JSON.stringify(options.expected)) {
            failure = new Error("O registo local mudou antes da eliminação remota.");
            failure.code = "LOCAL_DELETE_CHANGED";
            tx.abort();
            return;
          }
          if (anterior && store !== "teams" && !options.remote && !_visibleInSelectedRemoteWorkspace(anterior)) {
            failure = new Error("O registo pertence a outro workspace remoto.");
            tx.abort();
            return;
          }
          os.delete(key);
          if (keepTombstone && anterior?.sync_id) tx.objectStore("sync_tombstones").add({
            store,
            sync_id: anterior.sync_id,
            team_id: anterior.team_id || DEFAULT_TEAM_ID,
            remote_team_id: _remoteTeamIdForTombstone(anterior),
            storage_path: anterior.storage_path || null,
            expected_updated_at: anterior.remote_updated_at || null,
            created_at: new Date().toISOString(),
          });
        } catch (error) {
          failure = error;
          tx.abort();
        }
      };
      if (keepTombstone || options.expected) {
        const request = os.get(key);
        request.onsuccess = () => remove(request.result);
        request.onerror = () => { failure = request.error; };
      } else os.delete(key);
      tx.oncomplete = () => { _notifyRemoteSync(store, options); resolve(true); };
      tx.onabort = () => reject(failure || tx.error || new Error("Não foi possível apagar o registo."));
      tx.onerror = () => { failure = failure || tx.error; };
    });
  },
  async porIndice(store, indice, valor) {
    const os = await _tx(store, "readonly");
    const rows = await _prom(os.index(indice).getAll(valor));
    return store === "teams" ? rows : rows.filter(_visibleInSelectedRemoteWorkspace);
  },
  async percorrerIndice(store, indice, valor, visitar) {
    if (typeof visitar !== "function") throw new TypeError("É necessário indicar como processar cada registo.");
    const os = await _tx(store, "readonly");
    return new Promise((resolve, reject) => {
      let count = 0;
      const request = os.index(indice).openCursor(IDBKeyRange.only(valor));
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) { resolve(count); return; }
        try {
          if (store === "teams" || _visibleInSelectedRemoteWorkspace(cursor.value)) {
            visitar(cursor.value);
            count++;
          }
          cursor.continue();
        } catch (error) {
          reject(error);
          try { os.transaction.abort(); } catch (_) {}
        }
      };
      request.onerror = () => reject(request.error || new Error("Não foi possível percorrer o índice local."));
      os.transaction.onabort = () => reject(os.transaction.error || new Error("A leitura local foi interrompida."));
    });
  },
  async percorrerIntervaloEquipa(store, teamId, from, until, visitar) {
    if (store !== "jogos" && store !== "treinos") throw new TypeError("O intervalo por equipa só está disponível para jogos e treinos.");
    if (typeof visitar !== "function") throw new TypeError("É necessário indicar como processar cada registo.");
    if (typeof teamId !== "string" || !teamId || typeof from !== "string" || typeof until !== "string" || from >= until) {
      throw new TypeError("Indica uma equipa e um intervalo de datas válido.");
    }
    const os = await _tx(store, "readonly");
    return new Promise((resolve, reject) => {
      let count = 0;
      // O limite superior inclui eventuais timestamps ISO no último dia; o callback
      // do calendário aplica o limite exclusivo pela data civil.
      const range = IDBKeyRange.bound([teamId, from], [teamId, until + "\uffff"]);
      const request = os.index("team_data").openCursor(range);
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) { resolve(count); return; }
        try {
          if (_visibleInSelectedRemoteWorkspace(cursor.value)) {
            visitar(cursor.value);
            count++;
          }
          cursor.continue();
        } catch (error) {
          reject(error);
          try { os.transaction.abort(); } catch (_) {}
        }
      };
      request.onerror = () => reject(request.error || new Error("Não foi possível percorrer o intervalo da equipa."));
      os.transaction.onabort = () => reject(os.transaction.error || new Error("A leitura local foi interrompida."));
    });
  },
  async primeiroIntervaloEquipa(store, teamId, from, predicate) {
    if (store !== "jogos" && store !== "treinos") throw new TypeError("O intervalo por equipa só está disponível para jogos e treinos.");
    if (typeof predicate !== "function") throw new TypeError("É necessário indicar como selecionar o registo.");
    if (typeof teamId !== "string" || !teamId || typeof from !== "string") throw new TypeError("Indica uma equipa e uma data inicial válida.");
    const os = await _tx(store, "readonly");
    return new Promise((resolve, reject) => {
      const range = IDBKeyRange.bound([teamId, from], [teamId, "\uffff"]);
      const request = os.index("team_data").openCursor(range);
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) { resolve(null); return; }
        try {
          if (_visibleInSelectedRemoteWorkspace(cursor.value) && predicate(cursor.value)) { resolve(cursor.value); return; }
          cursor.continue();
        } catch (error) {
          reject(error);
          try { os.transaction.abort(); } catch (_) {}
        }
      };
      request.onerror = () => reject(request.error || new Error("Não foi possível procurar o próximo registo."));
      os.transaction.onabort = () => reject(os.transaction.error || new Error("A leitura local foi interrompida."));
    });
  },
  async percorrerValorEquipa(store, index, teamId, value, visitar) {
    if (typeof visitar !== "function") throw new TypeError("É necessário indicar como processar cada registo.");
    if (typeof teamId !== "string" || !teamId || !["string", "boolean", "number"].includes(typeof value)) throw new TypeError("Indica uma equipa e um valor de índice válido.");
    const os = await _tx(store, "readonly");
    return new Promise((resolve, reject) => {
      let count = 0;
      const request = os.index(index).openCursor(IDBKeyRange.only([teamId, value]));
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) { resolve(count); return; }
        try {
          if (store === "teams" || _visibleInSelectedRemoteWorkspace(cursor.value)) { visitar(cursor.value); count++; }
          cursor.continue();
        } catch (error) {
          reject(error);
          try { os.transaction.abort(); } catch (_) {}
        }
      };
      request.onerror = () => reject(request.error || new Error("Não foi possível percorrer o índice da equipa."));
      os.transaction.onabort = () => reject(os.transaction.error || new Error("A leitura local foi interrompida."));
    });
  },
  async percorrerEquipaMaisRecentes(store, teamId, limit, visitar, status = null) {
    const allStatusStores = new Set(["memory_items", "workspace_documents"]);
    const timelineStores = new Set(["activity_items", "jogos", "treinos"]);
    if (!allStatusStores.has(store) && !timelineStores.has(store)) throw new TypeError("Esta coleção não tem uma consulta de Timeline indexada.");
    if (typeof teamId !== "string" || !teamId || typeof visitar !== "function") throw new TypeError("Indica uma equipa e uma função de visita válidas.");
    if (allStatusStores.has(store) && (typeof status !== "string" || !status)) throw new TypeError("Indica o estado da Timeline a consultar.");
    const maximum = Math.max(1, Math.min(500, Math.floor(Number(limit) || 100)));
    const os = await _tx(store, "readonly");
    return new Promise((resolve, reject) => {
      const indexName = allStatusStores.has(store) ? "team_status_timeline" : "team_timeline";
      const range = allStatusStores.has(store)
        ? IDBKeyRange.bound([teamId, status, ""], [teamId, status, "\uffff"])
        : IDBKeyRange.bound([teamId, ""], [teamId, "\uffff"]);
      const request = os.index(indexName).openCursor(range, "prev");
      let count = 0;
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) { resolve(count); return; }
        try {
          if (_visibleInSelectedRemoteWorkspace(cursor.value)) {
            visitar(cursor.value);
            if (++count >= maximum) { resolve(count); return; }
          }
          cursor.continue();
        } catch (error) {
          reject(error);
          try { os.transaction.abort(); } catch (_) {}
        }
      };
      request.onerror = () => reject(request.error || new Error("Não foi possível ler a Timeline recente."));
      os.transaction.onabort = () => reject(os.transaction.error || new Error("A leitura local da Timeline foi interrompida."));
    });
  },
  async contarPorIndice(store, indice, valor) {
    const os = await _tx(store, "readonly");
    return new Promise((resolve, reject) => {
      let count = 0;
      const request = os.index(indice).openCursor(IDBKeyRange.only(valor));
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) { resolve(count); return; }
        if (store === "teams" || _visibleInSelectedRemoteWorkspace(cursor.value)) count++;
        cursor.continue();
      };
      request.onerror = () => reject(request.error || new Error("Não foi possível contar registos locais."));
      os.transaction.onabort = () => reject(os.transaction.error || new Error("A contagem local foi interrompida."));
    });
  },
  visivelNoWorkspaceAtivo(row) { return _visibleInSelectedRemoteWorkspace(row); },
  // Exportar/importar toda a base de dados (cópia de segurança).
  async exportarTudo() {
    const dados = {};
    for (const s of STORES) dados[s] = await this.listar(s);
    return { versao: DB_VERSAO, exportado_em: new Date().toISOString(), dados };
  },
  async importarTudo(payload, substituir = true) {
    if (!payload || !payload.dados) throw new Error("Ficheiro de backup inválido.");
    const db = await abrirDB();
    const tx = db.transaction(STORES, "readwrite");
    for (const s of STORES) {
      const os = tx.objectStore(s);
      if (substituir) os.clear();
      for (const registo of (payload.dados[s] || [])) {
        const base = (["jogadores", "treinos", "jogos"].includes(s) && !registo.team_id)
          ? { ...registo, team_id: DEFAULT_TEAM_ID } : registo;
        const normalizado = _operationalIndexFields(s, base);
        os.put(normalizado);
      }
    }
    return new Promise((resolve, reject) => {
      tx.oncomplete = async () => {
        // Backups v1-v3 não tinham equipa; backups parciais também podem omiti-la.
        if (!(await this.obter("teams", DEFAULT_TEAM_ID))) {
          const agora = new Date().toISOString();
          await this.atualizar("teams", { id: DEFAULT_TEAM_ID, nome: "Equipa principal", escalao: "sub-8", created_at: agora, updated_at: agora });
        }
        resolve(true);
      };
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error("Importação cancelada."));
    });
  },
  async gravarRevisaoMemoria(anterior, nova) {
    const db = await abrirDB();
    const tx = db.transaction("memory_items", "readwrite");
    const os = tx.objectStore("memory_items");
    return new Promise((resolve, reject) => {
      let novoId;
      const novaSync = _prepareSyncRecord("memory_items", nova);
      const req = os.add(novaSync);
      req.onsuccess = () => {
        novoId = req.result;
        os.put(_prepareSyncRecord("memory_items", { ...anterior, status: "superseded", superseded_by_id: novoId, updated_at: nova.updated_at }));
      };
      tx.oncomplete = () => { _notifyRemoteSync("memory_items"); resolve(novoId); };
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error("Revisão cancelada."));
    });
  },
  async gravarRevisaoModelo(anterior, novo) {
    const db = await abrirDB();
    const tx = db.transaction("game_models", "readwrite");
    const os = tx.objectStore("game_models");
    return new Promise((resolve, reject) => {
      let novoId;
      const novoSync = _prepareSyncRecord("game_models", novo);
      const req = os.add(novoSync);
      req.onsuccess = () => {
        novoId = req.result;
        os.put(_prepareSyncRecord("game_models", { ...anterior, status: "superseded", superseded_by_id: novoId, updated_at: novo.updated_at }));
      };
      tx.oncomplete = () => { _notifyRemoteSync("game_models"); resolve(novoId); };
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error("Revisão do modelo cancelada."));
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

// ------- dificuldades (evolução do treino) -------
// Tags fixas; servem também de "foco" na geração.
const DIFICULDADES = [
  "Passe e receção", "Condução / drible", "Finalização", "Jogos reduzidos / decisão",
  "Defesa / marcação", "Organização / posição", "Condição física", "Guarda-redes",
  "Coordenação", "Atenção / comportamento",
];

// Junta treinos+jogos do escalão com dificuldades registadas, ordena por data desc, usa os últimos nUlt.
// Devolve { tags (por frequência e recência), notas, top }.
function dificuldadesRecentes(treinos, jogos, escalao, nUlt = 4) {
  const eventos = [...(treinos || []), ...(jogos || [])]
    .filter((e) => e.escalao === escalao && (e.dificuldades || []).length)
    .sort((a, b) => (a.data < b.data ? 1 : a.data > b.data ? -1 : 0))
    .slice(0, nUlt);
  const freq = new Map(); // tag -> {n, ordem} (ordem = índice do 1º aparecimento, mais recente = menor)
  eventos.forEach((e, i) => (e.dificuldades || []).forEach((t) => {
    const f = freq.get(t) || { n: 0, ordem: i };
    f.n++; freq.set(t, f);
  }));
  const tags = [...freq.entries()].sort((a, b) => b[1].n - a[1].n || a[1].ordem - b[1].ordem).map(([t]) => t);
  const notas = eventos.map((e) => e.dif_nota).filter(Boolean);
  return { tags, notas, top: tags[0] || null };
}

// Foco sugerido = a 1ª dificuldade registada no ÚLTIMO treino do escalão (o mais recente).
function focoDoUltimoTreino(treinos, escalao) {
  const ult = (treinos || [])
    .filter((t) => t.escalao === escalao && (t.dificuldades || []).length)
    .sort((a, b) => (a.data < b.data ? 1 : a.data > b.data ? -1 : (b.id || 0) - (a.id || 0)))[0];
  return ult ? (ult.dificuldades[0] || null) : null;
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
  for (const t of (treinos || [])) evs.push({ tipo: "treino", data: t.data, hora: t.hora || null, ref: t });
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

  // dificuldadesRecentes: escalão, recência, frequência, nUlt
  const dr = dificuldadesRecentes(
    [
      { escalao: "sub-8", data: "2026-07-01", dificuldades: ["Finalização"], dif_nota: "n1" },
      { escalao: "sub-8", data: "2026-07-10", dificuldades: ["Passe e receção", "Finalização"] },
      { escalao: "sub-9", data: "2026-07-15", dificuldades: ["Defesa / marcação"] }, // outro escalão -> ignorado
    ],
    [{ escalao: "sub-8", data: "2026-07-12", dificuldades: ["Finalização"], dif_nota: "n2" }],
    "sub-8", 4);
  assert(dr.top === "Finalização", "top = mais frequente (Finalização 3x): " + dr.top);
  assert(dr.tags.includes("Passe e receção") && !dr.tags.includes("Defesa / marcação"), "só tags do escalão certo");
  assert(dr.notas.length === 2, "junta as notas dos eventos");
  const dr0 = dificuldadesRecentes([], [], "sub-7");
  assert(dr0.top === null && dr0.tags.length === 0, "sem dados -> top null");
  console.log("ok db dificuldadesRecentes: escalão, frequência, recência, top");

  // focoDoUltimoTreino: 1ª dificuldade do treino mais recente do escalão
  assert(focoDoUltimoTreino([
    { id: 1, escalao: "sub-8", data: "2026-07-10", dificuldades: ["Passe e receção"] },
    { id: 2, escalao: "sub-8", data: "2026-07-16", dificuldades: ["Finalização", "Defesa / marcação"] },
    { id: 3, escalao: "sub-9", data: "2026-07-18", dificuldades: ["Coordenação"] },
  ], "sub-8") === "Finalização", "foco = 1ª dificuldade do último treino do escalão");
  assert(focoDoUltimoTreino([{ id: 5, escalao: "sub-8", data: "2026-07-20" }], "sub-8") === null, "treino sem dificuldades -> null");
  assert(focoDoUltimoTreino([], "sub-8") === null, "sem treinos -> null");
  console.log("ok db focoDoUltimoTreino: dificuldade do último treino");
}
