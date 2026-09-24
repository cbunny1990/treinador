export function parseMigrationList(output) {
  const start = String(output || "").indexOf('{"migrations"');
  if (start < 0) throw new Error("A CLI Supabase não devolveu a lista de migrations em JSON.");
  const parsed = JSON.parse(String(output).slice(start));
  if (!Array.isArray(parsed.migrations)) throw new Error("A lista de migrations locais tem um formato inesperado.");
  return parsed.migrations;
}

export function migrationHistoryDrift(rows) {
  const unapplied = [];
  const unknownApplied = [];
  const mismatched = [];
  for (const row of rows || []) {
    const local = String(row?.local || "");
    const remote = String(row?.remote || "");
    if (local && !remote) unapplied.push(local);
    else if (remote && !local) unknownApplied.push(remote);
    else if (local && remote && local !== remote) mismatched.push({ local, remote });
  }
  return { unapplied, unknownApplied, mismatched };
}

export function migrationDriftMessage(drift) {
  const lines = ["A stack Supabase local não corresponde às migrations deste branch; os testes de integração foram interrompidos sem aplicar migrations nem fazer reset."];
  if (drift.unapplied.length) lines.push("Ainda por aplicar: " + drift.unapplied.join(", ") + ".");
  if (drift.unknownApplied.length) lines.push("Aplicadas na stack, mas sem ficheiro local: " + drift.unknownApplied.join(", ") + ".");
  if (drift.mismatched.length) lines.push("Versões divergentes: " + drift.mismatched.map((item) => item.local + " / " + item.remote).join(", ") + ".");
  lines.push("Usa uma stack isolada com o histórico esperado ou reconcilia-a explicitamente antes de repetir.");
  return lines.join("\n") + "\n";
}
