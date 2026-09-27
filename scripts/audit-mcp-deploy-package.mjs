import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const entrypoint = path.join(root, 'supabase/functions/vision-coach-mcp/index.ts');
const config = fs.readFileSync(path.join(root, 'supabase/config.toml'), 'utf8');
const sources = new Set();
const externals = new Set();
const pending = [entrypoint];

function insideRoot(file) {
  const relative = path.relative(root, file);
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

while (pending.length) {
  const file = pending.pop();
  if (sources.has(file)) continue;
  if (!insideRoot(file)) throw new Error(`Import outside repository: ${path.relative(root, file)}`);
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
    throw new Error(`Missing local dependency: ${path.relative(root, file)}`);
  }
  sources.add(file);

  const source = fs.readFileSync(file, 'utf8');
  const specifiers = [...source.matchAll(/\b(?:import|export)\s+(?:[^'";]*?\s+from\s*)?['"]([^'"]+)['"]/g)]
    .map((match) => match[1]);
  for (const specifier of specifiers) {
    if (!specifier.startsWith('.')) {
      externals.add(specifier);
      continue;
    }
    const resolved = path.resolve(path.dirname(file), specifier);
    if (!insideRoot(resolved)) throw new Error(`Import escapes repository: ${path.relative(root, file)} -> ${specifier}`);
    pending.push(resolved);
  }
}

const configLines = config.split(/\r?\n/);
const functionStart = configLines.indexOf('[functions.vision-coach-mcp]');
const functionEnd = configLines.findIndex((line, index) => index > functionStart && /^\s*\[/.test(line));
const functionSection = functionStart < 0 ? '' : configLines
  .slice(functionStart + 1, functionEnd < 0 ? undefined : functionEnd)
  .join('\n');
if (!/^\s*verify_jwt\s*=\s*false\s*$/m.test(functionSection)) {
  throw new Error('Expected [functions.vision-coach-mcp] verify_jwt = false (custom connector-token authentication).');
}

const relativePaths = [...sources]
  .map((file) => path.relative(root, file).split(path.sep).join('/'))
  .sort();
console.log(`MCP package graph: ${relativePaths.length} local source files; ${externals.size} external imports.`);
console.log(`Auth config: verify_jwt=false; local Deno CLI packaging: --use-api; remote deployment: not performed.`);
console.log(`Local dependencies: ${relativePaths.join(', ')}`);
