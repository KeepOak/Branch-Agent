import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";

const dist = process.env.BRANCH_DESKTOP_TEST_DIST;
if (!dist) throw new Error("Set BRANCH_DESKTOP_TEST_DIST to current strict-compiled source");
const { createComponentUpdateController, registerComponentUpdateIpc } = await import(pathToFileURL(join(dist, "component-update-ipc.js")));
const { RELEASE_MANIFEST_URL } = await import(pathToFileURL(join(dist, "component-update-manifest.js")));
const release = { schemaVersion: 1, version: "1.2.3", components: Object.fromEntries(["engine", "window"].map(name => [name,
  { url: `https://github.com/KeepOak/Branch-Agent/releases/download/v1.2.3/${name}.tar.gz`, sha256: "a".repeat(64), bytes: 10, expandedBytes: 20 }])) };

async function fixture(run) {
  const parent = join(tmpdir(), "Codex-session-files", "component-update-button");
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(join(parent, "fixture-"));
  const cfg = { dataDir: root, windowDir: join(root, "window"), engineDir: join(root, "engine") };
  try { await run(cfg); } finally { await rm(root, { recursive: true, force: true }); }
}

test("manual check reads the configured manifest once for concurrent callers without staging", async () => fixture(async cfg => {
  const urls = []; let resolveFetch;
  const request = async url => { urls.push(url); return new Promise(resolve => { resolveFetch = resolve; }); };
  const controller = createComponentUpdateController(cfg, { request, stage: async () => { assert.fail("check must not stage"); } });
  const first = controller.check(); const second = controller.check();
  await new Promise(resolve => setImmediate(resolve));
  resolveFetch(new Response(JSON.stringify(release)));
  const [one, two] = await Promise.all([first, second]);
  assert.deepEqual(one, two);
  assert.equal(one.phase, "available"); assert.equal(one.latestVersion, "1.2.3");
  assert.deepEqual(urls, [RELEASE_MANIFEST_URL]);
}));

test("status reports real pending publication and stage uses the owned runner only once", async () => fixture(async cfg => {
  let stages = 0;
  const controller = createComponentUpdateController(cfg, { stage: async () => {
    stages++; await writeFile(join(cfg.dataDir, "component-update-pending.json"), JSON.stringify({ phase: "pending", version: "1.2.3" }));
    return true;
  } });
  const [first, second] = await Promise.all([controller.stage(), controller.stage()]);
  assert.equal(stages, 1); assert.deepEqual(first, second); assert.equal(first.phase, "staged");
  assert.equal((await controller.status()).pendingVersion, "1.2.3");
}));

test("stage queued behind a manual check still stages once instead of returning the check result", async () => fixture(async cfg => {
  let resolveFetch; let stages = 0;
  const controller = createComponentUpdateController(cfg, { request: async () => new Promise(resolve => { resolveFetch = resolve; }),
    stage: async () => { stages++; await writeFile(join(cfg.dataDir, "component-update-pending.json"), JSON.stringify({ phase: "pending", version: "1.2.3" })); return true; } });
  const checked = controller.check(); const first = controller.stage(); const second = controller.stage();
  await new Promise(resolve => setImmediate(resolve)); resolveFetch(new Response(JSON.stringify(release)));
  assert.equal((await checked).phase, "available");
  assert.equal((await first).phase, "staged"); assert.deepEqual(await second, await first); assert.equal(stages, 1);
}));

test("status retires staged state after owned readiness confirmation or rollback", async () => fixture(async cfg => {
  const controller = createComponentUpdateController(cfg);
  await writeFile(join(cfg.dataDir, "component-update-pending.json"), JSON.stringify({ phase: "pending", version: "1.2.3" }));
  assert.equal((await controller.status()).phase, "staged");
  await writeFile(join(cfg.dataDir, "component-update-version.txt"), "1.2.3\n");
  await rm(join(cfg.dataDir, "component-update-pending.json"));
  const confirmed = await controller.status(); assert.equal(confirmed.phase, "current"); assert.equal(confirmed.pendingVersion, null);
  await writeFile(join(cfg.dataDir, "component-update-pending.json"), JSON.stringify({ phase: "pending", version: "1.2.4" }));
  assert.equal((await controller.status()).phase, "staged");
  await rm(join(cfg.dataDir, "component-update-pending.json"));
  assert.equal((await controller.status()).phase, "unchecked", "rolled back candidate must not remain staged or become current");
}));

test("untrusted manifest and rejected owned stage report errors without publication", async () => fixture(async cfg => {
  const controller = createComponentUpdateController(cfg, { request: async () => new Response(JSON.stringify({ ...release,
    components: { ...release.components, engine: { ...release.components.engine, url: "https://example.test/engine.tar.gz" } } })),
    stage: async () => { throw new Error("Owned lifecycle is occupied; current work is retained"); } });
  assert.match((await controller.check()).error, /Untrusted release/);
  assert.match((await controller.stage()).error, /Owned lifecycle is occupied/);
  assert.equal((await controller.status()).pendingVersion, null);
}));

test("a latest release previously rejected by owned readiness is not advertised as installable", async () => fixture(async cfg => {
  await writeFile(join(cfg.dataDir, "component-update-rejected.json"), JSON.stringify({ version: release.version,
    engineSha256: release.components.engine.sha256, windowSha256: release.components.window.sha256 }));
  const controller = createComponentUpdateController(cfg, { request: async () => new Response(JSON.stringify(release)) });
  const status = await controller.check();
  assert.equal(status.phase, "error"); assert.match(status.error, /failed readiness/); assert.equal(status.pendingVersion, null);
}));

test("IPC refuses foreign sender, subframe, wrong origin and arguments before reads or mutations", async () => {
  const handlers = new Map(); let reads = 0;
  const owner = { getURL: () => "http://127.0.0.1:1234/" }; owner.mainFrame = { url: owner.getURL() };
  const controller = Object.fromEntries(["status", "check", "stage"].map(method => [method, async () => { reads++; return {}; }]));
  registerComponentUpdateIpc({ handle: (name, handler) => handlers.set(name, handler) }, () => owner, "http://127.0.0.1:1234/", controller);
  const event = { sender: owner, senderFrame: owner.mainFrame };
  for (const method of ["status", "check", "stage"]) {
    const invoke = handlers.get(`branch-desktop:component-update:${method}`);
    await assert.rejects(async () => invoke({ ...event, sender: { ...owner } }), /served window/);
    await assert.rejects(async () => invoke({ ...event, senderFrame: { url: owner.getURL() } }), /served window/);
    await assert.rejects(async () => invoke(event, { url: "https://evil.test/" }), /arguments/);
    owner.mainFrame.url = "http://127.0.0.1:9999/";
    await assert.rejects(async () => invoke(event), /served window/); owner.mainFrame.url = owner.getURL();
    await invoke(event);
  }
  assert.equal(reads, 3);
});

test("served preload exposes only fixed parameter-free component IPC methods", async () => {
  const calls = []; let bridge;
  const electron = { contextBridge: { exposeInMainWorld: (name, value) => { assert.equal(name, "branchDesktop"); bridge = value; } },
    ipcRenderer: { sendSync: () => ({ gatewayUrl: "ws://127.0.0.1:1234", gatewayToken: "fixture-token" }),
      invoke: async (...args) => { calls.push(args); return { phase: "unchecked" }; }, on: () => {}, send: (...args) => calls.push(args) } };
  runInNewContext(await readFile(join(dist, "preload.js"), "utf8"), { exports: {}, process: { platform: "win32" }, require: name => {
    assert.equal(name, "electron"); return electron;
  }, window: { addEventListener: () => {} } });
  await bridge.componentUpdates.status(); await bridge.componentUpdates.check(); await bridge.componentUpdates.stage();
  const overlay = { color: "#0f1418", symbolColor: "#aebac3", height: 51 };
  bridge.titleBar.set(overlay);
  assert.deepEqual(calls, [["branch-desktop:component-update:status"], ["branch-desktop:component-update:check"], ["branch-desktop:component-update:stage"],
    ["branch-desktop:title-bar", overlay]]);
});
