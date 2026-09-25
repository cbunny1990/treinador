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

export function migrationDeploymentPlan(rows) {
  const local = new Set();
  const remote = new Set();
  for (const row of rows || []) {
    if (row?.local) local.add(String(row.local));
    if (row?.remote) remote.add(String(row.remote));
  }
  const unapplied = [...local].filter(version => !remote.has(version)).sort();
  const unknownApplied = [...remote].filter(version => !local.has(version)).sort();
  const latestApplied = [...remote].sort().at(-1) || null;
  const appliedOutOfOrder = latestApplied
    ? unapplied.filter(version => version < latestApplied)
    : [];
  return { unapplied, unknownApplied, latestApplied, appliedOutOfOrder, ready: !unknownApplied.length && !appliedOutOfOrder.length };
}

export function migrationDeploymentMessage(plan) {
  const lines = ["Auditoria apenas de leitura; não aplicou migrations nem alterou dados."];
  if (plan.unapplied.length) lines.push("Por aplicar: " + plan.unapplied.join(", ") + ".");
  if (plan.unknownApplied.length) lines.push("Remotas sem ficheiro local: " + plan.unknownApplied.join(", ") + ".");
  if (plan.appliedOutOfOrder.length) lines.push("Bloqueio: há migrations anteriores em falta antes da versão remota " + plan.latestApplied + ": " + plan.appliedOutOfOrder.join(", ") + ". Revê a sequência e os efeitos antes de qualquer deploy.");
  if (plan.ready) lines.push("A ordem remota não revela versões desconhecidas nem migrations anteriores em falta.");
  return lines.join("\n") + "\n";
}

export function migrationDriftMessage(drift) {
  const lines = ["A stack Supabase local não corresponde às migrations deste branch; os testes de integração foram interrompidos sem aplicar migrations nem fazer reset."];
  if (drift.unapplied.length) lines.push("Ainda por aplicar: " + drift.unapplied.join(", ") + ".");
  if (drift.unknownApplied.length) lines.push("Aplicadas na stack, mas sem ficheiro local: " + drift.unknownApplied.join(", ") + ".");
  if (drift.mismatched.length) lines.push("Versões divergentes: " + drift.mismatched.map((item) => item.local + " / " + item.remote).join(", ") + ".");
  lines.push("Usa uma stack isolada com o histórico esperado ou reconcilia-a explicitamente antes de repetir.");
  return lines.join("\n") + "\n";
}
