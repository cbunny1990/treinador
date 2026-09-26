const test = require('node:test');
const assert = require('node:assert/strict');
const { updateMatchPreGame } = require('../supabase/functions/vision-coach-mcp/match_pre_game.mjs');

test('partial pre-game MCP updates preserve omitted lists and explicit empty lists clear them', () => {
  const current = { pre_game: {
    adversario_pontos_fortes: ['Pressão alta'],
    adversario_vulnerabilidades: ['Espaço nas costas'],
    pontos_observar: ['Saída pelo lado esquerdo'],
    plano_jogo: 'Atrair pressão e procurar apoio.',
  } };
  const partial = updateMatchPreGame(current, { opponent_notes: 'Observar reposições.' });
  assert.deepEqual(partial.adversario_pontos_fortes, ['Pressão alta']);
  assert.deepEqual(partial.adversario_vulnerabilidades, ['Espaço nas costas']);
  assert.deepEqual(partial.pontos_observar, ['Saída pelo lado esquerdo']);
  assert.equal(partial.plano_jogo, 'Atrair pressão e procurar apoio.');
  const cleared = updateMatchPreGame(current, { opponent_strengths: [], opponent_vulnerabilities: [], observation_points: [] });
  assert.deepEqual(cleared.adversario_pontos_fortes, []);
  assert.deepEqual(cleared.adversario_vulnerabilidades, []);
  assert.deepEqual(cleared.pontos_observar, []);
});

test('pre-game text lists reject excess entries and overlong items without truncating', () => {
  const base = { pre_game: { adversario_pontos_fortes: ['Dados existentes'] } };
  assert.throws(() => updateMatchPreGame(base, { opponent_strengths: Array(21).fill('Ponto') }), /opponent_strengths_too_many_items/);
  assert.throws(() => updateMatchPreGame(base, { opponent_strengths: ['x'.repeat(501)] }), /opponent_strengths_item_too_long/);
  assert.throws(() => updateMatchPreGame(base, { observation_points: Array(31).fill('Observar') }), /observation_points_too_many_items/);
  assert.throws(() => updateMatchPreGame(base, { observation_points: [42] }), /observation_points_invalid_item/);
  assert.deepEqual(base.pre_game.adversario_pontos_fortes, ['Dados existentes']);
});

test('pre-game text lists retain every item within documented limits', () => {
  const points = Array.from({ length: 20 }, (_, index) => `Ponto ${index + 1}`);
  const result = updateMatchPreGame({}, { opponent_strengths: points, observation_points: Array(30).fill('x'.repeat(500)) });
  assert.deepEqual(result.adversario_pontos_fortes, points);
  assert.equal(result.pontos_observar.length, 30);
  assert.equal(result.pontos_observar[0].length, 500);
});
