// Scratch orchestrator (not committed): start Vite, run the driver, stop Vite by pid.
import { spawn, spawnSync } from "node:child_process";
const mode = process.env.MODE || "dev"; const port = process.env.PORT_ || "5291";
const args = mode === "dev" ? ["node_modules/vite/bin/vite.js", "--port", port, "--strictPort"] : ["node_modules/vite/bin/vite.js", "preview", "--port", port, "--strictPort", "--outDir", process.env.PREVIEW_DIR];
const server = spawn(process.execPath, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
let log = ""; server.stdout.on("data", (d) => { log += d; }); server.stderr.on("data", (d) => { log += d; });
const stop = () => spawnSync("taskkill", ["/pid", String(server.pid), "/T", "/F"], { windowsHide: true });
try {
  for (let i = 0; i < 100 && !/Local:/.test(log); i++) await new Promise((r) => setTimeout(r, 200));
  console.log("server:", server.pid, log.split("\n")[0]);
  const base = `http://127.0.0.1:${port}`;
  const page = mode === "dev" ? "/test-integration/stream-perf.html" : "/test-integration/stream-perf.html";
  const r = spawnSync(process.execPath, ["test-integration/stream-perf-run.mjs"], { windowsHide: true, stdio: "inherit", env: { ...process.env, FIXTURE_URL: base + page } });
  console.log("driver exit", r.status);
} finally { stop(); console.log("stopped server", server.pid); }
