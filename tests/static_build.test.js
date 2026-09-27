const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { readdir, readFile, rm, stat, mkdtemp } = require("node:fs/promises");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

test("static build includes runtime and approved images byte-for-byte, without development or backend files", async () => {
  const tempRoot = await mkdtemp(path.join(root, ".vision-coach-static-test-"));
  const output = path.join(tempRoot, "site");
  const relative = path.relative(root, output);
  try {
    const result = spawnSync(process.execPath, ["scripts/build-static-site.mjs", "--out", relative], {
      cwd: root,
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);

    for (const file of [".htaccess", "index.html", "manifest.webmanifest", "sw.js", "js/app.js", "css/styles.css", "vendor/supabase.min.js", "vendor/tus.min.js"]) {
      assert.ok((await stat(path.join(output, file))).isFile(), `${file} is included`);
    }
    const apacheConfig = await readFile(path.join(output, ".htaccess"), "utf8");
    assert.match(apacheConfig, /application\/manifest\+json/);
    assert.match(apacheConfig, /sw\\\.js/, "service worker is excluded from browser caching");
    const originals = await readdir(path.join(root, "assets"), { recursive: true });
    const bundledAssets = await readdir(path.join(output, "assets"), { recursive: true });
    assert.deepEqual([...bundledAssets].sort(), [...originals].sort());
    for (const relativeFile of originals.filter(file => file.endsWith(".png"))) {
      assert.deepEqual(
        await readFile(path.join(output, "assets", relativeFile)),
        await readFile(path.join(root, "assets", relativeFile)),
        `${relativeFile} bytes are unchanged`,
      );
    }
    for (const excluded of ["supabase", "tests", "node_modules", "package.json", ".env"]) {
      await assert.rejects(stat(path.join(output, excluded)), { code: "ENOENT" });
    }

    const second = spawnSync(process.execPath, ["scripts/build-static-site.mjs", "--out", relative], {
      cwd: root,
      encoding: "utf8",
    });
    assert.notEqual(second.status, 0, "existing output is refused, not overwritten");
    assert.match(second.stderr, /já existe/);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});
