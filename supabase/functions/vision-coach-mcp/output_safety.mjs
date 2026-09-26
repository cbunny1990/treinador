import { containsSensitivePersonalText } from "./team_knowledge.mjs";

const SENSITIVE_FIELD = /(?:les[aã]o|injur|medical|medic|health|sa[uú]de|diagnos|symptom|sintom|alerg|allerg|clinical|cl[ií]nic|doctor|m[eé]dico|hospital|internad|hospitaliz|insurance|seguro.?sa[uú]de|psycholog|psicolog|psychiatr|psiquiatr|therapy|terapia|birth|nasc|\bdob\b|email|phone|telef|contact|contacto|address|morada|guardian|encarregad|parent|tutor|token|secret|password)/i;
const PRIVATE_MEDIA_FIELDS = new Set([
  "visualimage", "visualurl", "visualstoragepath", "photo", "photourl", "photopath", "photostoragepath",
  "foto", "fotourl", "fotopath", "fotostoragepath", "image", "imageurl", "imagepath", "imagestoragepath",
  "imagedata", "imagebase64", "dataurl", "storagepath", "signedurl", "avatar", "avatarurl", "profilephoto",
  "profilephotourl", "profileimage", "profileimageurl", "headshot", "portrait", "imagem", "imagemurl", "imagempath",
]);
const OPERATIONAL_STATUS_FIELD = /^(?:estado_disponibilidade|availability|attendance|match_status)$/i;

function sanitize(value, state, key = "", parent = null) {
  if (typeof value === "string") {
    if (key === "message" && ["sensitive_query_not_sent", "sensitive_query_not_searched"].includes(parent?.retrieval_status)) return value;
    if (OPERATIONAL_STATUS_FIELD.test(key) || !containsSensitivePersonalText(value)) return value;
    state.omitted = true;
    return "Conteúdo pessoal sensível omitido";
  }
  if (Array.isArray(value)) {
    return value.map(item => {
      const itemState = { omitted: false };
      const safeItem = sanitize(item, itemState);
      if (itemState.omitted) state.omitted = true;
      return safeItem;
    }).filter(item => item !== undefined);
  }
  if (!value || typeof value !== "object") return value;

  const local = { omitted: false };
  const safe = {};
  const mediaKind = String(value.media_type || value.mediaType || "").toLowerCase();
  for (const [key, childValue] of Object.entries(value)) {
    const photoUrl = mediaKind === "photo" || mediaKind === "image" || mediaKind === "avatar";
    const normalizedKey = String(key).replace(/[_-]/g, "").toLowerCase();
    if (SENSITIVE_FIELD.test(key) || PRIVATE_MEDIA_FIELDS.has(normalizedKey) || (photoUrl && /^(?:url|uri|path)$/i.test(key))) {
      local.omitted = true;
      continue;
    }
    const child = sanitize(childValue, local, key, value);
    if (child !== undefined) safe[key] = child;
  }
  if (local.omitted) safe.sensitive_text_omitted = true;
  if (local.omitted) state.omitted = true;
  return safe;
}

export function sanitizeMcpOutput(value) {
  if (Array.isArray(value)) return value.map(item => sanitize(item, { omitted: false })).filter(item => item !== undefined);
  return sanitize(value, { omitted: false });
}
