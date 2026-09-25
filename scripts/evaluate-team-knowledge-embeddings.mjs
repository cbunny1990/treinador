import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { teamKnowledgeTestAPI } from "../supabase/functions/vision-coach-mcp/team_knowledge.mjs";

export const TEAM_KNOWLEDGE_EVAL_CASES = [
  {
    id: "build_up_support",
    query: "Porque perdemos tantas bolas quando começamos a construir desde trás?",
    relevant_id: "short_support",
    documents: [
      { id: "corner_defense", text: "Na defesa de canto, a equipa precisa de vigiar o segundo poste e atacar a bola." },
      { id: "short_support", text: "O portador perdeu a bola na primeira fase porque, depois do passe, ficou sem apoio curto para voltar a receber." },
      { id: "finishing", text: "O exercício trabalhou remates colocados depois de uma combinação junto à área." },
    ],
  },
  {
    id: "reaction_after_loss",
    query: "Como tem sido a reação da equipa logo após perder a posse?",
    relevant_id: "counterpress",
    documents: [
      { id: "counterpress", text: "Depois de perder a bola, os jogadores mais próximos demoraram a pressionar o novo portador e a fechar linhas de passe." },
      { id: "attendance", text: "Treino de quinta-feira: faltaram dois atletas e três chegaram atrasados." },
      { id: "keeper_distribution", text: "O guarda-redes iniciou a construção com passe para o defesa central." },
    ],
  },
  {
    id: "through_balls",
    query: "Estamos a conseguir criar ocasiões com passes para as costas da defesa?",
    relevant_id: "runs_behind",
    documents: [
      { id: "runs_behind", text: "O passe em profundidade encontrou o avançado a atacar o espaço nas costas da linha defensiva e criou uma ocasião." },
      { id: "deep_loss", text: "A equipa perdeu a bola na zona baixa durante a saída curta sob pressão." },
      { id: "weekly_goal", text: "Objetivo semanal: melhorar a comunicação e a organização nas bolas paradas defensivas." },
    ],
  },
  {
    id: "defensive_transition",
    query: "Que problema aparece quando tentamos recuperar a bola depois de uma perda?",
    relevant_id: "distance_to_ball",
    documents: [
      { id: "distance_to_ball", text: "Após a perda, a equipa ficou demasiado afastada da zona da bola para recuperar rapidamente e proteger o corredor central." },
      { id: "planned_rotation", text: "Plano de rotação: entrada prevista do ala ao minuto quinze." },
      { id: "goalkeeper_minutes", text: "O guarda-redes esteve em campo durante vinte e quatro minutos registados." },
    ],
  },
];

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
  const results = cases.map((item) => {
    const queryVector = vectors.get(`${item.id}:query`);
    const ranked = item.documents.map((document) => ({
      id: document.id,
      similarity: cosine(queryVector, vectors.get(`${item.id}:${document.id}`)),
    })).sort((left, right) => right.similarity - left.similarity || left.id.localeCompare(right.id));
    const rank = ranked.findIndex((document) => document.id === item.relevant_id) + 1;
    if (!rank) throw new Error(`Documento relevante ausente no caso ${item.id}.`);
    reciprocalRankTotal += 1 / rank;
    return { id: item.id, relevant_document: item.relevant_id, top_document: ranked[0].id, rank, top_1_hit: ranked[0].id === item.relevant_id };
  });
  return {
    cases: results,
    top_1_accuracy: results.filter((item) => item.top_1_hit).length / results.length,
    mean_reciprocal_rank: reciprocalRankTotal / results.length,
    coach_review_required: true,
    evaluation_status: "synthetic_initial_set_not_coach_reviewed",
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
