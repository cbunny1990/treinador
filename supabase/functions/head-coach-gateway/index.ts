import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const jsonHeaders = { "content-type": "application/json; charset=utf-8" };

function respond(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders });
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const raw = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = raw + "=".repeat((4 - (raw.length % 4)) % 4);
    return JSON.parse(atob(padded));
  } catch {
    return null;
  }
}

function cleanFileName(name: string) {
  const base = name.split(/[\\/]/).pop() || "file";
  return base.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 120) || "file";
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return respond(405, { ok: false, error: "method_not_allowed" });

  const contentLength = Number(req.headers.get("content-length") || "0");
  if (Number.isFinite(contentLength) && contentLength > 1024 * 1024) {
    return respond(413, { ok: false, error: "request_too_large" });
  }

  const authHeader = req.headers.get("authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  const jwt = decodeJwtPayload(token);

  // Supabase verify_jwt validates the token before the function runs.
  // This extra gate prevents normal authenticated browser sessions from
  // escalating through the service-role client used internally.
  if (!jwt || jwt.role !== "service_role") {
    return respond(403, { ok: false, error: "service_role_required" });
  }

  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) return respond(500, { ok: false, error: "server_not_configured" });

  const supabase = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let body: Record<string, any>;
  try {
    body = await req.json();
  } catch {
    return respond(400, { ok: false, error: "invalid_json" });
  }

  const operation = String(body.operation || "");
  const teamId = String(body.team_id || "");
  const agentSubject = String(body.agent_subject || "head-coach");
  const params = body.params && typeof body.params === "object" ? body.params : {};

  if (!/^[0-9a-f-]{36}$/i.test(teamId)) return respond(400, { ok: false, error: "invalid_team_id" });
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/i.test(agentSubject)) {
    return respond(400, { ok: false, error: "invalid_agent_subject" });
  }

  async function rpc(name: string, args: Record<string, unknown>) {
    const { data, error } = await supabase.rpc(name, args);
    if (error) throw new Error(error.message);
    return data;
  }

  async function requireScope(scope: string) {
    const { data, error } = await supabase
      .from("agent_authorizations")
      .select("scopes,enabled")
      .eq("team_id", teamId)
      .eq("agent_subject", agentSubject)
      .eq("enabled", true)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data || !Array.isArray(data.scopes) || !data.scopes.includes(scope)) {
      const e = new Error("agent_scope_not_authorized");
      (e as any).status = 403;
      throw e;
    }
  }

  try {
    let data: unknown;

    switch (operation) {
      case "capabilities":
        data = await rpc("head_coach_capabilities", {
          p_team_id: teamId,
          p_agent_subject: agentSubject,
        });
        break;

      case "snapshot":
        data = await rpc("head_coach_snapshot", {
          p_team_id: teamId,
          p_agent_subject: agentSubject,
          p_include_deleted: Boolean(params.include_deleted),
          p_activity_limit: Number(params.activity_limit ?? 100),
        });
        break;

      case "changes_since":
        if (!params.since) return respond(400, { ok: false, error: "since_required" });
        data = await rpc("head_coach_changes_since", {
          p_team_id: teamId,
          p_since: params.since,
          p_agent_subject: agentSubject,
        });
        break;

      case "get_record":
        if (!params.record_id) return respond(400, { ok: false, error: "record_id_required" });
        data = await rpc("head_coach_get_record", {
          p_team_id: teamId,
          p_record_id: params.record_id,
          p_agent_subject: agentSubject,
        });
        break;

      case "put_record":
        if (!params.kind || !params.payload) return respond(400, { ok: false, error: "kind_and_payload_required" });
        data = await rpc("head_coach_put_record", {
          p_team_id: teamId,
          p_kind: params.kind,
          p_payload: params.payload,
          p_record_id: params.record_id ?? null,
          p_expected_updated_at: params.expected_updated_at ?? null,
          p_idempotency_key: params.idempotency_key ?? null,
          p_agent_subject: agentSubject,
        });
        break;

      case "soft_delete_record":
        if (!params.record_id) return respond(400, { ok: false, error: "record_id_required" });
        data = await rpc("head_coach_soft_delete_record", {
          p_team_id: teamId,
          p_record_id: params.record_id,
          p_expected_updated_at: params.expected_updated_at ?? null,
          p_idempotency_key: params.idempotency_key ?? null,
          p_agent_subject: agentSubject,
        });
        break;

      case "restore_record":
        if (!params.record_id) return respond(400, { ok: false, error: "record_id_required" });
        data = await rpc("head_coach_restore_record", {
          p_team_id: teamId,
          p_record_id: params.record_id,
          p_expected_updated_at: params.expected_updated_at ?? null,
          p_idempotency_key: params.idempotency_key ?? null,
          p_agent_subject: agentSubject,
        });
        break;

      case "register_media":
        data = await rpc("head_coach_register_media", {
          p_team_id: teamId,
          p_subject_type: params.subject_type,
          p_subject_ref: params.subject_ref,
          p_media_type: params.media_type,
          p_title: params.title,
          p_note: params.note ?? null,
          p_external_url: params.external_url ?? null,
          p_storage_path: params.storage_path ?? null,
          p_file_name: params.file_name ?? null,
          p_mime_type: params.mime_type ?? null,
          p_size_bytes: params.size_bytes ?? null,
          p_media_id: params.media_id ?? null,
          p_expected_updated_at: params.expected_updated_at ?? null,
          p_idempotency_key: params.idempotency_key ?? null,
          p_agent_subject: agentSubject,
        });
        break;

      case "soft_delete_media":
        if (!params.media_id) return respond(400, { ok: false, error: "media_id_required" });
        data = await rpc("head_coach_soft_delete_media", {
          p_team_id: teamId,
          p_media_id: params.media_id,
          p_expected_updated_at: params.expected_updated_at ?? null,
          p_idempotency_key: params.idempotency_key ?? null,
          p_agent_subject: agentSubject,
        });
        break;

      case "create_media_upload": {
        await requireScope("media");
        const fileName = cleanFileName(String(params.file_name || "file"));
        const path = `${teamId}/agent/${crypto.randomUUID()}-${fileName}`;
        const { data: signed, error } = await supabase.storage
          .from("team-media")
          .createSignedUploadUrl(path, { upsert: false });
        if (error) throw new Error(error.message);
        data = {
          bucket: "team-media",
          path,
          signed_upload: signed,
          expires_in_seconds: 7200,
        };
        break;
      }

      case "create_media_download_url": {
        await requireScope("media");
        if (!params.media_id) return respond(400, { ok: false, error: "media_id_required" });
        const { data: media, error: mediaError } = await supabase
          .from("media_assets")
          .select("id,storage_path,deleted_at")
          .eq("id", params.media_id)
          .eq("team_id", teamId)
          .maybeSingle();
        if (mediaError) throw new Error(mediaError.message);
        if (!media || media.deleted_at || !media.storage_path) {
          return respond(404, { ok: false, error: "media_not_available" });
        }
        if (!String(media.storage_path).startsWith(`${teamId}/`)) {
          return respond(403, { ok: false, error: "invalid_media_path" });
        }
        const expires = Math.max(60, Math.min(Number(params.expires_in_seconds ?? 3600), 3600));
        const { data: signed, error } = await supabase.storage
          .from("team-media")
          .createSignedUrl(media.storage_path, expires);
        if (error) throw new Error(error.message);
        data = { media_id: media.id, expires_in_seconds: expires, ...signed };
        break;
      }

      default:
        return respond(400, { ok: false, error: "unknown_operation" });
    }

    return respond(200, { ok: true, operation, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "gateway_error";
    const status = Number((error as any)?.status || 400);
    return respond(status, { ok: false, error: message });
  }
});
