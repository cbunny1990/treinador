const test=require('node:test'),assert=require('node:assert/strict');
let rag;
test.before(async()=>{rag=await import('../supabase/functions/vision-coach-mcp/team_knowledge.mjs');});
const TEAM='10000000-0000-4000-8000-000000000001';
const SOURCE='20000000-0000-4000-8000-000000000002';
const PLAYER='30000000-0000-4000-8000-000000000003';
const connector={id:'connector-1',team_id:TEAM,scopes:['read']};
const match=()=>({id:SOURCE,team_id:TEAM,kind:'match',updated_at:'2026-09-24T10:00:00.000Z',actor_type:'human',payload:{data:'2026-09-20',adversario:'Rival',post_game:{analysis:{fields:{summary:'A equipa perdeu controlo da bola na saída curta após pressão alta.',interpretation:'O primeiro apoio apareceu tarde.',hypotheses:'Talvez a distância entre linhas tenha sido excessiva.',decisions:'Treinar apoio após passe.'},goals_conceded:{e1:'Cobertura atrasada.'}},},match_events:{events:[{id:'e1',type:'loss',minute:4,zone:'def_c',reason:'pass',note:'Passe interior intercetado.',player_ref:PLAYER}]},injury_report:'não indexar isto'}});
function fakeAdmin(rows=[match()]){
 const calls=[],fromCalls=[];
 return {calls,fromCalls,from(table){const filters=[];let rangeStart=0,rangeEnd=Infinity;fromCalls.push({table,filters});const query={select(){return this;},eq(k,v){filters.push(r=>r[k]===v);return this;},is(k,v){filters.push(r=>v===null?r[k]==null:r[k]===v);return this;},limit(){return this;},range(start,end){rangeStart=start;rangeEnd=end;return this;},maybeSingle(){return Promise.resolve({data:{metadata:{escalao:'Sub-8'}},error:null});},then(resolve){return Promise.resolve({data:rows.filter(r=>filters.every(f=>f(r))).slice(rangeStart,rangeEnd+1).map(r=>({payload:structuredClone(r.payload)}))}).then(resolve);}};return query;},async rpc(name,args){calls.push({name,args});
   if(name==='claim_team_knowledge_jobs')return {data:rows.filter(x=>x.team_id===args.p_team_id&&!x.deleted_at&&['player','match','training','memory','document','game_model','exercise'].includes(x.kind)).map(x=>({source_id:x.id,source_updated_at:x.updated_at,source_kind:x.kind,payload:x.payload,claim_token:'90000000-0000-4000-8000-000000000009'}))};
   if(name==='replace_team_knowledge_source')return {data:args.p_chunks.length};
   if(name==='release_team_knowledge_jobs')return {data:args.p_claims.length};
   if(name==='queue_team_knowledge_reindex')return {data:2};
   if(name==='search_team_knowledge_chunks')return {data:[{source_id:SOURCE,source_kind:'match',source_path:'post_game.analysis.fields.summary',source_updated_at:match().updated_at,source_date:'2026-09-20',match_ref:SOURCE,training_ref:null,player_ref:null,category:'match_analysis',evidence_type:'coach_observation',title:'Resumo do treinador',content:'Perdemos controlo da saída curta sob pressão alta.',metadata:{},similarity:.81,lexical_rank:.04}]};
   throw new Error('unexpected rpc '+name);
 }};
}
function fakeProvider(){const requests=[];return {requests,apiKey:'test-only',async fetchImpl(url,init){requests.push(JSON.parse(init.body));const input=requests.at(-1).input;return {ok:true,status:200,async json(){return {data:input.map((_,index)=>({index,embedding:Array.from({length:rag.teamKnowledgeTestAPI.DIMENSIONS},(_,i)=>i===index?1:0)}))};}};}};}

test('RAG tool is read-scoped, bounded and has structured filters with stable UUIDs',()=>{
 const tool=rag.TEAM_KNOWLEDGE_TOOLS[0];assert.equal(tool.name,'search_team_knowledge');assert.equal(tool.annotations.readOnlyHint,false);
 assert.equal(tool.inputSchema.properties.limit.maximum,12);assert.equal(tool.inputSchema.properties.source_kinds.maxItems,7);assert.equal(tool.inputSchema.properties.match_ref.format,'uuid');assert.equal(tool.inputSchema.properties.match_refs.maxItems,10);assert.equal(tool.inputSchema.properties.match_refs.uniqueItems,true);assert.equal(tool.inputSchema.properties.player_ref.format,'uuid');
 assert.equal(tool.inputSchema.properties.per_match_limit.maximum,4);
 const context=rag.TEAM_KNOWLEDGE_TOOLS.find(x=>x.name==='get_training_planning_context');assert.ok(context);assert.equal(context.annotations.readOnlyHint,false);assert.deepEqual(context.inputSchema.required,['target_date','question']);assert.match(context.description,/recently completed training sessions/);assert.match(context.description,/do not count as completed exercise use/);assert.match(tool.description,/not proof that a session or exercise was completed/);
 const recent=rag.TEAM_KNOWLEDGE_TOOLS.find(x=>x.name==='get_recent_match_context');assert.ok(recent);assert.deepEqual(recent.inputSchema.required,['question']);assert.equal(recent.inputSchema.properties.match_count.maximum,5);
});

test('hybrid training context combines exact structured scope and separate cited RAG results without writing',async()=>{
 const target='50000000-0000-4000-8000-000000000005',training=(id,date,objective,exerciseRef=null)=>({id,team_id:TEAM,kind:'training',updated_at:`${date}T10:00:00.000Z`,payload:{data:date,objetivo:objective,duracao_min:60,blocos:exerciseRef?[{exercise_ref:exerciseRef,exercise_name:'Apoio após passe',duration_min:15}]:[],session:{review:{status:'pending'}}}});
 const matchRows=Array.from({length:7},(_,i)=>({id:`60000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`,team_id:TEAM,kind:'match',updated_at:`2026-09-${String(17-i).padStart(2,'0')}T10:00:00.000Z`,payload:{data:`2026-09-${String(17-i).padStart(2,'0')}`,estado:'concluido',adversario:`Rival ${i+1}`,golos_favor:i,golos_contra:1}}));
 const exercise={id:'70000000-0000-4000-8000-000000000007',team_id:TEAM,kind:'exercise',updated_at:'v1',payload:{nome:'Apoio após passe'}};
 const targetTraining=training(target,'2026-09-24','Criar apoios na saída',exercise.id);
 const completedSession=training('50000000-0000-4000-8000-000000000004','2026-09-22','Passe e apoio',exercise.id);completedSession.payload.review={};completedSession.payload.session.status='completed';completedSession.payload.session.review={status:'done',melhorou:'O apoio surgiu mais cedo.'};
 const completedLegacy=training('50000000-0000-4000-8000-000000000003','2026-09-18','Construção curta');completedLegacy.payload.status='completed';completedLegacy.payload.duracao_min=null;
 const incompleteTraining=training('50000000-0000-4000-8000-000000000002','2026-09-17','Treino sem duração registada',exercise.id);incompleteTraining.payload.duracao_min=null;
 const rows=[targetTraining,completedSession,completedLegacy,incompleteTraining,...matchRows,{...exercise},{id:PLAYER,team_id:TEAM,kind:'player',updated_at:'v1',payload:{nome:'Atleta A',numero:7,plantel_ativo:true,estado_disponibilidade:'lesionado'}},{id:'30000000-0000-4000-8000-000000000004',team_id:TEAM,kind:'player',updated_at:'v1',payload:{nome:'Atleta B',numero:8,plantel_ativo:true,estado_disponibilidade:'disponivel'}},{id:'30000000-0000-4000-8000-000000000005',team_id:TEAM,kind:'player',updated_at:'v1',payload:{nome:'Atleta C',numero:9,plantel_ativo:true}}];
  const malformedRows=Array.from({length:55},(_,i)=>({id:`61000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`,team_id:TEAM,kind:'match',updated_at:`bad-${i}`,payload:{data:'2026-09-2!',estado:'concluido',adversario:'Data legada inválida'}}));const malformedTrainings=Array.from({length:55},(_,i)=>({id:`51000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`,team_id:TEAM,kind:'training',updated_at:`bad-${i}`,payload:{data:'2026-09-2!',objetivo:'Data legada inválida'}}));rows.splice(4,0,...malformedTrainings);rows.splice(rows.findIndex(row=>row.kind==='match'),0,...malformedRows);
 const calls=[],queryPlans=[],db={from(table){const filters=[],orders=[],operations=[];let limit=null;const paging={start:0,end:Infinity};queryPlans.push({table,operations});const value=(row,key)=>key.startsWith('payload->>')?row.payload?.[key.slice(10)]:row[key];const q={select(){return this;},eq(k,v){operations.push({op:'eq',key:k,value:v});filters.push(row=>value(row,k)===v);return this;},lt(k,v){operations.push({op:'lt',key:k,value:v});filters.push(row=>value(row,k)<v);return this;},in(k,values){operations.push({op:'in',key:k,value:values});filters.push(row=>values.includes(value(row,k)));return this;},is(k,v){operations.push({op:'is',key:k,value:v});filters.push(row=>v===null?value(row,k)==null:value(row,k)===v);return this;},order(k,options={}){operations.push({op:'order',key:k,ascending:options.ascending!==false});orders.push({k,ascending:options.ascending!==false});return this;},limit(n){operations.push({op:'limit',value:n});limit=n;return this;},range(from,to){operations.push({op:'range',from,to});paging.start=from;paging.end=to;return this;},maybeSingle(){return Promise.resolve({data:{metadata:{escalao:'Sub-8'}},error:null});},then(resolve){let data=(table==='workspace_records'?rows:[]).filter(row=>filters.every(test=>test(row)));for(const order of orders.slice().reverse())data.sort((a,b)=>{const result=String(value(a,order.k)??'').localeCompare(String(value(b,order.k)??''));return order.ascending?result:-result;});if(limit!=null)data=data.slice(0,limit);data=data.slice(paging.start,paging.end+1);return Promise.resolve({data,error:null}).then(resolve);}};q.or=expression=>{operations.push({op:'or',value:expression});filters.push(row=>row.payload?.status==='completed'||row.payload?.session?.status==='completed');return q;};return q;},async rpc(name,args){calls.push({name,args});if(name==='claim_team_knowledge_jobs')return {data:[]};if(name==='search_team_knowledge_chunks')return {data:[{source_id:args.p_match_refs?.[0]||target,source_kind:args.p_match_refs?'match':'training',source_path:'post_game.analysis.fields.problems',source_updated_at:'v1',source_date:'2026-09-17',match_ref:args.p_match_refs?.[0]||null,training_ref:null,player_ref:null,category:'match_analysis',evidence_type:'coach_observation',title:'Problemas',content:args.p_match_refs?'Pressão alta causou perdas na saída.':'O apoio após passe apareceu tarde.',metadata:{},similarity:.8,lexical_rank:.2}]};throw Error('unexpected rpc '+name);}};
 const provider=fakeProvider(),out=await rag.executeTeamKnowledgeTool(db,connector,'get_training_planning_context',{target_date:'2026-09-24',question:'O que devo trabalhar na saída de bola?'},{provider});
 assert.equal(out.team.age_group,'Sub-8');assert.equal(out.target_training.ref,target);assert.equal(out.target_training.planned_minutes,60);assert.equal(out.missing_data.target_training_duration,false);assert.equal(out.missing_data.target_training_exercises,false);assert.deepEqual(out.roster.availability_counts,{disponivel:1,indisponivel:0,lesionado:1,castigado:0,ausente:0,desconhecido:1});assert.equal(out.roster.available_count,1);assert.equal(out.roster.unavailable_count,1);assert.equal(out.roster.unknown_availability_count,1);assert.deepEqual(out.roster.available_players.map(x=>x.ref),['30000000-0000-4000-8000-000000000004']);assert.deepEqual(out.roster.unavailable_players.map(x=>x.ref),[PLAYER]);assert.deepEqual(out.roster.unknown_availability_players.map(x=>x.ref),['30000000-0000-4000-8000-000000000005']);assert.equal(out.missing_data.availability,true);assert.deepEqual(out.recent_matches.map(x=>x.date),['2026-09-17','2026-09-16','2026-09-15','2026-09-14','2026-09-13']);assert.equal(out.recent_trainings.length,2);assert.ok(out.recent_trainings.every(x=>x.status==='completed'));assert.equal(out.recent_trainings.find(x=>x.ref===completedSession.id).reviewed,true);assert.equal(out.recent_trainings.at(-1).planned_minutes,null);assert.equal(out.recent_exercise_use.find(x=>x.exercise_ref===exercise.id).uses,1,'only the previous completed session counts; the target and unstarted plan do not');assert.equal(out.semantic_evidence.length,2);assert.deepEqual(out.semantic_retrieval_statuses,['ready','ready']);assert.equal(calls.filter(x=>x.name==='search_team_knowledge_chunks').length,2);assert.deepEqual(calls.filter(x=>x.name==='search_team_knowledge_chunks')[0].args.p_match_refs,out.recent_matches.map(x=>x.ref));assert.equal(calls.filter(x=>x.name==='search_team_knowledge_chunks')[0].args.p_per_match_limit,2);assert.equal(calls.some(x=>x.name==='replace_team_knowledge_source'),false);
 let providerCalls=0;const unavailableProvider={apiKey:'test-only',async fetchImpl(){providerCalls++;throw new TypeError('synthetic provider network failure');}};
 const structuredFallback=await rag.executeTeamKnowledgeTool(db,connector,'get_training_planning_context',{target_date:'2026-09-24',question:'O que devo trabalhar na saída de bola?'},{provider:unavailableProvider});
 assert.equal(structuredFallback.evidence_status,'retrieval_unavailable');assert.equal(structuredFallback.missing_data.semantic_retrieval,true);assert.deepEqual(structuredFallback.semantic_retrieval_statuses,['provider_unavailable','skipped_after_retrieval_failure']);assert.equal(providerCalls,1,'a failed provider is not retried for the second semantic scope in the same request');assert.equal(structuredFallback.semantic_evidence.length,0);assert.equal(structuredFallback.target_training.ref,target);assert.equal(structuredFallback.roster.available_count,1);assert.equal(structuredFallback.roster.unavailable_count,1);assert.equal(structuredFallback.recent_matches.length,5);assert.doesNotMatch(JSON.stringify(structuredFallback),/synthetic provider network failure/);
 const pageCount=kind=>queryPlans.filter(x=>x.operations.some(op=>op.op==='eq'&&op.key==='kind'&&op.value===kind)&&x.operations.some(op=>op.op==='lt'&&op.key==='payload->>data'&&op.value==='2026-09-24')).length;assert.ok(pageCount('match')>=2);const completedTrainingQuery=queryPlans.find(x=>x.operations.some(op=>op.op==='eq'&&op.key==='kind'&&op.value==='training')&&x.operations.some(op=>op.op==='or'));assert.equal(completedTrainingQuery?.operations.find(op=>op.op==='or')?.value,'payload->>status.eq.completed,payload->session->>status.eq.completed');
 const exerciseQuery=queryPlans.find(x=>x.operations.some(op=>op.op==='in'&&op.key==='id'));assert.deepEqual(exerciseQuery.operations.find(op=>op.op==='in').value,[exercise.id]);
 targetTraining.payload.duracao_min=null;targetTraining.payload.blocos=[];
 const incompleteTarget=await rag.executeTeamKnowledgeTool(db,connector,'get_training_planning_context',{target_date:'2026-09-24',question:'O que devo trabalhar?'},{provider});
 assert.equal(incompleteTarget.missing_data.target_training_duration,true);assert.equal(incompleteTarget.missing_data.target_training_exercises,true);
 await assert.rejects(rag.executeTeamKnowledgeTool(db,{...connector,scopes:[]},'get_training_planning_context',{target_date:'2026-09-24',question:'foco'},{provider}),/scope_read_required/);
 await assert.rejects(rag.executeTeamKnowledgeTool(db,connector,'get_training_planning_context',{target_date:'2026-99-24',question:'foco'},{provider}),/invalid_training_context_date/);
 await assert.rejects(rag.executeTeamKnowledgeTool(db,connector,'get_training_planning_context',{target_date:'2026-09-24T00:00:00Z',question:'foco'},{provider}),/invalid_training_context_date/);
 const priorRpcs=calls.length,priorEmbeddings=provider.requests.length,priorStructuredQueries=queryPlans.length,sensitiveQuestion='O que trabalhar com a atleta que teve cãibras?';
 const sensitive=await rag.executeTeamKnowledgeTool(db,connector,'get_training_planning_context',{target_date:'2026-09-24',question:sensitiveQuestion},{provider});
 assert.equal(sensitive.evidence_status,'sensitive_query_not_sent');assert.equal(sensitive.semantic_evidence.length,0);assert.equal(sensitive.roster.unavailable_count,1,'structured availability context remains available');
 assert.equal(calls.length,priorRpcs,'sensitive query skips indexing and vector RPCs');assert.equal(provider.requests.length,priorEmbeddings,'sensitive question never reaches embeddings');assert.ok(queryPlans.length>priorStructuredQueries,'structured training/player reads still run');assert.doesNotMatch(JSON.stringify(sensitive),/cãibras|cibras/i,'the query is not echoed in the response');
});

test('recent-match hybrid context selects five dated completed matches and combines event counts with cited RAG evidence',async()=>{
 const today=new Date().toISOString().slice(0,10),day=offset=>new Date(Date.parse(`${today}T00:00:00Z`)-offset*86400000).toISOString().slice(0,10);
 const ids=Array.from({length:7},(_,i)=>`80000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`);
  const rows=ids.map((id,i)=>({id,team_id:TEAM,kind:'match',updated_at:`${day(i*3)}T12:00:00Z`,payload:{data:day(i*3),estado:'concluido',adversario:`Adversário ${i+1}`,golos_favor:i,golos_contra:2,...(i===1?{}:{match_events:{events:i===0?[{type:'loss',reason:'pass',zone:'def_c'},{type:'loss',reason:'pressure',zone:'def_c'},{type:'loss',zone:'def_c'},{type:'loss',reason:'other',zone:'def_c'},{type:'recovery',zone:'med_c'},{type:'shot_on'}]:[]}})}}));
 rows.push({id:'80000000-0000-4000-8000-000000000008',team_id:TEAM,kind:'match',updated_at:'v1',payload:{data:day(-1),estado:'concluido',adversario:'Future'}},{id:'80000000-0000-4000-8000-000000000009',team_id:TEAM,kind:'match',updated_at:'v1',payload:{estado:'concluido',adversario:'Sem data'}});
  const malformedDate=today.slice(0,8)+'2!',malformed=Array.from({length:101},(_,i)=>({id:`81000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`,team_id:TEAM,kind:'match',updated_at:`invalid-${i}`,payload:{data:malformedDate,estado:'concluido',adversario:'Data inválida'}}));rows.push(...malformed);
 const calls=[],queryLog=[],provider=fakeProvider(),db={from(table){const filters=[],orders=[],operations=[];let limit=null,rangeStart=0,rangeEnd=Infinity;const value=(row,key)=>key.startsWith('payload->>')?row.payload?.[key.slice(10)]:row[key];const q={select(){return this;},eq(k,v){operations.push(['eq',k,v]);filters.push(row=>value(row,k)===v);return this;},lt(k,v){operations.push(['lt',k,v]);filters.push(row=>value(row,k)<v);return this;},is(k,v){filters.push(row=>v===null?row[k]==null:row[k]===v);return this;},order(k,o={}){operations.push(['order',k,o.ascending!==false]);orders.push({k,ascending:o.ascending!==false});return this;},limit(n){operations.push(['limit',n]);limit=n;return this;},range(from,to){operations.push(['range',from,to]);rangeStart=from;rangeEnd=to;return this;},maybeSingle(){return Promise.resolve({data:{metadata:{escalao:'Sub-8'}},error:null});},then(resolve){queryLog.push(operations);let data=(table==='workspace_records'?rows:[]).filter(row=>filters.every(f=>f(row)));for(const order of orders.slice().reverse())data.sort((a,b)=>String(value(a,order.k)||'').localeCompare(String(value(b,order.k)||''))*(order.ascending?1:-1));if(limit!=null)data=data.slice(0,limit);data=data.slice(rangeStart,rangeEnd+1);return Promise.resolve({data,error:null}).then(resolve);}};return q;},async rpc(name,args){calls.push({name,args});if(name==='claim_team_knowledge_jobs')return {data:[]};if(name==='search_team_knowledge_chunks')return {data:[{source_id:ids[0],source_kind:'match',source_path:'post_game.analysis.fields.problems',source_updated_at:rows[0].updated_at,source_date:day(0),match_ref:args.p_match_refs[0],training_ref:null,player_ref:null,category:'match_analysis',evidence_type:'coach_observation',title:'Problema',content:'Perdas na saída curta sob pressão.',metadata:{},similarity:.9,lexical_rank:.4}]};throw Error('unexpected rpc '+name);}};
 const out=await rag.executeTeamKnowledgeTool(db,connector,'get_recent_match_context',{question:'O que correu mal?'},{provider});
  assert.equal(out.matches.length,5);assert.deepEqual(out.matches.map(x=>x.date),[day(0),day(3),day(6),day(9),day(12)]);assert.deepEqual(out.matches[0].registered_event_counts,{goals_for:0,goals_against:0,shots_on_target:1,shots_off_target:0,corners_for:0,corners_against:0,losses:4,recoveries:1,through_balls:0,striker_foot_balls:0});assert.deepEqual(out.matches[0].losses_by_reason,{'passe errado':1,'pressão adversária':1,'sem motivo':1,'outro':1});assert.deepEqual(out.matches[0].losses_by_zone,{'defesa central':4});assert.deepEqual(out.matches[0].recoveries_by_zone,{'meio-campo central':1});assert.equal(out.matches[0].statistics_provenance,'counted_from_recorded_events');assert.equal(out.matches[1].statistics_provenance,'not_available');assert.equal(out.matches[1].events_available,false);assert.equal(out.matches[1].registered_event_counts,null);assert.equal(out.matches[1].losses_by_reason,null);assert.equal(out.matches[1].losses_by_zone,null);assert.equal(out.matches[1].recoveries_by_zone,null);assert.equal(out.matches[1].recorded_event_count,null);assert.equal(out.matches[2].events_available,true);assert.equal(out.matches[2].recorded_event_count,0);assert.ok(Object.values(out.matches[2].registered_event_counts).every(value=>value===0));assert.equal(out.semantic_evidence.length,1);assert.equal(out.evidence_status,'sources_found');
 assert.equal(out.missing_data.structured_event_counts,true,'partial event coverage is reported as missing data');
 const search=calls.find(x=>x.name==='search_team_knowledge_chunks').args;assert.deepEqual(search.p_match_refs,ids.slice(0,5));assert.equal(search.p_per_match_limit,2);assert.equal(search.p_limit,12);assert.equal(calls.some(x=>x.name==='replace_team_knowledge_source'),false);
 const unavailableProvider={apiKey:'test-only',async fetchImpl(){throw new TypeError('synthetic provider network failure');}};
 const structuredFallback=await rag.executeTeamKnowledgeTool(db,connector,'get_recent_match_context',{question:'O que correu mal?'},{provider:unavailableProvider});
 assert.equal(structuredFallback.evidence_status,'retrieval_unavailable');assert.equal(structuredFallback.semantic_retrieval_status,'provider_unavailable');assert.equal(structuredFallback.missing_data.semantic_retrieval,true);assert.equal(structuredFallback.matches.length,5);assert.equal(structuredFallback.matches[0].registered_event_counts.losses,4);assert.deepEqual(structuredFallback.semantic_evidence,[]);assert.doesNotMatch(JSON.stringify(structuredFallback),/synthetic provider network failure/);
  const matchQueries=queryLog.filter(operations=>operations.some(([op,key,value])=>op==='eq'&&key==='kind'&&value==='match'));assert.ok(matchQueries.length>=3,'continues past malformed rows on later ranges');assert.ok(matchQueries.every(operations=>operations.some(([op])=>op==='range')));const matchesQuery=matchQueries[0];assert.ok(matchesQuery?.some(([op,key,value])=>op==='lt'&&key==='payload->>data'&&value===new Date(Date.parse(`${today}T00:00:00Z`)+86400000).toISOString().slice(0,10)));
 await assert.rejects(rag.executeTeamKnowledgeTool(db,{...connector,scopes:[]},'get_recent_match_context',{question:'falhas'},{provider}),/scope_read_required/);await assert.rejects(rag.executeTeamKnowledgeTool(db,connector,'get_recent_match_context',{question:'falhas',match_count:6},{provider}),/invalid_recent_match_count/);
});

test('chunks use an allowlist of coaching text and preserve epistemic provenance',()=>{
 const chunks=rag.teamKnowledgeTestAPI.chunkRecord(match());assert.ok(chunks.length>=5);
 const summary=chunks.find(x=>x.source_path==='post_game.analysis.fields.summary');assert.equal(summary.evidence_type,'coach_observation');assert.equal(summary.match_ref,SOURCE);assert.equal(summary.source_date,'2026-09-20');
 const interpretation=chunks.find(x=>x.source_path==='post_game.analysis.fields.interpretation');assert.equal(interpretation.evidence_type,'interpretation');
 const hypothesis=chunks.find(x=>x.source_path==='post_game.analysis.fields.hypotheses');assert.equal(hypothesis.evidence_type,'hypothesis');
 const decision=chunks.find(x=>x.source_path==='post_game.analysis.fields.decisions');assert.equal(decision.evidence_type,'coach_decision');
 const event=chunks.find(x=>x.source_path==='match_events.events[0]');assert.equal(event.evidence_type,'registered_fact');assert.equal(event.player_ref,PLAYER);assert.match(event.content,/Passe interior intercetado/);
 assert.ok(chunks.every(x=>!x.content.includes('não indexar')));
 assert.deepEqual(rag.teamKnowledgeTestAPI.chunkRecord({...match(),kind:'player'}),[]);
});

test('RAG indexes the coach-entered opponent analysis and tactical preparation with distinct provenance',()=>{
 const source=match();source.payload.pre_game={adversario_notas:'O adversário pressiona alto após reposição curta.',adversario_sistema:'1-2-1',adversario_estilo:'pressao_alta',adversario_pontos_fortes:['Reação rápida à perda.'],adversario_vulnerabilidades:['Espaço nas costas dos alas.'],pontos_observar:['Saída pelo corredor esquerdo.'],plano_jogo:'Atrair a pressão e procurar apoio interior.'};
 const chunks=rag.teamKnowledgeTestAPI.chunkRecord(source),vulnerability=chunks.find(item=>item.source_path==='pre_game.adversario_vulnerabilidades[0]'),plan=chunks.find(item=>item.source_path==='pre_game.plano_jogo');
 assert.equal(vulnerability.category,'opponent_analysis');assert.equal(vulnerability.evidence_type,'coach_observation');assert.equal(vulnerability.match_ref,SOURCE);assert.match(vulnerability.content,/Espaço nas costas dos alas/);
 assert.equal(plan.category,'match_preparation');assert.equal(plan.evidence_type,'coach_decision');assert.equal(plan.source_date,'2026-09-20');
});

test('RAG indexes free coach notes on the existing training plan with its training UUID',()=>{
 const training={id:SOURCE,team_id:TEAM,kind:'training',updated_at:'v1',payload:{data:'2026-09-24',objetivo:'Apoio após passe',notas:'Manter distâncias curtas entre portador e apoios.',duracao_min:60,blocos:[]}};
 const note=rag.teamKnowledgeTestAPI.chunkRecord(training).find(item=>item.source_path==='notas');
 assert.equal(note.category,'training_plan');assert.equal(note.evidence_type,'coach_observation');assert.equal(note.training_ref,SOURCE);assert.equal(note.source_date,'2026-09-24');assert.match(note.content,/distâncias curtas/);
});

test('RAG keeps a completed session review when the plan-level review object is empty',()=>{
 const row={id:SOURCE,team_id:TEAM,kind:'training',updated_at:'2026-09-24T10:00:00Z',payload:{data:'2026-09-24',review:{},session:{status:'completed',review:{status:'done',melhorou:'O apoio após passe melhorou.'}}}};
 const chunks=rag.teamKnowledgeTestAPI.chunkRecord(row);
 assert.ok(chunks.some(chunk=>chunk.source_path==='review.melhorou'&&chunk.content.includes('O apoio após passe melhorou.')));
});

test('RAG training-block chunks retain only the stable UUID of their exercise source',()=>{
 const exerciseRef='70000000-0000-4000-8000-000000000007',training={id:SOURCE,team_id:TEAM,kind:'training',updated_at:'v1',payload:{data:'2026-09-24',session:{blocks:[{exercise_ref:exerciseRef,exercise_name:'Apoio orientado',exercise_snapshot:{objetivo:'Receber orientado e apoiar.'}}]}}};
 const block=rag.teamKnowledgeTestAPI.chunkRecord(training).find(item=>item.source_path==='session.blocks[0]');
 assert.equal(block.training_ref,SOURCE);assert.equal(block.evidence_type,'coach_plan');assert.deepEqual(block.metadata.related_refs,[{type:'exercise',id:exerciseRef,field:null,event_ref:null}]);
 training.payload.session.blocks[0].exercise_ref=7;const localId=rag.teamKnowledgeTestAPI.chunkRecord(training).find(item=>item.source_path==='session.blocks[0]');assert.deepEqual(localId.metadata.related_refs,[]);
});

test('RAG indexes only player development notes, redacts the athlete name and excludes health notes',()=>{
 const player={id:PLAYER,team_id:TEAM,kind:'player',updated_at:'v1',payload:{nome:'Maria Silva',estado_disponibilidade:'lesionado',foto:'private-photo',development_goals:{items:[
  {id:'g1',title:'Melhorar primeiro toque de Maria Silva',notes:'Treinar orientação antes da receção.',started_at:'2026-09-01',status:'active'},
  {id:'g2',title:'Maria Silva regressar após lesão',notes:'Dor muscular e avaliação clínica.',started_at:'2026-09-02',status:'continue'},
  {id:'g3',title:'Acompanhar retorno ao treino',notes:'Reavaliação após fratura e concussão.',started_at:'2026-09-03',status:'continue'},
  {id:'g4',title:'Regresso progressivo',notes:'Cirurgia recente e alergia a medicamento.',started_at:'2026-09-04',status:'continue'}
 ]}}};
 const chunks=rag.teamKnowledgeTestAPI.chunkRecord(player);assert.equal(chunks.length,1);assert.equal(chunks[0].player_ref,PLAYER);assert.equal(chunks[0].category,'player_goal');assert.equal(chunks[0].evidence_type,'coach_goal');assert.doesNotMatch(chunks[0].content,/Maria Silva|private-photo|lesionado/);assert.match(chunks[0].content,/atleta/);
 const withName=match();withName.payload.match_events.events[0].note='Passe intercetado por Maria Silva';const redacted=rag.teamKnowledgeTestAPI.chunkRecord(withName,{redactNames:['Maria Silva']});assert.doesNotMatch(redacted.find(x=>x.source_path==='match_events.events[0]').content,/Maria Silva/);
});

test('RAG redacts athlete names and filters health terms in chunk labels as well as text',()=>{
 const training={id:SOURCE,team_id:TEAM,kind:'training',updated_at:'v1',payload:{data:'2026-09-24',session:{blocks:[{exercise_name:'Apoio orientado da Maria Silva',exercise_snapshot:{objetivo:'Apoiar depois do passe.'}}]}}};
 const chunks=rag.teamKnowledgeTestAPI.chunkRecord(training,{redactNames:['Maria Silva']});
 const block=chunks.find(chunk=>chunk.source_path==='session.blocks[0]');
 assert.doesNotMatch(block.title,/Maria|Silva/i);assert.doesNotMatch(block.content,/Maria|Silva/i);
 const titledHealth={id:SOURCE,team_id:TEAM,kind:'document',updated_at:'v1',payload:{type:'note',title:'Acompanhamento clínico do atleta',body:{summary:'Trabalhar apoio curto após passe.'}}};
 assert.deepEqual(rag.teamKnowledgeTestAPI.chunkRecord(titledHealth),[],'health-bearing labels must not leak through otherwise safe body text');
});

test('health privacy filter excludes common cardiovascular, glucose and mental-health wording without blocking tactical high press',()=>{
 const sensitive=[
  'O atleta tem hipertensão e deve evitar esforço intenso.',
  'A tensão arterial foi elevada no controlo médico.',
  'Registar pressão arterial antes do treino.',
  'A glicemia baixou e houve hipoglicemia após o exercício.',
  'A ansiedade está a afetar o bem-estar do atleta.',
  'Acompanhamento de saúde mental e depressão.',
  'O atleta tem TDAH e segue orientação clínica.',
  'Diagnóstico de bipolaridade em acompanhamento.',
  'The player has hypertension and should avoid intense exercise.',
  'Blood pressure was high at the medical check.',
  'The player reports anxiety and panic attacks.',
  'O atleta teve uma distensão muscular.',
  'Torção no tornozelo durante o jogo.',
  'O atleta torceu o tornozelo durante o jogo.',
  'Estiramento muscular durante o jogo.',
  'A contractura ainda causa dor.',
  'Ruptura do ligamento confirmada pelo médico.',
  'Regresso após fratura.',
  'Tem enxaqueca.',
  'O atleta está com febre.',
  'The player has a sprained ankle.',
  'The player has pain in the ankle.',
  'The athlete reported vomiting.',
  'The athlete reported nausea.',
  'The athlete reported dehydration.',
  'A atleta teve cãibras na segunda parte.',
  'The player suffered muscle cramps after running.',
  'O jogador relatou tonturas antes do treino.',
  'The athlete felt dizzy and fainted.',
  'O atleta teve tosse e foi observado pelo médico.',
  'The player has a persistent cough.',
  'O atleta tem uma arritmia cardíaca registada.',
  'The player reported an irregular heartbeat.',
  'O jogador teve palpitações e falta de ar.',
  'The athlete experienced shortness of breath while training.',
  'O relatório clínico assinala dispneia.',
  'The player reported dyspnea during the match.',
  'The player has swelling in the knee.',
  'Allergy symptoms after exercise.',
  'Recent COVID infection.',
 ];
 for(const [index,note] of sensitive.entries()){
  const source=match();source.payload.match_events.events[0].note=note;
  assert.equal(rag.teamKnowledgeTestAPI.chunkRecord(source).some(item=>item.source_path==='match_events.events[0]'),false,`não indexar: ${note}`);
 }
 const tactical=match();tactical.payload.post_game.analysis.fields.summary='A equipa aplicou pressão alta na construção e recuperou a bola.';
 assert.ok(rag.teamKnowledgeTestAPI.chunkRecord(tactical).some(item=>item.source_path==='post_game.analysis.fields.summary'));
 const tacticalReason=match();tacticalReason.payload.match_events.events[0].note='A pressão alta do adversário obrigou a equipa a jogar longo.';
 assert.ok(rag.teamKnowledgeTestAPI.chunkRecord(tacticalReason).some(item=>item.source_path==='match_events.events[0]'),'pressão tática não é um dado de saúde');
});

test('exercise definitions and game-model principles are not labelled as match observations',()=>{
 const exercise={id:SOURCE,team_id:TEAM,kind:'exercise',updated_at:'v1',payload:{nome:'Apoio após passe',objetivo:'Criar linha de apoio ao portador.'}};
 const model={id:SOURCE,team_id:TEAM,kind:'game_model',updated_at:'v1',payload:{title:'Modelo',principles:['Manter linhas de passe próximas.']}};
 assert.equal(rag.teamKnowledgeTestAPI.chunkRecord(exercise)[0].evidence_type,'exercise_definition');
 assert.ok(rag.teamKnowledgeTestAPI.chunkRecord(model).every(chunk=>chunk.evidence_type==='game_model_principle'));
});

test('chunks retain the team age group as provenance metadata',()=>{
 const chunks=rag.teamKnowledgeTestAPI.chunkRecord(match(),{ageGroup:'Sub-8'});assert.ok(chunks.length);assert.ok(chunks.every(x=>x.metadata.age_group==='Sub-8'));
});

test('document chunking bounds size, preserves order and overlaps long text',()=>{
 const source={id:SOURCE,team_id:TEAM,kind:'document',updated_at:'v1',payload:{title:'Plano',target_date:'2026-09-25',body:'Primeiro princípio de apoio após passe. '+('Construir com apoios próximos e linhas curtas. ').repeat(100)}};
 const chunks=rag.teamKnowledgeTestAPI.chunkRecord(source);assert.ok(chunks.length>2);assert.ok(chunks.every(x=>x.content.length<=1800));assert.ok(chunks.every(x=>x.category==='document'));
 assert.ok(chunks.some((x,i)=>i>0&&chunks[i-1].content.slice(-60).split(' ').some(word=>word.length>4&&x.content.includes(word))));
});

test('team goals and weekly plans preserve cited match/training/exercise UUIDs in RAG metadata',()=>{
 const trainingRef='50000000-0000-4000-8000-000000000005',matchRef='60000000-0000-4000-8000-000000000006',exerciseRef='70000000-0000-4000-8000-000000000007',workedRef='80000000-0000-4000-8000-000000000008';
 const goal={id:SOURCE,team_id:TEAM,kind:'document',updated_at:'v1',payload:{type:'team_goal',title:'Apoio após passe',target_date:'2026-09-24',body:JSON.stringify({schema:'vision-team-goal@1',observations:'A equipa ainda demora a apoiar após o passe.',evidence:[{type:'match',id:matchRef,field:'post_game.analysis.fields.problems'}],sessions:[{type:'training',id:trainingRef}],worked_sessions:[{type:'match',id:workedRef}],exercises:[{type:'exercise',id:exerciseRef}],agent_proposal:{rationale:'Repetir a progressão com oposição.',evidence_refs:[{type:'match',id:matchRef,field:'post_game.analysis.fields.problems'}]}})}};
 const chunks=rag.teamKnowledgeTestAPI.chunkRecord(goal),observation=chunks.find(x=>x.source_path==='body.observations'),proposal=chunks.find(x=>x.source_path==='body.agent_proposal.rationale');
 assert.deepEqual(observation.metadata.related_refs.map(x=>x.id).sort(),[exerciseRef,matchRef,trainingRef,workedRef].sort());
 assert.deepEqual(proposal.metadata.related_refs.map(x=>x.id),[matchRef]);
 const week={...goal,payload:{type:'weekly_plan',title:'Semana',target_date:'2026-09-24',body:JSON.stringify({schema:'vision-week-plan@1',objective:'Consolidar apoio após passe.',training1:trainingRef,match:matchRef,links:[{from:trainingRef,to:matchRef,note:'Aplicar no jogo.'}]})}};
 const weekly=rag.teamKnowledgeTestAPI.chunkRecord(week).find(x=>x.source_path==='body.links[0].note');
 assert.deepEqual(weekly.metadata.related_refs.map(x=>x.type).sort(),['match','training']);
 assert.deepEqual(weekly.metadata.related_refs.map(x=>x.id).sort(),[matchRef,trainingRef].sort());
});

test('provider absence leaves pending jobs untouched and reports disabled without claiming team data',async()=>{
 const db=fakeAdmin();const result=await rag.executeTeamKnowledgeTool(db,connector,'search_team_knowledge',{query:'saída de bola'});
 assert.equal(result.retrieval_status,'provider_not_configured');assert.equal(result.answer_mode,'not_generated');assert.deepEqual(db.calls,[]);
 assert.match(result.message,/Não foi enviada informação/);
});

test('empty RAG queue returns before loading team metadata or player names',async()=>{
 const db=fakeAdmin([]),provider=fakeProvider();
 const result=await rag.indexPendingTeamKnowledge(db,TEAM,{provider});
 assert.deepEqual(result,{indexed_sources:0,indexed_chunks:0,pending:false,provider_configured:true});
 assert.deepEqual(db.fromCalls,[],'a clean index must not fetch team or roster metadata');
 assert.deepEqual(db.calls,[{name:'claim_team_knowledge_jobs',args:{p_team_id:TEAM,p_limit:16}}]);
});

test('indexer releases claimed leases immediately when team metadata cannot be read',async()=>{
 const db=fakeAdmin(),query=db.from.bind(db);db.from=table=>table==='teams'?{select(){return this;},eq(){return this;},maybeSingle:async()=>({data:null,error:new Error('metadata unavailable')})}:query(table);
 await assert.rejects(rag.indexPendingTeamKnowledge(db,TEAM,{provider:fakeProvider()}),/metadata unavailable/);
 const release=db.calls.find(call=>call.name==='release_team_knowledge_jobs');
 assert.deepEqual(release.args,{p_team_id:TEAM,p_claims:[{source_id:SOURCE,claim_token:'90000000-0000-4000-8000-000000000009'}],p_error:'metadata unavailable'});
});

test('provider adapter validates dimensions and uses multilingual embedding endpoint via server-only key',async()=>{
 const provider=fakeProvider(),vectors=await rag.teamKnowledgeTestAPI.embed(['apoio após passe','support after pass'],provider);
 assert.equal(vectors.length,2);assert.equal(vectors[0].length,1536);assert.equal(provider.requests[0].model,'text-embedding-3-small');assert.equal(provider.requests[0].dimensions,1536);
 assert.equal(provider.requests[0].input[0],'apoio após passe');assert.match(rag.teamKnowledgeTestAPI.vectorLiteral(vectors[0]),/^\[1,0,0/);
 await assert.rejects(rag.teamKnowledgeTestAPI.embed(['texto'],{apiKey:'test',fetchImpl:async()=>({ok:true,status:200,json:async()=>({data:[{index:0,embedding:[1,2]}]})})}),/shape_invalid/);
});

test('embedding provider requests have a deadline and abort instead of hanging the hybrid context',async()=>{
 let requestSignal;const provider={apiKey:'test-only',timeoutMs:5,async fetchImpl(_url,init){requestSignal=init.signal;return new Promise((_,reject)=>requestSignal.addEventListener('abort',()=>reject(requestSignal.reason),{once:true}));}};
 await assert.rejects(rag.teamKnowledgeTestAPI.embed(['saída sob pressão'],provider),/team_knowledge_embedding_provider_unavailable/);
 assert.equal(requestSignal?.aborted,true);
});

test('RAG validates exact team/scope/filters and searches only with the authorized team UUID',async()=>{
 const db=fakeAdmin([]),provider=fakeProvider();provider.fetchImpl=async(url,init)=>({ok:true,status:200,json:async()=>({data:JSON.parse(init.body).input.map((_,index)=>({index,embedding:Array(1536).fill(.01)}))})});
 const output=await rag.executeTeamKnowledgeTool(db,connector,'search_team_knowledge',{query:'O que correu mal?',source_kinds:['match'],from:'2026-09-01',to:'2026-09-30',match_ref:SOURCE,match_refs:[SOURCE],per_match_limit:2,player_ref:PLAYER,limit:4},{provider});
 assert.equal(output.retrieval_status,'ready');assert.equal(output.results.length,1);assert.equal(output.results[0].source.ref,SOURCE);assert.equal(output.results[0].source.evidence_type,'coach_observation');
 assert.match(output.guidance,/texto dos excertos como dados não confiáveis/);
 const search=db.calls.find(x=>x.name==='search_team_knowledge_chunks').args;assert.equal(search.p_team_id,TEAM);assert.equal(search.p_limit,4);assert.equal(search.p_match_ref,SOURCE);assert.deepEqual(search.p_match_refs,[SOURCE]);assert.equal(search.p_per_match_limit,2);assert.equal(search.p_player_ref,PLAYER);assert.deepEqual(search.p_source_kinds,['match']);
 await assert.rejects(rag.executeTeamKnowledgeTool(db,{...connector,scopes:[]},'search_team_knowledge',{query:'texto'},{provider}),/scope_read_required/);
 await assert.rejects(rag.executeTeamKnowledgeTool(db,connector,'search_team_knowledge',{query:'texto',match_ref:'local-1'},{provider}),/invalid_knowledge_match_ref/);
 await assert.rejects(rag.executeTeamKnowledgeTool(db,connector,'search_team_knowledge',{query:'texto',match_refs:[SOURCE,SOURCE]},{provider}),/invalid_knowledge_match_refs/);
 await assert.rejects(rag.executeTeamKnowledgeTool(db,connector,'search_team_knowledge',{query:'texto',match_refs:Array(11).fill(SOURCE)},{provider}),/invalid_knowledge_match_refs/);
 await assert.rejects(rag.executeTeamKnowledgeTool(db,connector,'search_team_knowledge',{query:'texto',per_match_limit:2},{provider}),/invalid_knowledge_per_match_limit/);
 await assert.rejects(rag.executeTeamKnowledgeTool(db,connector,'search_team_knowledge',{query:'ok',from:'2026-09-30',to:'2026-09-01'},{provider}),/invalid_knowledge_date_range/);
});

test('health-related search query stays out of embeddings and returns no echoed text',async()=>{
 const db=fakeAdmin([]),provider=fakeProvider(),query='A atleta tem tonturas e tosse após o treino?';
 const result=await rag.executeTeamKnowledgeTool(db,connector,'search_team_knowledge',{query},{provider});
 assert.equal(result.retrieval_status,'sensitive_query_not_sent');assert.equal(result.answer_mode,'structured_data_only');assert.equal(result.evidence_status,'sensitive_query_not_sent');assert.deepEqual(result.results,[]);
 assert.deepEqual(db.calls,[]);assert.deepEqual(db.fromCalls,[]);assert.deepEqual(provider.requests,[]);assert.doesNotMatch(JSON.stringify(result),/tonturas|tosse/i);
});

test('athlete names are redacted from RAG query embeddings and lexical search',async()=>{
 const athlete={id:PLAYER,team_id:TEAM,kind:'player',updated_at:'2026-09-24T10:00:00.000Z',payload:{nome:'Maria Silva',development_goals:{items:[]}}};
 const db=fakeAdmin([match(),athlete]),provider=fakeProvider(),query='O que fez Maria na linha Silva?';
 const result=await rag.executeTeamKnowledgeTool(db,connector,'search_team_knowledge',{query},{provider});
 const safeQuery='O que fez atleta na linha atleta?';
 assert.equal(provider.requests.at(-1).input[0],safeQuery,'the original name must never reach embeddings');
 assert.equal(db.calls.find(call=>call.name==='search_team_knowledge_chunks').args.p_query,safeQuery,'lexical matching uses the same redacted query');
 assert.equal(result.query,safeQuery);assert.doesNotMatch(JSON.stringify(result),/Maria Silva/i);
});

test('RAG fails closed when it cannot load roster names for query redaction',async()=>{
 const calls=[],provider=fakeProvider(),admin={async rpc(name,args){calls.push({name,args});return {data:[]};}};
 await assert.rejects(rag.executeTeamKnowledgeTool(admin,connector,'search_team_knowledge',{query:'O que fez Maria Silva?'},{provider}),/query_privacy_metadata_unavailable/);
 assert.deepEqual(provider.requests,[],'an unredacted athlete name must not reach the embedding provider');
 assert.deepEqual(calls.map(call=>call.name),['claim_team_knowledge_jobs']);
});

test('hybrid search reuses scoped roster names within one MCP request',async()=>{
 const db=fakeAdmin([]),provider=fakeProvider();
 await rag.executeTeamKnowledgeTool(db,connector,'search_team_knowledge',{query:'O que mudou no jogo?'},{provider});
 await rag.executeTeamKnowledgeTool(db,connector,'search_team_knowledge',{query:'O que melhorar no treino?'},{provider});
 assert.equal(db.fromCalls.filter(call=>call.table==='workspace_records').length,1,'two retrievals in one hybrid operation should read names once');
 assert.equal(provider.requests.length,2,'each query still receives its own embedding');
});

test('full reindex requires explicit write approval and remains scoped to connector team',async()=>{
 const db=fakeAdmin(),readOnly={...connector,scopes:['read']},write={...connector,scopes:['read','write']};
 await assert.rejects(rag.executeTeamKnowledgeTool(db,readOnly,'reindex_team_knowledge',{confirmed:true}),/scope_write_required/);
 await assert.rejects(rag.executeTeamKnowledgeTool(db,write,'reindex_team_knowledge',{}),/explicit_confirmation_required/);
 const out=await rag.executeTeamKnowledgeTool(db,write,'reindex_team_knowledge',{confirmed:true});
 assert.equal(out.queued,true);assert.equal(out.source_count,2);assert.equal(out.team_id,TEAM);assert.equal(out.original_records_changed,false);
 assert.deepEqual(db.calls.at(-1),{name:'queue_team_knowledge_reindex',args:{p_team_id:TEAM}});
});

test('indexer replaces source chunks idempotently and only indexes allowlisted player goals',async()=>{
 const source=match();source.payload.post_game.analysis.fields.observations='The player has hypertension and should avoid intense exercise.';
 const rows=[source,{id:PLAYER,team_id:TEAM,kind:'player',updated_at:'v1',payload:{nome:'Maria Silva',observacao:'texto individual',development_goals:{items:[{title:'Melhorar primeiro toque',notes:'Maria Silva deve treinar orientação antes da receção.'},{title:'Acompanhamento',notes:'O atleta tem hipertensão e deve evitar esforço intenso.'}]}}}],db=fakeAdmin(rows),provider=fakeProvider();
 const result=await rag.indexPendingTeamKnowledge(db,TEAM,{provider,limit:16});
 assert.equal(result.indexed_sources,2);assert.ok(result.indexed_chunks>0);assert.equal(db.calls.filter(x=>x.name==='replace_team_knowledge_source').length,2);
 assert.equal(db.calls[0].args.p_team_id,TEAM);assert.equal(db.calls[0].args.p_limit,16);
 assert.equal(db.calls.find(x=>x.name==='replace_team_knowledge_source').args.p_source_id,SOURCE);assert.equal(db.calls.find(x=>x.name==='replace_team_knowledge_source').args.p_claim_token,'90000000-0000-4000-8000-000000000009');
 const indexedPlayer=db.calls.filter(x=>x.name==='replace_team_knowledge_source').find(x=>x.args.p_source_id===PLAYER);assert.match(indexedPlayer.args.p_chunks[0].content,/atleta/);assert.doesNotMatch(indexedPlayer.args.p_chunks[0].content,/Maria Silva|texto individual/);assert.equal(indexedPlayer.args.p_chunks[0].metadata.age_group,'Sub-8');
 assert.doesNotMatch(provider.requests.flatMap(request=>request.input).join('\n'),/hypertension|hipertens/i,'conteúdo de saúde não pode chegar ao provider');
 assert.match(provider.requests.flatMap(request=>request.input).join('\n'),/pressão alta/i,'observação tática não deve ser confundida com pressão arterial');
 assert.equal(db.fromCalls[0].table,'teams');assert.equal(db.fromCalls[1].table,'workspace_records');assert.ok(db.fromCalls[1].filters[0]({team_id:TEAM}));assert.equal(db.fromCalls[1].filters[0]({team_id:'40000000-0000-4000-8000-000000000004'}),false);
});

test('indexer redacts names of deleted players from retained match notes without indexing deleted player records',async()=>{
 const deletedPlayer={id:'30000000-0000-4000-8000-000000000004',team_id:TEAM,kind:'player',deleted_at:'2026-09-23T10:00:00.000Z',updated_at:'v2',payload:{nome:'Atleta Apagado'}};
 const source=match();source.payload.post_game.analysis.fields.summary='Atleta Apagado perdeu a bola sob pressão.';
 const db=fakeAdmin([source,deletedPlayer]),provider=fakeProvider();
 const result=await rag.indexPendingTeamKnowledge(db,TEAM,{provider,limit:16});
 assert.equal(result.indexed_sources,1);
 const replacements=db.calls.filter(x=>x.name==='replace_team_knowledge_source');
 assert.deepEqual(replacements.map(x=>x.args.p_source_id),[SOURCE]);
 const indexedContent=replacements.flatMap(x=>x.args.p_chunks.map(chunk=>chunk.content)).join('\n');
 assert.match(indexedContent,/atleta perdeu a bola sob pressão/i);
 assert.doesNotMatch(indexedContent,/Atleta Apagado/i);
 const embeddedInput=provider.requests.flatMap(request=>request.input).join('\n');
 assert.doesNotMatch(embeddedInput,/Atleta Apagado/i);
 assert.ok(db.fromCalls[1].filters.every(filter=>filter({team_id:TEAM,kind:'player'})));
});

test('indexer redacts historical names beyond the first paged roster batch',async()=>{
 const players=Array.from({length:151},(_,i)=>({id:`30000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`,team_id:TEAM,kind:'player',deleted_at:'2026-09-23T10:00:00.000Z',updated_at:`v${i}`,payload:{nome:i===150?'Nome Histórico Longe':'Atleta Apagado '+i}}));
 const source=match();source.payload.post_game.analysis.fields.summary='Nome Histórico Longe falhou o passe.';
 const db=fakeAdmin([source,...players]),provider=fakeProvider();
 const result=await rag.indexPendingTeamKnowledge(db,TEAM,{provider,limit:16});
 assert.equal(result.indexed_sources,1);
 const replacements=db.calls.filter(x=>x.name==='replace_team_knowledge_source');
 assert.deepEqual(replacements.map(x=>x.args.p_source_id),[SOURCE]);
 const indexedContent=replacements.flatMap(x=>x.args.p_chunks.map(chunk=>chunk.content)).join('\n');
 assert.match(indexedContent,/atleta falhou o passe/i);
 assert.doesNotMatch(indexedContent,/Nome Histórico Longe/i);
 assert.doesNotMatch(provider.requests.flatMap(request=>request.input).join('\n'),/Nome Histórico Longe/i);
 assert.equal(db.fromCalls.filter(call=>call.table==='workspace_records').length,2);
});

test('indexer releases only claimed leases after provider failure so newer revisions can retry immediately',async()=>{
 const db=fakeAdmin(),provider={apiKey:'test-only',fetchImpl:async()=>({ok:false,status:429})};
 await assert.rejects(rag.indexPendingTeamKnowledge(db,TEAM,{provider}),/provider_error_429/);
 const release=db.calls.find(x=>x.name==='release_team_knowledge_jobs');assert.deepEqual(release.args.p_claims,[{source_id:SOURCE,claim_token:'90000000-0000-4000-8000-000000000009'}]);assert.equal(release.args.p_team_id,TEAM);
});
