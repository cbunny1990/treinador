"use strict";

function dashboardDate(value) { return String(value || "").slice(0, 10); }
function dashboardSortDesc(a, b) {
  return String(b.occurred_at || b.created_at || b.data || "").localeCompare(String(a.occurred_at || a.created_at || a.data || ""));
}

function construirDashboardHeadCoach(data, now = new Date().toISOString()) {
  const today = dashboardDate(now);
  const memory = (data.memory || []).filter((m) => m.status === "active").sort(dashboardSortDesc);
  const teamWide = (m) => !(m.subject_refs || []).some((r) => r.type === "player");
  const priorityKinds = new Set(["diagnosis", "hypothesis", "observation"]);
  const explicit = memory.filter((m) => Number(m.metadata?.priority) >= 1 && Number(m.metadata?.priority) <= 3)
    .sort((a, b) => Number(a.metadata.priority) - Number(b.metadata.priority) || dashboardSortDesc(a, b));
  const suggested = memory.filter((m) => priorityKinds.has(m.kind) && teamWide(m) && !explicit.some((x) => x.id === m.id))
    .sort((a, b) => {
      const weight = { diagnosis: 3, hypothesis: 2, observation: 1 };
      return weight[b.kind] - weight[a.kind] || dashboardSortDesc(a, b);
    });
  const priorities = [...explicit, ...suggested].slice(0, 3).map((m, i) => ({ ...m, rank: i + 1, explicit: explicit.some((x) => x.id === m.id) }));

  const diagnoses = memory.filter((m) => m.kind === "diagnosis");
  const collectiveObservations = memory.filter((m) => m.kind === "observation" && teamWide(m));
  const stateText = diagnoses.length
    ? `${diagnoses.length} diagnóstico(s) ativo(s)`
    : collectiveObservations.length
      ? `${collectiveObservations.length} observação(ões) coletiva(s) ainda por diagnosticar`
      : "Ainda não existe evidência coletiva suficiente";

  const matches = [...(data.matches || [])].sort((a, b) => String(b.data).localeCompare(String(a.data)));
  const playedMatches = matches.filter((m) => m.data <= today && m.golos_favor != null && m.golos_contra != null);
  const lastMatch = playedMatches[0] || null;
  const previousMatch = playedMatches[1] || null;
  let matchChange = null;
  if (lastMatch && previousMatch) {
    const lastDiff = Number(lastMatch.golos_favor) - Number(lastMatch.golos_contra);
    const prevDiff = Number(previousMatch.golos_favor) - Number(previousMatch.golos_contra);
    matchChange = lastDiff > prevDiff ? "Evolução positiva no saldo de golos" : lastDiff < prevDiff ? "Saldo de golos piorou" : "Saldo de golos sem alteração";
  }

  const trainings = [...(data.trainings || [])].sort((a, b) => String(a.data).localeCompare(String(b.data)));
  const nextTraining = trainings.find((t) => t.data >= today) || null;
  const decisions = memory.filter((m) => m.kind === "decision");
  const objectiveSource = decisions[0] || priorities[0] || null;
  const nextItems = nextTraining ? (data.training_items || []).filter((x) => x.treino_id === nextTraining.id).sort((a, b) => a.ordem - b.ordem) : [];
  const exerciseMap = new Map((data.exercises || []).map((e) => [e.id, e]));
  const exercises = nextItems.map((item) => ({ ...item, exercise: exerciseMap.get(item.exercicio_id) || null }));

  const playerMap = new Map((data.players || []).map((p) => [String(p.id), p]));
  const attention = new Map();
  for (const item of memory.filter((m) => ["observation", "hypothesis", "diagnosis"].includes(m.kind))) {
    for (const ref of (item.subject_refs || []).filter((r) => r.type === "player")) {
      const key = String(ref.id), player = playerMap.get(key);
      if (!player) continue;
      const current = attention.get(key) || { player, count: 0, latest: item };
      current.count++;
      if (dashboardSortDesc(item, current.latest) < 0) current.latest = item;
      attention.set(key, current);
    }
  }
  const playersAttention = [...attention.values()].sort((a, b) => b.count - a.count || dashboardSortDesc(a.latest, b.latest)).slice(0, 5);

  return {
    generated_at: now,
    team: data.team || null,
    game_model: data.game_model || null,
    state: { text: stateText, diagnoses: diagnoses.length, collective_observations: collectiveObservations.length },
    priorities,
    next_training: {
      event: nextTraining,
      objective: objectiveSource ? objectiveSource.content : null,
      source_id: objectiveSource?.id || null,
      exercises,
      observe: priorities[0]?.content || null,
      measure: priorities.length ? "Registar tentativas bem-sucedidas e total de tentativas; acrescentar o resultado à memória." : null,
    },
    last_match: lastMatch,
    previous_match: previousMatch,
    match_change: matchChange,
    players_attention: playersAttention,
    latest_observations: memory.filter((m) => m.kind === "observation").slice(0, 5),
    latest_results: memory.filter((m) => m.kind === "result").slice(0, 3),
  };
}

const HeadCoachDashboard = {
  async load(teamId = HEAD_COACH_DEFAULT_TEAM_ID) {
    const context = await HeadCoachMemory.buildContext(teamId, { limit: 200 });
    const [trainings, matches, trainingItems, exercises] = await Promise.all([
      DB.porIndice("treinos", "team_id", teamId), DB.porIndice("jogos", "team_id", teamId),
      DB.listar("treino_itens"), DB.listar("exercicios"),
    ]);
    return construirDashboardHeadCoach({
      team: context.team, game_model: context.game_model, memory: context.memory, players: context.players,
      trainings, matches, training_items: trainingItems, exercises,
    });
  },
};

if (typeof module !== "undefined" && module.exports) module.exports = { construirDashboardHeadCoach };

