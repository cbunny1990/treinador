"use strict";

const WORKSPACE_DEFAULT_TEAM_ID = typeof DEFAULT_TEAM_ID === "undefined" ? "default" : DEFAULT_TEAM_ID;
const WORKSPACE_DOC_TYPES = ["training_plan", "match_analysis", "note", "brief"];
const WORKSPACE_DOC_LABELS = {
  training_plan: "Plano de treino",
  match_analysis: "Análise de jogo",
  note: "Nota",
  brief: "Briefing",
};
const WORKSPACE_STATUSES = ["draft", "ready", "approved", "archived"];
const WORKSPACE_ACTORS = ["human", "agent", "system"];

function wsText(value, max = 12000) {
  return String(value == null ? "" : value).trim().slice(0, max);
}
function wsActor(value) {
  const actor = wsText(value, 20) || "human";
  return WORKSPACE_ACTORS.includes(actor) ? actor : "human";
}
function wsRefs(value) {
  return (Array.isArray(value) ? value : []).map((ref) => ({
    type: wsText(ref?.type, 40),
    id: wsText(ref?.id, 100),
    relation: wsText(ref?.relation, 40) || "about",
  })).filter((ref) => ref.type && ref.id);
}
function wsNow() { return new Date().toISOString(); }
function wsDate(value) { return String(value || "").slice(0, 10); }
function wsEntityKey(type, id) {
  return type && id != null ? wsText(type, 40) + "|" + wsText(id, 100) : null;
}

function normalizarWorkspaceDocument(input, options = {}) {
  const now = options.now || wsNow();
  const type = wsText(input?.type, 40) || "note";
  if (!WORKSPACE_DOC_TYPES.includes(type)) throw new Error("Tipo de documento inválido.");
  const status = wsText(input?.status, 30) || "draft";
  if (!WORKSPACE_STATUSES.includes(status)) throw new Error("Estado de documento inválido.");
  const title = wsText(input?.title, 180);
  if (!title) throw new Error("O documento precisa de título.");
  return {
    team_id: wsText(input?.team_id || WORKSPACE_DEFAULT_TEAM_ID, 100),
    type,
    title,
    body: wsText(input?.body, 30000),
    status,
    target_date: wsText(input?.target_date, 20) || null,
    refs: wsRefs(input?.refs),
    created_by: wsActor(input?.created_by),
    created_by_label: wsText(input?.created_by_label, 120) || (wsActor(input?.created_by) === "agent" ? "Agente" : "Treinador"),
    updated_by: wsActor(input?.updated_by || input?.created_by),
    updated_by_label: wsText(input?.updated_by_label || input?.created_by_label, 120) || (wsActor(input?.updated_by || input?.created_by) === "agent" ? "Agente" : "Treinador"),
    created_at: wsText(input?.created_at, 40) || now,
    updated_at: now,
  };
}
function normalizarActivity(input, options = {}) {
  const now = options.now || wsNow();
  const actor = wsActor(input?.actor);
  const entityType = wsText(input?.entity_type, 40) || null;
  const entityId = input?.entity_id == null ? null : wsText(input.entity_id, 100);
  return {
    team_id: wsText(input?.team_id || WORKSPACE_DEFAULT_TEAM_ID, 100),
    actor,
    actor_label: wsText(input?.actor_label, 120) || (actor === "agent" ? "Agente" : actor === "system" ? "Sistema" : "Treinador"),
    action: wsText(input?.action, 60) || "updated",
    summary: wsText(input?.summary, 500),
    entity_type: entityType,
    entity_id: entityId,
    entity_key: wsEntityKey(entityType, entityId),
    metadata: input?.metadata && typeof input.metadata === "object" ? input.metadata : {},
    created_at: wsText(input?.created_at, 40) || now,
  };
}

function workspaceSortDesc(a, b) {
  return String(b.updated_at || b.created_at || b.occurred_at || b.data || "")
    .localeCompare(String(a.updated_at || a.created_at || a.occurred_at || a.data || ""));
}

function workspacePriority(memory) {
  const explicit = (memory || []).filter((item) =>
    item.status === "active" && Number(item.metadata?.priority) >= 1 && Number(item.metadata?.priority) <= 3);
  return explicit.sort((a, b) => Number(a.metadata.priority) - Number(b.metadata.priority) || workspaceSortDesc(a, b)).slice(0, 3);
}

function workspaceTimeline(data) {
  const rows = [];
  for (const item of data.activity || []) rows.push({
    type: "activity", date: item.created_at, title: item.summary || item.action,
    actor: item.actor, actor_label: item.actor_label, ref: item,
  });
  for (const item of data.documents || []) rows.push({
    type: "document", date: item.updated_at || item.created_at, title: item.title,
    actor: item.updated_by || item.created_by, actor_label: item.updated_by_label || item.created_by_label, ref: item,
  });
  for (const item of data.memory || []) rows.push({
    type: "memory", date: item.occurred_at || item.created_at, title: item.title,
    actor: item.metadata?.actor || "human", actor_label: item.metadata?.actor_label || item.source?.label || "Treinador", ref: item,
  });
  for (const item of data.matches || []) rows.push({
    type: "match", date: item.data, title: "Jogo · " + (item.adversario || "Adversário"), actor: "human", actor_label: "Equipa", ref: item,
  });
  for (const item of data.trainings || []) rows.push({
    type: "training", date: item.data, title: "Treino · " + (item.escalao || ""), actor: "human", actor_label: "Equipa", ref: item,
  });
  return rows.sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
}
const WorkspaceStore = {
  async listDocuments(teamId = WORKSPACE_DEFAULT_TEAM_ID, filters = {}) {
    let rows = (await DB.porIndice("workspace_documents", "team_id", teamId)).sort(workspaceSortDesc);
    if (!filters.includeArchived) rows = rows.filter((row) => row.status !== "archived");
    if (filters.type) rows = rows.filter((row) => row.type === filters.type);
    return rows;
  },
  async getDocument(id) { return DB.obter("workspace_documents", id); },
  async saveDocument(input) {
    const existing = input?.id ? await this.getDocument(input.id) : null;
    const actor = wsActor(input?.updated_by || input?.created_by);
    const actorLabel = wsText(input?.updated_by_label || input?.created_by_label, 120) || (actor === "agent" ? "Agente" : "Treinador");
    const row = normalizarWorkspaceDocument({
      ...(existing || {}),
      ...input,
      created_by: existing?.created_by || input?.created_by,
      created_by_label: existing?.created_by_label || input?.created_by_label,
      updated_by: actor,
      updated_by_label: actorLabel,
      created_at: existing?.created_at,
    });
    let id;
    if (existing) {
      id = existing.id;
      await DB.atualizar("workspace_documents", { ...row, id });
    } else id = await DB.criar("workspace_documents", row);
    await this.logActivity({
      team_id: row.team_id,
      actor,
      actor_label: actorLabel,
      action: existing ? "updated_document" : "created_document",
      summary: (existing ? "Atualizou " : "Criou ") + WORKSPACE_DOC_LABELS[row.type].toLowerCase() + " · " + row.title,
      entity_type: "document",
      entity_id: id,
    });
    return id;
  },
  async archiveDocument(id, actor = "human") {
    const row = await this.getDocument(id);
    if (!row) return false;
    await DB.atualizar("workspace_documents", { ...row, status: "archived", updated_at: wsNow() });
    await this.logActivity({
      team_id: row.team_id, actor, action: "archived_document",
      summary: "Arquivou documento · " + row.title, entity_type: "document", entity_id: id,
    });
    return true;
  },
  async logActivity(input) {
    return DB.criar("activity_items", normalizarActivity(input));
  },
  async listActivity(teamId = WORKSPACE_DEFAULT_TEAM_ID, limit = 30) {
    return (await DB.porIndice("activity_items", "team_id", teamId))
      .sort(workspaceSortDesc).slice(0, Math.max(1, Math.min(200, Number(limit) || 30)));
  },
  async captureObservation(input) {
    const actor = wsActor(input?.actor);
    const itemId = await HeadCoachMemory.create({
      team_id: input?.team_id || WORKSPACE_DEFAULT_TEAM_ID,
      kind: "observation",
      title: input?.title || "Observação",
      content: input?.content,
      occurred_at: input?.occurred_at || wsDate(wsNow()),
      source: { type: actor === "agent" ? "system" : "coach", label: input?.actor_label || (actor === "agent" ? "Agente" : "Treinador") },
      subject_refs: wsRefs(input?.refs),
      metadata: { actor, actor_label: input?.actor_label || (actor === "agent" ? "Agente" : "Treinador") },
    });
    await this.logActivity({
      team_id: input?.team_id || WORKSPACE_DEFAULT_TEAM_ID, actor, actor_label: input?.actor_label,
      action: "captured_observation", summary: "Registou observação · " + (input?.title || "Observação"),
      entity_type: "memory", entity_id: itemId,
    });
    return itemId;
  },
  async buildSnapshot(teamId = WORKSPACE_DEFAULT_TEAM_ID) {
    const today = wsDate(wsNow());
    const [team, players, matches, trainings, memory, documents, media, activity] = await Promise.all([
      HeadCoachMemory.ensureTeam(),
      DB.porIndice("jogadores", "team_id", teamId),
      DB.porIndice("jogos", "team_id", teamId),
      DB.porIndice("treinos", "team_id", teamId),
      HeadCoachMemory.list(teamId, { includeArchived: false }),
      this.listDocuments(teamId),
      DB.porIndice("media_items", "team_id", teamId),
      this.listActivity(teamId, 50),
    ]);
    const futureMatches = matches.filter((m) => wsDate(m.data) >= today).sort((a, b) => String(a.data).localeCompare(String(b.data)));
    const futureTrainings = trainings.filter((t) => wsDate(t.data) >= today).sort((a, b) => String(a.data).localeCompare(String(b.data)));
    const data = { team, players, matches, trainings, memory, documents, media, activity };
    return {
      ...data,
      next_match: futureMatches[0] || null,
      next_training: futureTrainings[0] || null,
      priorities: workspacePriority(memory),
      recent_documents: documents.slice(0, 4),
      recent_activity: activity.slice(0, 6),
      timeline: workspaceTimeline(data).slice(0, 100),
      agent_access: "not_connected",
    };
  },
};

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    WORKSPACE_DOC_TYPES, WORKSPACE_DOC_LABELS, WORKSPACE_STATUSES,
    normalizarWorkspaceDocument, normalizarActivity, workspaceTimeline, workspacePriority,
  };
}

