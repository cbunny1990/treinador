"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { createClient } = require("@supabase/supabase-js");

const url = process.env.VISION_COACH_SUPABASE_LOCAL_URL || "";
const anonKey = process.env.VISION_COACH_SUPABASE_LOCAL_ANON_KEY || "";
const serviceKey = process.env.VISION_COACH_SUPABASE_LOCAL_SERVICE_KEY || "";
const enabled = !!(url && anonKey && serviceKey);
const isLoopback = (value) => ["localhost", "127.0.0.1", "::1"].includes(new URL(value).hostname);
function within(promise, timeoutMs, timeoutMessage) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(typeof timeoutMessage === "function" ? timeoutMessage() : timeoutMessage)), timeoutMs);
    }),
  ]).finally(() => clearTimeout(timer));
}

test("Realtime local entrega atividade a outro membro da equipa e mantém RLS", {
  skip: !enabled && "requer URL e chaves da stack Supabase local; nunca usar credenciais de produção",
  timeout: 60_000,
}, async () => {
  assert.ok(isLoopback(url), "Este teste aceita apenas Supabase em localhost.");
  const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const clientFor = () => createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
  const users = [];
  const subscriptions = [];
  const cleanupErrors = [];
  let teamId = null;
  let testError = null;

  async function makeUser(label) {
    const email = `realtime-${label}-${crypto.randomUUID()}@vision-coach.local`;
    const password = crypto.randomBytes(24).toString("base64url");
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    assert.ifError(created.error);
    users.push(created.data.user.id);
    const client = clientFor();
    const signIn = await client.auth.signInWithPassword({ email, password });
    assert.ifError(signIn.error);
    return { user: signIn.data.user, client };
  }

  try {
    const owner = await makeUser("owner");
    const coach = await makeUser("coach");
    const outsider = await makeUser("outsider");
    const createdTeam = await owner.client.from("teams")
      .insert({ owner_id: owner.user.id, name: "Realtime local isolado" }).select("id").single();
    assert.ifError(createdTeam.error);
    teamId = createdTeam.data.id;
    const joined = await admin.from("team_members").insert({ team_id: teamId, user_id: coach.user.id, role: "coach" });
    assert.ifError(joined.error);

    const statuses = [];
    let lastError = null;
    let resolveSubscribed;
    let rejectSubscribed;
    let resolveEvent;
    let rejectEvent;
    const subscribed = new Promise((resolve, reject) => { resolveSubscribed = resolve; rejectSubscribed = reject; });
    const received = new Promise((resolve, reject) => { resolveEvent = resolve; rejectEvent = reject; });
    void received.catch(() => {});
    const channel = owner.client
      .channel(`realtime-activity-${crypto.randomUUID()}`, {
        config: { postgres_changes_options: { wait: true } },
      })
      .on("postgres_changes", {
        event: "INSERT", schema: "public", table: "activity_log", filter: `team_id=eq.${teamId}`,
      }, (payload) => {
        resolveEvent(payload);
      });
    subscriptions.push({ client: owner.client, channel });
    channel.subscribe((status, error) => {
      statuses.push(status);
      if (error) lastError = error;
      if (status === "SUBSCRIBED") {
        resolveSubscribed();
        return;
      }
      if (["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].includes(status)) {
        const failure = error || new Error(`realtime_subscription_${status}`);
        rejectSubscribed(failure);
        rejectEvent(failure);
      }
    });
    await within(subscribed, 20_000, () => `activity_log_subscription_timeout:${statuses.join(",")}:${lastError?.message || "no_subscription_error"}`);

    const row = {
      id: crypto.randomUUID(), team_id: teamId, actor_type: "human", actor_label: "Treinador",
      action: "realtime_test", summary: "Atividade de sync local", entity_type: "test",
      entity_ref: null, metadata: { test: true }, created_by: coach.user.id,
    };
    const inserted = await coach.client.from("activity_log").insert(row).select("id").single();
    assert.ifError(inserted.error);
    assert.equal(inserted.data.id, row.id);

    const event = await within(received, 20_000, () => `activity_log_event_timeout:${statuses.join(",")}:${lastError?.message || "no_subscription_error"}`);
    assert.equal(event.eventType, "INSERT");
    assert.equal(event.new.id, row.id);
    assert.equal(event.new.team_id, teamId);
    assert.equal(event.new.summary, row.summary);

    const visibleToOwner = await owner.client.from("activity_log").select("id").eq("id", row.id).single();
    assert.ifError(visibleToOwner.error);
    assert.equal(visibleToOwner.data.id, row.id);
    const hiddenFromOutsider = await outsider.client.from("activity_log").select("id").eq("team_id", teamId);
    assert.ifError(hiddenFromOutsider.error);
    assert.deepEqual(hiddenFromOutsider.data, []);
  } catch (error) {
    testError = error;
  } finally {
    for (const { client, channel } of subscriptions) {
      try { await within(client.removeChannel(channel), 5_000, "realtime_channel_cleanup_timeout"); }
      catch (error) { cleanupErrors.push(error); }
      try { await within(client.realtime.disconnect(), 5_000, "realtime_socket_cleanup_timeout"); }
      catch (error) { cleanupErrors.push(error); }
    }
    if (teamId) {
      try {
        const removed = await admin.from("teams").delete().eq("id", teamId);
        if (removed.error) cleanupErrors.push(removed.error);
      } catch (error) { cleanupErrors.push(error); }
    }
    for (const id of users) {
      try {
        const removed = await admin.auth.admin.deleteUser(id);
        if (removed.error) cleanupErrors.push(removed.error);
      } catch (error) { cleanupErrors.push(error); }
    }
  }
  if (testError) {
    if (cleanupErrors.length) testError.cleanupErrors = cleanupErrors;
    throw testError;
  }
  if (cleanupErrors.length) throw new AggregateError(cleanupErrors, "Realtime integration fixture cleanup failed");
});
