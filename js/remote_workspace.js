"use strict";

const REMOTE_CONFIG_KEY = "treinador.remote.supabase.v1";
const REMOTE_TUS_THRESHOLD = 6 * 1024 * 1024;
const REMOTE_DEFAULT_CONFIG = {
  url: "https://rsydvhbsxzdoprekefij.supabase.co",
  publishableKey: "sb_publishable_0DwyNhlIJijcAr3u3cG51w_3VP_2vmC",
};
const REMOTE_STORE_KINDS = {
  jogadores: "player",
  jogos: "match",
  exercicios: "exercise",
  treinos: "training",
  memory_items: "memory",
  workspace_documents: "document",
  game_models: "game_model",
};
const REMOTE_KIND_STORES = Object.fromEntries(
  Object.entries(REMOTE_STORE_KINDS).map(([store, kind]) => [kind, store])
);
const REMOTE_SUBJECT_STORES = {
  player: "jogadores",
  match: "jogos",
  training: "treinos",
  exercise: "exercicios",
  memory: "memory_items",
  document: "workspace_documents",
  game_model: "game_models",
  media: "media_items",
};

function remoteText(value, max = 500) {
  return String(value == null ? "" : value).trim().slice(0, max);
}
function remoteUuid() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0, v = c === "x" ? r : (r & 3 | 8);
    return v.toString(16);
  });
}
function remoteIsUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ""));
}
function remoteReferenceError(reason) {
  const error = new Error("Referência local por reconciliar: " + reason);
  error.code = "LOCAL_REFERENCE_CONFLICT";
  error.reason = reason;
  return error;
}

function remoteLoadConfig() {
  try {
    return {
      ...REMOTE_DEFAULT_CONFIG,
      ...JSON.parse(localStorage.getItem(REMOTE_CONFIG_KEY) || "{}"),
    };
  } catch (_) {
    return { ...REMOTE_DEFAULT_CONFIG };
  }
}
function remoteSaveConfig(config) {
  localStorage.setItem(REMOTE_CONFIG_KEY, JSON.stringify(config || {}));
  return config;
}
function remoteConfigValid(config) {
  const url = remoteText(config?.url, 500);
  const key = remoteText(config?.publishableKey, 1000);
  let secure = /^https:\/\//i.test(url);
  if (!secure) {
    try {
      const parsed = new URL(url);
      secure = parsed.protocol === "http:" && ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname);
    } catch (_) {}
  }
  return secure && !!key;
}
function remoteActorFor(store, row) {
  if (store === "workspace_documents") {
    return {
      actor_type: row.updated_by || row.created_by || "human",
      actor_label: row.updated_by_label || row.created_by_label || "Treinador",
    };
  }
  if (store === "memory_items") {
    return {
      actor_type: row.metadata?.actor || "human",
      actor_label: row.metadata?.actor_label || row.source?.label || "Treinador",
    };
  }
  return {
    actor_type: row.sync_actor_type || "human",
    actor_label: row.sync_actor_label || "Treinador",
  };
}
function remotePayload(row) {
  const payload = { ...row };
  for (const key of [
    "id", "team_id", "sync_id", "sync_dirty", "sync_local_updated_at",
    "remote_updated_at", "remote_team_id", "sync_actor_type", "sync_actor_label", "data_url", "profile_media_ref",
  ]) {
    delete payload[key];
  }
  if (String(payload.foto || "").startsWith("data:") || row.profile_media_ref || /\/storage\/v1\/object\/sign\/team-media\//i.test(String(payload.foto || ""))) delete payload.foto;
  return payload;
}
function remoteFreshLocalRecord(row) {
  const fresh = { ...row };
  delete fresh.id;
  return fresh;
}

function remoteIdentityKey(kind, payload) {
  const externalKey = remoteText(payload?.external_key, 500).toLocaleLowerCase();
  return externalKey ? kind + "|" + externalKey : null;
}
function remoteNeedsConflict(local, remote) {
  return !!(
    local?.sync_dirty && remote &&
    (!local.remote_updated_at || local.remote_updated_at !== remote.updated_at)
  );
}
function remoteConflict(store, local, remote, reason = "version_mismatch") {
  return {
    store,
    local_id: local?.id ?? null,
    sync_id: local?.sync_id || remote?.id || null,
    reason,
    expected_updated_at: local?.remote_updated_at || null,
    remote_updated_at: remote?.updated_at || null,
    remote_deleted_at: remote?.deleted_at || null,
  };
}
function remoteIdentityConflictReason(row) {
  return row?.sync_id && !remoteIsUuid(row.sync_id) ? "invalid_local_sync_id" : "remote_team_unknown";
}
function remoteTombstoneNeedsConflict(item, remote) {
  return !!remote && !remote.deleted_at && (!item?.expected_updated_at || item.expected_updated_at !== remote.updated_at);
}
function remoteDeletionConflictsWithLocalEdit(local, remote) {
  return !!(local?.sync_dirty && remote?.deleted_at);
}
function remoteSyncRetryDelay(attempt) {
  return Math.min(60000, 2000 * (2 ** Math.min(5, Math.max(0, Number(attempt) - 1))));
}
function remoteActivityMatches(expected, remote) {
  const stable = (value) => Array.isArray(value) ? value.map(stable) : value && typeof value === "object"
    ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])])) : value;
  return ["actor_type", "actor_label", "action", "summary", "entity_type", "entity_ref", "created_at"]
    .every((key) => (expected[key] ?? null) === (remote[key] ?? null)) &&
    JSON.stringify(stable(expected.metadata || {})) === JSON.stringify(stable(remote.metadata || {}));
}
function remoteRowBelongsToTeam(row, remoteTeamId) {
  return !row?.remote_team_id || row.remote_team_id === remoteTeamId;
}
function remoteStoragePathBelongsToTeam(path, remoteTeamId) {
  const value = String(path || "");
  const parts = value.split("/");
  return !!remoteTeamId && parts[0] === remoteTeamId && parts.length > 1 &&
    parts.slice(1).every((part) => !!part && part !== "." && part !== "..") && !value.includes("\\");
}
function remoteIsUniqueViolation(error) {
  return error?.code === "23505" || /duplicate key|unique constraint/i.test(error?.message || "");
}
function remoteProjectRef(url) {
  try {
    const host = new URL(url).hostname;
    return host.endsWith(".supabase.co") ? host.split(".")[0] : null;
  } catch (_) {
    return null;
  }
}
function remoteShouldUseTus(size) {
  return Number(size || 0) > REMOTE_TUS_THRESHOLD;
}
function remoteChooseTeamId(currentTeamId, teams) {
  const rows = Array.isArray(teams) ? teams : [];
  const current = remoteText(currentTeamId, 100);
  if (current && rows.some((team) => String(team?.id) === current)) return current;
  if (rows.length === 1 && rows[0]?.id) return String(rows[0].id);
  return null;
}
function remoteEmitSync(result) {
  if (typeof window === "undefined" || typeof window.dispatchEvent !== "function") return;
  try {
    window.dispatchEvent(new CustomEvent("visioncoach:sync-complete", { detail: result || {} }));
  } catch (_) {}
}

function remoteDataUrlToBlob(dataUrl) {
  const parts = String(dataUrl || "").split(",");
  if (parts.length !== 2) throw new Error("Ficheiro local inválido.");
  const mime = (parts[0].match(/^data:([^;]+)/) || [])[1] || "application/octet-stream";
  const bytes = atob(parts[1]);
  const out = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) out[i] = bytes.charCodeAt(i);
  return new Blob([out], { type: mime });
}
function remoteSafeFilename(value) {
  return remoteText(value || "ficheiro", 180)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "ficheiro";
}
function remoteUploadTus(config, session, file, path, onProgress) {
  const projectRef = remoteProjectRef(config?.url);
  if (!projectRef || !globalThis.TusClient?.Upload) {
    throw new Error("Upload resumível indisponível neste dispositivo.");
  }
  return new Promise((resolve, reject) => {
    const upload = new globalThis.TusClient.Upload(file, {
      endpoint: `https://${projectRef}.storage.supabase.co/storage/v1/upload/resumable`,
      retryDelays: [0, 3000, 5000, 10000, 20000],
      headers: {
        authorization: `Bearer ${session.access_token}`,
        "x-upsert": "false",
      },
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      metadata: {
        bucketName: "team-media",
        objectName: path,
        contentType: file.type || "application/octet-stream",
        cacheControl: "3600",
      },
      chunkSize: REMOTE_TUS_THRESHOLD,
      onError: reject,
      onProgress(bytesUploaded, bytesTotal) {
        if (typeof onProgress === "function") onProgress(bytesUploaded, bytesTotal);
      },
      onSuccess() { resolve({ path }); },
    });
    upload.findPreviousUploads().then((previous) => {
      if (previous.length) upload.resumeFromPreviousUpload(previous[0]);
      upload.start();
    }).catch(reject);
  });
}
function remoteRecordRow(store, local, teamId, userId, payloadOverride) {
  const actor = remoteActorFor(store, local);
  return {
    id: local.sync_id,
    team_id: teamId,
    kind: REMOTE_STORE_KINDS[store],
    payload: payloadOverride || remotePayload(local),
    actor_type: actor.actor_type,
    actor_label: actor.actor_label,
    created_by: userId || null,
  };
}
function remoteActivityRow(local, teamId, userId) {
  return {
    id: local.sync_id,
    team_id: teamId,
    actor_type: local.actor || "human",
    actor_label: local.actor_label || "Treinador",
    action: local.action || "updated",
    summary: local.summary || local.action || "Atualização",
    entity_type: local.entity_type || null,
    entity_ref: local.entity_id == null ? null : String(local.entity_id),
    metadata: local.metadata || {},
    created_by: userId || null,
    created_at: local.created_at || new Date().toISOString(),
  };
}

const RemoteWorkspace = {
  _client: null,
  _syncTimer: null,
  _syncRetryTimer: null,
  _syncRetryAttempt: 0,
  _syncPromise: null,
  _syncTeamId: null,
  _syncAgain: false,
  _realtimeChannel: null,
  _realtimeTeamId: null,

  scheduleSync(delay = 1400) {
    clearTimeout(this._syncTimer);
    this._syncTimer = setTimeout(async () => {
      try {
        if (!navigator.onLine) return;
        const status = await this.status();
        if (!status.signedIn) return;
        await this.syncNow();
      } catch (error) {
        console.warn("Remote sync adiado:", error.message);
        this._scheduleSyncRetry();
      }
    }, delay);
  },

  _scheduleSyncRetry() {
    if (!globalThis.navigator?.onLine) return;
    clearTimeout(this._syncRetryTimer);
    this._syncRetryAttempt++;
    const delay = remoteSyncRetryDelay(this._syncRetryAttempt);
    this._syncRetryTimer = setTimeout(() => {
      this._syncRetryTimer = null;
      this.scheduleSync(0);
    }, delay);
  },

  _clearSyncRetry() {
    clearTimeout(this._syncRetryTimer);
    this._syncRetryTimer = null;
    this._syncRetryAttempt = 0;
  },

  async startRealtime(teamId) {
    const client = await this.init();
    if (!client || !teamId) return null;
    if (this._realtimeChannel && this._realtimeTeamId === teamId) return this._realtimeChannel;
    if (this._realtimeChannel) {
      try { await client.removeChannel(this._realtimeChannel); } catch (_) {}
      this._realtimeChannel = null;
      this._realtimeTeamId = null;
    }
    const schedule = () => this.scheduleSync(120);
    const channel = client
      .channel("vision-coach-" + teamId)
      .on("postgres_changes", { event:"*", schema:"public", table:"workspace_records", filter:"team_id=eq." + teamId }, schedule)
      .on("postgres_changes", { event:"*", schema:"public", table:"media_assets", filter:"team_id=eq." + teamId }, schedule)
      .on("postgres_changes", { event:"*", schema:"public", table:"activity_log", filter:"team_id=eq." + teamId }, schedule)
      .on("postgres_changes", { event:"*", schema:"public", table:"teams", filter:"id=eq." + teamId }, schedule)
      .subscribe((status) => {
        if (status === "SUBSCRIBED") this.scheduleSync(0);
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          console.warn("Realtime Vision Coach:", status);
        }
      });
    this._realtimeChannel = channel;
    this._realtimeTeamId = teamId;
    return channel;
  },
  async stopRealtime() {
    const client = await this.init();
    if (client && this._realtimeChannel) {
      try { await client.removeChannel(this._realtimeChannel); } catch (_) {}
    }
    this._realtimeChannel = null;
    this._realtimeTeamId = null;
  },

  getConfig() {
    return remoteLoadConfig();
  },
  saveConfig(input) {
    const current = remoteLoadConfig();
    const next = {
      ...current,
      url: remoteText(input?.url || current.url, 500),
      publishableKey: remoteText(input?.publishableKey || current.publishableKey, 1000),
      remoteTeamId: remoteText(input?.remoteTeamId || current.remoteTeamId, 100) || null,
      email: remoteText(input?.email || current.email, 320) || null,
    };
    if (!remoteConfigValid(next)) throw new Error("Indica o Project URL e a publishable key do Supabase.");
    this._client = null;
    remoteSaveConfig(next);
    return next;
  },
  clearConfig() {
    localStorage.removeItem(REMOTE_CONFIG_KEY);
    this._client = null;
  },
  async init() {
    const config = remoteLoadConfig();
    if (!remoteConfigValid(config)) return null;
    if (this._client) return this._client;
    if (!globalThis.SupabaseLib?.createClient) throw new Error("Cliente Supabase indisponível.");
    this._client = globalThis.SupabaseLib.createClient(config.url, config.publishableKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });
    return this._client;
  },
  async getSession() {
    const client = await this.init();
    if (!client) return null;
    const { data, error } = await client.auth.getSession();
    if (error) throw error;
    return data.session || null;
  },

  async status() {
    const config = remoteLoadConfig();
    const configured = remoteConfigValid(config);
    let session = null;
    if (configured) {
      try { session = await this.getSession(); } catch (_) {}
    }
    return {
      configured,
      signedIn: !!session,
      email: session?.user?.email || config.email || null,
      remoteTeamId: config.remoteTeamId || null,
      lastSyncAt: config.lastSyncAt || null,
      conflicts: Array.isArray(config.conflicts) ? config.conflicts : [],
    };
  },
  async signInWithEmail(email) {
    const client = await this.init();
    if (!client) throw new Error("Configura primeiro o Supabase.");
    const cleanEmail = remoteText(email, 320);
    if (!cleanEmail) throw new Error("Indica o teu email.");
    const redirect = location.origin + location.pathname + "?auth=1";
    const { error } = await client.auth.signInWithOtp({
      email: cleanEmail,
      options: { emailRedirectTo: redirect },
    });
    if (error) throw error;
    const config = remoteLoadConfig();
    remoteSaveConfig({ ...config, email: cleanEmail });
    return true;
  },
  async signOut() {
    await globalThis.VisionExerciseImageStorage?.clear();
    await this.stopRealtime();
    const client = await this.init();
    if (client) await client.auth.signOut();
  },
  async listTeams() {
    const client = await this.init();
    const session = await this.getSession();
    if (!client || !session) return [];
    const { data, error } = await client.from("teams")
      .select("id,name,metadata,updated_at")
      .order("created_at", { ascending: true });
    if (error) throw error;
    return data || [];
  },
  async ensureSelectedTeam() {
    const session = await this.getSession();
    if (!session) return null;
    const teams = await this.listTeams();
    const config = remoteLoadConfig();
    const selected = remoteChooseTeamId(config.remoteTeamId, teams);
    if ((config.remoteTeamId || null) !== selected) {
      remoteSaveConfig({ ...config, remoteTeamId: selected });
    }
    if (selected) await this.startRealtime(selected);
    return selected;
  },

  async createTeamFromLocal() {
    const client = await this.init();
    const session = await this.getSession();
    if (!client || !session) throw new Error("Inicia sessão antes de criar o workspace remoto.");
    const local = await HeadCoachMemory.ensureTeam();
    const metadata = remotePayload(local);
    const { data, error } = await client.from("teams").insert({
      owner_id: session.user.id,
      name: local.nome || "Equipa principal",
      metadata,
    }).select("id,name,metadata,updated_at").single();
    if (error) throw error;
    const config = remoteLoadConfig();
    remoteSaveConfig({ ...config, remoteTeamId: data.id });
    await DB.atualizar("teams", {
      ...local,
      sync_id: data.id,
      sync_dirty: false,
      remote_updated_at: data.updated_at,
    }, { remote: true });
    this.scheduleSync(0);
    return data;
  },
  async useTeam(teamId) {
    const id = remoteText(teamId, 100);
    if (!id) throw new Error("Escolhe um workspace remoto.");
    let config = remoteLoadConfig();
    if (config.remoteTeamId !== id && this._syncPromise) {
      await this._syncPromise.catch(() => {});
      config = remoteLoadConfig();
    }
    if (config.remoteTeamId !== id) {
      if (!navigator.onLine) throw new Error("Liga à Internet antes de trocar de workspace para separar os dados locais com segurança.");
      const client = await this.init();
      const assignmentTeamId = config.remoteTeamId || id;
      for (const store of [...Object.keys(REMOTE_STORE_KINDS), "media_items", "activity_items"]) {
        const rows = (await DB.listar(store)).filter((row) => (row.team_id || DEFAULT_TEAM_ID) === DEFAULT_TEAM_ID && !row.remote_team_id);
        for (const row of rows) {
          const belongs = await this._bindRemoteTeam(client, store, row, assignmentTeamId);
          if (belongs === true && !row.remote_team_id) {
            const current = await DB.obter(store, row.id);
            if (current && !current.remote_team_id && !current.remote_updated_at) {
              await DB.atualizar(store, { ...current, remote_team_id: assignmentTeamId }, { remote: true });
            }
          }
        }
      }
    }
    remoteSaveConfig({ ...config, remoteTeamId: id });
    this.scheduleSync(0);
    return id;
  },
  async syncTeam(remoteTeamId) {
    const client = await this.init();
    const session = await this.getSession();
    const local = await HeadCoachMemory.ensureTeam();
    const { data: remote, error } = await client.from("teams")
      .select("id,name,metadata,updated_at").eq("id", remoteTeamId).single();
    if (error) throw error;
    const conflict = remoteNeedsConflict(local, remote);
    if (local.sync_dirty && !conflict) {
      let update = client.from("teams").update({
        name: local.nome || remote.name,
        metadata: remotePayload(local),
      }).eq("id", remoteTeamId);
      if (local.remote_updated_at) update = update.eq("updated_at", local.remote_updated_at);
      const { data: savedRows, error: saveError } = await update.select("id,name,metadata,updated_at");
      if (saveError) throw saveError;
      const saved = savedRows?.[0];
      if (!saved) {
        return {
          conflicts: [remoteConflict("teams", local, remote)],
          pushed: 0,
          pulled: 0,
        };
      }
      await DB.atualizar("teams", {
        ...local, sync_id: remoteTeamId, sync_dirty: false, remote_updated_at: saved.updated_at,
      }, { remote: true });
      return { conflicts: [], pushed: 1, pulled: 0 };
    }

    if (!local.sync_dirty && local.remote_updated_at !== remote.updated_at) {
      const merged = {
        ...local,
        ...(remote.metadata || {}),
        nome: remote.name || local.nome,
        id: local.id || DEFAULT_TEAM_ID,
        sync_id: remoteTeamId,
        sync_dirty: false,
        remote_updated_at: remote.updated_at,
      };
      await DB.atualizar("teams", merged, { remote: true });
      return { conflicts: [], pushed: 0, pulled: 1 };
    }
    return {
      conflicts: conflict ? [remoteConflict("teams", local, remote)] : [],
      pushed: 0,
      pulled: 0,
    };
  },
  async _ensureSyncId(store, row) {
    if (remoteIsUuid(row.sync_id)) return row;
    if (row.remote_updated_at) throw new Error("Identificador remoto local inválido; é necessária reconciliação antes de sincronizar este registo.");
    const next = {
      ...row,
      sync_id: remoteUuid(),
      sync_dirty: true,
      sync_local_updated_at: new Date().toISOString(),
    };
    await DB.atualizar(store, next, { remote: true });
    return next;
  },
  async _bindRemoteTeam(client, store, row, selectedRemoteTeamId) {
    if (row.remote_team_id && row.remote_team_id !== selectedRemoteTeamId) return false;
    // Local sentinels such as "default" can never be remote UUIDs. Repair only
    // records with no acknowledged remote version; otherwise preserve as conflict.
    if (row.sync_id && !remoteIsUuid(row.sync_id)) return row.remote_updated_at ? null : true;
    if (row.remote_team_id) return true;
    // A remote version without its stable identity cannot be assigned safely
    // to whichever workspace happens to be selected on this device.
    if (!row.sync_id) return row.remote_updated_at ? null : true;
    const table = store === "media_items" ? "media_assets" : store === "activity_items" ? "activity_log" : "workspace_records";
    const { data, error } = await client.from(table).select("team_id").eq("id", row.sync_id).maybeSingle();
    if (error) throw error;
    if (!data?.team_id) return row.remote_updated_at ? null : true;
    await DB.atualizar(store, { ...row, remote_team_id: data.team_id }, { remote: true });
    return data.team_id === selectedRemoteTeamId;
  },
  async _localBySyncId(store) {
    const rows = await DB.listar(store);
    return new Map(rows.filter((x) => x.sync_id).map((x) => [x.sync_id, x]));
  },
  async _subjectRemoteRef(subjectType, subjectId, remoteTeamId) {
    if (subjectType === "team") return remoteTeamId;
    const store = REMOTE_SUBJECT_STORES[subjectType];
    if (!store) return String(subjectId);
    const ref = String(subjectId ?? "").trim();
    if (!ref) throw remoteReferenceError("missing_subject_id");
    if (remoteIsUuid(ref)) {
      const client = await this.init();
      const table = subjectType === "media" ? "media_assets" : "workspace_records";
      let query = client.from(table).select("id")
        .eq("id", ref).eq("team_id", remoteTeamId).is("deleted_at", null);
      if (table === "workspace_records") query = query.eq("kind", subjectType);
      const { data, error } = await query.maybeSingle();
      if (error) throw error;
      if (!data) throw remoteReferenceError("subject_uuid_not_in_team");
      return ref;
    }
    const localId = Number(ref);
    if (!Number.isSafeInteger(localId) || localId < 1) throw remoteReferenceError("invalid_subject_id");
    const local = await DB.obter(store, localId);
    if (!local || (local.team_id || DEFAULT_TEAM_ID) !== DEFAULT_TEAM_ID) {
      throw remoteReferenceError("subject_not_found_locally");
    }
    if (local.remote_team_id && local.remote_team_id !== remoteTeamId) {
      throw remoteReferenceError("subject_other_team");
    }
    const withId = await this._ensureSyncId(store, local);
    return withId.sync_id;
  },

  async _localIdForRemoteRef(subjectType, remoteRef, remoteTeamId = remoteLoadConfig().remoteTeamId) {
    if (subjectType === "team") return DEFAULT_TEAM_ID;
    const store = REMOTE_SUBJECT_STORES[subjectType];
    if (!store) return remoteRef;
    if (!remoteTeamId) return String(remoteRef);
    const rows = await DB.listar(store);
    const found = rows.find((x) => x.sync_id === remoteRef && x.remote_team_id === remoteTeamId);
    return found ? String(found.id) : remoteRef;
  },
  async _refsForRemote(refs, remoteTeamId) {
    const out = [];
    for (const ref of (Array.isArray(refs) ? refs : [])) {
      out.push({
        ...ref,
        id: await this._subjectRemoteRef(ref.type, ref.id, remoteTeamId),
      });
    }
    return out;
  },
  async _payloadForRemote(store, local, remoteTeamId) {
    const payload = remotePayload(local);
    const mapExerciseBlocks = async (source) => {
      const blocks = [];
      for (const block of source) {
        if (!block?.exercise_ref) { blocks.push(block); continue; }
        blocks.push({
          ...block,
          exercise_ref: await this._subjectRemoteRef("exercise", block.exercise_ref, remoteTeamId),
        });
      }
      return blocks;
    };
    if (store === "treinos") {
      if (Array.isArray(payload.blocos)) payload.blocos = await mapExerciseBlocks(payload.blocos);
      if (Array.isArray(payload.session?.blocks)) {
        payload.session = { ...payload.session, blocks: await mapExerciseBlocks(payload.session.blocks) };
      }
    }
    if (Array.isArray(payload.subject_refs)) {
      payload.subject_refs = await this._refsForRemote(payload.subject_refs, remoteTeamId);
    }
    if (Array.isArray(payload.refs)) {
      payload.refs = await this._refsForRemote(payload.refs, remoteTeamId);
    }
    if (store === "memory_items") {
      const mapIds = async (ids) => {
        const out = [];
        for (const id of (Array.isArray(ids) ? ids : [])) {
          out.push(await this._subjectRemoteRef("memory", id, remoteTeamId));
        }
        return out;
      };
      payload.evidence_ids = await mapIds(payload.evidence_ids);
      payload.related_ids = await mapIds(payload.related_ids);
      if (payload.supersedes_id) {
        payload.supersedes_id = await this._subjectRemoteRef("memory", payload.supersedes_id, remoteTeamId);
      }
    }
    if (store === "game_models" && payload.supersedes_id) {
      payload.supersedes_id = await this._subjectRemoteRef("game_model", payload.supersedes_id, remoteTeamId);
    }
    return payload;
  },
  async _hydratePayload(kind, payload, remoteTeamId) {
    const out = { ...(payload || {}) };
    if (Array.isArray(out.subject_refs)) {
      const refs = [];
      for (const ref of out.subject_refs) {
        refs.push({
          ...ref,
          id: await this._localIdForRemoteRef(ref.type, String(ref.id), remoteTeamId),
        });
      }
      out.subject_refs = refs;
    }
    if (Array.isArray(out.refs)) {
      const refs = [];
      for (const ref of out.refs) {
        refs.push({
          ...ref,
          id: await this._localIdForRemoteRef(ref.type, String(ref.id), remoteTeamId),
        });
      }
      out.refs = refs;
    }
    if (kind === "memory") {
      const mapIds = async (ids) => {
        const mapped = [];
        for (const id of (Array.isArray(ids) ? ids : [])) {
          mapped.push(Number(await this._localIdForRemoteRef("memory", String(id), remoteTeamId)) || id);
        }
        return mapped;
      };
      out.evidence_ids = await mapIds(out.evidence_ids);
      out.related_ids = await mapIds(out.related_ids);
      if (out.supersedes_id) {
        const localId = await this._localIdForRemoteRef("memory", String(out.supersedes_id), remoteTeamId);
        out.supersedes_id = Number(localId) || out.supersedes_id;
      }
    }
    if (kind === "game_model" && out.supersedes_id) {
      const localId = await this._localIdForRemoteRef("game_model", String(out.supersedes_id), remoteTeamId);
      out.supersedes_id = Number(localId) || out.supersedes_id;
    }
    return out;
  },
  async _syncRecords(remoteTeamId, userId) {
    const client = await this.init();
    const first = await client.from("workspace_records")
      .select("*").eq("team_id", remoteTeamId);
    if (first.error) throw first.error;
    let remoteMap = new Map((first.data || []).map((x) => [x.id, x]));
    const result = { pushed: 0, pulled: 0, deleted: 0, conflicts: [] };
    const conflictKeys = new Set();
    const addConflict = (conflict) => {
      const key = [conflict.store, conflict.local_id, conflict.sync_id, conflict.reason].join("|");
      if (!conflictKeys.has(key)) {
        conflictKeys.add(key);
        result.conflicts.push(conflict);
      }
    };

    for (const store of Object.keys(REMOTE_STORE_KINDS)) {
      const kind = REMOTE_STORE_KINDS[store];
      const remoteRows = [...remoteMap.values()].filter((row) => row.kind === kind);
      const remoteByIdentity = new Map(
        remoteRows.filter((row) => !row.deleted_at)
          .map((row) => [remoteIdentityKey(row.kind, row.payload), row]).filter(([key]) => key)
      );
      let rows = (await DB.listar(store))
        .filter((x) => (x.team_id || DEFAULT_TEAM_ID) === DEFAULT_TEAM_ID)
        .filter((x) => store !== "exercicios" || x.workspace_v2 || x.sync_id);
      const scopedRows = [];
      for (const row of rows) {
        const belongs = await this._bindRemoteTeam(client, store, row, remoteTeamId);
        if (belongs) scopedRows.push(row.remote_team_id ? row : (await DB.obter(store, row.id)));
        else if (belongs === null) addConflict(remoteConflict(store, row, null, remoteIdentityConflictReason(row)));
      }
      rows = scopedRows.filter(Boolean);
      let localBySyncId = new Map(rows.filter((x) => x.sync_id).map((x) => [x.sync_id, x]));

      for (const remote of remoteRows.filter((row) => row.deleted_at)) {
        const local = localBySyncId.get(remote.id);
        if (!local) continue;
        if (remoteDeletionConflictsWithLocalEdit(local, remote)) {
          addConflict(remoteConflict(store, local, remote, "remote_deleted_local_dirty"));
          continue;
        }
        await DB.apagar(store, local.id, { remote: true });
        result.deleted++;
      }

      rows = (await DB.listar(store))
        .filter((x) => (x.team_id || DEFAULT_TEAM_ID) === DEFAULT_TEAM_ID)
        .filter((x) => store !== "exercicios" || x.workspace_v2 || x.sync_id);
      const scopedCurrentRows = [];
      for (const row of rows) {
        const belongs = await this._bindRemoteTeam(client, store, row, remoteTeamId);
        if (belongs) scopedCurrentRows.push(row.remote_team_id ? row : (await DB.obter(store, row.id)));
        else if (belongs === null) addConflict(remoteConflict(store, row, null, remoteIdentityConflictReason(row)));
      }
      rows = scopedCurrentRows.filter(Boolean);
      for (const original of rows) {
        let local = await this._ensureSyncId(store, original);
        let remote = remoteMap.get(local.sync_id);
        const identity = remoteIdentityKey(kind, local);
        const duplicate = !remote && identity ? remoteByIdentity.get(identity) : null;
        if (duplicate) {
          local = { ...local, sync_id: duplicate.id };
          await DB.atualizar(store, local, { remote: true });
          remote = duplicate;
          if (local.sync_dirty) {
            addConflict(remoteConflict(store, local, remote, "duplicate_identity"));
            continue;
          }
        }
        if (remote?.deleted_at) {
          if (remoteDeletionConflictsWithLocalEdit(local, remote)) {
            addConflict(remoteConflict(store, local, remote, "remote_deleted_local_dirty"));
            continue;
          }
          await DB.apagar(store, local.id, { remote: true });
          result.deleted++;
          continue;
        }
        if (!local.sync_dirty) continue;
        if (remoteNeedsConflict(local, remote)) {
          addConflict(remoteConflict(store, local, remote));
          continue;
        }

        let payload;
        try { payload = await this._payloadForRemote(store, local, remoteTeamId); }
        catch (error) {
          if (error.code !== "LOCAL_REFERENCE_CONFLICT") throw error;
          addConflict(remoteConflict(store, local, remote, error.reason));
          continue;
        }
        const row = remoteRecordRow(store, local, remoteTeamId, userId, payload);
        let saved;
        if (remote) {
          const updateRow = {
            kind: row.kind,
            payload: row.payload,
            actor_type: row.actor_type,
            actor_label: row.actor_label,
          };
          const savedRes = await client.from("workspace_records")
            .update(updateRow)
            .eq("id", row.id)
            .eq("team_id", remoteTeamId)
            .eq("updated_at", local.remote_updated_at)
            .is("deleted_at", null)
            .select("*");
          if (savedRes.error) throw savedRes.error;
          saved = savedRes.data?.[0];
          if (!saved) {
            addConflict(remoteConflict(store, local, remote));
            continue;
          }
        } else {
          const savedRes = await client.from("workspace_records")
            .insert(row)
            .select("*").single();
          if (savedRes.error) {
            if (remoteIsUniqueViolation(savedRes.error)) {
              addConflict(remoteConflict(store, local, null, "duplicate_identity"));
              continue;
            }
            throw savedRes.error;
          }
          saved = savedRes.data;
        }
        await DB.atualizar(store, {
          ...local,
          sync_dirty: false,
          remote_updated_at: saved.updated_at,
          remote_team_id: remoteTeamId,
          sync_actor_type: saved.actor_type,
          sync_actor_label: saved.actor_label,
        }, { remote: true });
        remoteMap.set(saved.id, saved);
        result.pushed++;
      }
    }

    const refreshed = await client.from("workspace_records")
      .select("*").eq("team_id", remoteTeamId);
    if (refreshed.error) throw refreshed.error;
    remoteMap = new Map((refreshed.data || []).map((x) => [x.id, x]));

    for (const remote of remoteMap.values()) {
      const store = REMOTE_KIND_STORES[remote.kind];
      if (!store) continue;
      const locals = await DB.listar(store);
      const localMap = new Map(locals.filter((x) => x.sync_id && remoteRowBelongsToTeam(x, remoteTeamId)).map((x) => [x.sync_id, x]));
      const identity = remoteIdentityKey(remote.kind, remote.payload);
      const identityLocal = identity
        ? locals.find((row) => remoteRowBelongsToTeam(row, remoteTeamId) && remoteIdentityKey(remote.kind, row) === identity)
        : null;
      let local = localMap.get(remote.id) || identityLocal;
      if (remote.deleted_at) {
        if (!local) continue;
        if (remoteDeletionConflictsWithLocalEdit(local, remote)) {
          addConflict(remoteConflict(store, local, remote, "remote_deleted_local_dirty"));
          continue;
        }
        await DB.apagar(store, local.id, { remote: true });
        result.deleted++;
        continue;
      }
      if (local?.sync_dirty) {
        addConflict(remoteConflict(
          store,
          local,
          remote,
          local.sync_id === remote.id ? "version_mismatch" : "duplicate_identity"
        ));
        continue;
      }
      const payload = await this._hydratePayload(remote.kind, remote.payload, remoteTeamId);
      const merged = {
        ...(local || {}),
        ...payload,
        ...(store === "exercicios" ? { workspace_v2: true } : {}),
        team_id: DEFAULT_TEAM_ID,
        sync_id: remote.id,
        sync_dirty: false,
        remote_updated_at: remote.updated_at,
        remote_team_id: remoteTeamId,
        sync_actor_type: remote.actor_type,
        sync_actor_label: remote.actor_label,
      };
      if (store === "workspace_documents") {
        merged.created_by = merged.created_by || remote.actor_type;
        merged.created_by_label = merged.created_by_label || remote.actor_label;
        merged.updated_by = remote.actor_type;
        merged.updated_by_label = remote.actor_label;
      }
      if (store === "memory_items") {
        merged.metadata = {
          ...(merged.metadata || {}),
          actor: remote.actor_type,
          actor_label: remote.actor_label,
        };
      }
      if (local) {
        merged.id = local.id;
        if (local.remote_updated_at === remote.updated_at) continue;
        await DB.atualizar(store, merged, { remote: true });
      } else {
        await DB.criar(store, remoteFreshLocalRecord(merged), { remote: true });
      }
      result.pulled++;
    }
    return result;
  },

  async _activityRemoteRow(local, remoteTeamId, userId) {
    const row = remoteActivityRow(local, remoteTeamId, userId);
    if (local.entity_type && local.entity_id != null) {
      row.entity_ref = String(await this._subjectRemoteRef(
        local.entity_type, local.entity_id, remoteTeamId
      ));
    }
    return row;
  },

  async _syncActivity(remoteTeamId, userId) {
    const client = await this.init();
    const remoteRes = await client.from("activity_log")
      .select("*").eq("team_id", remoteTeamId).order("created_at", { ascending: true });
    if (remoteRes.error) throw remoteRes.error;
    const remoteMap = new Map((remoteRes.data || []).map((x) => [x.id, x]));
    const result = { pushed: 0, pulled: 0, conflicts: [] };
    const localCandidates = (await DB.listar("activity_items"))
      .filter((x) => (x.team_id || DEFAULT_TEAM_ID) === DEFAULT_TEAM_ID);
    const locals = [];
    for (const row of localCandidates) {
      const belongs = await this._bindRemoteTeam(client, "activity_items", row, remoteTeamId);
      if (belongs) locals.push(row.remote_team_id ? row : (await DB.obter("activity_items", row.id)));
      else if (belongs === null) result.conflicts.push(remoteConflict("activity_items", row, null, remoteIdentityConflictReason(row)));
    }

    for (const original of locals) {
      const local = await this._ensureSyncId("activity_items", original);
      if (!remoteMap.has(local.sync_id)) {
        let remoteRow;
        try { remoteRow = await this._activityRemoteRow(local, remoteTeamId, userId); }
        catch (error) {
          if (error.code !== "LOCAL_REFERENCE_CONFLICT") throw error;
          result.conflicts.push(remoteConflict("activity_items", local, null, error.reason));
          continue;
        }
        const { data: saved, error } = await client.from("activity_log")
          .insert(remoteRow)
          .select("*").single();
        if (error) {
          if (remoteIsUniqueViolation(error)) {
            result.conflicts.push(remoteConflict("activity_items", local, null, "duplicate_identity"));
            continue;
          }
          throw error;
        }

        await DB.atualizar("activity_items", {
          ...local,
          sync_dirty: false,
          remote_updated_at: saved.created_at,
          remote_team_id: remoteTeamId,
        }, { remote: true });
        remoteMap.set(saved.id, saved);
        result.pushed++;
      } else if (local.sync_dirty) {
        let expected;
        try { expected = await this._activityRemoteRow(local, remoteTeamId, userId); }
        catch (error) {
          if (error.code !== "LOCAL_REFERENCE_CONFLICT") throw error;
          result.conflicts.push(remoteConflict("activity_items", local, null, error.reason));
          continue;
        }
        const existing = remoteMap.get(local.sync_id);
        if (!remoteActivityMatches(expected, existing)) {
          result.conflicts.push(remoteConflict("activity_items", local, { id: existing.id, updated_at: existing.created_at }, "duplicate_identity"));
          continue;
        }
        await DB.atualizar("activity_items", {
          ...local,
          sync_dirty: false,
          remote_updated_at: existing.created_at,
          remote_team_id: remoteTeamId,
        }, { remote: true });
      }
    }

    const localMap = new Map([...await this._localBySyncId("activity_items")].filter(([, row]) => remoteRowBelongsToTeam(row, remoteTeamId)));
    for (const remote of remoteMap.values()) {
      if (localMap.has(remote.id)) continue;
      const localEntityId = remote.entity_type && remote.entity_ref != null
        ? await this._localIdForRemoteRef(remote.entity_type, String(remote.entity_ref), remoteTeamId)
        : null;
      const row = {
        team_id: DEFAULT_TEAM_ID,
        actor: remote.actor_type,
        actor_label: remote.actor_label,
        action: remote.action,
        summary: remote.summary,
        entity_type: remote.entity_type,
        entity_id: localEntityId,
        metadata: remote.metadata || {},
        created_at: remote.created_at,
        sync_id: remote.id,
        sync_dirty: false,
        remote_updated_at: remote.created_at,
        remote_team_id: remoteTeamId,
      };
      await DB.criar("activity_items", row, { remote: true });
      result.pulled++;
    }
    return result;
  },

  async _uploadLocalMedia(local, remoteTeamId) {
    if (local.storage_path) {
      if (!remoteStoragePathBelongsToTeam(local.storage_path, remoteTeamId)) {
        throw new Error("O caminho do ficheiro pertence a outro workspace remoto.");
      }
      return local.storage_path;
    }
    if (!local.data_url) return null;
    const client = await this.init();
    const blob = remoteDataUrlToBlob(local.data_url);
    const name = remoteSafeFilename(local.file_name || local.title);
    const path = remoteTeamId + "/" + local.sync_id + "/" + name;

    const bucket = client.storage.from("team-media");
    const uploaded = await bucket.upload(path, blob, {
      contentType: local.mime_type || blob.type,
      upsert: true,
    });
    if (uploaded.error) throw uploaded.error;
    return path;
  },

  async _mediaRemoteRow(local, remoteTeamId, userId) {
    const subjectRef = await this._subjectRemoteRef(
      local.subject_type, local.subject_id, remoteTeamId
    );
    const storagePath = await this._uploadLocalMedia(local, remoteTeamId);
    return {
      id: local.sync_id,
      team_id: remoteTeamId,
      subject_type: local.subject_type,
      subject_ref: String(subjectRef),
      media_type: local.type,
      title: local.title,
      note: local.note || null,
      external_url: !storagePath && local.url && !String(local.url).startsWith("blob:") ? local.url : null,
      storage_path: storagePath,
      file_name: local.file_name || null,
      mime_type: local.mime_type || null,
      size_bytes: local.size || null,
      actor_type: "human",
      actor_label: "Treinador",
      created_by: userId || null,
    };
  },

  async _syncMedia(remoteTeamId, userId) {
    const client = await this.init();
    const remoteRes = await client.from("media_assets")
      .select("*").eq("team_id", remoteTeamId);
    if (remoteRes.error) throw remoteRes.error;
    let remoteMap = new Map((remoteRes.data || []).map((x) => [x.id, x]));
    const result = { pushed: 0, pulled: 0, deleted: 0, conflicts: [] };
    const addConflict = (conflict) => {
      if (!result.conflicts.some((item) => item.sync_id === conflict.sync_id && item.reason === conflict.reason)) result.conflicts.push(conflict);
    };

    const mediaCandidates = (await DB.listar("media_items"))
      .filter((x) => (x.team_id || DEFAULT_TEAM_ID) === DEFAULT_TEAM_ID);
    let locals = [];
    for (const row of mediaCandidates) {
      const belongs = await this._bindRemoteTeam(client, "media_items", row, remoteTeamId);
      if (belongs) locals.push(row.remote_team_id ? row : (await DB.obter("media_items", row.id)));
      else if (belongs === null) result.conflicts.push(remoteConflict("media_items", row, null, remoteIdentityConflictReason(row)));
    }
    let localMap = new Map(locals.filter((x) => x.sync_id).map((x) => [x.sync_id, x]));
    for (const remote of [...remoteMap.values()].filter((row) => row.deleted_at)) {
      const local = localMap.get(remote.id);
      if (!local) continue;
      if (remoteDeletionConflictsWithLocalEdit(local, remote)) {
        addConflict(remoteConflict("media_items", local, remote, "remote_deleted_local_dirty"));
        continue;
      }
      await DB.apagar("media_items", local.id, { remote: true });
      result.deleted++;
    }

    const currentCandidates = (await DB.listar("media_items"))
      .filter((x) => (x.team_id || DEFAULT_TEAM_ID) === DEFAULT_TEAM_ID);
    locals = [];
    for (const row of currentCandidates) {
      const belongs = await this._bindRemoteTeam(client, "media_items", row, remoteTeamId);
      if (belongs) locals.push(row.remote_team_id ? row : (await DB.obter("media_items", row.id)));
      else if (belongs === null) addConflict(remoteConflict("media_items", row, null, remoteIdentityConflictReason(row)));
    }
    locals = locals.filter(Boolean);
    for (const original of locals) {
      const local = await this._ensureSyncId("media_items", original);
      const remote = remoteMap.get(local.sync_id);
      if (remote?.deleted_at) {
        if (remoteDeletionConflictsWithLocalEdit(local, remote)) {
          addConflict(remoteConflict("media_items", local, remote, "remote_deleted_local_dirty"));
          continue;
        }
        await DB.apagar("media_items", local.id, { remote: true });
        result.deleted++;
        continue;
      }
      if (!local.sync_dirty) continue;
      if (remoteNeedsConflict(local, remote)) {
        result.conflicts.push(remoteConflict("media_items", local, remote));
        continue;
      }

      if (local.storage_path && !remoteStoragePathBelongsToTeam(local.storage_path, remoteTeamId)) {
        addConflict(remoteConflict("media_items", local, remote, "storage_path_team_mismatch"));
        continue;
      }

      let row;
      try { row = await this._mediaRemoteRow(local, remoteTeamId, userId); }
      catch (error) {
        if (error.code !== "LOCAL_REFERENCE_CONFLICT") throw error;
        addConflict(remoteConflict("media_items", local, remote, error.reason));
        continue;
      }
      let saved;
      if (remote) {
        const { id, team_id, created_by, actor_type, actor_label, ...updateRow } = row;
        const savedRes = await client.from("media_assets")
          .update(updateRow)
          .eq("id", row.id)
          .eq("team_id", remoteTeamId)
          .eq("updated_at", local.remote_updated_at)
          .is("deleted_at", null)
          .select("*");
        if (savedRes.error) throw savedRes.error;
        saved = savedRes.data?.[0];
        if (!saved) {
          result.conflicts.push(remoteConflict("media_items", local, remote));
          continue;
        }
      } else {
        const savedRes = await client.from("media_assets")
          .insert(row).select("*").single();
        if (savedRes.error) {
          if (remoteIsUniqueViolation(savedRes.error)) {
            result.conflicts.push(remoteConflict("media_items", local, null, "duplicate_identity"));
            continue;
          }
          throw savedRes.error;
        }
        saved = savedRes.data;
      }
      await DB.atualizar("media_items", {
        ...local,
        storage_path: saved.storage_path || local.storage_path || null,
        sync_dirty: false,
        remote_updated_at: saved.updated_at,
        remote_team_id: remoteTeamId,
        sync_actor_type: saved.actor_type,
        sync_actor_label: saved.actor_label,
      }, { remote: true });
      remoteMap.set(saved.id, saved);
      result.pushed++;
    }

    const refreshed = await client.from("media_assets")
      .select("*").eq("team_id", remoteTeamId);
    if (refreshed.error) throw refreshed.error;
    remoteMap = new Map((refreshed.data || []).map((x) => [x.id, x]));
    localMap = new Map([...await this._localBySyncId("media_items")].filter(([, row]) => remoteRowBelongsToTeam(row, remoteTeamId)));
    for (const remote of remoteMap.values()) {
      const local = localMap.get(remote.id);
      if (remote.deleted_at) {
        if (!local) continue;
        if (remoteDeletionConflictsWithLocalEdit(local, remote)) {
          addConflict(remoteConflict("media_items", local, remote, "remote_deleted_local_dirty"));
          continue;
        }
        await DB.apagar("media_items", local.id, { remote: true });
        result.deleted++;
        continue;
      }
      if (remote.storage_path && !remoteStoragePathBelongsToTeam(remote.storage_path, remoteTeamId)) {
        addConflict(remoteConflict("media_items", local, remote, "storage_path_team_mismatch"));
        continue;
      }
      if (local?.sync_dirty) {
        result.conflicts.push(remoteConflict("media_items", local, remote));
        continue;
      }
      const subjectId = await this._localIdForRemoteRef(
        remote.subject_type, String(remote.subject_ref), remoteTeamId
      );
      let url = remote.external_url || null;
      if (!url && remote.storage_path) {
        const signed = await client.storage.from("team-media")
          .createSignedUrl(remote.storage_path, 3600);
        if (!signed.error) url = signed.data?.signedUrl || null;
        else {
          addConflict(remoteConflict("media_items", local, remote, "storage_signed_url_failed"));
          url = local?.url || null;
        }
      }

      const merged = {
        ...(local || {}),
        team_id: DEFAULT_TEAM_ID,
        subject_type: remote.subject_type,
        subject_id: subjectId,
        subject_key: mediaSubjectKey(DEFAULT_TEAM_ID, remote.subject_type, subjectId),
        type: remote.media_type,
        title: remote.title,
        note: remote.note || null,
        url,
        storage_path: remote.storage_path || null,
        file_name: remote.file_name || null,
        mime_type: remote.mime_type || null,
        size: remote.size_bytes || null,
        created_at: remote.created_at,
        updated_at: remote.updated_at,
        sync_id: remote.id,
        sync_dirty: false,
        remote_updated_at: remote.updated_at,
        remote_team_id: remoteTeamId,
        sync_actor_type: remote.actor_type,
        sync_actor_label: remote.actor_label,
      };

      if (local) {
        if (local.remote_updated_at === remote.updated_at && !remote.storage_path) continue;
        merged.id = local.id;
        await DB.atualizar("media_items", merged, { remote: true });
      } else {
        await DB.criar("media_items", remoteFreshLocalRecord(merged), { remote: true });
      }
      result.pulled++;
    }
    await this._refreshPlayerProfilePhotos();
    return result;
  },

  async _refreshPlayerProfilePhotos() {
    const [players, media] = await Promise.all([
      DB.porIndice("jogadores", "team_id", DEFAULT_TEAM_ID),
      DB.porIndice("media_items", "team_id", DEFAULT_TEAM_ID),
    ]);
    const profilePhotos = media
      .filter((item) =>
        item.subject_type === "player" &&
        item.type === "photo" &&
        String(item.note || "").toLowerCase().includes("foto de perfil")
      )
      .sort((a, b) => String(b.updated_at || b.created_at || "").localeCompare(String(a.updated_at || a.created_at || "")));

    for (const player of players) {
      const photo = profilePhotos.find((item) => String(item.subject_id) === String(player.id));
      const nextPhoto = photo ? (photo.data_url || photo.url || null) : null;
      if (nextPhoto) {
        const photoRef = photo.sync_id || null;
        if (player.foto !== nextPhoto || player.profile_media_ref !== photoRef) {
          await DB.atualizar("jogadores", { ...player, foto: nextPhoto, profile_media_ref: photoRef }, { remote: true });
        }
        continue;
      }
      const managedPhoto = !!player.profile_media_ref || String(player.foto || "").startsWith("data:") || /\/storage\/v1\/object\/sign\/team-media\//i.test(String(player.foto || ""));
      if (managedPhoto) {
        const cleared = { ...player, foto: null };
        delete cleared.profile_media_ref;
        await DB.atualizar("jogadores", cleared, { remote: true });
      }
    }
  },

  async _syncTombstones(selectedRemoteTeamId) {
    const client = await this.init();
    const rows = await DB.listar("sync_tombstones");
    const result = { deleted: 0, conflicts: [] };
    for (const item of rows) {
      let table;
      if (item.store === "media_items") table = "media_assets";
      else if (REMOTE_STORE_KINDS[item.store]) table = "workspace_records";
      else continue;

      if (!remoteIsUuid(item.sync_id)) {
        result.conflicts.push({ store: item.store, local_id: null, sync_id: item.sync_id, reason: "invalid_local_sync_id" });
        continue;
      }

      let remoteTeamId = item.remote_team_id;
      if (!remoteTeamId) {
        const originRes = await client.from(table).select("team_id").eq("id", item.sync_id).maybeSingle();
        if (originRes.error) throw originRes.error;
        remoteTeamId = originRes.data?.team_id || null;
      }
      if (!remoteTeamId) {
        result.conflicts.push({ store: item.store, local_id: null, sync_id: item.sync_id, reason: "delete_team_unknown" });
        continue;
      }

      const currentRes = await client.from(table)
        .select("id,updated_at,deleted_at")
        .eq("id", item.sync_id)
        .eq("team_id", remoteTeamId)
        .maybeSingle();
      if (currentRes.error) throw currentRes.error;
      const current = currentRes.data;
      if (!current || current.deleted_at) {
        await DB.apagar("sync_tombstones", item.id, { remote: true });
        result.deleted++;
        continue;
      }
      if (remoteTombstoneNeedsConflict(item, current)) {
        result.conflicts.push({
          store: item.store,
          local_id: null,
          sync_id: item.sync_id,
          reason: "delete_version_mismatch",
          expected_updated_at: item.expected_updated_at || null,
          remote_updated_at: current.updated_at || null,
        });
        continue;
      }
      const stamp = new Date().toISOString();
      let query = client.from(table)
        .update({ deleted_at: stamp })
        .eq("id", item.sync_id)
        .eq("team_id", remoteTeamId)
        .eq("updated_at", item.expected_updated_at)
        .is("deleted_at", null);
      const res = await query.select("id");
      if (res.error) throw res.error;
      if (!res.data?.length) {
        const latestRes = await client.from(table).select("id,updated_at,deleted_at").eq("id", item.sync_id).eq("team_id", remoteTeamId).maybeSingle();
        if (latestRes.error) throw latestRes.error;
        if (remoteTombstoneNeedsConflict(item, latestRes.data)) result.conflicts.push({
          store: item.store, local_id: null, sync_id: item.sync_id,
          reason: "delete_version_mismatch", expected_updated_at: item.expected_updated_at || null,
          remote_updated_at: latestRes.data.updated_at || null,
        });
        else if (!latestRes.data || latestRes.data.deleted_at) {
          await DB.apagar("sync_tombstones", item.id, { remote: true });
          result.deleted++;
        }
        continue;
      }
      await DB.apagar("sync_tombstones", item.id, { remote: true });
      result.deleted++;
    }
    return result;
  },

  async consolidateNow() {
    if (!navigator.onLine) throw new Error("Sem ligação à Internet.");
    const client = await this.init();
    const session = await this.getSession();
    const remoteTeamId = await this.ensureSelectedTeam();
    if (!client || !session || !remoteTeamId) throw new Error("Liga primeiro o workspace remoto.");

    const remoteRecordsRes = await client.from("workspace_records")
      .select("id,kind,deleted_at").eq("team_id", remoteTeamId);
    if (remoteRecordsRes.error) throw remoteRecordsRes.error;
    const remoteRecordIds = new Set((remoteRecordsRes.data || []).map((x) => x.id));

    let repaired = 0;
    for (const store of Object.keys(REMOTE_STORE_KINDS)) {
      let rows = (await DB.listar(store))
        .filter((x) => (x.team_id || DEFAULT_TEAM_ID) === DEFAULT_TEAM_ID)
        .filter((x) => store !== "exercicios" || x.workspace_v2 || x.sync_id);
      const scopedRows = [];
      for (const row of rows) {
        const belongs = await this._bindRemoteTeam(client, store, row, remoteTeamId);
        if (belongs) scopedRows.push(row.remote_team_id ? row : (await DB.obter(store, row.id)));
      }
      rows = scopedRows.filter(Boolean);
      for (const original of rows) {
        let local = original;
        if (!remoteIsUuid(local.sync_id)) {
          // Consolidation must never treat a local sentinel (for example
          // "default") as a remote UUID. Only rekey rows with no acknowledged
          // remote version; syncNow will surface older identities as conflicts.
          if (local.remote_updated_at) continue;
          local = await this._ensureSyncId(store, local);
          repaired++;
          continue;
        }
        if (!remoteRecordIds.has(local.sync_id)) {
          await DB.atualizar(store, {
            ...local,
            sync_dirty: true,
            sync_local_updated_at: new Date().toISOString(),
          }, { remote: true });
          repaired++;
        }
      }
    }

    const remoteMediaRes = await client.from("media_assets")
      .select("id,deleted_at").eq("team_id", remoteTeamId);
    if (remoteMediaRes.error) throw remoteMediaRes.error;
    const remoteMediaIds = new Set((remoteMediaRes.data || []).map((x) => x.id));
    let mediaRows = (await DB.listar("media_items"))
      .filter((x) => (x.team_id || DEFAULT_TEAM_ID) === DEFAULT_TEAM_ID);
    const scopedMediaRows = [];
    for (const row of mediaRows) {
      const belongs = await this._bindRemoteTeam(client, "media_items", row, remoteTeamId);
      if (belongs) scopedMediaRows.push(row.remote_team_id ? row : (await DB.obter("media_items", row.id)));
    }
    mediaRows = scopedMediaRows.filter(Boolean);
    for (const original of mediaRows) {
      let local = original;
      if (!remoteIsUuid(local.sync_id)) {
        if (local.remote_updated_at) continue;
        local = await this._ensureSyncId("media_items", local);
        repaired++;
        continue;
      }
      if (!remoteMediaIds.has(local.sync_id)) {
        await DB.atualizar("media_items", {
          ...local,
          sync_dirty: true,
          sync_local_updated_at: new Date().toISOString(),
        }, { remote: true });
        repaired++;
      }
    }

    const first = await this.syncNow();
    const second = await this.syncNow();
    const result = {
      repaired,
      pushed: (first.pushed || 0) + (second.pushed || 0),
      pulled: (first.pulled || 0) + (second.pulled || 0),
      deleted: (first.deleted || 0) + (second.deleted || 0),
      conflicts: [...(first.conflicts || []), ...(second.conflicts || [])],
    };
    localStorage.setItem("treinador.workspace.consolidated.v1", new Date().toISOString());
    return result;
  },

  async consolidateIfNeeded() {
    if (localStorage.getItem("treinador.workspace.consolidated.v1")) return null;
    const status = await this.status();
    if (!navigator.onLine || !status.signedIn || !status.remoteTeamId) return null;
    return this.consolidateNow();
  },

  async syncNow() {
    const requestedTeamId = remoteLoadConfig().remoteTeamId || null;
    if (this._syncPromise) {
      if (this._syncTeamId === requestedTeamId) {
        this._syncAgain = true;
        return this._syncPromise;
      }
      await this._syncPromise.catch(() => {});
      return this.syncNow();
    }

    this._syncAgain = false;
    const running = (async () => {
      let result = await this._syncNow();
      while (this._syncAgain && remoteLoadConfig().remoteTeamId === requestedTeamId) {
        this._syncAgain = false;
        result = await this._syncNow();
      }
      return result;
    })();
    this._syncPromise = running;
    this._syncTeamId = requestedTeamId;
    try {
      return await running;
    } finally {
      if (this._syncPromise === running) {
        this._syncPromise = null;
        this._syncTeamId = null;
        this._syncAgain = false;
      }
    }
  },

  async _syncNow() {
    if (!navigator.onLine) throw new Error("Sem ligação à Internet.");
    let config = remoteLoadConfig();
    if (!remoteConfigValid(config)) throw new Error("Configura primeiro o backend remoto.");
    const session = await this.getSession();
    if (!session) throw new Error("Inicia sessão para sincronizar.");
    const remoteTeamId = await this.ensureSelectedTeam();
    if (!remoteTeamId) throw new Error("Escolhe ou cria o workspace remoto.");
    config = remoteLoadConfig();
    const result = { pushed: 0, pulled: 0, conflicts: [], deleted: 0 };

    const tombstoneResult = await this._syncTombstones(remoteTeamId);
    const teamResult = await this.syncTeam(remoteTeamId);
    const recordResult = await this._syncRecords(remoteTeamId, session.user.id);
    const activityResult = await this._syncActivity(remoteTeamId, session.user.id);
    const mediaResult = await this._syncMedia(remoteTeamId, session.user.id);
    const parts = [tombstoneResult, teamResult, recordResult, activityResult, mediaResult];

    for (const part of parts) {
      result.pushed += part.pushed || 0;
      result.pulled += part.pulled || 0;
      result.deleted += part.deleted || 0;
      for (const conflict of (part.conflicts || [])) result.conflicts.push(conflict);
    }

    const lastSyncAt = new Date().toISOString();
    const completed = { ...result, lastSyncAt };
    remoteSaveConfig({ ...remoteLoadConfig(), lastSyncAt, conflicts: result.conflicts });
    this._clearSyncRetry();
    remoteEmitSync(completed);
    return completed;
  },

  async resolveDeleteConflict(syncId, resolution) {
    const config = remoteLoadConfig();
    const conflict = (config.conflicts || []).find((item) => item.sync_id === syncId && item.reason === "delete_version_mismatch");
    if (!conflict) throw new Error("O conflito de eliminação já mudou. Sincroniza novamente antes de decidir.");
    const tombstones = await DB.listar("sync_tombstones");
    const tombstone = tombstones.find((item) => item.sync_id === syncId);
    if (!tombstone) throw new Error("A eliminação local já foi resolvida.");
    if (resolution === "keep_remote") await DB.apagar("sync_tombstones", tombstone.id, { remote: true });
    else if (resolution === "delete_remote") {
      if (!conflict.remote_updated_at) throw new Error("Não foi possível confirmar a versão remota atual.");
      await DB.modificar("sync_tombstones", tombstone.id, (item) => ({ ...item, expected_updated_at: conflict.remote_updated_at }));
    } else throw new Error("Escolhe manter a versão remota ou confirmar a eliminação.");
    return this.syncNow();
  },

  async restoreLocallyEditedRecord(syncId) {
    const config = remoteLoadConfig();
    const conflict = (config.conflicts || []).find((item) => item.sync_id === syncId && item.reason === "remote_deleted_local_dirty");
    if (!conflict?.remote_updated_at || !conflict.remote_deleted_at) throw new Error("O conflito já mudou. Sincroniza novamente antes de restaurar.");
    const store = conflict.store;
    const table = store === "media_items" ? "media_assets" : REMOTE_STORE_KINDS[store] ? "workspace_records" : null;
    if (!table) throw new Error("Tipo de registo não suportado para restauro.");
    const locals = await DB.listar(store);
    const local = locals.find((item) => item.sync_id === syncId && item.sync_dirty);
    if (!local) throw new Error("A edição local já não está disponível para restauro.");
    const client = await this.init();
    const restored = await client.from(table).update({ deleted_at: null })
      .eq("id", syncId).eq("team_id", remoteLoadConfig().remoteTeamId)
      .eq("updated_at", conflict.remote_updated_at).eq("deleted_at", conflict.remote_deleted_at)
      .select("id,updated_at").maybeSingle();
    if (restored.error) throw restored.error;
    if (!restored.data) throw new Error("A versão remota mudou. A restauração foi recusada; sincroniza novamente.");
    await DB.modificar(store, local.id, (current) => ({ ...current, sync_dirty: true, remote_updated_at: restored.data.updated_at }));
    return this.syncNow();
  },

  async canUpload() {
    const status = await this.status();
    return !!(status.configured && status.signedIn && status.remoteTeamId && navigator.onLine);
  },
  async uploadFileMedia(file, input = {}) {
    if (!file?.size) throw new Error("Escolhe um ficheiro.");
    const config = remoteLoadConfig();
    const client = await this.init();
    const session = await this.getSession();
    if (!client || !session || !config.remoteTeamId) {
      throw new Error("Liga o workspace remoto antes de enviar ficheiros grandes.");
    }
    const syncId = remoteUuid();
    const name = remoteSafeFilename(file.name || input.title);
    const path = config.remoteTeamId + "/" + syncId + "/" + name;
    if (remoteShouldUseTus(file.size)) {
      await remoteUploadTus(config, session, file, path, input.onProgress);
    } else {
      const uploaded = await client.storage.from("team-media").upload(path, file, {
        contentType: file.type || "application/octet-stream",
        upsert: false,
      });
      if (uploaded.error) throw uploaded.error;
    }

    const subjectRef = await this._subjectRemoteRef(
      input.subject_type, input.subject_id, config.remoteTeamId
    );
    const remoteRow = {
      id: syncId,
      team_id: config.remoteTeamId,
      subject_type: input.subject_type,
      subject_ref: String(subjectRef),
      media_type: input.type || "file",
      title: remoteText(input.title || file.name, 160),
      note: remoteText(input.note, 2000) || null,
      storage_path: path,
      file_name: file.name,
      mime_type: file.type || null,
      size_bytes: file.size,
      actor_type: "human",
      actor_label: "Treinador",
      created_by: session.user.id,
    };
    const saved = await client.from("media_assets")
      .insert(remoteRow).select("*").single();
    if (saved.error) {
      await client.storage.from("team-media").remove([path]);
      throw saved.error;
    }

    const signed = await client.storage.from("team-media").createSignedUrl(path, 3600);
    const localRow = {
      team_id: DEFAULT_TEAM_ID,
      subject_type: input.subject_type,
      subject_id: String(input.subject_id),
      subject_key: mediaSubjectKey(DEFAULT_TEAM_ID, input.subject_type, input.subject_id),
      type: input.type || "file",
      title: remoteText(input.title || file.name, 160),
      note: remoteText(input.note, 2000) || null,
      url: signed.error ? null : signed.data?.signedUrl || null,
      data_url: null,
      storage_path: path,
      file_name: file.name,
      mime_type: file.type || null,
      size: file.size,
      created_at: saved.data.created_at,
      updated_at: saved.data.updated_at,
      sync_id: syncId,
      sync_dirty: false,
      remote_updated_at: saved.data.updated_at,
      remote_team_id: config.remoteTeamId,
      sync_actor_type: saved.data.actor_type,
      sync_actor_label: saved.data.actor_label,
    };
    try {
      return await DB.criar("media_items", localRow, { remote: true });
    } catch (error) {
      const persistenceError = error instanceof Error ? error : new Error(String(error));
      persistenceError.remoteMediaSaved = true;
      throw persistenceError;
    }
  },
};

if (typeof globalThis !== "undefined") globalThis.RemoteWorkspace = RemoteWorkspace;

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    REMOTE_STORE_KINDS,
    REMOTE_KIND_STORES,
    remoteConfigValid,
    remoteActorFor,
    remotePayload,
    remoteFreshLocalRecord,
    remoteSafeFilename,
    remoteIdentityKey,
    remoteNeedsConflict,
    remoteTombstoneNeedsConflict,
    remoteDeletionConflictsWithLocalEdit,
    remoteActivityMatches,
    remoteSyncRetryDelay,
    remoteRowBelongsToTeam,
    remoteConflict,
    remoteProjectRef,
    remoteShouldUseTus,
    remoteChooseTeamId,
    remoteRecordRow,
    remoteActivityRow,
    RemoteWorkspace,
  };
}
