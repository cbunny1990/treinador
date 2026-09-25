import { build } from "esbuild";

await build({
  entryPoints: ["supabase/functions/head-coach-gateway/index.ts"],
  bundle: true,
  platform: "neutral",
  format: "esm",
  write: false,
  logLevel: "silent",
  external: ["jsr:*", "npm:*"],
});
