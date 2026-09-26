"use strict";
(function(root){
  const TABLES=new Set(["learning_items","learning_sessions"]);
  function createStore(remote){
    async function ctx(){
      const client=await remote?.init?.(),session=await remote?.getSession?.();
      if(!client||!session?.user?.id)throw new Error("Inicia sessão na conta Vision Coach para usar a Formação.");
      return client;
    }
    async function run(q){const {data,error}=await q;if(error)throw error;return data;}
    const now=()=>new Date().toISOString();
    function allowed(t){if(!TABLES.has(t))throw new Error("learning_table_not_allowed");}
    return{
      async listAgeGroups(){return run((await ctx()).from("learning_age_groups").select("code,name,sort,active").order("sort"));},
      async listModules(code){return run((await ctx()).from("learning_modules").select("id,block,slug,title,sort").eq("age_group_code",code).order("sort"));},
      async listItems(ids){if(!ids?.length)return[];return run((await ctx()).from("learning_items").select("*").in("module_id",ids).eq("status","aprovado").eq("broken",false).order("created_at"));},
      async getGuide(id){return run((await ctx()).from("learning_guides").select("*").eq("module_id",id).eq("status","aprovado").maybeSingle());},
      async listSessions(id){return run((await ctx()).from("learning_sessions").select("*").eq("module_id",id).eq("status","aprovado").order("created_at"));},
      async getSession(id){return run((await ctx()).from("learning_sessions").select("*").eq("id",id).eq("status","aprovado").maybeSingle());},
      async markSeen(t,id,seen){allowed(t);return run((await ctx()).from(t).update({seen_at:seen?now():null,updated_at:now()}).eq("id",id));},
      async saveNotes(t,id,notes){allowed(t);return run((await ctx()).from(t).update({notes:String(notes||"").slice(0,5000),updated_at:now()}).eq("id",id));},
      async markBroken(id){return run((await ctx()).from("learning_items").update({broken:true,updated_at:now()}).eq("id",id));}
    };
  }
  const store=createStore({init:()=>root.RemoteWorkspace?.init(),getSession:()=>root.RemoteWorkspace?.getSession()});
  const api={createStore,store};root.LearningStore=api;if(typeof module!=="undefined"&&module.exports)module.exports=api;
})(globalThis);
