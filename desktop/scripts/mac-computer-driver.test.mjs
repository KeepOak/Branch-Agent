import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createConnection, createServer } from "node:net";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { MacComputerDriver, macScreenControlEnabled } from "../dist/mac-computer-driver.js";
import { createMacScreenControlReconciler, restartMacScreenControlOnBuild } from "../dist/mac-screen-control-restart.js";

test("Mac control restart boots the serving build without confirming a pending update", async () => {
  const events = [];
  await restartMacScreenControlOnBuild("/running/engine", {
    drain: async () => { events.push("drain"); },
    waitForPort: async () => { events.push("wait"); },
    boot: async (dir, confirmUpdate) => { events.push([dir, confirmUpdate]); },
    handoff: () => { events.push("handoff"); },
  });
  assert.deepEqual(events, ["drain", "wait", ["/running/engine", false], "handoff"]);
});

test("Mac setting changes stay queued while restart is busy or fails", async () => {
  let state = { enabled: false, granted: false };
  const outcomes = [false, false, true, true];
  const calls = [];
  const poll = createMacScreenControlReconciler(() => state, async () => {
    calls.push(state.enabled);
    return outcomes.shift();
  }, () => {});
  state = { enabled: true, granted: false };
  for (let i = 0; i < 3; i++) { poll(); await new Promise(resolve => setImmediate(resolve)); }
  assert.deepEqual(calls, [true, true, true]);
  poll();
  assert.deepEqual(calls, [true, true, true]);
  state = { enabled: false, granted: false };
  poll(); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls, [true, true, true, false]);
});

test("Mac screen control remains off until explicitly enabled", async () => {
  const dir = await mkdtemp(join(tmpdir(), "branch-mac-screen-setting-"));
  const config = join(dir, "branch.json");
  try {
    assert.equal(macScreenControlEnabled(config), false);
    await writeFile(config, JSON.stringify({ plugins: { entries: { "cua-computer": { enabled: false } } } }));
    assert.equal(macScreenControlEnabled(config), false);
    await writeFile(config, JSON.stringify({ plugins: { entries: { "cua-computer": { enabled: true } } } }));
    assert.equal(macScreenControlEnabled(config), true);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("Mac app requests both permissions before supplying a live embedded driver endpoint", async () => {
  const dir = await mkdtemp(join(tmpdir(), "branch-mac-driver-test-"));
  const binary = join(dir, "cua-driver");
  const socketPath = process.platform === "win32" ? `\\\\.\\pipe\\branch-driver-test-${process.pid}` : join(dir, "driver.sock");
  const backend = createServer(socket => socket.pipe(socket));
  await new Promise((resolve, reject) => { backend.once("error", reject); backend.listen(socketPath, resolve); });
  await writeFile(binary, "fixture");
  const events = [];
  let granted = false;
  const exit = new EventEmitter();
  const sdk = () => ({
    currentMacOsPermissionStatus: () => ({ accessibility: granted, screenRecording: granted }),
    requestMacOSPermissions: () => { events.push("permission request"); return { accessibility: granted, screenRecording: granted }; },
    hasRequiredMacOSPermissions: status => status.accessibility && status.screenRecording,
    EmbeddedPermissionMode: { Standard: 0 },
    EmbeddedCuaDriverHost: class {
      static withOptions(options) {
        assert.equal(options.binaryPath, binary);
        assert.equal(options.hostBundleId, "ai.branch.mac");
        assert.equal(options.permissionMode, 0);
        assert.equal(options.dangerouslyBypassApprovals, false);
        return new this();
      }
      async start() { events.push("start"); return { socketPath, generation: "one" }; }
      async stop() { events.push("stop"); }
      waitForExit() { return new Promise(resolve => exit.once("exit", resolve)); }
      uniffiDestroy() { events.push("destroy"); }
    },
  });
  const driver = new MacComputerDriver(() => {}, sdk, () => "ai.branch.mac");
  try {
    assert.equal(await driver.start(dir), undefined);
    assert.deepEqual(events, ["permission request"]);
    granted = true;
    const endpoint = JSON.parse(await driver.start(dir));
    assert.equal(endpoint.v, 2);
    assert.ok(Number.isInteger(endpoint.port) && endpoint.port > 0);
    assert.match(endpoint.secret, /^[0-9a-f]{64}$/);
    assert.deepEqual(events, ["permission request", "start"]);
    assert.equal(await driver.start(dir), JSON.stringify(endpoint));
    const denied = createConnection({ host: "127.0.0.1", port: endpoint.port });
    denied.on("error", () => {});
    await new Promise(resolve => denied.once("connect", resolve));
    denied.write("not-the-secret\n");
    await new Promise(resolve => denied.once("close", resolve));
    const admitted = createConnection({ host: "127.0.0.1", port: endpoint.port });
    try {
      await new Promise(resolve => admitted.once("connect", resolve));
      admitted.write(`${endpoint.secret}\nping`);
      assert.equal((await new Promise(resolve => admitted.once("data", resolve))).toString(), "ping");
    } finally { admitted.destroy(); }
    await driver.stop();
    events.length = 0;
    await driver.start(dir);
    assert.deepEqual(events, ["start"]);
    await driver.stop();
    assert.deepEqual(events.slice(-2), ["stop", "destroy"]);
    exit.emit("exit");
  } finally { await driver.stop(); backend.close(); await rm(dir, { recursive: true, force: true }); }
});
