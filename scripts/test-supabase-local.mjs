import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const supabaseWorkdir = resolve(root, process.env.VISION_COACH_SUPABASE_LOCAL_WORKDIR || ".");
const npx = process.platform === "win32" ? "npx.cmd" : "npx";
const status = spawnSync(npx, ["--yes", "supabase@2.117.0", "status", "--output", "env", "--workdir", supabaseWorkdir], {
  cwd: root,
  encoding: "utf8",
  shell: process.platform === "win32",
  windowsHide: true,
  timeout: 15_000,
});

if (status.error || status.status !== 0) {
  process.stderr.write(status.error?.code === "ETIMEDOUT"
    ? "A CLI Supabase excedeu 15 segundos a consultar a stack local. Verifica o Docker Desktop/engine e volta a executar este teste.\n"
    : "Supabase local não está disponível. Inicia a stack com `npx supabase start` e volta a executar este teste.\n");
  process.exit(status.status || 1);
}

const values = Object.fromEntries(status.stdout.split(/\r?\n/).flatMap((line) => {
  const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
  return match ? [[match[1], match[2].replace(/^['"]|['"]$/g, "")]] : [];
}));
const apiUrl = values.API_URL;
if (!apiUrl || !["localhost", "127.0.0.1", "::1"].includes(new URL(apiUrl).hostname)) {
  process.stderr.write("Recusado: o teste de integração aceita apenas uma URL Supabase local.\n");
  process.exit(1);
}
if (!values.ANON_KEY || !values.SERVICE_ROLE_KEY) {
  process.stderr.write("A stack local não devolveu as chaves de teste esperadas.\n");
  process.exit(1);
}

const result = spawnSync(process.execPath, ["--test", "--test-concurrency=1", "tests/remote_workspace_supabase.local.test.js", "tests/realtime_supabase_local.test.js", "tests/team_knowledge_supabase_local.test.js"], {
  cwd: root,
  stdio: "inherit",
  windowsHide: true,
  env: {
    ...process.env,
    VISION_COACH_SUPABASE_LOCAL_URL: apiUrl,
    VISION_COACH_SUPABASE_LOCAL_ANON_KEY: values.ANON_KEY,
    VISION_COACH_SUPABASE_LOCAL_SERVICE_KEY: values.SERVICE_ROLE_KEY,
  },
});

if (result.status !== 0) process.exit(result.status ?? 1);

const browser = spawnSync(npx, ["playwright", "test", "--config", "playwright.local.config.js", "--reporter=line"], {
  cwd: root,
  stdio: "inherit",
  shell: process.platform === "win32",
  windowsHide: true,
  env: {
    ...process.env,
    VISION_COACH_SUPABASE_LOCAL_URL: apiUrl,
    VISION_COACH_SUPABASE_LOCAL_ANON_KEY: values.ANON_KEY,
    VISION_COACH_SUPABASE_LOCAL_SERVICE_KEY: values.SERVICE_ROLE_KEY,
  },
});

process.exit(browser.status ?? 1);
