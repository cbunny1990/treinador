"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {createStore}=require("../js/learning_store.js");
function fake(result={data:[],error:null},user="u1"){
  const calls=[];
  const q=table=>{const c={table,ops:[]};calls.push(c);const p={};
    for(const op of ["select","eq","in","order","update","maybeSingle"])p[op]=(...a)=>{c.ops.push([op,...a]);return p;};
    p.then=(res,rej)=>Promise.resolve(result).then(res,rej);return p;};
  return{calls,remote:{init:async()=>({from:q}),getSession:async()=>user?{user:{id:user}}:null}};
}
test("listItems filtra aprovado e não partido",async()=>{
  const f=fake();await createStore(f.remote).listItems(["m1","m2"]);
  const ops=f.calls[0].ops;assert.equal(f.calls[0].table,"learning_items");
  assert.deepEqual(ops.find(o=>o[0]==="in"),["in","module_id",["m1","m2"]]);
  assert.ok(ops.some(o=>o[0]==="eq"&&o[1]==="status"&&o[2]==="aprovado"));
  assert.ok(ops.some(o=>o[0]==="eq"&&o[1]==="broken"&&o[2]===false));
});
test("markSeen grava data e rejeita tabelas fora da lista",async()=>{
  const f=fake(),s=createStore(f.remote);await s.markSeen("learning_items","i1",true);
  assert.match(f.calls[0].ops.find(o=>o[0]==="update")[1].seen_at,/^\d{4}-\d{2}-\d{2}T/);
  await s.markSeen("learning_items","i1",false);
  assert.equal(f.calls[1].ops.find(o=>o[0]==="update")[1].seen_at,null);
  await assert.rejects(()=>s.markSeen("teams","x",true),/learning_table_not_allowed/);
});
test("sem sessão dá mensagem clara em pt-PT",async()=>{
  await assert.rejects(()=>createStore(fake(undefined,null).remote).listAgeGroups(),/Inicia sessão/);
});
test("erro do Supabase é propagado",async()=>{
  await assert.rejects(()=>createStore(fake({data:null,error:new Error("boom")}).remote).listAgeGroups(),/boom/);
});
