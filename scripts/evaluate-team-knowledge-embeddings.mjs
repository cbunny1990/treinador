import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { teamKnowledgeTestAPI } from "../supabase/functions/vision-coach-mcp/team_knowledge.mjs";

export const TEAM_KNOWLEDGE_EVAL_CASES = [
  {
    id: "build_up_support",
    domain: "match_analysis",
    query: "Porque perdemos tantas bolas quando começamos a construir desde trás?",
    relevance: { short_support: 2, post_pass_option: 1 },
    documents: [
      { id: "corner_defense", text: "Na defesa de canto, a equipa precisa de vigiar o segundo poste e atacar a bola." },
      { id: "short_support", text: "O portador perdeu a bola na primeira fase porque, depois do passe, ficou sem apoio curto para voltar a receber." },
      { id: "finishing", text: "O exercício trabalhou remates colocados depois de uma combinação junto à área." },
      { id: "post_pass_option", text: "Na construção, a equipa deve criar uma nova linha de passe logo depois de soltar a bola." },
    ],
  },
  {
    id: "reaction_after_loss",
    domain: "match_analysis",
    query: "Como tem sido a reação da equipa logo após perder a posse?",
    relevance: { counterpress: 2, compactness_after_loss: 1 },
    documents: [
      { id: "counterpress", text: "Depois de perder a bola, os jogadores mais próximos demoraram a pressionar o novo portador e a fechar linhas de passe." },
      { id: "attendance", text: "O treinador anotou que o grupo começou o treino com pouca concentração." },
      { id: "keeper_distribution", text: "O guarda-redes iniciou a construção com passe para o defesa central." },
      { id: "compactness_after_loss", text: "Após algumas perdas, a equipa demorou a aproximar-se da zona da bola para condicionar a saída adversária." },
    ],
  },
  {
    id: "through_balls",
    domain: "match_analysis",
    query: "Estamos a conseguir criar ocasiões com passes para as costas da defesa?",
    relevance: { runs_behind: 2, depth_combination: 1 },
    documents: [
      { id: "runs_behind", text: "O passe em profundidade encontrou o avançado a atacar o espaço nas costas da linha defensiva e criou uma ocasião." },
      { id: "deep_loss", text: "A equipa perdeu a bola na zona baixa durante a saída curta sob pressão." },
      { id: "weekly_goal", text: "Objetivo semanal: melhorar a comunicação e a organização nas bolas paradas defensivas." },
      { id: "depth_combination", text: "Uma tabela pelo corredor abriu espaço para um passe vertical nas costas da defesa." },
    ],
  },
  {
    id: "defensive_transition",
    domain: "match_analysis",
    query: "Que problema aparece quando tentamos recuperar a bola depois de uma perda?",
    relevance: { distance_to_ball: 2, nearby_cover: 1 },
    documents: [
      { id: "distance_to_ball", text: "Após a perda, a equipa ficou demasiado afastada da zona da bola para recuperar rapidamente e proteger o corredor central." },
      { id: "planned_rotation", text: "A rotação prevista procura dar descanso aos jogadores das alas." },
      { id: "goalkeeper_minutes", text: "O treinador pediu ao guarda-redes para variar a distribuição com os pés." },
      { id: "nearby_cover", text: "A equipa precisa de ter apoios próximos para reagir quando perde a posse e proteger o centro." },
    ],
  },
  {
    id: "repeated_low_build_losses",
    domain: "recurring_pattern",
    query: "O que se repetiu nos últimos jogos durante a saída curta na zona baixa?",
    relevance: { repeated_low_losses: 2, build_up_observation: 1 },
    documents: [
      { id: "repeated_low_losses", text: "Em três jogos distintos foram registadas perdas na primeira fase de construção, perto da nossa baliza." },
      { id: "build_up_observation", text: "Num dos jogos, o treinador observou que faltou apoio curto ao jogador que recebeu de costas." },
      { id: "high_press_success", text: "A equipa conseguiu manter a organização defensiva e proteger o corredor central." },
      { id: "training_presence", text: "O grupo terminou a sessão com remates após combinações curtas junto à área." },
    ],
  },
  {
    id: "thursday_training_priority",
    domain: "training_planning",
    query: "O que devo trabalhar no treino de quinta-feira depois do último jogo?",
    relevance: { match_priority: 2, recent_training_progression: 2 },
    documents: [
      { id: "match_priority", text: "No último jogo, depois do primeiro passe da construção faltou uma linha de apoio para progredir com segurança." },
      { id: "recent_training_progression", text: "No treino recente, o apoio após passe melhorou sem oposição e ficou irregular quando se aumentou a pressão." },
      { id: "opponent_corner", text: "O adversário defendeu os cantos com um jogador junto a cada poste." },
      { id: "team_availability", text: "O treinador quer terminar o aquecimento com condução de bola e mudança de direção." },
    ],
  },
  {
    id: "exercise_reuse_context",
    domain: "exercise_library",
    query: "Que exercício pode reforçar o apoio depois do passe sem repetir o trabalho recente?",
    relevance: { pass_and_support_exercise: 2, recent_exercise_use: 1 },
    documents: [
      { id: "pass_and_support_exercise", text: "Exercício: passe e apoio imediato. Objetivo: o jogador passa e cria de seguida uma nova linha de receção." },
      { id: "recent_exercise_use", text: "No treino anterior foi usado o exercício passe e apoio imediato, com oposição progressiva." },
      { id: "finishing_exercise", text: "Exercício de remate após cruzamento; o foco é finalizar ao primeiro toque." },
      { id: "attendance_record", text: "A presença no treino foi marcada para sete atletas." },
    ],
  },
  {
    id: "opponent_press_analysis",
    domain: "opponent_analysis",
    query: "Como podemos sair da pressão alta deste adversário?",
    relevance: { opponent_press_weakness: 2, tactical_preparation: 1 },
    documents: [
      { id: "opponent_press_weakness", text: "Quando pressionado alto, o adversário deixa espaço atrás do ala do lado contrário à bola." },
      { id: "tactical_preparation", text: "A preparação propõe atrair a pressão num corredor e procurar uma mudança rápida para o lado oposto." },
      { id: "team_set_piece", text: "A equipa trabalhou a marcação individual nos pontapés de canto defensivos." },
      { id: "own_possession_stat", text: "A equipa recuou para um bloco médio depois de perder a vantagem no marcador." },
    ],
  },
  {
    id: "game_model_support_principle",
    domain: "game_model",
    query: "Que princípio do nosso modelo ajuda a dar continuidade depois de um passe?",
    relevance: { game_model_support: 2, team_goal_support: 1 },
    documents: [
      { id: "game_model_support", text: "Princípio de jogo: após passar, o jogador volta a oferecer apoio e cria uma nova linha de passe." },
      { id: "team_goal_support", text: "Objetivo da equipa: melhorar a continuidade da posse com apoios próximos ao portador." },
      { id: "match_result", text: "O treinador observou boa circulação da bola durante a primeira parte." },
      { id: "keeper_minutes", text: "O guarda-redes teve vinte minutos de utilização registada." },
    ],
  },
  {
    id: "individual_progress_evidence",
    domain: "player_development",
    query: "Que evidência mostra a evolução do atleta A no apoio ofensivo?",
    relevance: { individual_goal_evidence: 2, coach_observation: 1 },
    documents: [
      { id: "individual_goal_evidence", text: "Objetivo do atleta A: oferecer apoio depois do passe. No último jogo, registou duas receções após apoiar o portador." },
      { id: "coach_observation", text: "O treinador observou que o atleta A procurou mais vezes uma linha de apoio no treino com oposição." },
      { id: "equipment_note", text: "Nota do treinador: faltam coletes de treino para o próximo exercício." },
      { id: "team_attendance", text: "O treinador observou que o atleta A comunicou melhor com os colegas no treino." },
    ],
  },
  {
    id: "conceded_goal_hypothesis",
    domain: "post_match_analysis",
    query: "Que hipótese foi registada para o golo sofrido no corredor central?",
    relevance: { conceded_goal_hypothesis: 2, linked_goal_event: 1 },
    documents: [
      { id: "conceded_goal_hypothesis", text: "Hipótese do treinador: a linha defensiva abriu espaço no corredor central antes do golo sofrido. Esta causa não foi verificada." },
      { id: "linked_goal_event", text: "Na análise do lance, o treinador registou uma entrada adversária pelo corredor central." },
      { id: "scored_goal", text: "Na análise ofensiva, o treinador destacou uma combinação pelo corredor direito." },
      { id: "match_score", text: "O treinador concluiu que a equipa deve manter mais largura quando progride." },
    ],
  },
  {
    id: "weekly_session_progression",
    domain: "weekly_planning",
    query: "Como se relacionam o primeiro e o segundo treino desta semana?",
    relevance: { weekly_plan_relation: 2, week_objective: 1 },
    documents: [
      { id: "weekly_plan_relation", text: "Plano semanal: no primeiro treino a equipa trabalha passe e apoio sem oposição; no segundo acrescenta oposição progressiva." },
      { id: "week_objective", text: "Objetivo semanal: manter o apoio depois do passe quando aumenta a pressão adversária." },
      { id: "match_schedule", text: "A equipa deve defender com distâncias curtas quando perde a bola." },
      { id: "exercise_duration", text: "O exercício de ativação começa com condução livre e termina com passe em pares." },
    ],
  },
];

export const TEAM_KNOWLEDGE_EVAL_STATUS = "synthetic_expanded_set_not_coach_reviewed";

export function buildEmbeddingEvaluationInputs(cases = TEAM_KNOWLEDGE_EVAL_CASES) {
  return cases.flatMap((item) => [
    { case_id: item.id, kind: "query", id: "query", text: item.query },
    ...item.documents.map((document) => ({ case_id: item.id, kind: "document", ...document })),
  ]);
}

function cosine(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || !left.length || left.length !== right.length) throw new Error("Vetor inválido na avaliação de embeddings.");
  let dot = 0, leftNorm = 0, rightNorm = 0;
  for (let index = 0; index < left.length; index++) {
    const a = left[index], b = right[index];
    if (!Number.isFinite(a) || !Number.isFinite(b)) throw new Error("Vetor não finito na avaliação de embeddings.");
    dot += a * b; leftNorm += a * a; rightNorm += b * b;
  }
  if (!leftNorm || !rightNorm) throw new Error("Vetor nulo na avaliação de embeddings.");
  return dot / Math.sqrt(leftNorm * rightNorm);
}

export function evaluateEmbeddingVectors(cases, vectors) {
  let reciprocalRankTotal = 0;
  let recallAtThreeTotal = 0;
  let ndcgAtThreeTotal = 0;
  const results = cases.map((item) => {
    const relevance = item.relevance || (item.relevant_id ? { [item.relevant_id]: 1 } : {});
    const relevantIds = Object.keys(relevance).filter((id) => Number(relevance[id]) > 0);
    if (!relevantIds.length || relevantIds.some((id) => !item.documents.some((document) => document.id === id))) {
      throw new Error(`Documentos relevantes inválidos no caso ${item.id}.`);
    }
    const queryVector = vectors.get(`${item.id}:query`);
    const ranked = item.documents.map((document) => ({
      id: document.id,
      relevance: Number(relevance[document.id] || 0),
      similarity: cosine(queryVector, vectors.get(`${item.id}:${document.id}`)),
    })).sort((left, right) => right.similarity - left.similarity || left.id.localeCompare(right.id));
    const rank = ranked.findIndex((document) => document.relevance > 0) + 1;
    if (!rank) throw new Error(`Documento relevante ausente no caso ${item.id}.`);
    reciprocalRankTotal += 1 / rank;
    const topThree = ranked.slice(0, 3),ideal = ranked.slice().sort((left, right) => right.relevance - left.relevance || left.id.localeCompare(right.id)).slice(0, 3);
    const recallAtThree = topThree.filter((document) => document.relevance > 0).length / relevantIds.length;
    const dcg = (items) => items.reduce((sum, document, index) => sum + (Math.pow(2, document.relevance) - 1) / Math.log2(index + 2), 0);
    const idealDcg = dcg(ideal),ndcgAtThree = idealDcg ? dcg(topThree) / idealDcg : 0;
    recallAtThreeTotal += recallAtThree;
    ndcgAtThreeTotal += ndcgAtThree;
    return { id: item.id, relevant_documents: relevantIds, top_document: ranked[0].id, rank, top_1_hit: ranked[0].relevance > 0, recall_at_3: recallAtThree, ndcg_at_3: ndcgAtThree };
  });
  return {
    cases: results,
    top_1_accuracy: results.filter((item) => item.top_1_hit).length / results.length,
    mean_reciprocal_rank: reciprocalRankTotal / results.length,
    mean_recall_at_3: recallAtThreeTotal / results.length,
    mean_ndcg_at_3: ndcgAtThreeTotal / results.length,
    coach_review_required: true,
    evaluation_status: TEAM_KNOWLEDGE_EVAL_STATUS,
  };
}

export async function runTeamKnowledgeEmbeddingEvaluation({ apiKey = process.env.OPENAI_API_KEY, embedImpl = teamKnowledgeTestAPI.embed } = {}) {
  if (!apiKey) throw new Error("OPENAI_API_KEY não está configurada; nenhuma chamada externa foi feita.");
  const cases = TEAM_KNOWLEDGE_EVAL_CASES;
  const inputs = buildEmbeddingEvaluationInputs(cases);
  const embeddings = await embedImpl(inputs.map((item) => item.text), { apiKey });
  if (!Array.isArray(embeddings) || embeddings.length !== inputs.length) throw new Error("Número de embeddings inválido na avaliação.");
  const vectors = new Map(inputs.map((item, index) => [`${item.case_id}:${item.id}`, embeddings[index]]));
  return { model: teamKnowledgeTestAPI.MODEL, ...evaluateEmbeddingVectors(cases, vectors) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    console.log(JSON.stringify(await runTeamKnowledgeEmbeddingEvaluation(), null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
