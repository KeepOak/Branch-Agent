// Real loopback Gateway acceptance with an isolated home. No model, accounts or channels.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import net from "node:net";
import { randomUUID } from "node:crypto";

const fixture = path.resolve("../output/library-live", randomUUID());
const workspace = path.join(fixture, "workspace");
const linkedWorkspace = path.join(fixture, "linked-workspace");
const outsideWorkspace = path.join(fixture, "outside-workspace");
const state = path.join(fixture, "state");
await fs.mkdir(workspace, { recursive: true });
await fs.mkdir(linkedWorkspace, { recursive: true });
await fs.mkdir(outsideWorkspace, { recursive: true });
await fs.symlink(outsideWorkspace, path.join(linkedWorkspace, "Documents"), process.platform === "win32" ? "junction" : "dir");
await fs.mkdir(state, { recursive: true });
for (const key of ["HOME", "USERPROFILE", "BRANCH_HOME", "LOCALAPPDATA", "APPDATA"]) process.env[key] = fixture;
process.env.BRANCH_STATE_DIR = state;
process.env.BRANCH_CONFIG_PATH = path.join(state, "branch.json");
for (const suffix of ["CHANNELS", "GMAIL_WATCHER", "CRON", "CANVAS_HOST", "BROWSER_CONTROL_SERVER", "PROVIDERS"]) process.env[`BRANCH_SKIP_${suffix}`] = "1";
process.env.BRANCH_DISABLE_BUNDLED_PLUGINS = "1";
console.log("[acceptance] isolated home ready; channels, providers and scheduled work disabled");
const token = randomUUID();
process.env.BRANCH_GATEWAY_TOKEN = token;
await fs.writeFile(process.env.BRANCH_CONFIG_PATH, JSON.stringify({ gateway: { auth: { mode: "token", token } }, agents: { entries: { main: { default: true, workspace }, linked: { workspace: linkedWorkspace } } } }));
const probe = net.createServer();
await new Promise<void>(resolve => probe.listen(0, "127.0.0.1", resolve));
const address = probe.address();
assert(address && typeof address !== "string");
const port = address.port;
assert(![3210, 3300, 3299, 18789, 19001].includes(port));
await new Promise<void>((resolve, reject) => probe.close(error => error ? reject(error) : resolve()));
process.env.BRANCH_GATEWAY_PORT = String(port);
const { startGatewayServer } = await import("../src/gateway/server.js");
const { GatewayClient } = await import("../src/gateway/client.js");
const { loadOrCreateDeviceIdentity } = await import("../src/infra/device-identity.js");
const { loadCompleteTranscript } = await import("../../window/src/transcript-export/load.ts");
const { eventsToMarkdown } = await import("../../window/src/transcript-export/render.ts");
console.log("[acceptance] source imports loaded; starting real loopback Gateway");
const serverOptions = { bind: "loopback" as const, auth: { mode: "token" as const, token }, controlUiEnabled: false, sidecarStartup: "defer" as const, ambientEnvTriggers: "suppress" as const };
let server = await startGatewayServer(port, serverOptions);
console.log("[acceptance] Gateway ready");
let client: InstanceType<typeof GatewayClient> | undefined;
async function connect(scopes: string[]) {
  let connected!: () => void;
  let failed!: (error: Error) => void;
  const ready = new Promise<void>((resolve, reject) => { connected = resolve; failed = reject; });
  const deviceIdentity = loadOrCreateDeviceIdentity({ path: path.join(state, scopes.includes("operator.admin") ? "acceptance-admin-device.json" : "acceptance-reader-device.json") });
  client = new GatewayClient({ url: `ws://127.0.0.1:${port}`, token, clientName: "test", mode: "test", scopes, deviceIdentity, onHelloOk: connected, onConnectError: failed });
  const deadline = setTimeout(() => failed(new Error("Isolated Gateway connect timeout")), 30_000);
  client.start();
  try { await ready; } finally { clearTimeout(deadline); }
  return client;
}
try {
  const admin = await connect(["operator.admin", "operator.read", "operator.write"]);
  console.log("[acceptance] admin connected; creating isolated conversation");
  const sessionKey = "agent:main:library-acceptance";
  await admin.request("sessions.create", { key: sessionKey, agentId: "main", displayName: "Library acceptance" });
  await admin.request("chat.inject", { sessionKey, message: "Persisted isolated transcript ☀", label: "Library acceptance" });
  const engine = { request: admin.request.bind(admin), scopes: ["operator.admin", "operator.read"], sessionKey, agentId: "main", onEvent: () => () => {} };
  const blocks = await loadCompleteTranscript(engine, sessionKey, new AbortController().signal);
  const content = eventsToMarkdown(blocks, { title: "Library acceptance", includeToolDetails: true, includeTimestamps: true });
  assert(content.includes("Persisted isolated transcript ☀"));
  const saved = await admin.request<{ file: { path: string } }>("agents.documents.create", { agentId: "main", name: "Acceptance.md", content });
  assert.equal(await fs.readFile(path.join(workspace, saved.file.path), "utf8"), content);
  await assert.rejects(admin.request("agents.documents.create", { agentId: "main", name: "Acceptance.md", content: "overwrite" }), /already exists/);
  for (const name of ["../escape.md", "C:\\escape.md", "nested/file.md", "NUL.md"]) {
    await assert.rejects(admin.request("agents.documents.create", { agentId: "main", name, content: "escape" }), /portable filename/);
  }
  await assert.rejects(admin.request("agents.documents.create", { agentId: "linked", name: "Escape.md", content: "escape" }));
  assert.deepEqual(await fs.readdir(outsideWorkspace), []);
  await assert.rejects(admin.request("agents.documents.create", { agentId: "unknown", name: "Unknown.md", content: "unknown" }), /not found/);
  const { acceptCronStagger, verifyCronStaggerPersistence } = await import("./cron-stagger-acceptance.js");
  const cronIds = await acceptCronStagger(admin);
  console.log("[acceptance] persisted transcript exported; exclusive-create conflict verified");
  await client!.stopAndWait();
  console.log("[acceptance] path/link boundaries verified; restarting Gateway to verify persistence");
  await server.close();
  server = await startGatewayServer(port, serverOptions);
  const persistedAdmin = await connect(["operator.admin", "operator.read", "operator.write"]);
  await verifyCronStaggerPersistence(persistedAdmin, cronIds);
  await persistedAdmin.stopAndWait();
  const reader = await connect(["operator.read"]);
  console.log("[acceptance] separate read-only device connected; verifying Library listing and content");
  const listing = await reader.request<{ entries: { path: string }[] }>("agents.workspace.list", { agentId: "main", path: "Documents" });
  assert(listing.entries.some(file => file.path === saved.file.path));
  const read = await reader.request<{ file: { content: string } }>("agents.workspace.get", { agentId: "main", path: saved.file.path });
  assert.equal(read.file.content, content);
  await assert.rejects(reader.request("agents.documents.create", { agentId: "main", name: "Read-only.md", content: "denied" }), /scope|permission|admin/i);
  assert.equal(await fs.readFile(path.join(workspace, saved.file.path), "utf8"), content);
  console.log("PASS: real isolated Gateway history → Markdown → exclusive Library create → reconnect/list/read; duplicate and read-only writes rejected");
} finally {
  await client?.stopAndWait();
  await server.close();
}
