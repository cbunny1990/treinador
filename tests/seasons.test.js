const test=require('node:test'),assert=require('node:assert/strict');
const S=require('../js/seasons.js');
const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222';
test('season archive stores stable roster UUIDs, one active period, and preserves prior state',()=>{
 const first=S.save(null,{name:'2025/26',start_date:'2025-08-01',end_date:'2026-07-31',roster:[{ref:A,name:'Ana',number:7}],activate:true},{expected_revision:0,now:'2025-08-01T10:00:00Z'});
 const next=S.save({body:JSON.stringify(first)},{name:'2026/27',start_date:'2026-08-01',end_date:'2027-07-31',roster:[{ref:B,name:'Bia'}],activate:true},{expected_revision:1,now:'2026-08-01T10:00:00Z'});
 assert.equal(next.active_id,next.items[1].id);assert.equal(next.items[0].state,'archived');assert.deepEqual(next.items[0].roster.map(x=>x.ref),[A]);assert.equal(next.history.length,2);
 assert.equal(S.includes(next.items[0],'2026-07-31'),true);assert.equal(S.includes(next.items[0],'2026-08-01'),false);
 assert.throws(()=>S.save({body:JSON.stringify(next)},{name:'2027/28',start_date:'2026-08-01',end_date:'2027-07-31'},{expected_revision:1}),/mudou noutro dispositivo/);
});
test('season ranges reject impossible dates and duplicate names',()=>{
 assert.throws(()=>S.save(null,{name:'Inválida',start_date:'2026-02-31',end_date:'2026-07-31'},{expected_revision:0}),/intervalo de datas válido/);
 const first=S.save(null,{name:'2026/27',start_date:'2026-08-01',end_date:'2027-07-31'},{expected_revision:0});
 assert.throws(()=>S.save({body:JSON.stringify(first)},{name:'2026/27',start_date:'2027-08-01',end_date:'2028-07-31'},{expected_revision:1}),/Já existe uma época/);
});
test('season roster rejects malformed stable UUIDs and jersey numbers instead of dropping entries',()=>{
 const base={name:'2026/27',start_date:'2026-08-01',end_date:'2027-07-31'};
 assert.throws(()=>S.save(null,{...base,roster:[{ref:'------------------------------------',name:'Atleta'}]},{expected_revision:0}),/UUIDs válidos/);
 assert.throws(()=>S.save(null,{...base,roster:[{ref:A,name:'Atleta',number:7.5}]},{expected_revision:0}),/UUIDs válidos/);
 assert.throws(()=>S.save(null,{...base,id:'not-a-uuid'},{expected_revision:0}),/UUID estável/);
});
test('stable archive UUID is deterministic for each team',async()=>{assert.equal(await S.stableIndexId(A),await S.stableIndexId(A));assert.notEqual(await S.stableIndexId(A),await S.stableIndexId(B));});
test('season index retains all revision history after repeated saves and activation',()=>{let doc=null;const first=S.save(doc,{name:'2026/27',start_date:'2026-08-01',end_date:'2027-07-31',activate:true},{expected_revision:0});doc={body:JSON.stringify(first)};for(let i=1;i<=45;i++){const current=S.state(doc),updated=i%2?S.activate(doc,current.items[0].id,{expected_revision:current.revision,now:`2026-09-${String(i%28+1).padStart(2,'0')}T10:00:00Z`}):S.save(doc,{id:current.items[0].id,name:'2026/27',start_date:'2026-08-01',end_date:'2027-07-31',activate:true},{expected_revision:current.revision,now:`2026-09-${String(i%28+1).padStart(2,'0')}T10:00:00Z`});doc={body:JSON.stringify(updated)};}const reopened=S.state(doc);assert.equal(reopened.history.length,46);assert.equal(reopened.history[0].revision,0);assert.equal(reopened.history.at(-1).revision,45);});
