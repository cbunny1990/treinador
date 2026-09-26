export async function getWorkspaceSummary(admin, connector, today = new Date().toISOString().slice(0, 10)) {
  const teamId = String(connector.team_id);
  const teamQuery = admin.from("teams").select("id,name,metadata,updated_at").eq("id", teamId).maybeSingle();
  const upcomingQuery = admin.from("workspace_records").select("id,kind,payload,actor_type,actor_label,updated_at")
    .eq("team_id", teamId).eq("kind", "match").is("deleted_at", null)
    .gte("payload->>data", today)
    .order("payload->>data", { ascending: true, nullsFirst: false })
    .order("id", { ascending: true }).limit(5);
  const trainingQuery = admin.from("workspace_records").select("id,kind,payload,actor_type,actor_label,updated_at")
    .eq("team_id", teamId).eq("kind", "training").is("deleted_at", null)
    .order("payload->>data", { ascending: false, nullsFirst: false })
    .order("id", { ascending: true }).limit(5);
  const exerciseCountQuery = admin.from("workspace_records").select("id", { count: "exact", head: true })
    .eq("team_id", teamId).eq("kind", "exercise").is("deleted_at", null);
  const [teamResult, upcomingResult, trainingResult, exerciseCountResult] = await Promise.all([
    teamQuery, upcomingQuery, trainingQuery, exerciseCountQuery,
  ]);
  if (teamResult.error) throw teamResult.error;
  if (upcomingResult.error) throw upcomingResult.error;
  if (trainingResult.error) throw trainingResult.error;
  if (exerciseCountResult.error) throw exerciseCountResult.error;
  if (!Number.isInteger(exerciseCountResult.count)) throw new Error("workspace_exercise_count_unavailable");
  return {
    connector: { label: connector.label, scopes: connector.scopes },
    team: teamResult.data,
    upcoming_matches: upcomingResult.data || [],
    exercise_count: exerciseCountResult.count,
    recent_trainings: trainingResult.data || [],
  };
}
