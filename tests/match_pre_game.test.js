const test = require('node:test');
const assert = require('node:assert/strict');
const { updateMatchPreGame, updateMatchOpponentObservation } = require('../supabase/functions/vision-coach-mcp/match_pre_game.mjs');

test('pre-game keeps the plan and old opponent data, but refuses new opponent observations', () => {
  const current = { pre_game: { adversario_notas: 'Registo antigo', pontos_observar: ['Saída pela esquerda'], plano_jogo: 'Procurar apoio.' } };
  const plan = updateMatchPreGame(current, { main_objective: 'Circular' });
  assert.equal(plan.objetivo_principal, 'Circular');
  assert.equal(plan.adversario_notas, 'Registo antigo');
  assert.deepEqual(plan.pontos_observar, ['Saída pela esquerda']);
  assert.throws(() => updateMatchPreGame(current, { opponent_notes: 'Pressiona alto' }), /opponent_observations_belong_to_post_match/);
  assert.deepEqual(updateMatchPreGame(current, { observation_points: [] }).pontos_observar, []);
});

test('post-game opponent updates preserve omitted fields and allow explicit clearing', () => {
  const current = { estado: 'concluido', pre_game: { adversario_sistema: '1-2-1', adversario_pontos_fortes: ['Pressão alta'] } };
  const first = updateMatchOpponentObservation(current, { opponent_notes: 'Pressiona reposições.' }, '2026-09-27T12:00:00Z');
  assert.equal(first.adversario_sistema, '1-2-1');
  assert.deepEqual(first.adversario_pontos_fortes, ['Pressão alta']);
  const second = updateMatchOpponentObservation({ ...current, post_game: { opponent_observation: first } }, { opponent_strengths: [], opponent_notes: '' });
  assert.deepEqual(second.adversario_pontos_fortes, []);
  assert.equal(second.adversario_notas, '');
  assert.equal(second.adversario_sistema, '1-2-1');
  assert.equal(current.pre_game.adversario_pontos_fortes[0], 'Pressão alta');
});

test('opponent observations require a completed game and validate list limits', () => {
  const scheduled = { estado: 'agendado', pre_game: { adversario_pontos_fortes: ['Dados existentes'] } };
  assert.throws(() => updateMatchOpponentObservation(scheduled, { opponent_strengths: ['x'] }), /match_must_be_completed/);
  const finished = { ...scheduled, estado: 'concluido' };
  assert.throws(() => updateMatchOpponentObservation(finished, { opponent_strengths: Array(21).fill('Ponto') }), /opponent_strengths_too_many_items/);
  assert.throws(() => updateMatchOpponentObservation(finished, { opponent_strengths: ['x'.repeat(501)] }), /opponent_strengths_item_too_long/);
  assert.throws(() => updateMatchOpponentObservation(finished, { opponent_strengths: [42] }), /opponent_strengths_invalid_item/);
  assert.deepEqual(finished.pre_game.adversario_pontos_fortes, ['Dados existentes']);
});
