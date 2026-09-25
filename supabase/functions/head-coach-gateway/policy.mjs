const GENERIC_PUT_RECORD_KINDS = new Set(["game_model"]);

export function allowsGenericPutRecordKind(kind) {
  return GENERIC_PUT_RECORD_KINDS.has(String(kind));
}
