"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { createClient } = require("@supabase/supabase-js");
const { createStore } = require("../js/learning_store.js");

const url = process.env.VISION_COACH_SUPABASE_LOCAL_URL || "";
const anonKey = process.env.VISION_COACH_SUPABASE_LOCAL_ANON_KEY || "";
const serviceKey = process.env.VISION_COACH_SUPABASE_LOCAL_SERVICE_KEY || "";
const enabled = !!(url && anonKey && serviceKey);

test("Formação local isola biblioteca e plano por dono e recusa ligações cruzadas", {
  skip: !enabled && "requer apenas a stack Supabase local; nunca usar credenciais de produção",
  timeout: 60_000,
}, async () => {
  assert.ok(["localhost", "127.0.0.1", "::1"].includes(new URL(url).hostname));
  const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const users = [];
  const clients = [];
  try {
    for (const label of ["A", "B"]) {
      const email = `formation-${label.toLowerCase()}-${crypto.randomUUID()}@vision-coach.local`;
      const password = crypto.randomBytes(24).toString("base64url");
      const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
      assert.ifError(created.error);
      users.push(created.data.user.id);
      const client = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
      const signedIn = await client.auth.signInWithPassword({ email, password });
      assert.ifError(signedIn.error);
      clients.push(client);
    }

    const moduleResult = await clients[0].from("learning_modules").select("id")
      .eq("age_group_code", "sub8").eq("slug", "treinos-exemplo").single();
    assert.ifError(moduleResult.error);
    const moduleId = moduleResult.data.id;
    const records = [];
    for (let i = 0; i < clients.length; i++) {
      const session = await clients[i].from("learning_sessions").insert({
        module_id: moduleId, title: `Treino local ${i}`, objective: "Teste de isolamento",
        library_code: `LOCAL-${crypto.randomUUID()}`, status: "aprovado",
      }).select("id").single();
      assert.ifError(session.error);
      const plan = await clients[i].from("learning_season_plans").insert({
        age_group_code: "sub8", season_label: `local-${crypto.randomUUID()}`,
        title: `Plano local ${i}`, start_date: "2026-09-07", end_date: "2027-07-30",
        status: "aprovado",
      }).select("id").single();
      assert.ifError(plan.error);
      records.push({ sessionId: session.data.id, planId: plan.data.id });
    }

    const foreignPlan = await clients[1].from("learning_plan_weeks").insert({
      plan_id: records[0].planId, week_no: 1, starts_on: "2026-09-07",
      block_no: 1, block_title: "Bloco", objective: "Foco",
    });
    assert.equal(foreignPlan.error?.code, "23503");
    const foreignSession = await clients[1].from("learning_plan_weeks").insert({
      plan_id: records[1].planId, week_no: 1, starts_on: "2026-09-07",
      block_no: 1, block_title: "Bloco", objective: "Foco",
      session_a_id: records[0].sessionId,
    });
    assert.equal(foreignSession.error?.code, "23503");

    const ownWeek = await clients[1].from("learning_plan_weeks").insert({
      plan_id: records[1].planId, week_no: 1, starts_on: "2026-09-07",
      block_no: 1, block_title: "Bloco", objective: "Foco",
      session_a_id: records[1].sessionId,
    }).select("id").single();
    assert.ifError(ownWeek.error);
    const stolenLink = await clients[1].from("learning_plan_weeks")
      .update({ session_b_id: records[0].sessionId }).eq("id", ownWeek.data.id);
    assert.equal(stolenLink.error?.code, "23503");

    const storeB = createStore({ init: async () => clients[1], getSession: async () => ({ user: { id: users[1] } }) });
    const library = await storeB.listLibrary("sub8");
    assert.deepEqual(library.map((row) => row.id), [records[1].sessionId]);
    const season = await storeB.getSeasonPlan("sub8");
    assert.equal(season.plan.id, records[1].planId);
    assert.deepEqual(season.weeks.map((row) => row.id), [ownWeek.data.id]);
    const hiddenPlan = await clients[1].from("learning_season_plans")
      .select("id").eq("id", records[0].planId);
    assert.ifError(hiddenPlan.error);
    assert.deepEqual(hiddenPlan.data, []);
  } finally {
    if (users.length) {
      for (const table of ["learning_plan_weeks", "learning_season_plans", "learning_sessions"]) {
        const removed = await admin.from(table).delete().in("owner_id", users);
        assert.ifError(removed.error);
      }
    }
    for (const id of users) {
      const removed = await admin.auth.admin.deleteUser(id);
      assert.ifError(removed.error);
    }
  }
});
