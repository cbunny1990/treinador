const test=require('node:test'),assert=require('node:assert/strict'),Archive=require('../js/player_archive.js');
const team='equipa-uuid',playerRef='00000000-0000-4000-8000-000000000001',evidence='00000000-0000-4000-8000-000000000002';
test('player archive keeps goal revisions and stable source refs while excluding profile media',async()=>{
 const goals={schema:'vision-player-goals@1',revision:2,items:[{id:evidence,title:'Apoio',started_at:'2026-09-01',status:'continue',notes:'Manter apoio',evidence_refs:[{type:'match',id:evidence}],exercise_refs:[evidence],history:[{title:'Apoio',status:'active',notes:'Começar apoio',updated_at:'2026-09-02'}]}]};
 const player={team_id:team,sync_id:playerRef,nome:'Atleta',numero:7,escalao:'Sub-8',foto:'data:image/png;base64,PRIVATE',profile_media_ref:'private-media-uuid',development_goals:goals};
 const archive=Archive.snapshot(player,{teamId:team,teamName:'Figueiró',teamAgeGroup:'Sub-8',archivedAt:'2026-09-24T12:00:00.000Z'});
 assert.deepEqual(archive.development_goals,goals);assert.equal(archive.player.ref,playerRef);assert.equal(archive.player.number,7);assert.equal(archive.team_name,'Figueiró');assert.doesNotMatch(JSON.stringify(archive),/data:image|private-media-uuid|profile_media_ref|"foto"/);
 const first=await Archive.stableId(team,playerRef),second=await Archive.stableId(team,playerRef);assert.equal(first,second);assert.match(first,/^[0-9a-f-]{36}$/i);
 assert.deepEqual(Archive.state({type:'player_archive',body:JSON.stringify(archive)}),archive);
});
test('player archive refuses unstable athlete identity and malformed objectives',()=>{
 assert.throws(()=>Archive.snapshot({nome:'Atleta',development_goals:{items:[]}},{teamId:team}),/UUID partilhado/);
 assert.throws(()=>Archive.snapshot({sync_id:playerRef,development_goals:{items:null}},{teamId:team}),/inválidos/);
});
test('player without development goals still has a stable historical archive without profile media',async()=>{
 const archive=Archive.snapshot({sync_id:playerRef,nome:'Atleta sem objetivos',foto:'data:image/png;base64,PRIVATE',profile_media_ref:'private-media-uuid'} ,{teamId:team,archivedAt:'2026-09-25T12:00:00.000Z'});
 assert.equal(archive.player.ref,playerRef);assert.deepEqual(archive.development_goals.items,[]);assert.doesNotMatch(JSON.stringify(archive),/data:image|private-media-uuid|profile_media_ref|"foto"/);
 assert.deepEqual(Archive.state({type:'player_archive',body:JSON.stringify(archive)}),archive);
});
test('historical identity requires exact team and UUID and refuses ambiguous archives',()=>{
 const value=Archive.snapshot({sync_id:playerRef,nome:'Atleta histórico',numero:8},{teamId:team});
 const doc=(snapshot,owner=team)=>({type:'player_archive',team_id:owner,body:JSON.stringify(snapshot)});
 assert.deepEqual([...Archive.identitiesForRefs(team,new Set([playerRef]),[doc(value)])],[[playerRef,{name:'Atleta histórico',number:8}]]);
 assert.equal(Archive.identitiesForRefs(team,[playerRef],[doc(value,'outra-equipa')]).size,0);
 assert.equal(Archive.identitiesForRefs(team,[playerRef],[doc({...value,team_id:'outra-equipa'})]).size,0);
 assert.equal(Archive.identitiesForRefs(team,['id-local'],[doc({...value,player:{...value.player,ref:'id-local'}})]).size,0);
 assert.equal(Archive.identitiesForRefs(team,[playerRef],[doc(value),doc({...value,player:{...value.player,name:'Outro nome'}})]).size,0);
 assert.deepEqual([...Archive.identitiesForRefs(team,[playerRef],[{type:'player_archive',team_id:team,body:'{invalid'},doc(value)])],[[playerRef,{name:'Atleta histórico',number:8}]]);
});
