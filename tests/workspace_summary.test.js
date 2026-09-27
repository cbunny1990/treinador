const test = require('node:test');
const assert = require('node:assert/strict');
const { getWorkspaceSummary } = require('../supabase/functions/vision-coach-mcp/workspace_summary.mjs');

function makeAdmin({ team = { id: 'team-a', name: 'Equipa A' }, rows = [], countOverride, fail = null } = {}) {
  const calls = [];
  const admin = { from(table) {
    const query = { table, filters: [], orders: [], max: null, head: false, count: null };
    const builder = {
      select(columns, options = {}) { query.columns = columns; query.head = options.head === true; query.count = options.count || null; return this; },
      eq(key, value) { query.filters.push([key, value]); return this; },
      is(key, value) { query.filters.push([key, value]); return this; },
      gte(key, value) { query.filters.push([key, value, 'gte']); return this; },
      order(key, options) { query.orders.push([key, options]); return this; },
      limit(value) { query.max = value; return this; },
      maybeSingle() { calls.push(query); return Promise.resolve({ data: team, error: fail === 'team' ? Error('team failed') : null }); },
      then(resolve) {
        calls.push(query);
        if (query.head) return Promise.resolve({ data: null, count: countOverride ?? rows.filter(row => row.kind === 'exercise' && row.deleted_at == null && row.team_id === 'team-a').length, error: fail === 'count' ? Error('count failed') : null }).then(resolve);
        let result = rows.filter(row => query.filters.every(([key, value, op]) => {
          if (key === 'team_id') return row.team_id === value;
          if (key === 'kind') return row.kind === value;
          if (key === 'deleted_at') return row.deleted_at === value;
          if (op === 'gte' && key === 'payload->>data') return String(row.payload.data || '') >= value;
          return true;
        }));
        for (const [key, options] of query.orders.slice().reverse()) result.sort((a, b) => {
          const valueA = key === 'id' ? a.id : a.payload.data;
          const valueB = key === 'id' ? b.id : b.payload.data;
          const cmp = String(valueA || '').localeCompare(String(valueB || ''));
          return cmp * (options.ascending ? 1 : -1);
        });
        return Promise.resolve({ data: result.slice(0, query.max ?? 1000), error: fail === query.table ? Error(`${query.table} failed`) : null }).then(resolve);
      },
    };
    return builder;
  } };
  return { admin, calls };
}

test('workspace summary gets exact exercise count and correct upcoming/recent rows beyond 1000 records', async () => {
  const rows = [];
  for (let i = 0; i < 1105; i++) {
    const id = String(i).padStart(4, '0');
    rows.push({ id: `past-match-${id}`, team_id: 'team-a', kind: 'match', deleted_at: null, payload: { data: `2020-01-${id}` } });
    rows.push({ id: `training-${id}`, team_id: 'team-a', kind: 'training', deleted_at: null, payload: { data: `2024-01-${id}` } });
    rows.push({ id: `exercise-${id}`, team_id: 'team-a', kind: 'exercise', deleted_at: null, payload: {} });
  }
  for (let i = 1; i <= 8; i++) rows.push({ id: `upcoming-${i}`, team_id: 'team-a', kind: 'match', deleted_at: null, payload: { data: `2026-10-${String(i).padStart(2, '0')}` } });
  const { admin, calls } = makeAdmin({ rows });
  const summary = await getWorkspaceSummary(admin, { team_id: 'team-a', label: 'Head Coach', scopes: ['read'] }, '2026-10-01');
  assert.deepEqual(summary.upcoming_matches.map(row => row.id), ['upcoming-1', 'upcoming-2', 'upcoming-3', 'upcoming-4', 'upcoming-5']);
  assert.deepEqual(summary.recent_trainings.map(row => row.id), ['training-1104', 'training-1103', 'training-1102', 'training-1101', 'training-1100']);
  assert.equal(summary.exercise_count, 1105);
  assert.equal(calls.length, 4);
  assert.equal(calls.filter(call => call.table === 'workspace_records' && !call.head).every(call => call.max === 5), true);
  assert.equal(calls.find(call => call.head).count, 'exact');
  assert.deepEqual(summary.connector, { label: 'Head Coach', scopes: ['read'] });
});

test('workspace summary fails closed when a query or exact count fails', async () => {
  await assert.rejects(getWorkspaceSummary(makeAdmin({ fail: 'workspace_records' }).admin, { team_id: 'team-a' }, '2026-10-01'), /workspace_records failed/);
  await assert.rejects(getWorkspaceSummary(makeAdmin({ countOverride: false }).admin, { team_id: 'team-a' }, '2026-10-01'), /workspace_exercise_count_unavailable/);
});
