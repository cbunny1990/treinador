import { cp, mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const files = [".nojekyll", ".htaccess", "index.html", "manifest.webmanifest", "sw.js"];
const directories = ["assets", "css", "icons", "js", "vendor"];

function outputFromArgs(args) {
  if (!args.length) return path.join(root, "dist", "vision-coach");
  if (args.length !== 2 || args[0] !== "--out" || !args[1]) {
    throw new Error("Uso: npm run build:static [-- --out dist/pasta-destino]");
  }
  return path.resolve(root, args[1]);
}

function assertSafeOutput(output) {
  const relative = path.relative(root, output);
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error("A pasta de saída tem de ser nova e ficar dentro do repositório.");
  }
  const first = relative.split(path.sep)[0].toLowerCase();
  if (["assets", "css", "icons", "js", "vendor", "supabase", "docs", "tests", "scripts", "node_modules"].includes(first)) {
    throw new Error("A pasta de saída não pode ficar dentro das fontes do projeto.");
  }
}

const output = outputFromArgs(process.argv.slice(2));
assertSafeOutput(output);
try {
  await stat(output);
  throw new Error(`A pasta de saída já existe; nada foi substituído: ${path.relative(root, output)}`);
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}

await mkdir(path.dirname(output), { recursive: true });
await mkdir(output);
for (const entry of [...files, ...directories]) {
  await cp(path.join(root, entry), path.join(output, entry), { recursive: true, errorOnExist: true, force: false });
}
process.stdout.write(`Pacote estático criado: ${path.relative(root, output)}\n`);
