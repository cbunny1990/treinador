import { createReadStream, promises as fs } from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.VISION_TEST_PORT || 18765);
const contentTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".webmanifest", "application/manifest+json; charset=utf-8"],
  [".webp", "image/webp"],
  [".woff2", "font/woff2"],
]);

const server = http.createServer(async (request, response) => {
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, { Allow: "GET, HEAD" }).end("Method not allowed");
    return;
  }
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(request.url || "/", "http://127.0.0.1").pathname);
  } catch (_) {
    response.writeHead(400).end("Bad request");
    return;
  }
  const relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const file = path.resolve(root, relative);
  if (file !== root && !file.startsWith(root + path.sep)) {
    response.writeHead(403).end("Forbidden");
    return;
  }
  try {
    const info = await fs.stat(file);
    if (!info.isFile()) throw new Error("Not a file");
    response.writeHead(200, {
      "Content-Length": info.size,
      "Content-Type": contentTypes.get(path.extname(file).toLowerCase()) || "application/octet-stream",
      "Last-Modified": info.mtime.toUTCString(),
      "Cache-Control": "no-cache",
    });
    if (request.method === "HEAD") response.end();
    else createReadStream(file).pipe(response);
  } catch (_) {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("Not found");
  }
});

server.listen(port, "127.0.0.1");
