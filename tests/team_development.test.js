const test=require('node:test'),assert=require('node:assert/strict');
const D=require('../js/team_development.js');
const U='11111111-1111-4111-8111-111111111111',M='22222222-2222-4222-8222-222222222222';
test('weekly plan anchors Monday, keeps stable session links, and requires the current revision',()=>{
 const first=D.saveWeek(null,{week_start:'2026-09-23',objective:'Apoio depois do passe',training1:U,match:M,links:[{from:U,to:M,note:'Aplicar no jogo'}],evaluation:{summary:'Ainda não avaliado'}},{expected_revision:0,now:'2026-09-20T12:00:00Z'});
 assert.equal(first.week_start,'2026-09-21');assert.equal(first.training1,U);assert.equal(first.match,M);assert.equal(first.links[0].note,'Aplicar no jogo');
 assert.throws(()=>D.saveWeek({body:JSON.stringify(first)},{week_start:'2026-09-21',objective:'Outro'},{expected_revision:0}),/mudou noutro dispositivo/);
});
test('team progress requires real session references, separate evaluation and coach decision',()=>{
 const base={title:'Saída apoiada',identified_at:'2026-09-01',stage:'worked',sessions:[{type:'training',id:U}],observations:'Apoio tardio',interpretation:'Linha curta reduz opções',hypothesis:'Sob pressão pode falhar'};
 const worked=D.saveGoal(null,base,{expected_revision:0,now:'2026-09-20T12:00:00Z'});assert.equal(worked.stage,'worked');
 assert.throws(()=>D.saveGoal({body:JSON.stringify(worked)},{...base,stage:'improved',coach_decision:''},{expected_revision:1}),/decisão explícita/);
 assert.throws(()=>D.saveGoal({body:JSON.stringify(worked)},{...base,stage:'improved',coach_decision:'Decisão registada.'},{expected_revision:1}),/avaliação do treinador/);
 const improved=D.saveGoal({body:JSON.stringify(worked)},{...base,stage:'improved',evaluation:'O apoio apareceu em três jogos consecutivos.',coach_decision:'Manter o princípio no próximo ciclo.'},{expected_revision:1});assert.equal(improved.history.at(-1).stage,'worked');assert.equal(improved.stage,'improved');assert.equal(improved.evaluation,'O apoio apareceu em três jogos consecutivos.');assert.equal(improved.history.at(-1).evaluation,'');
 assert.throws(()=>D.saveGoal(null,{...base,sessions:[]},{expected_revision:0}),/associa pelo menos um treino ou jogo/i);
});
test('Head Coach proposals keep source-level evidence separate and cannot be accepted without coach decision',()=>{
 const evidence=[{type:'match',id:M,field:'analysis.problems',quote:'Perdas na saída',record_updated_at:'v1'},{type:'match',id:M,field:'analysis.problems',quote:'Perdas na saída',record_updated_at:'v1'}];
 const proposal=D.saveGoal(null,{title:'Apoio na saída',stage:'identified',sessions:[{type:'match',id:M}],evidence:[{type:'match',id:M}],observations:'',interpretation:'O apoio pode estar distante',hypothesis:'Confirmar em mais jogos',coach_decision:'',agent_proposal:{status:'proposed',rationale:'A mesma dificuldade aparece em fontes distintas.',prepared_by:'Head Coach',evidence_refs:evidence}},{expected_revision:0});
 assert.equal(proposal.agent_proposal.evidence_refs.length,1);assert.equal(proposal.agent_proposal.evidence_refs[0].quote,'Perdas na saída');
 const edited=D.saveGoal({body:JSON.stringify(proposal)},{...proposal,title:'Apoio curto na saída'},{expected_revision:1});assert.equal(edited.agent_proposal.status,'proposed');assert.equal(edited.history[0].agent_proposal,null);
 assert.throws(()=>D.saveGoal({body:JSON.stringify(edited)},{...edited,agent_proposal:{...edited.agent_proposal,status:'accepted'},coach_decision:''},{expected_revision:2}),/decisão explícita/);
 const accepted=D.saveGoal({body:JSON.stringify(edited)},{...edited,agent_proposal:{...edited.agent_proposal,status:'accepted'},coach_decision:'Aceito trabalhar apoio curto.'},{expected_revision:2});assert.equal(accepted.agent_proposal.status,'accepted');assert.equal(accepted.coach_decision,'Aceito trabalhar apoio curto.');
});
