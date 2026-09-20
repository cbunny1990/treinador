"use strict";

const HEAD_COACH_RESPONSE_KINDS = ["fact", "observation", "hypothesis", "diagnosis"];
const AIProviderRegistry = {
  providers: new Map(),
  register(name, provider) { this.providers.set(name, provider); },
  get(name) {
    const provider = this.providers.get(name);
    if (!provider) throw new Error(`Provider de IA não configurado: ${name}.`);
    return provider;
  },
};

function chatText(value, max = 2000) { return String(value == null ? "" : value).trim().slice(0, max); }
function chatIds(value) { return [...new Set((Array.isArray(value) ? value : []).map(Number).filter((x) => Number.isInteger(x) && x > 0))]; }
function chatTokens(text) {
  return new Set(String(text || "").toLocaleLowerCase("pt-PT").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .split(/[^a-z0-9]+/).filter((x) => x.length >= 3));
}

function selecionarContextoHeadCoach(context, question, maxItems = 30) {
  const terms = chatTokens(question);
  const kindWeight = { diagnosis: 8, fact: 7, result: 6, decision: 5, intervention: 5, hypothesis: 4, observation: 3 };
  const scored = (context.memory || []).map((item, index) => {
    const hay = chatTokens(`${item.title || ""} ${item.content || ""}`);
    let overlap = 0;
    for (const term of terms) if (hay.has(term)) overlap++;
    const explicitPriority = Number(item.metadata?.priority) >= 1 && Number(item.metadata?.priority) <= 3 ? 20 - Number(item.metadata.priority) : 0;
    return { item, score: overlap * 10 + explicitPriority + (kindWeight[item.kind] || 0) + Math.max(0, 5 - index / 10) };
  }).sort((a, b) => b.score - a.score);
  return {
    schema: context.schema,
    generated_at: context.generated_at,
    team: context.team,
    game_model: context.game_model,
    memory: scored.slice(0, Math.max(1, Math.min(50, maxItems))).map((x) => x.item),
    players: context.players || [],
    recent_trainings: context.recent_trainings || [],
    recent_matches: context.recent_matches || [],
  };
}

function normalizarRespostaHeadCoach(input) {
  if (!input || typeof input !== "object") throw new Error("A IA devolveu uma resposta inválida.");
  const claims = (Array.isArray(input.claims) ? input.claims : []).map((claim) => {
    const kind = chatText(claim.kind, 30);
    if (!HEAD_COACH_RESPONSE_KINDS.includes(kind)) throw new Error(`Classificação inválida na resposta: ${kind || "vazia"}.`);
    const text = chatText(claim.text);
    if (!text) throw new Error("A IA devolveu uma afirmação vazia.");
    return { kind, text, evidence_ids: chatIds(claim.evidence_ids) };
  });
  const recommendations = (Array.isArray(input.recommendations) ? input.recommendations : []).slice(0, 5).map((rec, index) => ({
    id: chatText(rec.id, 60) || `rec-${index + 1}`,
    title: chatText(rec.title, 120) || `Recomendação ${index + 1}`,
    action: chatText(rec.action),
    rationale: chatText(rec.rationale),
    measurement: chatText(rec.measurement),
    evidence_ids: chatIds(rec.evidence_ids),
    status: "proposed",
  })).filter((rec) => rec.action);
  return {
    summary: chatText(input.summary) || "Sem resumo.",
    claims,
    uncertainties: (Array.isArray(input.uncertainties) ? input.uncertainties : []).map((x) => chatText(x, 500)).filter(Boolean).slice(0, 8),
    questions: (Array.isArray(input.questions) ? input.questions : []).map((x) => chatText(x, 500)).filter(Boolean).slice(0, 5),
    recommendations,
  };
}

function validarRespostaContraContexto(response, context) {
  const allowed = new Set((context.memory || []).map((item) => Number(item.id)).filter(Number.isInteger));
  let downgraded = false;
  const claims = response.claims.map((claim) => {
    const evidence_ids = claim.evidence_ids.filter((id) => allowed.has(id));
    if ((claim.kind === "fact" || claim.kind === "diagnosis") && evidence_ids.length === 0) {
      downgraded = true;
      return { ...claim, kind: "hypothesis", evidence_ids };
    }
    return { ...claim, evidence_ids };
  });
  const recommendations = response.recommendations.map((rec) => ({
    ...rec,
    evidence_ids: rec.evidence_ids.filter((id) => allowed.has(id)),
  }));
  const uncertainties = [...response.uncertainties];
  if (downgraded) uncertainties.push("Uma afirmação sem evidência válida foi apresentada como hipótese.");
  return { ...response, claims, recommendations, uncertainties: [...new Set(uncertainties)] };
}

function construirPromptHeadCoach(question, context) {
  const system = `És o Head Coach de apoio à decisão de uma equipa de futebol de formação. Usa exclusivamente o contexto fornecido. Nunca inventes jogadores, jogos, resultados ou evidência. Separa FACTO, OBSERVAÇÃO, HIPÓTESE e DIAGNÓSTICO. Um diagnóstico só pode existir quando IDs de evidência o suportam; sem evidência suficiente, usa hipótese ou declara incerteza. Podes discordar do treinador com respeito e razões operacionais. Propõe no máximo 3 ações concretas e uma forma de medir cada uma. Responde apenas com JSON válido.`;
  const user = `PERGUNTA DO TREINADOR:\n${question}\n\nCONTEXTO DA EQUIPA (JSON):\n${JSON.stringify(context)}\n\nDevolve exatamente:\n{\n  "summary": "resposta curta e direta",\n  "claims": [{"kind":"fact|observation|hypothesis|diagnosis","text":"...","evidence_ids":[1,2]}],\n  "uncertainties": ["o que ainda não sabemos"],\n  "questions": ["pergunta útil ao treinador"],\n  "recommendations": [{"id":"rec-1","title":"...","action":"ação concreta","rationale":"porquê","measurement":"como medir","evidence_ids":[1,2]}]\n}`;
  return { system, user };
}

AIProviderRegistry.register("openrouter", {
  async complete({ system, user, signal }) {
    const { key, modelo } = iaConfig();
    if (!key) throw new Error("Falta a chave OpenRouter (Dados → IA).");
    const raw = await iaChamarOpenRouter(key, modelo, system, user, signal, 0.2);
    return iaExtrairJSON(raw);
  },
});

const HeadCoachEngine = {
  async listConversations(teamId = HEAD_COACH_DEFAULT_TEAM_ID) {
    return (await DB.porIndice("head_coach_conversations", "team_id", teamId))
      .sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
  },
  async getConversation(id) { return DB.obter("head_coach_conversations", id); },
  async getMessages(conversationId) {
    return (await DB.porIndice("head_coach_messages", "conversation_id", Number(conversationId)))
      .sort((a, b) => (a.id || 0) - (b.id || 0));
  },
  async createConversation(teamId = HEAD_COACH_DEFAULT_TEAM_ID, title = "Nova conversa") {
    const now = new Date().toISOString();
    return DB.criar("head_coach_conversations", { team_id: teamId, title: chatText(title, 100) || "Nova conversa", provider: "openrouter", created_at: now, updated_at: now });
  },
  async ask({ teamId = HEAD_COACH_DEFAULT_TEAM_ID, conversationId, question, consent, signal }) {
    question = chatText(question);
    if (!question) throw new Error("Escreve uma pergunta.");
    if (consent !== true) throw new Error("É necessário autorizar o envio do contexto relevante ao provider de IA.");
    if (typeof navigator !== "undefined" && navigator.onLine === false) throw new Error("Sem internet. O histórico continua disponível offline.");
    let conversation = conversationId ? await this.getConversation(conversationId) : null;
    if (!conversation) {
      conversationId = await this.createConversation(teamId, question.slice(0, 70));
      conversation = await this.getConversation(conversationId);
    }
    const now = new Date().toISOString();
    await DB.criar("head_coach_messages", { conversation_id: Number(conversationId), role: "user", text: question, created_at: now });
    const fullContext = await HeadCoachMemory.buildContext(teamId, { limit: 200 });
    const relevantContext = selecionarContextoHeadCoach(fullContext, question);
    const { system, user } = construirPromptHeadCoach(question, relevantContext);
    const provider = AIProviderRegistry.get(conversation.provider || "openrouter");
    const response = validarRespostaContraContexto(
      normalizarRespostaHeadCoach(await provider.complete({ system, user, signal })),
      relevantContext,
    );
    const messageId = await DB.criar("head_coach_messages", {
      conversation_id: Number(conversationId), role: "assistant", text: response.summary,
      response, provider: conversation.provider || "openrouter", model: iaConfig().modelo,
      context_memory_ids: relevantContext.memory.map((m) => m.id), created_at: new Date().toISOString(),
    });
    await DB.atualizar("head_coach_conversations", { ...conversation, id: Number(conversationId), updated_at: new Date().toISOString() });
    return { conversationId: Number(conversationId), messageId, response };
  },
  async actOnRecommendation(messageId, recommendationId, action, changedText) {
    if (!["accept", "change", "reject"].includes(action)) throw new Error("Ação de recomendação inválida.");
    const message = await DB.obter("head_coach_messages", messageId);
    if (!message || message.role !== "assistant") throw new Error("Resposta do Head Coach não encontrada.");
    const recommendations = (message.response?.recommendations || []).map((r) => ({ ...r }));
    const rec = recommendations.find((r) => r.id === recommendationId);
    if (!rec) throw new Error("Recomendação não encontrada.");
    if (rec.status !== "proposed") return rec.memory_id || null;
    if (action === "reject") {
      rec.status = "rejected";
      rec.decided_at = new Date().toISOString();
      await DB.atualizar("head_coach_messages", { ...message, response: { ...message.response, recommendations } });
      return null;
    }
    const content = chatText(changedText || rec.action);
    if (!content) throw new Error("A decisão não pode ficar vazia.");
    const conversation = await this.getConversation(message.conversation_id);
    const memoryId = await HeadCoachMemory.create({
      team_id: conversation?.team_id || HEAD_COACH_DEFAULT_TEAM_ID, kind: "decision", title: rec.title, content,
      source: { type: "system", label: action === "change" ? "Recomendação Head Coach alterada pelo treinador" : "Recomendação Head Coach aceite pelo treinador" },
      evidence_ids: rec.evidence_ids, related_ids: rec.evidence_ids,
      metadata: { conversation_id: message.conversation_id, message_id: message.id, recommendation_id: rec.id, measurement: rec.measurement },
    });
    rec.status = action === "change" ? "changed" : "accepted";
    rec.memory_id = memoryId;
    rec.decided_at = new Date().toISOString();
    await DB.atualizar("head_coach_messages", { ...message, response: { ...message.response, recommendations } });
    return memoryId;
  },
};

if (typeof module !== "undefined" && module.exports) {
  module.exports = { selecionarContextoHeadCoach, normalizarRespostaHeadCoach, validarRespostaContraContexto, construirPromptHeadCoach };
}
