const PAGE_SIZE_MAX = 50;
const OFFSET_MAX = 1000000;

export async function listMatches(admin, teamId, { state, dateOrder = "asc", limit = 20, offset = 0 } = /** @type {{ state?: string | null, dateOrder?: string, limit?: number, offset?: number }} */ ({})) {
  if (!["asc", "desc"].includes(dateOrder)) throw new Error("invalid_match_date_order");
  if (!Number.isInteger(limit) || limit < 1 || limit > PAGE_SIZE_MAX) throw new Error("invalid_match_limit");
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > OFFSET_MAX) throw new Error("invalid_match_offset");
  let query = admin.from("workspace_records").select("id,kind,payload,actor_type,actor_label,updated_at")
    .eq("team_id", teamId).eq("kind", "match").is("deleted_at", null);
  if (state) query = query.eq("payload->>estado", state);
  const { data, error } = await query
    .order("payload->>data", { ascending: dateOrder === "asc", nullsFirst: false })
    .order("id", { ascending: true })
    .range(offset, offset + limit);
  if (error) throw error;
  const rows = Array.isArray(data) ? data : [];
  const hasMore = rows.length > limit;
  return {
    matches: rows.slice(0, limit),
    offset,
    limit,
    has_more: hasMore,
    next_offset: hasMore ? offset + limit : null,
    date_order: dateOrder,
  };
}
