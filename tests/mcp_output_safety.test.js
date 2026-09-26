const test = require('node:test');
const assert = require('node:assert/strict');
const { sanitizeMcpOutput } = require('../supabase/functions/vision-coach-mcp/output_safety.mjs');

test('MCP sanitization removes clinical text and private media while preserving operational football facts', () => {
  const output = sanitizeMcpOutput({
    id: 'stable-match-uuid',
    payload: {
      notas: 'O atleta foi diagnosticado com asma.',
      medical_diagnosis: 'asma',
      allergies: ['alergia sintética'],
      visual_url: 'https://private.invalid/player-photo',
      foto: 'https://storage.invalid/object/sign/team-media/player.jpg?token=secret',
      foto_path: 'team-media/private/player.jpg',
      fotoUrl: 'https://storage.invalid/private/camel-case?token=secret',
      imagem: 'data:image/jpeg;base64,c2VjcmV0',
      imagemUrl: 'https://storage.invalid/private/legacy-image',
      notes: ['Apoio rápido depois do passe.', 'Encaminhado para hospitalização.'],
      session: { attendance: [{ player_ref: 'stable-player-uuid', status: 'present' }] },
      player: { estado_disponibilidade: 'lesionado', match_status: 'castigado' },
      analysis: { summary: 'Criámos três oportunidades em ataque rápido.' },
    },
  });
  assert.equal(output.id, 'stable-match-uuid');
  assert.equal(output.payload.notas, 'Conteúdo pessoal sensível omitido');
  assert.equal(output.payload.medical_diagnosis, undefined);
  assert.equal(output.payload.allergies, undefined);
  assert.equal(output.payload.visual_url, undefined);
  assert.equal(output.payload.foto, undefined);
  assert.equal(output.payload.foto_path, undefined);
  assert.equal(output.payload.fotoUrl, undefined);
  assert.equal(output.payload.imagem, undefined);
  assert.equal(output.payload.imagemUrl, undefined);
  assert.deepEqual(output.payload.notes, ['Apoio rápido depois do passe.', 'Conteúdo pessoal sensível omitido']);
  assert.deepEqual(output.payload.session.attendance, [{ player_ref: 'stable-player-uuid', status: 'present' }]);
  assert.equal(output.payload.player.estado_disponibilidade, 'lesionado');
  assert.equal(output.payload.player.match_status, 'castigado');
  assert.equal(output.payload.analysis.summary, 'Criámos três oportunidades em ataque rápido.');
  assert.equal(output.sensitive_text_omitted, true);
  assert.doesNotMatch(JSON.stringify(output), /diagnosticado|asma|private\.invalid|storage\.invalid|token=secret|c2VjcmV0/);
});

test('MCP sanitization applies independently to record arrays and retains stable identifiers', () => {
  const output = sanitizeMcpOutput([
    { id: 'match-1', payload: { note: 'Sem limitações observadas.' } },
    { id: 'match-2', payload: { note: 'Consulta de psicologia marcada.' } },
  ]);
  assert.equal(output[0].id, 'match-1');
  assert.equal(output[1].id, 'match-2');
  assert.equal(output[0].sensitive_text_omitted, undefined);
  assert.equal(output[1].payload.note, 'Conteúdo pessoal sensível omitido');
  assert.equal(output[1].sensitive_text_omitted, true);
});
