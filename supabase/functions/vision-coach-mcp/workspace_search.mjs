const KINDS = new Set(["player", "match", "training", "exercise", "memory", "document", "game_model"]);
const PAGE_SIZE = 500;
const SCAN_LIMIT = 10000;
const MAX_OFFSET = 10000000;

export async function searchWorkspace(admin, teamId, { query, kinds = null, limit = 20, offset = 0 } = /** @type {{ query?: unknown, kinds?: string[] | null, limit?: number, offset?: number }} */ ({})) {
  const needle = String(query || "").trim().toLowerCase();
  if (!needle) throw new Error("query_required");
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new Error("invalid_search_limit");
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > MAX_OFFSET) throw new Error("invalid_search_offset");
  const selectedKinds = Array.isArray(kinds) && kinds.length ? [...new Set(kinds.map(String))] : null;
  if (selectedKinds?.some(kind => !KINDS.has(kind))) throw new Error("invalid_search_kind");
  const results = [];
  let cursor = offset, scanned = 0, searchComplete = false, hasMoreResults = null, nextOffset = null;
  while (scanned < SCAN_LIMIT) {
    const pageLimit = Math.min(PAGE_SIZE, SCAN_LIMIT - scanned);
    let request = admin.from("workspace_records")
      .select("id,kind,payload,actor_type,actor_label,updated_at")
      .eq("team_id", teamId).is("deleted_at", null);
    if (selectedKinds) request = request.in("kind", selectedKinds);
    const { data, error } = await request
      .order("updated_at", { ascending: false, nullsFirst: false })
      .order("id", { ascending: true })
      .range(cursor, cursor + pageLimit - 1);
    if (error) throw error;
    const rows = Array.isArray(data) ? data : [];
    let foundExtra = false;
    for (let index = 0; index < rows.length; index++) {
      const row = rows[index];
      if (!JSON.stringify(row.payload || {}).toLowerCase().includes(needle)) continue;
      if (results.length === limit) {
        foundExtra = true;
        hasMoreResults = true;
        nextOffset = cursor + index;
        break;
      }
      results.push(row);
    }
    if (foundExtra) break;
    scanned += rows.length;
    cursor += rows.length;
    if (rows.length < pageLimit) {
      searchComplete = true;
      hasMoreResults = false;
      break;
    }
  }
  if (!searchComplete && hasMoreResults === null) nextOffset = cursor;
  return {
    results,
    limit,
    offset,
    scanned_records: scanned,
    search_complete: searchComplete,
    has_more_results: hasMoreResults,
    next_offset: nextOffset,
  };
}
