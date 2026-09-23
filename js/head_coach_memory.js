"use strict";

// Memória persistente da equipa. Não conhece fornecedores de IA: devolve apenas dados
// estruturados e com proveniência, utilizáveis offline e por qualquer provider futuro.
const HEAD_COACH_MEMORY_SCHEMA = "treinador-team-memory@1";
const HEAD_COACH_DEFAULT_TEAM_ID = typeof DEFAULT_TEAM_ID === "undefined" ? "default" : DEFAULT_TEAM_ID;
const MEMORY_KINDS = ["fact", "observation", "hypothesis", "diagnosis", "decision", "intervention", "result"];
const MEMORY_KIND_LABELS = {
  fact: "Facto", observation: "Observação", hypothesis: "Hipótese",
  diagnosis: "Diagnóstico", decision: "Decisão", intervention: "Intervenção", result: "Resultado",
};
const MEMORY_STATUSES = ["active", "archived", "superseded"];
const MEMORY_SOURCE_TYPES = ["coach", "match", "training", "player", "video", "file", "system", "import"];

function memoryNow() { return new Date().toISOString(); }
function memoryDateOnly() { return memoryNow().slice(0, 10); }
function memoryText(value) { return value == null ? "" : String(value).trim(); }
function memoryIds(value) {
  return [...new Set((Array.isArray(value) ? value : []).map(Number).filter((n) => Number.isInteger(n) && n > 0))];
}
function memoryRefs(value) {
  return (Array.isArray(value) ? value : []).map((r) => ({
    type: memoryText(r.type), id: memoryText(r.id), relation: memoryText(r.relation) || "about",
  })).filter((r) => r.type && r.id);
}

function normalizarMemoryItem(input, options = {}) {
  const kind = memoryText(input.kind || "observation");
  if (!MEMORY_KINDS.includes(kind)) throw new Error("Classificação de memória inválida.");
  const content = memoryText(input.content);
  if (!content) throw new Error("Escreve o conteúdo da memória.");
  const source = {
    type: memoryText(input.source?.type || "coach"),
    label: memoryText(input.source?.label || (input.source?.type === "import" ? "Importação privada" : "Treinador")),
    ref_type: memoryText(input.source?.ref_type) || null,
    ref_id: memoryText(input.source?.ref_id) || null,
  };
  if (!MEMORY_SOURCE_TYPES.includes(source.type)) throw new Error("Tipo de origem inválido.");
  if (kind === "fact" && !source.label && !source.ref_id)
    throw new Error("Um facto precisa de uma fonte identificada.");

  const evidenceIds = memoryIds(input.evidence_ids);
  const relatedIds = memoryIds(input.related_ids);
  if (kind === "diagnosis" && evidenceIds.length === 0)
    throw new Error("Um diagnóstico precisa de pelo menos uma evidência ligada.");
  if (["intervention", "result"].includes(kind) && relatedIds.length === 0)
    throw new Error(`${MEMORY_KIND_LABELS[kind]} precisa de pelo menos um registo anterior ligado.`);

  const agora = options.now || memoryNow();
  const status = memoryText(input.status || "active");
  if (!MEMORY_STATUSES.includes(status)) throw new Error("Estado de memória inválido.");
  return {
    team_id: memoryText(input.team_id || HEAD_COACH_DEFAULT_TEAM_ID),
    kind,
    title: memoryText(input.title) || content.slice(0, 80),
    content,
    occurred_at: memoryText(input.occurred_at) || agora.slice(0, 10),
    source,
    subject_refs: memoryRefs(input.subject_refs),
    evidence_ids: evidenceIds,
    related_ids: relatedIds,
    metadata: input.metadata && typeof input.metadata === "object" ? input.metadata : {},
    status,
    external_key: memoryText(input.external_key) || null,
    supersedes_id: input.supersedes_id ? Number(input.supersedes_id) : null,
    created_at: memoryText(input.created_at) || agora,
    updated_at: agora,
  };
}

function normalizarTeam(input, options = {}) {
  const agora = options.now || memoryNow();
  return {
    id: memoryText(input.id || HEAD_COACH_DEFAULT_TEAM_ID),
    nome: memoryText(input.nome || "Equipa principal"),
    clube: memoryText(input.clube) || null,
    escalao: memoryText(input.escalao) || null,
    epoca: memoryText(input.epoca) || null,
    competicao: memoryText(input.competicao) || null,
    formato: memoryText(input.formato) || null,
    horarios: input.horarios && typeof input.horarios === "object" ? input.horarios : null,
    staff: input.staff && typeof input.staff === "object" ? input.staff : null,
    created_at: memoryText(input.created_at) || agora,
    updated_at: agora,
  };
}

function validarPacoteEquipa(payload) {
  if (!payload || payload.schema !== HEAD_COACH_MEMORY_SCHEMA)
    throw new Error(`Formato inválido: esperado ${HEAD_COACH_MEMORY_SCHEMA}.`);
  if (!payload.team || typeof payload.team !== "object") throw new Error("O pacote não contém uma equipa.");
  const team = normalizarTeam(payload.team);
  const gameModels = (payload.game_models || []).map((g) => ({ ...g, team_id: team.id }));
  const memoryItems = (payload.memory_items || []).map((m) => normalizarMemoryItem({ ...m, team_id: team.id }));
  const players = (payload.players || []).map((p) => ({ ...p, team_id: team.id }));
  return { team, gameModels, memoryItems, players };
}

const HeadCoachMemory = {
  async ensureTeam() {
    let team = await DB.obter("teams", HEAD_COACH_DEFAULT_TEAM_ID);
    if (!team) { team = normalizarTeam({ id: HEAD_COACH_DEFAULT_TEAM_ID }); await DB.atualizar("teams", team); }
    return team;
  },
  async getTeam(teamId = HEAD_COACH_DEFAULT_TEAM_ID) { return DB.obter("teams", teamId); },
  async saveTeam(input) {
    const atual = await DB.obter("teams", input.id || HEAD_COACH_DEFAULT_TEAM_ID);
    const team = normalizarTeam({ ...(atual || {}), ...input, created_at: atual?.created_at });
    await DB.atualizar("teams", team);
    return team;
  },
  async list(teamId = HEAD_COACH_DEFAULT_TEAM_ID, filters = {}) {
    let items = (await DB.listar("memory_items")).filter((m) => m.team_id === teamId && DB.visivelNoWorkspaceAtivo(m));
    if (!filters.includeArchived) items = items.filter((m) => m.status === "active");
    if (filters.kind) items = items.filter((m) => m.kind === filters.kind);
    if (filters.subjectType && filters.subjectId != null) items = items.filter((m) =>
      (m.subject_refs || []).some((r) => r.type === filters.subjectType && String(r.id) === String(filters.subjectId)));
    return items.sort((a, b) => String(b.occurred_at || b.created_at).localeCompare(String(a.occurred_at || a.created_at)) || (b.id || 0) - (a.id || 0));
  },
  async get(id) { return DB.obter("memory_items", id); },
  async create(input) {
    await this.ensureTeam();
    const item = normalizarMemoryItem(input);
    return DB.criar("memory_items", item);
  },
  async revise(id, changes) {
    const anterior = await this.get(id);
    if (!anterior) throw new Error("Registo de memória não encontrado.");
    if (anterior.status !== "active") throw new Error("Só é possível rever um registo ativo.");
    const agora = memoryNow();
    const nova = normalizarMemoryItem({ ...anterior, ...changes, id: undefined, supersedes_id: anterior.id, status: "active", created_at: agora }, { now: agora });
    delete nova.id;
    return DB.gravarRevisaoMemoria(anterior, nova);
  },
  async archive(id) {
    const item = await this.get(id);
    if (!item) throw new Error("Registo de memória não encontrado.");
    await DB.atualizar("memory_items", { ...item, status: "archived", updated_at: memoryNow() });
  },
  async currentGameModel(teamId = HEAD_COACH_DEFAULT_TEAM_ID) {
    return (await DB.porIndice("game_models", "team_id", teamId))
      .filter((m) => m.status === "active")
      .sort((a, b) => String(b.effective_from || b.created_at).localeCompare(String(a.effective_from || a.created_at)))[0] || null;
  },
  async saveGameModel(input) {
    const agora = memoryNow();
    const atual = input.id ? await DB.obter("game_models", input.id) : null;
    const model = {
      ...(atual || {}), team_id: memoryText(input.team_id || HEAD_COACH_DEFAULT_TEAM_ID),
      name: memoryText(input.name || "Modelo de jogo"),
      with_ball: memoryText(input.with_ball), without_ball: memoryText(input.without_ball),
      principles: Array.isArray(input.principles) ? input.principles.map(memoryText).filter(Boolean) : [],
      effective_from: memoryText(input.effective_from) || memoryDateOnly(), status: "active",
      external_key: memoryText(input.external_key) || null,
      created_at: atual?.created_at || agora, updated_at: agora,
    };
    if (atual) {
      delete model.id;
      model.supersedes_id = atual.id;
      model.created_at = agora;
      return DB.gravarRevisaoModelo(atual, model);
    }
    return DB.criar("game_models", model);
  },
  async buildContext(teamId = HEAD_COACH_DEFAULT_TEAM_ID, options = {}) {
    const limit = Math.max(1, Math.min(200, Number(options.limit) || 50));
    const [team, gameModel, memory, players, trainings, matches] = await Promise.all([
      this.getTeam(teamId), this.currentGameModel(teamId), this.list(teamId, { includeArchived: false }),
      DB.porIndice("jogadores", "team_id", teamId), DB.porIndice("treinos", "team_id", teamId), DB.porIndice("jogos", "team_id", teamId),
    ]);
    return {
      schema: "head-coach-context@1", generated_at: memoryNow(), team, game_model: gameModel,
      memory: memory.slice(0, limit),
      players: players.map((p) => ({ id: p.id, nome: p.nome, escalao: p.escalao, posicao: p.posicao })),
      recent_trainings: trainings.sort((a, b) => String(b.data).localeCompare(String(a.data))).slice(0, 5),
      recent_matches: matches.sort((a, b) => String(b.data).localeCompare(String(a.data))).slice(0, 5),
    };
  },
  previewPackage(payload) {
    const p = validarPacoteEquipa(payload);
    return { team: 1, players: p.players.length, game_models: p.gameModels.length, memory_items: p.memoryItems.length };
  },
  async importPackage(payload) {
    const p = validarPacoteEquipa(payload); // valida tudo antes da primeira escrita
    const counts = { teams: 0, players: 0, game_models: 0, memory_items: 0 };
    await this.saveTeam(p.team); counts.teams++;

    const jogadores = (await DB.listar("jogadores")).filter((row) => DB.visivelNoWorkspaceAtivo(row));
    const playerIds = new Map();
    for (const player of p.players) {
      const found = player.external_key ? jogadores.find((x) => x.external_key === player.external_key && x.team_id === p.team.id) : null;
      const reg = { ...player, team_id: p.team.id };
      let playerId;
      if (found) { reg.id = found.id; await DB.atualizar("jogadores", reg); playerId = found.id; }
      else playerId = await DB.criar("jogadores", reg);
      if (player.external_key) playerIds.set(player.external_key, playerId);
      counts.players++;
    }

    const models = (await DB.listar("game_models")).filter((row) => DB.visivelNoWorkspaceAtivo(row));
    for (const model of p.gameModels) {
      const found = model.external_key ? models.find((x) => x.external_key === model.external_key && x.team_id === p.team.id) : null;
      await this.saveGameModel({ ...model, id: found?.id }); counts.game_models++;
    }

    const existing = (await DB.listar("memory_items")).filter((row) => DB.visivelNoWorkspaceAtivo(row));
    for (const item of p.memoryItems) {
      item.subject_refs = (item.subject_refs || []).map((r) =>
        r.type === "player" && playerIds.has(String(r.id)) ? { ...r, id: String(playerIds.get(String(r.id))) } : r);
      if (item.source?.ref_type === "player" && playerIds.has(String(item.source.ref_id)))
        item.source.ref_id = String(playerIds.get(String(item.source.ref_id)));
      const found = item.external_key ? existing.find((x) => x.external_key === item.external_key && x.team_id === p.team.id && x.status === "active") : null;
      if (found) await this.revise(found.id, item);
      else await this.create(item);
      counts.memory_items++;
    }
    return counts;
  },
};

if (typeof module !== "undefined" && module.exports) {
  module.exports = { normalizarMemoryItem, normalizarTeam, validarPacoteEquipa, MEMORY_KINDS, HEAD_COACH_MEMORY_SCHEMA };
}

// Funções puras verificáveis em Node sem IndexedDB.
if (typeof window === "undefined" && typeof process !== "undefined") {
  const assert = (c, m) => { if (!c) { console.error("FALHOU:", m); process.exit(1); } };
  const obs = normalizarMemoryItem({ content: "A equipa juntou-se ao guarda-redes." }, { now: "2026-09-20T10:00:00.000Z" });
  assert(obs.kind === "observation" && obs.source.type === "coach", "opinião começa como observação do treinador");
  let diagnosisRejected = false;
  try { normalizarMemoryItem({ kind: "diagnosis", content: "Saída sob pressão." }); } catch (_) { diagnosisRejected = true; }
  assert(diagnosisRejected, "diagnóstico sem evidência é rejeitado");
  const pack = validarPacoteEquipa({ schema: HEAD_COACH_MEMORY_SCHEMA, team: { id: "t1", nome: "Teste" }, memory_items: [{ content: "Observação" }] });
  assert(pack.team.id === "t1" && pack.memoryItems[0].team_id === "t1", "pacote herda team_id");
  console.log("ok head_coach_memory: classificação, proveniência, validação e pacote privado");
}
