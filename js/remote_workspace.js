"use strict";

const REMOTE_CONFIG_KEY = "treinador.remote.supabase.v1";
const REMOTE_STORE_KINDS = {
  jogadores: "player",
  jogos: "match",
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

function remoteLoadConfig() {
  try {
    return JSON.parse(localStorage.getItem(REMOTE_CONFIG_KEY) || "{}");
  } catch (_) {
    return {};
  }
}
function remoteSaveConfig(config) {
  localStorage.setItem(REMOTE_CONFIG_KEY, JSON.stringify(config || {}));
  return config;
}
function remoteConfigValid(config) {
  const url = remoteText(config?.url, 500);
  const key = remoteText(config?.publishableKey, 1000);
  return /^https:\/\//i.test(url) && !!key;
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
  return { actor_type: "human", actor_label: "Treinador" };
}
function remotePayload(row) {
  const payload = { ...row };
  for (const key of ["id", "team_id", "sync_id", "sync_dirty", "sync_local_updated_at", "remote_updated_at", "data_url"]) {
    delete payload[key];
  }
  return payload;
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

  scheduleSync(delay = 1400) {
    clearTimeout(this._syncTimer);
    this._syncTimer = setTimeout(async () => {
      try {
        const status = await this.status();
        if (navigator.onLine && status.signedIn && status.remoteTeamId) await this.syncNow();
      } catch (error) {
        console.warn("Remote sync adiado:", error.message);
      }
    }, delay);
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
    return data;
  },
  async useTeam(teamId) {
    const id = remoteText(teamId, 100);
    if (!id) throw new Error("Escolhe um workspace remoto.");
    const config = remoteLoadConfig();
    remoteSaveConfig({ ...config, remoteTeamId: id });
    return id;
  },
  async syncTeam(remoteTeamId) {
    const client = await this.init();
    const session = await this.getSession();
    const local = await HeadCoachMemory.ensureTeam();
    const { data: remote, error } = await client.from("teams")
      .select("id,name,metadata,updated_at").eq("id", remoteTeamId).single();
    if (error) throw error;
    const conflict = !!(local.sync_dirty && local.remote_updated_at && local.remote_updated_at !== remote.updated_at);
    if (local.sync_dirty && !conflict) {
      const { data: saved, error: saveError } = await client.from("teams").update({
        name: local.nome || remote.name,
        metadata: remotePayload(local),
      }).eq("id", remoteTeamId).select("id,name,metadata,updated_at").single();
      if (saveError) throw saveError;
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
      conflicts: conflict ? [{ store: "teams", local_id: local.id, sync_id: remoteTeamId }] : [],
      pushed: 0,
      pulled: 0,
    };
  },
  async _ensureSyncId(store, row) {
    if (row.sync_id) return row;
    const next = {
      ...row,
      sync_id: remoteUuid(),
      sync_dirty: true,
      sync_local_updated_at: new Date().toISOString(),
    };
    await DB.atualizar(store, next, { remote: true });
    return next;
  },
  async _localBySyncId(store) {
    const rows = await DB.listar(store);
    return new Map(rows.filter((x) => x.sync_id).map((x) => [x.sync_id, x]));
  },
  async _subjectRemoteRef(subjectType, subjectId, remoteTeamId) {
    if (subjectType === "team") return remoteTeamId;
    const store = REMOTE_SUBJECT_STORES[subjectType];
    if (!store) return String(subjectId);
    const local = await DB.obter(store, subjectId);
    if (!local) return String(subjectId);
    const withId = await this._ensureSyncId(store, local);
    return withId.sync_id;
  },

  async _localIdForRemoteRef(subjectType, remoteRef) {
    if (subjectType === "team") return DEFAULT_TEAM_ID;
    const store = REMOTE_SUBJECT_STORES[subjectType];
    if (!store) return remoteRef;
    const rows = await DB.listar(store);
    const found = rows.find((x) => x.sync_id === remoteRef);
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
  async _hydratePayload(kind, payload) {
    const out = { ...(payload || {}) };
    if (Array.isArray(out.subject_refs)) {
      const refs = [];
      for (const ref of out.subject_refs) {
        refs.push({
          ...ref,
          id: await this._localIdForRemoteRef(ref.type, String(ref.id)),
        });
      }
      out.subject_refs = refs;
    }
    if (Array.isArray(out.refs)) {
      const refs = [];
      for (const ref of out.refs) {
        refs.push({
          ...ref,
          id: await this._localIdForRemoteRef(ref.type, String(ref.id)),
        });
      }
      out.refs = refs;
    }
    if (kind === "memory") {
      const mapIds = async (ids) => {
        const mapped = [];
        for (const id of (Array.isArray(ids) ? ids : [])) {
          mapped.push(Number(await this._localIdForRemoteRef("memory", String(id))) || id);
        }
        return mapped;
      };
      out.evidence_ids = await mapIds(out.evidence_ids);
      out.related_ids = await mapIds(out.related_ids);
      if (out.supersedes_id) {
        const localId = await this._localIdForRemoteRef("memory", String(out.supersedes_id));
        out.supersedes_id = Number(localId) || out.supersedes_id;
      }
    }
    if (kind === "game_model" && out.supersedes_id) {
      const localId = await this._localIdForRemoteRef("game_model", String(out.supersedes_id));
      out.supersedes_id = Number(localId) || out.supersedes_id;
    }
    return out;
  },
  async _syncRecords(remoteTeamId, userId) {
    const client = await this.init();
    const first = await client.from("workspace_records")
      .select("*").eq("team_id", remoteTeamId).is("deleted_at", null);
    if (first.error) throw first.error;
    let remoteMap = new Map((first.data || []).map((x) => [x.id, x]));
    const result = { pushed: 0, pulled: 0, conflicts: [] };

    for (const store of Object.keys(REMOTE_STORE_KINDS)) {
      const rows = (await DB.listar(store)).filter((x) => (x.team_id || DEFAULT_TEAM_ID) === DEFAULT_TEAM_ID);
      for (const original of rows) {
        const local = await this._ensureSyncId(store, original);
        const remote = remoteMap.get(local.sync_id);

        const changedBoth = !!(
          local.sync_dirty &&
          local.remote_updated_at &&
          remote &&
          local.remote_updated_at !== remote.updated_at
        );
        if (changedBoth) {
          result.conflicts.push({ store, local_id: local.id, sync_id: local.sync_id });
          continue;
        }
        if (local.sync_dirty || !remote) {
          const payload = await this._payloadForRemote(store, local, remoteTeamId);
          const row = remoteRecordRow(store, local, remoteTeamId, userId, payload);
          const { data: saved, error } = await client.from("workspace_records")
            .upsert(row, { onConflict: "id" })
            .select("*").single();
          if (error) throw error;
          await DB.atualizar(store, {
            ...local,
            sync_dirty: false,
            remote_updated_at: saved.updated_at,
          }, { remote: true });
          remoteMap.set(saved.id, saved);
          result.pushed++;
        }
      }
    }

    const refreshed = await client.from("workspace_records")
      .select("*").eq("team_id", remoteTeamId).is("deleted_at", null);
    if (refreshed.error) throw refreshed.error;
    remoteMap = new Map((refreshed.data || []).map((x) => [x.id, x]));

    for (const remote of remoteMap.values()) {
      const store = REMOTE_KIND_STORES[remote.kind];
      if (!store) continue;
      const localMap = await this._localBySyncId(store);
      const local = localMap.get(remote.id);
      if (local?.sync_dirty) continue;
      const payload = await this._hydratePayload(remote.kind, remote.payload);
      const merged = {
        ...(local || {}),
        ...payload,
        team_id: DEFAULT_TEAM_ID,
        sync_id: remote.id,
        sync_dirty: false,
        remote_updated_at: remote.updated_at,
      };
      if (local) {
        merged.id = local.id;
        if (local.remote_updated_at === remote.updated_at) continue;
        await DB.atualizar(store, merged, { remote: true });
      } else {
        delete merged.id;
        await DB.criar(store, merged, { remote: true });
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
    const locals = (await DB.listar("activity_items"))
      .filter((x) => (x.team_id || DEFAULT_TEAM_ID) === DEFAULT_TEAM_ID);

    for (const original of locals) {
      const local = await this._ensureSyncId("activity_items", original);
      if (!remoteMap.has(local.sync_id)) {
        const remoteRow = await this._activityRemoteRow(local, remoteTeamId, userId);
        const { data: saved, error } = await client.from("activity_log")
          .insert(remoteRow)
          .select("*").single();
        if (error) throw error;

        await DB.atualizar("activity_items", {
          ...local,
          sync_dirty: false,
          remote_updated_at: saved.created_at,
        }, { remote: true });
        remoteMap.set(saved.id, saved);
        result.pushed++;
      } else if (local.sync_dirty) {
        await DB.atualizar("activity_items", {
          ...local,
          sync_dirty: false,
          remote_updated_at: remoteMap.get(local.sync_id).created_at,
        }, { remote: true });
      }
    }

    const localMap = await this._localBySyncId("activity_items");
    for (const remote of remoteMap.values()) {
      if (localMap.has(remote.id)) continue;
      const localEntityId = remote.entity_type && remote.entity_ref != null
        ? await this._localIdForRemoteRef(remote.entity_type, String(remote.entity_ref))
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
      };
      await DB.criar("activity_items", row, { remote: true });
      result.pulled++;
    }
    return result;
  },

  async _uploadLocalMedia(local, remoteTeamId) {
    if (local.storage_path) return local.storage_path;
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
      external_url: local.url && !String(local.url).startsWith("blob:") ? local.url : null,
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
      .select("*").eq("team_id", remoteTeamId).is("deleted_at", null);
    if (remoteRes.error) throw remoteRes.error;
    const remoteMap = new Map((remoteRes.data || []).map((x) => [x.id, x]));
    const result = { pushed: 0, pulled: 0, conflicts: [] };

    const locals = (await DB.listar("media_items"))
      .filter((x) => (x.team_id || DEFAULT_TEAM_ID) === DEFAULT_TEAM_ID);
    for (const original of locals) {
      const local = await this._ensureSyncId("media_items", original);
      const remote = remoteMap.get(local.sync_id);
      const changedBoth = !!(
        local.sync_dirty && local.remote_updated_at &&
        remote && local.remote_updated_at !== remote.updated_at
      );
      if (changedBoth) {
        result.conflicts.push({ store: "media_items", local_id: local.id, sync_id: local.sync_id });
        continue;
      }

      if (local.sync_dirty || !remote) {
        const row = await this._mediaRemoteRow(local, remoteTeamId, userId);
        const savedRes = await client.from("media_assets")
          .upsert(row, { onConflict: "id" }).select("*").single();
        if (savedRes.error) throw savedRes.error;
        await DB.atualizar("media_items", {
          ...local,
          storage_path: savedRes.data.storage_path || local.storage_path || null,
          sync_dirty: false,
          remote_updated_at: savedRes.data.updated_at,
        }, { remote: true });
        remoteMap.set(savedRes.data.id, savedRes.data);
        result.pushed++;
      }
    }

    const localMap = await this._localBySyncId("media_items");
    for (const remote of remoteMap.values()) {
      const local = localMap.get(remote.id);
      if (local?.sync_dirty) continue;
      const subjectId = await this._localIdForRemoteRef(
        remote.subject_type, String(remote.subject_ref)
      );
      let url = remote.external_url || null;
      if (!url && remote.storage_path) {
        const signed = await client.storage.from("team-media")
          .createSignedUrl(remote.storage_path, 3600);
        if (!signed.error) url = signed.data?.signedUrl || null;
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
      };

      if (local) {
        if (local.remote_updated_at === remote.updated_at && !remote.storage_path) continue;
        merged.id = local.id;
        await DB.atualizar("media_items", merged, { remote: true });
      } else {
        const fresh = { ...merged, id: undefined };
        await DB.criar("media_items", fresh, { remote: true });
      }
      result.pulled++;
    }
    return result;
  },

  async _syncTombstones() {
    const client = await this.init();
    const rows = await DB.listar("sync_tombstones");
    let pushed = 0;
    for (const item of rows) {
      const stamp = new Date().toISOString();
      if (item.store === "media_items") {
        const res = await client.from("media_assets")
          .update({ deleted_at: stamp }).eq("id", item.sync_id);
        if (res.error) throw res.error;
      } else if (REMOTE_STORE_KINDS[item.store]) {
        const res = await client.from("workspace_records")
          .update({ deleted_at: stamp }).eq("id", item.sync_id);
        if (res.error) throw res.error;
      } else {
        continue;
      }
      await DB.apagar("sync_tombstones", item.id, { remote: true });
      pushed++;
    }
    return pushed;
  },

  async syncNow() {
    if (!navigator.onLine) throw new Error("Sem ligação à Internet.");
    const config = remoteLoadConfig();
    if (!remoteConfigValid(config)) throw new Error("Configura primeiro o backend remoto.");
    const session = await this.getSession();
    if (!session) throw new Error("Inicia sessão para sincronizar.");
    if (!config.remoteTeamId) throw new Error("Escolhe ou cria o workspace remoto.");
    const result = { pushed: 0, pulled: 0, conflicts: [], deleted: 0 };

    const teamResult = await this.syncTeam(config.remoteTeamId);
    const recordResult = await this._syncRecords(config.remoteTeamId, session.user.id);
    const activityResult = await this._syncActivity(config.remoteTeamId, session.user.id);
    const mediaResult = await this._syncMedia(config.remoteTeamId, session.user.id);
    const parts = [teamResult, recordResult, activityResult, mediaResult];

    for (const part of parts) {
      result.pushed += part.pushed || 0;
      result.pulled += part.pulled || 0;
      for (const conflict of (part.conflicts || [])) result.conflicts.push(conflict);
    }
    result.deleted = await this._syncTombstones();

    const lastSyncAt = new Date().toISOString();
    remoteSaveConfig({ ...remoteLoadConfig(), lastSyncAt });
    return { ...result, lastSyncAt };
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
    const uploaded = await client.storage.from("team-media").upload(path, file, {
      contentType: file.type || "application/octet-stream",
      upsert: false,
    });
    if (uploaded.error) throw uploaded.error;

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
    if (saved.error) throw saved.error;

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
    };
    return DB.criar("media_items", localRow, { remote: true });
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
    remoteSafeFilename,
    remoteRecordRow,
    remoteActivityRow,
  };
}
