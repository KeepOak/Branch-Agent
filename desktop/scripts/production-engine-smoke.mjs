import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { join } from "node:path";
import { once } from "node:events";
import { validateRuntime } from "./bundle-node.mjs";

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function freePort() {
  const server = createServer(); server.listen(0, "127.0.0.1"); await once(server, "listening");
  const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port;
}
function isolatedEnvironment(root, port, token) {
  const env = {};
  for (const key of ["PATH", "Path", "SystemRoot", "WINDIR", "COMSPEC", "TEMP", "TMP", "TMPDIR"]) if (process.env[key]) env[key] = process.env[key];
  return { ...env, HOME: root, USERPROFILE: root, LOCALAPPDATA: join(root, "AppData/Local"), APPDATA: join(root, "AppData/Roaming"),
    BRANCH_HOME: root, BRANCH_STATE_DIR: join(root, "state"), BRANCH_CONFIG_PATH: join(root, "state/branch.json"),
    BRANCH_PROFILE: "release-smoke", BRANCH_SKIP_CHANNELS: "1", BRANCH_GATEWAY_PORT: String(port), BRANCH_GATEWAY_TOKEN: token,
    BRANCH_SUPERVISOR_MODE: "external" };
}
async function ready(child, port, deadline) {
  while (Date.now() < deadline) {
    assert(child.exitCode === null && child.signalCode === null, "Packaged production engine exited before readyz");
    try {
      const response = await fetch(`http://127.0.0.1:${port}/readyz`, { signal: AbortSignal.timeout(Math.min(1000, deadline - Date.now())) });
      await response.body?.cancel(); if (response.status === 200) return;
    } catch {}
    await pause(Math.min(200, Math.max(0, deadline - Date.now())));
  }
  throw new Error("Packaged production engine exceeded its readiness deadline");
}
async function health(port, token, protocol, deadline) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  const request = (method, params) => new Promise((resolve, reject) => {
    const id = randomUUID();
    const timer = setTimeout(() => finish(new Error(`Packaged engine ${method} timed out`)), Math.max(1, deadline - Date.now()));
    const message = event => { try { const value = JSON.parse(String(event.data)); if (value.type === "res" && value.id === id) finish(undefined, value); } catch {} };
    const closed = () => finish(new Error("Packaged engine connection closed before response"));
    function finish(error, value) { clearTimeout(timer); ws.removeEventListener("message", message); ws.removeEventListener("close", closed); error ? reject(error) : resolve(value); }
    ws.addEventListener("message", message); ws.addEventListener("close", closed);
    ws.send(JSON.stringify({ type: "req", id, method, params }));
  });
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Packaged engine websocket timed out")), Math.max(1, deadline - Date.now()));
      ws.addEventListener("open", () => { clearTimeout(timer); resolve(); }, { once: true });
      ws.addEventListener("error", () => { clearTimeout(timer); reject(new Error("Packaged engine websocket failed")); }, { once: true });
    });
    const connected = await request("connect", { minProtocol: protocol.min, maxProtocol: protocol.max,
      client: { id: "branch-ios", displayName: "isolated production release smoke", version: "dev", platform: "dev", mode: "ui", instanceId: "release-smoke" },
      role: "operator", scopes: [], caps: [], auth: { token } });
    assert(connected.ok && connected.payload?.type === "hello-ok", "Packaged engine refused authenticated connection");
    const response = await request("health", { probe: false });
    assert(response.ok && response.payload?.ok === true && typeof response.payload.ts === "number", "Packaged engine failed authenticated non-model health");
  } finally { ws.close(); }
}
async function shutdown(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === "win32") execFileSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore", timeout: 10_000 });
  else process.kill(-child.pid, "SIGTERM");
  const end = Date.now() + 5000;
  while (child.exitCode === null && child.signalCode === null && Date.now() < end) await pause(50);
  if (child.exitCode === null && child.signalCode === null && process.platform !== "win32") process.kill(-child.pid, "SIGKILL");
  const final = Date.now() + 1000;
  while (child.exitCode === null && child.signalCode === null && Date.now() < final) await pause(25);
  assert(child.exitCode !== null || child.signalCode !== null, "Owned production smoke process survived shutdown");
}
export async function smokeProductionEngine(engine, nodePath, commit, protocol, { budgetMs = 150_000 } = {}) {
  assert(Number.isSafeInteger(budgetMs) && budgetMs > 0 && budgetMs <= 150_000, "Production smoke must finish within three minutes including shutdown");
  assert.equal(JSON.parse(await readFile(join(engine, "dist/build-info.json"), "utf8")).commit, commit, "Packaged engine source identity mismatch");
  const runtime = JSON.parse(execFileSync(nodePath, ["-p", "JSON.stringify({version:process.version,platform:process.platform,arch:process.arch})"], { encoding: "utf8", windowsHide: true, timeout: 5000 }));
  validateRuntime(runtime, { platform: process.platform, arch: process.arch });
  const root = await mkdtemp(join(process.env.RUNNER_TEMP ?? process.env.BRANCH_RELEASE_TEST_TEMP, "production-engine-smoke-"));
  const port = await freePort(), token = randomBytes(32).toString("hex"), started = Date.now();
  let child;
  try {
    await mkdir(join(root, "state"));
    await writeFile(join(root, "state/branch.json"), JSON.stringify({ gateway: { mode: "local", bind: "loopback", auth: { mode: "token", token } }, plugins: { enabled: false }, update: { auto: { enabled: false } } }), { mode: 0o600 });
    child = spawn(nodePath, ["branch.mjs", "gateway", "--port", String(port)], { cwd: engine, env: isolatedEnvironment(root, port, token), windowsHide: true, detached: process.platform !== "win32", stdio: "ignore" });
    await Promise.race([once(child, "spawn"), once(child, "error").then(() => { throw new Error("Packaged engine could not start"); })]);
    const deadline = started + budgetMs;
    await ready(child, port, deadline - Math.min(15_000, budgetMs / 3));
    await health(port, token, protocol, deadline);
    await shutdown(child);
    return { commit, ready: true, authenticatedHealth: true, exited: true, elapsedMs: Date.now() - started, runtime };
  } finally {
    if (child?.pid) await shutdown(child);
    await rm(root, { recursive: true, force: true });
  }
}
