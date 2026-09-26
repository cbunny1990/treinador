const MAX_ITEMS = 20;
const MAX_OBSERVATION_POINTS = 30;
const MAX_ITEM_LENGTH = 500;

function coachList(value, current, field, maxItems = MAX_ITEMS) {
  if (!Array.isArray(value)) return Array.isArray(current) ? current : [];
  if (value.length > maxItems) throw new Error(`${field}_too_many_items`);
  return value.map((item) => {
    if (typeof item !== "string") throw new Error(`${field}_invalid_item`);
    const text = item.trim();
    if (text.length > MAX_ITEM_LENGTH) throw new Error(`${field}_item_too_long`);
    return text;
  }).filter(Boolean);
}

export function updateMatchPreGame(payload, args) {
  const current = payload?.pre_game && typeof payload.pre_game === "object" ? payload.pre_game : {};
  return {
    ...current,
    status: "ready",
    objetivo_principal: args?.main_objective ?? current.objetivo_principal ?? null,
    plano_jogo: args?.game_plan ?? current.plano_jogo ?? null,
    adversario_notas: args?.opponent_notes ?? current.adversario_notas ?? null,
    adversario_sistema: args?.opponent_formation ?? current.adversario_sistema ?? null,
    adversario_estilo: args?.opponent_style ?? current.adversario_estilo ?? null,
    adversario_pontos_fortes: coachList(args?.opponent_strengths, current.adversario_pontos_fortes, "opponent_strengths"),
    adversario_vulnerabilidades: coachList(args?.opponent_vulnerabilities, current.adversario_vulnerabilidades, "opponent_vulnerabilities"),
    pontos_observar: coachList(args?.observation_points, current.pontos_observar, "observation_points", MAX_OBSERVATION_POINTS),
  };
}
