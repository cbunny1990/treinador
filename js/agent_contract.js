"use strict";

const AGENT_WORKSPACE_SCHEMA = "treinador-agent-workspace@2";

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
function agentTextContains(value, quote) {
  if (typeof value === "string") return value.includes(quote);
  if (Array.isArray(value)) return value.some((item) => agentTextContains(item, quote));
  if (value && typeof value === "object") return Object.values(value).some((item) => agentTextContains(item, quote));
  return false;
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
    if (!input || input.type !== "brief")
      throw new Error("O agente só pode criar brief de trabalho; usa a operação MCP específica para outros tipos de registo.");
    if (input.status && input.status !== "draft")
      throw new Error("O agente só pode preparar documentos em rascunho.");
    return WorkspaceStore.saveDocument({
      team_id: agentTeamId(input && input.team_id),
      type: "brief",
      title: input && input.title,
      body: input && input.body,
      status: "draft",
      target_date: input && input.target_date || null,
      refs: input && input.refs || [],
      created_by: "agent",
      created_by_label: agentText(input && input.agent_label, 120) || "Head Coach",
    });
  },

  async updateDocument(id, changes) {
    const existing = await WorkspaceStore.getDocument(id);
    if (!existing) throw new Error("Documento não encontrado.");
    if (existing.type !== "brief" || existing.status !== "draft")
      throw new Error("O agente só pode editar os seus briefs ainda em rascunho.");
    if (!changes || !existing.updated_at || changes.expected_updated_at !== existing.updated_at)
      throw new Error("O documento mudou. Lê a versão atual antes de editar.");
    const editable = {};
    for (const key of ["title", "body", "target_date", "refs"])
      if (Object.prototype.hasOwnProperty.call(changes, key)) editable[key] = changes[key];
    return WorkspaceStore.saveDocument({
      ...existing,
      ...editable,
      id: existing.id,
      updated_by: "agent",
      updated_by_label: agentText(changes && changes.agent_label, 120) || "Head Coach",
    });
  },

  async addHypothesis(input) {
    if (!input || input.confirmed !== true) throw new Error("Uma hipótese só pode ser guardada após confirmação explícita do treinador.");
    const teamId = agentTeamId(input.team_id), title = agentText(input.title, 180), content = agentText(input.content, 3000);
    if (!title || !content) throw new Error("A hipótese precisa de título e conteúdo.");
    const sourceStores = { match: "jogos", training: "treinos", player: "jogadores", exercise: "exercicios", observation: "memory_items" };
    const evidence = Array.isArray(input.evidence) ? input.evidence : [];
    if (!evidence.length || evidence.length > 10) throw new Error("A hipótese precisa de uma a dez citações de registos existentes.");
    const verified = [];
    for (const ref of evidence) {
      const type = agentText(ref && ref.type, 40), sourceId = agentText(ref && ref.id, 100), quote = agentText(ref && ref.quote, 1000);
      if (!sourceStores[type] || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(sourceId) || !quote)
        throw new Error("Cada evidência precisa de tipo, UUID estável e citação textual.");
      const rows = await DB.porIndice(sourceStores[type], "team_id", teamId);
      const source = rows.find((row) => String(row.sync_id || "") === sourceId && DB.visivelNoWorkspaceAtivo(row));
      if (!source || !agentTextContains(source, quote)) throw new Error("Uma citação não corresponde a um registo disponível neste workspace.");
      verified.push({ type, id: sourceId, quote });
    }
    const unique = [...new Map(verified.map((ref) => [ref.type + ":" + ref.id + ":" + ref.quote, ref])).values()];
    const identity = JSON.stringify([teamId, title.toLowerCase(), content, unique]);
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(identity)));
    const externalKey = "agent-hypothesis-v1:" + [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    const previous = (await HeadCoachMemory.list(teamId, { includeArchived: true })).find((item) => item.external_key === externalKey);
    if (previous) return previous.id;
    const first = unique[0], sourceType = ["match", "training", "player"].includes(first.type) ? first.type : "system";
    const id = await HeadCoachMemory.create({
      team_id: teamId, kind: "hypothesis", title, content, occurred_at: input.occurred_at,
      source: { type: sourceType, label: "Head Coach · hipótese", ref_type: first.type, ref_id: first.id },
      subject_refs: unique.map((ref) => ({ type: ref.type, id: ref.id, relation: "evidence_for" })),
      external_key: externalKey,
      metadata: { actor: "agent", actor_label: agentText(input.agent_label, 120) || "Head Coach", classification: "hypothesis", coach_confirmed: true, evidence_refs: unique },
    });
    await WorkspaceStore.logActivity({ team_id: teamId, actor: "agent", actor_label: "Head Coach", action: "prepared_hypothesis", summary: "Registou hipótese com evidências · " + title, entity_type: "memory", entity_id: id });
    return id;
  },

  // Compatibility alias: v2 stores a sourced hypothesis, never a coach fact.
  async addObservation(input) { return this.addHypothesis(input); },

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
  module.exports = { AGENT_WORKSPACE_SCHEMA, agentPublicDocument, agentPublicMedia, agentTextContains };
}
