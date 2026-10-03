// Serves the built window on 127.0.0.1. The gateway refuses file:// and custom schemes, but accepts a loopback
// origin from a loopback client (engine src/gateway/origin-check.ts, "local-loopback").
import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webm": "video/webm",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".ico": "image/x-icon",
};

export function serveWindow(root: string, port: number): Promise<Server> {
  const base = normalize(root) + sep;
  const server = createServer(async (req, res) => {
    const path = decodeURIComponent(new URL(req.url ?? "/", "http://127.0.0.1").pathname);
    const file = normalize(join(base, path === "/" ? "index.html" : path));
    if (!file.startsWith(base)) {
      res.writeHead(403).end();
      return;
    }
    try {
      const body = await readFile(file);
      res.writeHead(200, { "Content-Type": TYPES[extname(file)] ?? "application/octet-stream" }).end(body);
    } catch {
      const index = await readFile(join(base, "index.html"));
      res.writeHead(200, { "Content-Type": TYPES[".html"] }).end(index);
    }
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}
