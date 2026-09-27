import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { migrationDeploymentMessage, migrationDeploymentPlan, parseMigrationList } from "./supabase-migration-preflight.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const projectRef = String(process.env.VISION_COACH_SUPABASE_PROJECT_REF || "").trim();
if (!/^[a-z0-9]{20}$/i.test(projectRef)) {
  process.stderr.write("Define VISION_COACH_SUPABASE_PROJECT_REF com o ID do projeto antes da auditoria. Não é uma chave nem password.\n");
  process.exit(2);
}

const npx = process.platform === "win32" ? "npx.cmd" : "npx";
const result = spawnSync(npx, [
  "--yes", "supabase@2.117.0", "migration", "list", "--project-ref", projectRef,
  "--output-format", "json", "--workdir", root,
], {
  cwd: root,
  encoding: "utf8",
  shell: process.platform === "win32",
  windowsHide: true,
  timeout: 30_000,
});

if (result.error || result.status !== 0) {
  const detail = result.error?.code === "ETIMEDOUT" ? "A CLI excedeu 30 segundos." : "A CLI não conseguiu ler o histórico remoto.";
  process.stderr.write(detail + " Confirma a sessão autenticada da CLI Supabase e o ID do projeto. Nenhuma migration foi aplicada.\n");
  process.exit(result.status || 1);
}

try {
  const plan = migrationDeploymentPlan(parseMigrationList(result.stdout));
  process.stdout.write(migrationDeploymentMessage(plan));
  process.exitCode = plan.ready ? 0 : 2;
} catch (error) {
  process.stderr.write(String(error?.message || "Formato de histórico desconhecido") + " Nenhuma migration foi aplicada.\n");
  process.exit(1);
}
