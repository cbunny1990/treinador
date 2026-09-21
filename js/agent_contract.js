"use strict";

const AGENT_WORKSPACE_SCHEMA = "treinador-agent-workspace@1";

function agentText(value, max) {
  return String(value == null ? "" : value).trim().slice(0, max || 12000);
}
function agentTeamId(value) {
  return agentText(value || (typeof DEFAULT_TEAM_ID === "undefined" ? "default" : DEFAULT_TEAM_ID), 100);
}
function agentPublicMedia(item) {
  return {
    id: item.id,
    type: item.type,
    title: item.title,
    note: item.note || null,
    subject_type: item.subject_type,
    subject_id: item.subject_id,
    url: item.url || null,
    file_name: item.file_name || null,
    mime_type: item.mime_type || null,
    size: item.size || null,
    created_at: item.created_at,
  };
}
function agentPublicDocument(doc) {
  return {
    id: doc.id,
    type: doc.type,
    title: doc.title,
    body: doc.body,
    status: doc.status,
    target_date: doc.target_date || null,
    refs: doc.refs || [],
    created_by: doc.created_by,
    created_by_label: doc.created_by_label,
    updated_by: doc.updated_by || doc.created_by,
    updated_by_label: doc.updated_by_label || doc.created_by_label,
    created_at: doc.created_at,
    updated_at: doc.updated_at,
  };
}

const AgentWorkspaceAPI = {
  schema: AGENT_WORKSPACE_SCHEMA,

  async snapshot(options) {
    options = options || {};
    const teamId = agentTeamId(options.team_id);
    const s = await WorkspaceStore.buildSnapshot(teamId);
    return {
      schema: AGENT_WORKSPACE_SCHEMA,
      generated_at: new Date().toISOString(),
      team: s.team,
      players: s.players.map((p) => ({
        id: p.id, nome: p.nome, numero: p.numero || null,
        escalao: p.escalao || null, posicao: p.posicao || null,
        notas: p.notas || null,
      })),
      matches: s.matches,
      trainings: s.trainings,
      priorities: s.priorities,
      memory: s.memory,
      documents: s.documents.map(agentPublicDocument),
      media: s.media.map(agentPublicMedia),
      activity: s.activity,
    };
  },

  async listDocuments(options) {
    options = options || {};
    return (await WorkspaceStore.listDocuments(agentTeamId(options.team_id), {
      type: options.type || null,
      includeArchived: !!options.include_archived,
    })).map(agentPublicDocument);
  },

  async getDocument(id) {
    const doc = await WorkspaceStore.getDocument(id);
    return doc ? agentPublicDocument(doc) : null;
  },

  async createDocument(input) {
    return WorkspaceStore.saveDocument({
      team_id: agentTeamId(input && input.team_id),
      type: input && input.type,
      title: input && input.title,
      body: input && input.body,
      status: input && input.status || "draft",
      target_date: input && input.target_date || null,
      refs: input && input.refs || [],
      created_by: "agent",
      created_by_label: agentText(input && input.agent_label, 120) || "Head Coach",
    });
  },

  async updateDocument(id, changes) {
    const existing = await WorkspaceStore.getDocument(id);
    if (!existing) throw new Error("Documento não encontrado.");
    return WorkspaceStore.saveDocument({
      ...existing,
      ...(changes || {}),
      id: existing.id,
      updated_by: "agent",
      updated_by_label: agentText(changes && changes.agent_label, 120) || "Head Coach",
    });
  },

  async addObservation(input) {
    return WorkspaceStore.captureObservation({
      team_id: agentTeamId(input && input.team_id),
      actor: "agent",
      actor_label: agentText(input && input.agent_label, 120) || "Head Coach",
      title: input && input.title,
      content: input && input.content,
      occurred_at: input && input.occurred_at,
      refs: input && input.refs || [],
    });
  },

  async listMedia(input) {
    input = input || {};
    if (input.subject_type && input.subject_id != null) {
      return (await HeadCoachMedia.listForSubject(input.subject_type, input.subject_id)).map(agentPublicMedia);
    }
    return (await DB.porIndice("media_items", "team_id", agentTeamId(input.team_id))).map(agentPublicMedia);
  },

  async addMediaLink(input) {
    if (!input || !input.subject_type || input.subject_id == null) throw new Error("Media precisa de associação.");
    if (!input.url) throw new Error("O agente só pode adicionar media por link.");
    const id = await HeadCoachMedia.create({
      team_id: agentTeamId(input.team_id),
      subject_type: input.subject_type,
      subject_id: input.subject_id,
      type: input.type || "video",
      title: input.title,
      url: input.url,
      note: input.note || null,
    });
    await WorkspaceStore.logActivity({
      team_id: agentTeamId(input.team_id),
      actor: "agent",
      actor_label: agentText(input.agent_label, 120) || "Head Coach",
      action: "added_media",
      summary: "Adicionou media · " + agentText(input.title, 180),
      entity_type: "media",
      entity_id: id,
    });
    return id;
  },
};

if (typeof module !== "undefined" && module.exports) {
  module.exports = { AGENT_WORKSPACE_SCHEMA, agentPublicDocument, agentPublicMedia };
}
