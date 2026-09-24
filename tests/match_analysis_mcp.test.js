const test=require('node:test'),assert=require('node:assert/strict');let api;
test.before(async()=>{api=await import('../supabase/functions/vision-coach-mcp/match_analysis.mjs');});
const c={id:'connector',team_id:'team',scopes:['read','write']};
const MATCH='99999999-9999-4999-8999-999999999999';
function fixture(){const match={id:MATCH,team_id:'team',kind:'match',updated_at:'v0',deleted_at:null,payload:{adversario:'Teste',post_game:{analysis:{revision:0,fields:{observations:'Facto escrito pelo treinador'}}}}},rows=[match],calls=[];const admin={from(){const filters=[];let max=Infinity;return{select(){return this;},eq(k,v){filters.push(r=>(k==='payload->>external_key'?r.payload.external_key:r[k])===v);return this;},is(k,v){return this.eq(k,v);},order(){return this;},limit(n){max=n;return this;},then(resolve){return Promise.resolve({data:rows.filter(r=>filters.every(f=>f(r))).slice(0,max).map(r=>structuredClone(r))}).then(resolve);}}},async rpc(n,args){calls.push(args);match.payload=structuredClone(args.p_payload);match.updated_at='v1';return{data:{ok:true}};}};return{match,rows,calls,admin,call:(name,args={})=>api.executeMatchAnalysisTool(admin,c,name,{id:MATCH,expected_updated_at:match.updated_at,expected_revision:0,...args})};}
test('read returns unknown score and event counts as null without inferred data or photos',async()=>{const f=fixture(),out=await f.call('get_match_analysis');assert.equal(out.result,null);assert.equal(out.statistics.events_available,false);assert.equal(out.statistics.event_count,null);assert.equal(out.statistics.counts,null);assert.equal(f.calls.length,0);});
test('proposal requires explicit confirmation/current revision and remains separate from coach text',async()=>{const f=fixture();const proposal={summary:'Possível melhoria',hypotheses:['Hipótese'],next_priority:'Apoio',evidence_ids:[]};await assert.rejects(f.call('prepare_match_analysis',{confirmed:false,proposal}),/schema|confirmation/i);await f.call('prepare_match_analysis',{confirmed:true,proposal});assert.equal(f.match.payload.post_game.analysis.fields.observations,'Facto escrito pelo treinador');assert.equal(f.match.payload.post_game.analysis.agent_proposal.prepared_by,'Head Coach');assert.equal(f.match.payload.post_game.analysis.agent_proposal.source_analysis_revision,0);assert.equal(f.match.payload.post_game.analysis.agent_proposal.source_events_revision,0);assert.equal(f.calls.length,1);});
test('MCP enforces write scope, team, exact match and current revision',async()=>{const f=fixture(),proposal={summary:'',hypotheses:[],next_priority:'',evidence_ids:[]};await assert.rejects(api.executeMatchAnalysisTool(f.admin,{...c,scopes:['read']},'prepare_match_analysis',{id:MATCH,confirmed:true,expected_updated_at:'v0',expected_revision:0,proposal}),/scope_write/);await assert.rejects(api.executeMatchAnalysisTool(f.admin,{...c,team_id:'other'},'get_match_analysis',{id:MATCH}),/not_found/);await assert.rejects(f.call('prepare_match_analysis',{confirmed:true,expected_revision:4,proposal}),/revision_conflict/);assert.equal(f.calls.length,0);});
test('MCP analysis selector requires stable match UUID',async()=>{const f=fixture();assert.equal(api.MATCH_ANALYSIS_TOOLS[0].inputSchema.properties.id.format,'uuid');await assert.rejects(api.executeMatchAnalysisTool(f.admin,c,'get_match_analysis',{id:'local-17'}),/invalid_match_uuid/);});
test('recurring patterns count exact recorded reason and zone across distinct matches only',async()=>{const f=fixture(),ids=['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','cccccccc-cccc-4ccc-8ccc-cccccccccccc'];f.rows.splice(0,1,...ids.map((id,i)=>({id,team_id:'team',kind:'match',updated_at:'v0',deleted_at:null,payload:{external_key:'m'+i,data:'2026-09-0'+(i+1),adversario:'Adversário '+i,match_events:{events:[{id:'loss-'+i,type:'loss',at_ms:60000,reason:'pass',zone:'def_c'},{id:'missing-'+i,type:'loss',at_ms:120000,reason:'',zone:'def_c'},{id:'different-'+i,type:'loss',at_ms:180000,reason:'duel',zone:'med_c'}]}}})));const out=await f.call('get_recurring_match_patterns',{limit:10});assert.equal(out.matches_examined,3);assert.equal(out.patterns.length,2);const passes=out.patterns.find(x=>x.reason==='pass'&&x.zone==='def_c');assert.equal(passes.event_count,3);assert.equal(passes.matches.length,3);assert.deepEqual(passes.matches.map(x=>x.event_ids),[['loss-0'],['loss-1'],['loss-2']]);assert.equal(out.patterns.some(x=>x.reason===''),false);assert.match(out.origin,/Contagem exata/);assert.equal(f.calls.length,0);});
test('cross-session evidence preserves source UUIDs and separates coach fields without writing',async()=>{const f=fixture(),trainingId='88888888-8888-4888-8888-888888888888';f.match.payload.data='2026-09-20';f.match.payload.post_game.analysis.fields={observations:'Vimos perda na saída',interpretation:'O apoio pode estar distante',hypotheses:'Confirmar em mais jogos',decisions:'Treinar apoio curto'};f.match.payload.match_events={events:[{id:'ev-1',type:'loss',at_ms:120000,reason:'pass',zone:'def_c',note:'Passe interceptado'}]};f.rows.push({id:trainingId,team_id:'team',kind:'training',updated_at:'t1',deleted_at:null,payload:{data:'2026-09-22',review:{},session:{review:{status:'done',continua:'Apoio após passe irregular',focus_outcome:'continues'},blocks:[{key:'b1',exercise_name:'Rondo',notes:[{id:'n1',text:'Apoio tardio'}]}]}}});const out=await api.executeMatchAnalysisTool(f.admin,c,'get_cross_session_evidence',{match_limit:10,training_limit:10});assert.equal(out.schema,'cross-session-evidence@1');assert.equal(out.source_records.matches,1);assert.equal(out.source_records.trainings,1);assert.equal(out.evidence.find(x=>x.field==='analysis.observations').evidence_type,'coach_observation');assert.equal(out.evidence.find(x=>x.field==='analysis.interpretation').evidence_type,'interpretation');assert.equal(out.evidence.find(x=>x.field==='analysis.hypotheses').evidence_type,'hypothesis');assert.equal(out.evidence.find(x=>x.field==='analysis.decisions').evidence_type,'coach_decision');assert.equal(out.evidence.find(x=>x.field==='review.continua').source_ref,trainingId);assert.equal(out.evidence.find(x=>x.field==='review.continua').quote,'Apoio após passe irregular');assert.equal(out.evidence.find(x=>x.field==='review.focus_outcome').evidence_type,'coach_evaluation');const event=out.evidence.find(x=>x.event_ref==='ev-1');assert.equal(event.evidence_type,'registered_fact');assert.equal(event.zone,'def_c');assert.equal(f.calls.length,0);});

test('cross-session evidence omits a cause whose conceded-goal event was removed',async()=>{const f=fixture();f.match.payload.post_game.analysis.goals_conceded={'goal-removed':'Possível falta de cobertura'};f.match.payload.match_events={events:[{id:'goal-kept',type:'goal_against',at_ms:120000},{id:'goal-removed',type:'loss',at_ms:240000}]};const out=await api.executeMatchAnalysisTool(f.admin,c,'get_cross_session_evidence',{match_limit:10,training_limit:10});assert.equal(out.evidence.some(item=>item.field==='analysis.goals_conceded.goal-removed'),false);});

test('cross-session evidence cap alternates match and training sources instead of dropping training context', async () => {
  const f = fixture();
  f.rows.splice(0, 1, ...Array.from({ length: 10 }, (_, i) => ({
    id: `aaaaaaaa-aaaa-4aaa-8aaa-${String(i).padStart(12, '0')}`,
    team_id: 'team', kind: 'match', updated_at: `m${i}`, deleted_at: null,
    payload: { data: `2026-09-${String(i + 1).padStart(2, '0')}`, post_game: { analysis: { fields: {
      observations: `Observação de jogo ${i}`, problems: `Problema de jogo ${i}`,
      interpretation: `Interpretação de jogo ${i}`, next_priority: `Prioridade de jogo ${i}`,
    } } } },
  })));
  f.rows.push(...Array.from({ length: 10 }, (_, i) => ({
    id: `bbbbbbbb-bbbb-4bbb-8bbb-${String(i).padStart(12, '0')}`,
    team_id: 'team', kind: 'training', updated_at: `t${i}`, deleted_at: null,
    payload: { data: `2026-09-${String(i + 1).padStart(2, '0')}`, review: {
      status: 'done', continua: `Observação de treino ${i}`, focus_outcome: 'continues',
    } },
  })));
  const out = await api.executeMatchAnalysisTool(f.admin, c, 'get_cross_session_evidence', {});
  const textEvidence = out.evidence.filter((item) => item.evidence_type !== 'registered_fact');
  assert.equal(out.other_evidence_count > 25, true);
  assert.equal(out.other_evidence_truncated, true);
  assert.equal(textEvidence.length, 25);
  assert.equal(textEvidence.some((item) => item.source_type === 'match'), true);
  assert.equal(textEvidence.some((item) => item.source_type === 'training'), true);
});

test('Jev relation judgment rereads exact current citations and never writes a proposal', async () => {
  const f = fixture(), trainingId = '88888888-8888-4888-8888-888888888888';
  f.match.payload.data = '2026-09-20';
  f.match.payload.post_game.analysis.fields = { observations: 'Vimos perda na saída' };
  f.rows.push({ id: trainingId, team_id: 'team', kind: 'training', updated_at: 't1', deleted_at: null,
    payload: { data: '2026-09-22', review: { status: 'done', continua: 'Apoio após passe irregular' } } });
  const originalFetch = globalThis.fetch, originalDeno = globalThis.Deno;
  let request;
  globalThis.Deno = { env: { get: (name) => name === 'TYPESAFE_API_KEY' ? 'test-secret' : undefined } };
  globalThis.fetch = async (url, options) => {
    request = { url, options, body: JSON.parse(options.body) };
    return { ok: true, async json() { return { model: 'jev-test', answers: { support: { type: 'noul', noul: 0.83 } } }; } };
  };
  try {
    const result = await api.executeMatchAnalysisTool(f.admin, c, 'evaluate_cross_session_relation', {
      claim: 'O treino trabalhou o apoio após passe, relacionado com a perda observada no jogo.',
      match_ref: MATCH, match_field: 'analysis.observations', match_expected_updated_at: 'v0',
      training_ref: trainingId, training_field: 'review.continua', training_expected_updated_at: 't1',
    });
    assert.equal(request.url, 'https://api.typesafe.ai/v1/systemone');
    assert.equal(request.options.headers.Authorization, 'Bearer test-secret');
    assert.equal(request.body.model, 'jev-latest');
    assert.equal(request.body.state.match_evidence.quote, 'Vimos perda na saída');
    assert.equal(request.body.state.training_evidence.quote, 'Apoio após passe irregular');
    assert.equal(result.probability, 0.83);
    assert.equal(result.coach_review_required, true);
    assert.equal(result.writes_performed, false);
    assert.equal(f.calls.length, 0);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalDeno === undefined) delete globalThis.Deno;
    else globalThis.Deno = originalDeno;
  }
});

test('Jev reads explicitly cited sources by UUID even when they fall outside the recent evidence window', async () => {
  const f = fixture();
  const oldMatch = structuredClone(f.match);
  oldMatch.id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
  oldMatch.updated_at = 'match-current';
  oldMatch.payload.post_game.analysis.fields = { observations: 'Perda observada no jogo antigo' };
  const oldTraining = { id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', team_id: 'team', kind: 'training', updated_at: 'training-current', deleted_at: null,
    payload: { review: { status: 'done', continua: 'Apoio após passe no treino antigo' } } };
  const decoyMatches = Array.from({ length: 51 }, (_, i) => ({
    id: `aaaaaaaa-aaaa-4aaa-8aaa-${String(i + 1).padStart(12, '0')}`, team_id: 'team', kind: 'match', updated_at: `m${i}`,
    deleted_at: null, payload: { post_game: { analysis: { fields: { observations: `Outro jogo ${i}` } } } },
  }));
  const decoyTrainings = Array.from({ length: 51 }, (_, i) => ({
    id: `bbbbbbbb-bbbb-4bbb-8bbb-${String(i + 1).padStart(12, '0')}`, team_id: 'team', kind: 'training', updated_at: `t${i}`,
    deleted_at: null, payload: { review: { status: 'done', continua: `Outro treino ${i}` } },
  }));
  f.rows.splice(0, f.rows.length, ...decoyMatches, oldMatch, ...decoyTrainings, oldTraining);
  const originalFetch = globalThis.fetch, originalDeno = globalThis.Deno;
  let body;
  globalThis.Deno = { env: { get: () => 'test-secret' } };
  globalThis.fetch = async (_url, options) => {
    body = JSON.parse(options.body);
    return { ok: true, async json() { return { model: 'jev-test', answers: { support: { type: 'noul', noul: 0.72 } } }; } };
  };
  try {
    const result = await api.executeMatchAnalysisTool(f.admin, c, 'evaluate_cross_session_relation', {
      claim: 'O treino trabalhou o apoio relacionado com a perda observada.',
      match_ref: oldMatch.id, match_field: 'analysis.observations', match_expected_updated_at: oldMatch.updated_at,
      training_ref: oldTraining.id, training_field: 'review.continua', training_expected_updated_at: oldTraining.updated_at,
    });
    assert.equal(body.state.match_evidence.quote, 'Perda observada no jogo antigo');
    assert.equal(body.state.training_evidence.quote, 'Apoio após passe no treino antigo');
    assert.equal(result.probability, 0.72);
    assert.equal(f.calls.length, 0);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalDeno === undefined) delete globalThis.Deno;
    else globalThis.Deno = originalDeno;
  }
});

test('Jev relation judgment refuses stale citations and disabled calls when server secret is absent', async () => {
  const f = fixture(), trainingId = '88888888-8888-4888-8888-888888888888';
  f.match.payload.post_game.analysis.fields = { observations: 'Perda na saída' };
  f.rows.push({ id: trainingId, team_id: 'team', kind: 'training', updated_at: 't1', deleted_at: null,
    payload: { review: { status: 'done', continua: 'Apoio em falta' } } });
  const originalFetch = globalThis.fetch, originalDeno = globalThis.Deno;
  let calls = 0;
  globalThis.Deno = { env: { get: () => undefined } };
  globalThis.fetch = async () => { calls++; throw new Error('Should not call TypeSafe'); };
  const args = { claim: 'Existe um tema comum.', match_ref: MATCH, match_field: 'analysis.observations', match_expected_updated_at: 'v0',
    training_ref: trainingId, training_field: 'review.continua', training_expected_updated_at: 't1' };
  try {
    await assert.rejects(api.executeMatchAnalysisTool(f.admin, c, 'evaluate_cross_session_relation', args), /typesafe_api_not_configured/);
    globalThis.Deno.env.get = () => 'test-secret';
    await assert.rejects(api.executeMatchAnalysisTool(f.admin, c, 'evaluate_cross_session_relation', { ...args, match_expected_updated_at: 'old' }), /cross_session_evidence_source_changed/);
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalDeno === undefined) delete globalThis.Deno;
    else globalThis.Deno = originalDeno;
  }
});

test('Jev relation judgment retries only documented throttling responses with bounded Retry-After', async () => {
  const f = fixture(), trainingId = '88888888-8888-4888-8888-888888888888';
  f.match.payload.post_game.analysis.fields = { observations: 'Perda na saída' };
  f.rows.push({ id: trainingId, team_id: 'team', kind: 'training', updated_at: 't1', deleted_at: null,
    payload: { review: { status: 'done', continua: 'Apoio em falta' } } });
  const originalFetch = globalThis.fetch, originalDeno = globalThis.Deno;
  let calls = 0;
  globalThis.Deno = { env: { get: () => 'test-secret' } };
  globalThis.fetch = async () => {
    calls++;
    if (calls === 1) return { ok: false, status: 429, headers: { get: () => '0' } };
    return { ok: true, async json() { return { model: 'jev-test', answers: { support: { type: 'noul', noul: 0.5 } } }; } };
  };
  try {
    const args = { claim: 'Há uma relação possível.', match_ref: MATCH, match_field: 'analysis.observations', match_expected_updated_at: 'v0',
      training_ref: trainingId, training_field: 'review.continua', training_expected_updated_at: 't1' };
    const result = await api.executeMatchAnalysisTool(f.admin, c, 'evaluate_cross_session_relation', args);
    assert.equal(calls, 2);
    assert.equal(result.probability, 0.5);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalDeno === undefined) delete globalThis.Deno;
    else globalThis.Deno = originalDeno;
  }
});

test('Jev relation judgment stops after three throttling responses', async () => {
  const f = fixture(), trainingId = '88888888-8888-4888-8888-888888888888';
  f.match.payload.post_game.analysis.fields = { observations: 'Perda na saída' };
  f.rows.push({ id: trainingId, team_id: 'team', kind: 'training', updated_at: 't1', deleted_at: null,
    payload: { review: { status: 'done', continua: 'Apoio em falta' } } });
  const originalFetch = globalThis.fetch, originalDeno = globalThis.Deno;
  let calls = 0;
  globalThis.Deno = { env: { get: () => 'test-secret' } };
  globalThis.fetch = async () => { calls++; return { ok: false, status: 529, headers: { get: () => '0' } }; };
  try {
    const args = { claim: 'Há uma relação possível.', match_ref: MATCH, match_field: 'analysis.observations', match_expected_updated_at: 'v0',
      training_ref: trainingId, training_field: 'review.continua', training_expected_updated_at: 't1' };
    await assert.rejects(api.executeMatchAnalysisTool(f.admin, c, 'evaluate_cross_session_relation', args), /typesafe_request_failed_529/);
    assert.equal(calls, 3);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalDeno === undefined) delete globalThis.Deno;
    else globalThis.Deno = originalDeno;
  }
});
