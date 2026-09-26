const test=require('node:test'),assert=require('node:assert/strict');
const D=require('../js/team_development.js');
const U='11111111-1111-4111-8111-111111111111',M='22222222-2222-4222-8222-222222222222';
test('weekly plan anchors Monday, keeps stable session links, and requires the current revision',()=>{
 const first=D.saveWeek(null,{week_start:'2026-09-23',objective:'Apoio depois do passe',training1:U,match:M,links:[{from:U,to:M,note:'Aplicar no jogo'}],evaluation:{summary:'Ainda não avaliado'}},{expected_revision:0,now:'2026-09-20T12:00:00Z'});
 assert.equal(first.week_start,'2026-09-21');assert.equal(first.training1,U);assert.equal(first.match,M);assert.equal(first.links[0].note,'Aplicar no jogo');
 assert.throws(()=>D.saveWeek({body:JSON.stringify(first)},{week_start:'2026-09-21',objective:'Outro'},{expected_revision:0}),/mudou noutro dispositivo/);
});
test('weekly plans refuse malformed references instead of silently converting them to empty links',()=>{
 const old={body:JSON.stringify({schema:D.schemas.week,revision:0,week_start:'2026-09-21',training1:'legacy-local-id'})};
 assert.throws(()=>D.saveWeek(null,{week_start:'2026-09-23',training1:'legacy-local-id'},{expected_revision:0}),/referência de treino 1 não é um UUID válido/i);
 assert.throws(()=>D.saveWeek(null,{week_start:'2026-09-23',links:[{from:U,to:'bad-ref'}]},{expected_revision:0}),/referência de destino da relação não é um UUID válido/i);
 assert.throws(()=>D.saveWeek({body:old.body},{week_start:'2026-09-23',training1:'legacy-local-id'},{expected_revision:0}),/referência de treino 1 não é um UUID válido/i);
 assert.equal(JSON.parse(old.body).training1,'legacy-local-id');
});
test('weekly plan proposal status, citations, and coach decision remain in revision history',()=>{
 const pending=D.saveWeek(null,{week_start:'2026-09-23',objective:'Progressão do apoio',relation_note:'Introduzir oposição',agent_proposal:{status:'proposed',proposal_key:'proposal-1',rationale:'O problema apareceu no jogo.',hypothesis:'Verificar sob oposição.',evidence_refs:[{type:'match',id:M,field:'analysis.problems',quote:'Perdas na saída',record_updated_at:'match-v1'}]}},{expected_revision:0});
 assert.equal(pending.week_start,'2026-09-21');assert.equal(pending.agent_proposal.status,'proposed');assert.equal(pending.agent_proposal.coach_decision,'');assert.equal(pending.agent_proposal.evidence_refs[0].quote,'Perdas na saída');
 const accepted=D.saveWeek({body:JSON.stringify(pending)},{...pending,agent_proposal:{...pending.agent_proposal,status:'accepted',coach_decision:'Aprovo esta progressão.'}},{expected_revision:1});
 assert.equal(accepted.agent_proposal.status,'accepted');assert.equal(accepted.agent_proposal.coach_decision,'Aprovo esta progressão.');assert.equal(accepted.history.at(-1).agent_proposal.status,'proposed');
 assert.throws(()=>D.saveWeek({body:JSON.stringify(pending)},{...pending,agent_proposal:{...pending.agent_proposal,evidence_refs:[{type:'training',id:'legacy-id',field:'review'}]}},{expected_revision:1}),/evidência da proposta é inválida/i);
});
test('team goals reject malformed session, evidence, exercise, and proposal references before saving',()=>{
 const base={title:'Apoio',stage:'identified'};
 for(const field of ['sessions','evidence','worked_sessions','exercises'])assert.throws(()=>D.saveGoal(null,{...base,[field]:[{type:field==='exercises'?'exercise':'training',id:'legacy-local-id'}]},{expected_revision:0}),/referência .* inválida/i,field);
 for(const [field,type] of [['sessions','memory'],['worked_sessions','exercise'],['exercises','training']])assert.throws(()=>D.saveGoal(null,{...base,[field]:[{type,id:U}]},{expected_revision:0}),/tipo inválido/i,field);
 assert.throws(()=>D.saveGoal(null,{...base,agent_proposal:{status:'proposed',evidence_refs:[{type:'match',id:'legacy-local-id',field:'analysis.problems'}]}},{expected_revision:0}),/evidência da proposta é inválida/i);
});
test('editing a legacy team goal preserves unknown worked-session history until the coach supplies a replacement',()=>{
 const old={body:JSON.stringify({schema:D.schemas.goal,revision:3,title:'Apoio antigo',stage:'planned',sessions:[{type:'training',id:U}],worked_sessions:null})};
 const changed=D.saveGoal(old,{title:'Apoio antigo revisto',stage:'planned',sessions:[{type:'training',id:U}],evidence:[],exercises:[],observations:'Nota atualizada'},{expected_revision:3});
 assert.equal(changed.worked_sessions,null);assert.equal(changed.history[0].worked_sessions,null);assert.equal(changed.title,'Apoio antigo revisto');
});
test('team progress requires explicitly worked session references, separate evaluation and coach decision',()=>{
 const base={title:'Saída apoiada',identified_at:'2026-09-01',stage:'worked',sessions:[{type:'training',id:U}],worked_sessions:[{type:'training',id:U}],observations:'Apoio tardio',interpretation:'Linha curta reduz opções',hypothesis:'Sob pressão pode falhar'};
 const worked=D.saveGoal(null,base,{expected_revision:0,now:'2026-09-20T12:00:00Z'});assert.equal(worked.stage,'worked');
 assert.throws(()=>D.saveGoal({body:JSON.stringify(worked)},{...base,stage:'improved',coach_decision:''},{expected_revision:1}),/decisão explícita/);
 assert.throws(()=>D.saveGoal({body:JSON.stringify(worked)},{...base,stage:'improved',coach_decision:'Decisão registada.'},{expected_revision:1}),/avaliação do treinador/);
 const improved=D.saveGoal({body:JSON.stringify(worked)},{...base,stage:'improved',evaluation:'O apoio apareceu em três jogos consecutivos.',coach_decision:'Manter o princípio no próximo ciclo.'},{expected_revision:1});assert.equal(improved.history.at(-1).stage,'worked');assert.equal(improved.stage,'improved');assert.equal(improved.evaluation,'O apoio apareceu em três jogos consecutivos.');assert.equal(improved.history.at(-1).evaluation,'');
 assert.throws(()=>D.saveGoal(null,{...base,sessions:[],worked_sessions:[]},{expected_revision:0}),/associa explicitamente pelo menos uma sessão concluída/i);
});
test('legacy session associations do not become worked-session evidence automatically',()=>{const legacy={schema:D.schemas.goal,revision:1,title:'Apoio',stage:'planned',sessions:[{type:'training',id:U}]};const read=D.teamGoal({body:JSON.stringify(legacy)});assert.deepEqual(read.sessions,[{type:'training',id:U}]);assert.equal(read.worked_sessions,null);assert.match(D.workedSessionsLabel(read.worked_sessions),/registo antigo/);assert.equal(D.stageRequiresWorkedSession('worked'),true);assert.equal(D.stageRequiresWorkedSession('planned'),false);});
test('only completed training or explicitly concluded match records count as worked sessions',()=>{assert.equal(D.isCompletedSession('training',{session:{status:'completed'}}),true);assert.equal(D.isCompletedSession('training',{status:'ready'}),false);assert.equal(D.isCompletedSession('training',{session:{status:'running'}}),false);assert.equal(D.isCompletedSession('match',{estado:'concluido'}),true);assert.equal(D.isCompletedSession('match',{visual_match:{status:'completed'}}),true);assert.equal(D.isCompletedSession('match',{estado:'agendado',visual_match:{status:'paused'}}),false);});
test('team goal keeps observation evidence separate from linked sessions across edits',()=>{const memory='33333333-3333-4333-8333-333333333333',goal=D.saveGoal(null,{title:'Apoio na construção',stage:'identified',sessions:[{type:'training',id:U}],evidence:[{type:'training',id:U},{type:'memory',id:memory}],observations:'Apoio observado.',interpretation:'Apoio pode estar distante.'},{expected_revision:0}),edited=D.saveGoal({body:JSON.stringify(goal)},{...goal,title:'Apoio curto na construção'},{expected_revision:1});assert.deepEqual(edited.evidence,[{type:'training',id:U},{type:'memory',id:memory}]);assert.equal(edited.history.at(-1).evidence.some(x=>x.type==='memory'&&x.id===memory),true);});
test('team goal and weekly plan retain history beyond the previous silent caps',()=>{let goal=D.saveGoal(null,{title:'Apoio',stage:'identified'},{expected_revision:0}),week=D.saveWeek(null,{week_start:'2026-09-21',objective:'Foco 0'},{expected_revision:0});for(let i=1;i<=35;i++){goal=D.saveGoal({body:JSON.stringify(goal)},{...goal,title:`Apoio ${i}`},{expected_revision:i});week=D.saveWeek({body:JSON.stringify(week)},{week_start:'2026-09-21',objective:`Foco ${i}`},{expected_revision:i});}assert.equal(goal.history.length,36);assert.equal(goal.history[1].title,'Apoio');assert.equal(goal.history.at(-1).title,'Apoio 34');assert.equal(week.history.length,36);assert.equal(week.history[0].objective,'');assert.equal(week.history.at(-1).objective,'Foco 34');});
test('Head Coach proposals keep source-level evidence separate and cannot be accepted without coach decision',()=>{
 const evidence=[{type:'match',id:M,field:'analysis.problems',quote:'Perdas na saída',record_updated_at:'v1'},{type:'match',id:M,field:'analysis.problems',quote:'Perdas na saída',record_updated_at:'v1'}];
 const proposal=D.saveGoal(null,{title:'Apoio na saída',stage:'identified',sessions:[{type:'match',id:M}],evidence:[{type:'match',id:M}],observations:'',interpretation:'O apoio pode estar distante',hypothesis:'Confirmar em mais jogos',coach_decision:'',agent_proposal:{status:'proposed',rationale:'A mesma dificuldade aparece em fontes distintas.',prepared_by:'Head Coach',evidence_refs:evidence}},{expected_revision:0});
 assert.equal(proposal.agent_proposal.evidence_refs.length,1);assert.equal(proposal.agent_proposal.evidence_refs[0].quote,'Perdas na saída');
 const edited=D.saveGoal({body:JSON.stringify(proposal)},{...proposal,title:'Apoio curto na saída'},{expected_revision:1});assert.equal(edited.agent_proposal.status,'proposed');assert.equal(edited.history[0].agent_proposal,null);
 assert.throws(()=>D.saveGoal({body:JSON.stringify(edited)},{...edited,agent_proposal:{...edited.agent_proposal,status:'accepted'},coach_decision:''},{expected_revision:2}),/decisão explícita/);
 const accepted=D.saveGoal({body:JSON.stringify(edited)},{...edited,agent_proposal:{...edited.agent_proposal,status:'accepted'},coach_decision:'Aceito trabalhar apoio curto.'},{expected_revision:2});assert.equal(accepted.agent_proposal.status,'accepted');assert.equal(accepted.coach_decision,'Aceito trabalhar apoio curto.');
});
