"use strict";

const HEAD_COACH_MEDIA_TYPES = ["photo", "video", "file"];
const HEAD_COACH_MEDIA_SUBJECTS = ["player", "training", "match", "memory", "document"];

function mediaText(value, max = 2000) {
  return String(value == null ? "" : value).trim().slice(0, max);
}

function mediaSubjectKey(teamId, type, id) {
  return [mediaText(teamId || "default"), mediaText(type), mediaText(id)].join("|");
}

function mediaSafeUrl(value) {
  const url = mediaText(value, 8000);
  if (!url) return null;
  if (/^https?:\/\//i.test(url) || /^data:/i.test(url)) return url;
  throw new Error("O link de media deve começar por http:// ou https://.");
}

function normalizarMediaItem(input, options = {}) {
  const type = mediaText(input.type || "file", 20);
  const subjectType = mediaText(input.subject_type, 30);
  const subjectId = mediaText(input.subject_id, 100);
  if (!HEAD_COACH_MEDIA_TYPES.includes(type)) throw new Error("Tipo de media inválido.");
  if (!HEAD_COACH_MEDIA_SUBJECTS.includes(subjectType) || !subjectId)
    throw new Error("Escolhe a entidade a que o media pertence.");
  const url = mediaSafeUrl(input.url);
  const dataUrl = mediaText(input.data_url, 8_000_000) || null;
  if (!url && !dataUrl) throw new Error("Adiciona um link ou um ficheiro pequeno.");
  const now = options.now || new Date().toISOString();
  const teamId = mediaText(input.team_id || "default", 100);
  return {
    team_id: teamId,
    subject_type: subjectType,
    subject_id: subjectId,
    subject_key: mediaSubjectKey(teamId, subjectType, subjectId),
    type,
    title: mediaText(input.title, 160) || (type === "photo" ? "Fotografia" : type === "video" ? "Vídeo" : "Ficheiro"),
    url,
    data_url: dataUrl,
    file_name: mediaText(input.file_name, 255) || null,
    mime_type: mediaText(input.mime_type, 120) || null,
    size: Number(input.size) || null,
    note: mediaText(input.note, 2000) || null,
    created_at: mediaText(input.created_at) || now,
    updated_at: now,
  };
}

const HeadCoachMedia = {
  async listForSubject(subjectType, subjectId, teamId = HEAD_COACH_DEFAULT_TEAM_ID) {
    const key = mediaSubjectKey(teamId, subjectType, subjectId);
    return (await DB.porIndice("media_items", "subject_key", key))
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  },
  async create(input) {
    const item = normalizarMediaItem(input);
    return DB.criar("media_items", item);
  },

  async remove(id) {
    return DB.apagar("media_items", id);
  },
};

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    HEAD_COACH_MEDIA_TYPES, HEAD_COACH_MEDIA_SUBJECTS,
    mediaSubjectKey, mediaSafeUrl, normalizarMediaItem,
  };
}
