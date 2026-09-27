"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { searchWorkspace } = require("../supabase/functions/vision-coach-mcp/workspace_search.mjs");

function mockAdmin(records) {
  const calls = [];
  return {
    calls,
    from(table) {
      assert.equal(table, "workspace_records");
      const filters = {};
      const orders = [];
      let start = 0, end = Infinity;
      const query = {
        select(columns) { calls.push({ select: columns }); return query; },
        eq(key, value) { filters[key] = value; return query; },
        is(key, value) { filters[key] = value; return query; },
        in(key, value) { filters[key] = value; return query; },
        order(key, options) { orders.push([key, options]); return query; },
        range(from, to) { start = from; end = to; calls.push({ range: [from, to] }); return query; },
        then(resolve, reject) {
          try {
            let rows = records.filter(row => row.team_id === filters.team_id && row.deleted_at === filters.deleted_at);
            if (filters.kind) rows = rows.filter(row => filters.kind.includes(row.kind));
            for (const [key, options] of orders.slice().reverse()) {
              rows = rows.slice().sort((a, b) => {
                const av = a[key], bv = b[key];
                if (av == null || bv == null) return av == null && bv == null ? 0 : (av == null ? (options.nullsFirst ? -1 : 1) : (options.nullsFirst ? 1 : -1));
                const cmp = av < bv ? -1 : av > bv ? 1 : 0;
                return options.ascending ? cmp : -cmp;
              });
            }
            resolve({ data: rows.slice(start, end + 1), error: null });
          } catch (error) { reject(error); }
        },
      };
      return query;
    },
  };
}

function recordsOf(count, make = i => ({ payload: { text: `row ${i}` } })) {
  return Array.from({ length: count }, (_, i) => ({
    id: `id-${String(i).padStart(5, "0")}`,
    kind: "match", team_id: "team-a", deleted_at: null,
    updated_at: new Date(Date.UTC(2026, 0, 1) - i * 1000).toISOString(),
    ...make(i),
  }));
}

test("search_workspace encontra correspondência rara além da primeira página PostgREST", async () => {
  const rows = recordsOf(1205, i => ({ payload: { text: i === 1202 ? "padrão raro" : `jogo ${i}` } }));
  const result = await searchWorkspace(mockAdmin(rows), "team-a", { query: "padrão raro" });
  assert.deepEqual(result.results.map(row => row.id), ["id-01202"]);
  assert.equal(result.search_complete, true);
  assert.equal(result.has_more_results, false);
  assert.equal(result.scanned_records, 1205);
});

test("paginação lexical usa cursor bruto sem omitir nem duplicar correspondências", async () => {
  const rows = recordsOf(1240, i => ({ payload: { text: i % 3 === 0 ? "apoio após passe" : `jogo ${i}` } }));
  const admin = mockAdmin(rows);
  const first = await searchWorkspace(admin, "team-a", { query: "apoio", limit: 20 });
  assert.equal(first.results.length, 20);
  assert.equal(first.search_complete, false);
  assert.equal(first.has_more_results, true);
  const all = [...first.results];
  let page = first;
  while (page.next_offset != null) {
    page = await searchWorkspace(admin, "team-a", { query: "apoio", limit: 20, offset: page.next_offset });
    all.push(...page.results);
    if (page.search_complete) break;
  }
  const expected = rows.filter(row => row.payload.text.includes("apoio")).map(row => row.id);
  assert.deepEqual(all.map(row => row.id), expected);
  assert.equal(new Set(all.map(row => row.id)).size, expected.length);
  assert.equal(page.search_complete, true);
});

test("pesquisa isola equipa, tipos e tombstones e indica limite de cobertura", async () => {
  const rows = recordsOf(10, i => ({ payload: { text: "marcador" }, kind: i % 2 ? "training" : "match" }));
  rows.push({ ...recordsOf(1)[0], id: "other-team", team_id: "team-b", payload: { text: "marcador" } });
  rows.push({ ...recordsOf(1)[0], id: "deleted", deleted_at: "2026-01-01", payload: { text: "marcador" } });
  const admin = mockAdmin(rows);
  const result = await searchWorkspace(admin, "team-a", { query: "marcador", kinds: ["training"], limit: 5 });
  assert.deepEqual(result.results.map(row => row.id), ["id-00001", "id-00003", "id-00005", "id-00007", "id-00009"]);
  assert.equal(result.search_complete, true);
  assert.equal(result.has_more_results, false);

  const cappedRows = recordsOf(10005, i => ({ payload: { text: i === 10004 ? "marcador" : `linha ${i}` } }));
  const capped = await searchWorkspace(mockAdmin(cappedRows), "team-a", { query: "marcador", limit: 5 });
  assert.deepEqual(capped.results, []);
  assert.equal(capped.search_complete, false);
  assert.equal(capped.has_more_results, null);
  assert.equal(capped.next_offset, 10000);
});

test("pesquisa de categoria isolada ordena os resultados deterministicamente", async () => {
  const result = await searchWorkspace(mockAdmin(recordsOf(10, i => ({ payload: { text: "marcador" }, kind: i % 2 ? "training" : "match" }))), "team-a", { query: "marcador", kinds: ["training"], limit: 2 });
  assert.deepEqual(result.results.map(row => row.id), ["id-00001", "id-00003"]);
  assert.equal(result.has_more_results, true);
});

test("pesquisa lexical de exercícios devolve só candidatos da equipa e não confunde uso registado", async () => {
  const source = recordsOf(4, i => ({
    kind: i < 2 ? "exercise" : "training",
    payload: { nome: i === 0 ? "Apoio após passe" : "Construção sob pressão", objetivo: "Criar apoio em zona baixa" },
  }));
  source.push({ ...source[0], id: "foreign-exercise", team_id: "team-b" });
  source.push({ ...source[0], id: "deleted-exercise", deleted_at: "2026-01-02" });
  const result = await searchWorkspace(mockAdmin(source), "team-a", { query: "apoio", kinds: ["exercise"], limit: 3 });
  assert.deepEqual(result.results.map(row => row.id), ["id-00000", "id-00001"]);
  assert.ok(result.results.every(row => row.kind === "exercise"));
  assert.equal(result.search_complete, true);
  assert.equal(result.has_more_results, false);
});

test("pesquisa rejeita parâmetros inválidos", async () => {
  const admin = mockAdmin([]);
  await assert.rejects(searchWorkspace(admin, "team-a", { query: " " }), /query_required/);
  await assert.rejects(searchWorkspace(admin, "team-a", { query: "x", limit: 51 }), /invalid_search_limit/);
  await assert.rejects(searchWorkspace(admin, "team-a", { query: "x", offset: -1 }), /invalid_search_offset/);
  await assert.rejects(searchWorkspace(admin, "team-a", { query: "x", kinds: ["unknown"] }), /invalid_search_kind/);
});

test("search_workspace mantém dados desportivos e redação de texto/campos privados", async () => {
  const rows = recordsOf(1, () => ({
    payload: {
      text: "Boa circulação e criação de oportunidades",
      note: "O atleta está a fazer quimioterapia",
      availability_status: "indisponível",
      player: { name: "Atleta de teste", birth_date: "2012-02-03", email: "private@example.test" },
      media: { signed_url: "https://private.example.test/photo", storage_path: "team/player/photo.jpg" },
    },
  }));
  const result = await searchWorkspace(mockAdmin(rows), "team-a", { query: "circulação" });
  assert.equal(result.results.length, 1);
  const [row] = result.results;
  assert.equal(row.id, "id-00000");
  assert.equal(row.payload.text, "Boa circulação e criação de oportunidades");
  assert.equal(row.payload.note, "Conteúdo pessoal sensível omitido");
  assert.equal(row.payload.availability_status, "indisponível");
  assert.equal(row.payload.player.birth_date, undefined);
  assert.equal(row.payload.player.email, undefined);
  assert.equal(row.payload.player.name, "Atleta de teste");
  assert.deepEqual(row.payload.media, { sensitive_text_omitted: true });
  assert.equal(row.sensitive_text_omitted, true);
  assert.doesNotMatch(JSON.stringify(row), /quimioterapia|private@example|private\.example|photo\.jpg/);
});

test("search_workspace não consulta nem ecoa uma pesquisa clínica reconhecida", async () => {
  let queryCount = 0;
  const admin = {
    from() { queryCount++; throw new Error("não devia consultar a base de dados"); },
  };
  const result = await searchWorkspace(admin, "team-a", { query: "quimioterapia do atleta" });
  assert.equal(queryCount, 0);
  assert.deepEqual(result.results, []);
  assert.equal(result.retrieval_status, "sensitive_query_not_searched");
  assert.equal(result.scanned_records, 0);
  assert.doesNotMatch(JSON.stringify(result), /quimioterapia|atleta/);
});
