const test = require('node:test');
const assert = require('node:assert/strict');
const { listMatches } = require('../supabase/functions/vision-coach-mcp/match_queries.mjs');

function fixture(rows) {
  const calls = [];
  const admin = { from(table) {
    assert.equal(table, 'workspace_records');
    const query = { filters: [], orders: [], rangeValues: null };
    const builder = {
      select(columns) { query.columns = columns; return this; },
      eq(key, value) { query.filters.push([key, value]); return this; },
      is(key, value) { query.filters.push([key, value]); return this; },
      order(key, options) { query.orders.push([key, options]); return this; },
      range(from, to) { query.rangeValues = [from, to]; return this; },
      then(resolve) {
        calls.push(query);
        let result = rows.filter(row => query.filters.every(([key, value]) => {
          if (key === 'payload->>estado') return row.payload.estado === value;
          if (key === 'deleted_at') return row.deleted_at === value;
          return row[key] === value;
        }));
        result = result.sort((a, b) => {
          const dateA = a.payload.data || null, dateB = b.payload.data || null;
          if (dateA == null && dateB != null) return 1;
          if (dateB == null && dateA != null) return -1;
          const cmp = String(dateA || '').localeCompare(String(dateB || ''));
          if (cmp) return query.orders[0][1].ascending ? cmp : -cmp;
          return a.id.localeCompare(b.id);
        });
        const [from, to] = query.rangeValues;
        return Promise.resolve({ data: result.slice(from, to + 1), error: null }).then(resolve);
      },
    };
    return builder;
  } };
  return { admin, calls };
}

test('match listing orders and pages on the server beyond the default first 1000 rows', async () => {
  const rows = Array.from({ length: 1205 }, (_, index) => {
    const day = String(index + 1).padStart(4, '0');
    return { id: `match-${String(index).padStart(4, '0')}`, team_id: 'team-a', kind: 'match', deleted_at: null, payload: { data: `2023-01-${day}` } };
  });
  const { admin, calls } = fixture(rows);
  const first = await listMatches(admin, 'team-a', { dateOrder: 'desc', limit: 50 });
  assert.equal(first.matches[0].id, 'match-1204');
  assert.equal(first.matches.at(-1).id, 'match-1155');
  assert.equal(first.has_more, true);
  assert.equal(first.next_offset, 50);
  const second = await listMatches(admin, 'team-a', { dateOrder: 'desc', limit: 50, offset: first.next_offset });
  assert.equal(second.matches[0].id, 'match-1154');
  assert.equal(second.has_more, true);
  assert.equal(new Set([...first.matches, ...second.matches].map(row => row.id)).size, 100);
  assert.deepEqual(calls[0].filters, [['team_id', 'team-a'], ['kind', 'match'], ['deleted_at', null]]);
  assert.deepEqual(calls[0].orders, [
    ['payload->>data', { ascending: false, nullsFirst: false }],
    ['id', { ascending: true }],
  ]);
  assert.deepEqual(calls.map(call => call.rangeValues), [[0, 50], [50, 100]]);
});

test('match listing applies state before page boundaries and reports completion', async () => {
  const rows = Array.from({ length: 7 }, (_, index) => ({
    id: `match-${index}`, team_id: 'team-a', kind: 'match', deleted_at: null,
    payload: { data: `2026-09-0${index + 1}`, estado: index % 2 ? 'concluido' : 'agendado' },
  }));
  const { admin } = fixture(rows);
  const page = await listMatches(admin, 'team-a', { state: 'concluido', limit: 2, offset: 1 });
  assert.deepEqual(page.matches.map(row => row.id), ['match-3', 'match-5']);
  assert.equal(page.has_more, false);
  assert.equal(page.next_offset, null);
  assert.equal(page.offset, 1);
});

test('match listing rejects invalid pagination and date order', async () => {
  const { admin } = fixture([]);
  await assert.rejects(listMatches(admin, 'team-a', { dateOrder: 'newest' }), /invalid_match_date_order/);
  await assert.rejects(listMatches(admin, 'team-a', { limit: 51 }), /invalid_match_limit/);
  await assert.rejects(listMatches(admin, 'team-a', { offset: -1 }), /invalid_match_offset/);
});
