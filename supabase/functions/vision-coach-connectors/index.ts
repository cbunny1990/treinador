import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.116.0";

const ALLOWED_ORIGINS = new Set([
  "https://cbunny1990.github.io",
  "http://localhost:3000",
  "http://127.0.0.1:8000",
]);

function cors(req: Request) {
  const origin = req.headers.get("origin") || "";
  return {
    "access-control-allow-origin": ALLOWED_ORIGINS.has(origin) ? origin : "https://cbunny1990.github.io",
    "access-control-allow-headers": "authorization, apikey, content-type",
    "access-control-allow-methods": "POST, OPTIONS",
    "vary": "Origin",
  };
}

function json(req: Request, status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors(req), "content-type": "application/json; charset=utf-8" },
  });
}

function publishableKey() {
  try {
    const keys = JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS") || "{}");
    if (keys.default) return String(keys.default);
    const first = Object.values(keys)[0];
    if (first) return String(first);
  } catch (_) {}
  return Deno.env.get("SUPABASE_ANON_KEY") || "";
}

function base64url(bytes: Uint8Array) {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return [...digest].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function validUuid(value: unknown) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ""));
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(req) });
  if (req.method !== "POST") return json(req, 405, { ok: false, error: "method_not_allowed" });

  const url = Deno.env.get("SUPABASE_URL") || "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const publicKey = publishableKey();
  if (!url || !serviceKey || !publicKey) return json(req, 500, { ok: false, error: "server_not_configured" });

  const authHeader = req.headers.get("authorization") || "";
  const accessToken = authHeader.replace(/^Bearer\s+/i, "");
  if (!accessToken) return json(req, 401, { ok: false, error: "authentication_required" });

  const userClient = createClient(url, publicKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: "Bearer " + accessToken } },
  });
  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: userData, error: userError } = await userClient.auth.getUser(accessToken);
  const user = userData?.user;
  if (userError || !user) return json(req, 401, { ok: false, error: "invalid_user_session" });

  let body: Record<string, any>;
  try {
    body = await req.json();
  } catch (_) {
    return json(req, 400, { ok: false, error: "invalid_json" });
  }

  const action = String(body.action || "");
  const teamId = String(body.team_id || "");
  if (!validUuid(teamId)) return json(req, 400, { ok: false, error: "invalid_team_id" });

  const { data: team, error: teamError } = await admin
    .from("teams").select("id,owner_id,name").eq("id", teamId).maybeSingle();
  if (teamError) return json(req, 500, { ok: false, error: "team_lookup_failed" });
  if (!team || team.owner_id !== user.id) return json(req, 403, { ok: false, error: "team_owner_required" });

  try {
    if (action === "list") {
      const { data, error } = await admin.rpc("mcp_connector_list", {
        p_team_id: teamId,
        p_owner_id: user.id,
      });
      if (error) throw error;
      return json(req, 200, {
        ok: true,
        team: { id: team.id, name: team.name },
        mcp_url: url + "/functions/v1/vision-coach-mcp",
        connectors: data || [],
      });
    }

    if (action === "create") {
      const label = String(body.label || "").trim().slice(0, 80);
      if (!label) return json(req, 400, { ok: false, error: "label_required" });

      const allowed = new Set(["read", "write", "media"]);
      const scopes = [...new Set((Array.isArray(body.scopes) ? body.scopes : ["read"]).map(String))]
        .filter((scope) => allowed.has(scope));
      if (!scopes.length) return json(req, 400, { ok: false, error: "scope_required" });

      const requestedDays = Number(body.expires_in_days ?? 365);
      if (!Number.isFinite(requestedDays) || requestedDays < 1 || requestedDays > 3650) {
        return json(req, 400, { ok: false, error: "invalid_expiry" });
      }

      const random = crypto.getRandomValues(new Uint8Array(32));
      const rawToken = "vcmcp_" + base64url(random);
      const tokenHash = await sha256(rawToken);
      const tokenPrefix = rawToken.slice(0, 14);
      const expiresAt = new Date(Date.now() + requestedDays * 86400000).toISOString();

      const { data, error } = await admin.rpc("mcp_connector_create", {
        p_team_id: teamId,
        p_owner_id: user.id,
        p_token_hash: tokenHash,
        p_token_prefix: tokenPrefix,
        p_label: label,
        p_scopes: scopes,
        p_expires_at: expiresAt,
      });
      if (error) throw error;

      await admin.from("activity_log").insert({
        team_id: teamId,
        actor_type: "human",
        actor_label: "Treinador",
        action: "created_mcp_connector",
        summary: "Criou ligação IA · " + label,
        entity_type: "connector",
        entity_ref: data?.id ? String(data.id) : null,
        metadata: { scopes, expires_at: expiresAt },
        created_by: user.id,
      });

      return json(req, 201, {
        ok: true,
        connector: data,
        token: rawToken,
        mcp_url: url + "/functions/v1/vision-coach-mcp",
        warning: "Guarda este token agora. O Vision Coach não o volta a mostrar.",
      });
    }

    if (action === "revoke") {
      const tokenId = String(body.token_id || "");
      if (!validUuid(tokenId)) return json(req, 400, { ok: false, error: "invalid_token_id" });
      const { data, error } = await admin.rpc("mcp_connector_revoke", {
        p_token_id: tokenId,
        p_team_id: teamId,
        p_owner_id: user.id,
      });
      if (error) throw error;
      if (!data) return json(req, 404, { ok: false, error: "connector_not_found" });

      await admin.from("activity_log").insert({
        team_id: teamId,
        actor_type: "human",
        actor_label: "Treinador",
        action: "revoked_mcp_connector",
        summary: "Revogou ligação IA",
        entity_type: "connector",
        entity_ref: tokenId,
        metadata: {},
        created_by: user.id,
      });

      return json(req, 200, { ok: true, revoked: true });
    }

    return json(req, 400, { ok: false, error: "unknown_action" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "connector_error";
    return json(req, 400, { ok: false, error: message });
  }
});
