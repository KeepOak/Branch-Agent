// Serves the built window on 127.0.0.1. The gateway refuses file:// and custom schemes, but accepts a loopback
// origin from a loopback client (engine src/gateway/origin-check.ts, "local-loopback").
import { createServer, type Server } from "node:http";
import { statSync } from "node:fs";
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

/** What is on disk for a build: the window's entry page, by inode, time and size. A new build changes it. */
function windowIdentity(base: string): string {
  try {
    const entry = statSync(join(base, "index.html"));
    return `${entry.ino}:${entry.mtimeMs}:${entry.size}`;
  } catch {
    return "missing";
  }
}

/**
 * `root` is read on every request, so the server always serves the folder the updater publishes into. `onSwap` runs the
 * first time a request finds a different build on disk from the one the server started with, or from the one it last
 * served: a window swap at startup, after a launch, or during a staged update.
 */
export function serveWindow(root: () => string, port: number, onSwap?: () => void): Promise<Server> {
  let served = windowIdentity(normalize(root()));
  const server = createServer(async (req, res) => {
    const base = normalize(root()) + sep;
    const now = windowIdentity(normalize(root()));
    if (now !== served) {
      served = now;
      onSwap?.();
    }
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
      try {
        const index = await readFile(join(base, "index.html"));
        res.writeHead(200, { "Content-Type": TYPES[".html"] }).end(index);
      } catch {
        // Mid-swap: the folder is being moved. The page retries its request.
        res.writeHead(503, { "Retry-After": "1" }).end();
      }
    }
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}
