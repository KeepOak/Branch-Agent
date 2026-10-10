import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createConnection, createServer } from "node:net";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { MacComputerDriver, describeDriverError, macScreenControlEnabled } from "../dist/mac-computer-driver.js";

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

// The shipped SDK accepts only these environment names for an embedded host (its safe allowlist).
const EMBEDDED_ENVIRONMENT_ALLOWLIST = new Set(["CUA_DRIVER_RS_TELEMETRY_ENABLED"]);
function allowlistedSdk(events, reasonFor = () => undefined) {
  return {
    currentMacOsPermissionStatus: () => ({ accessibility: true, screenRecording: true }),
    requestMacOSPermissions: () => ({ accessibility: true, screenRecording: true }),
    hasRequiredMacOSPermissions: status => status.accessibility && status.screenRecording,
    EmbeddedPermissionMode: { Standard: 0 },
    EmbeddedCuaDriverHost: class {
      static withOptions(options) {
        for (const { name } of options.environment) {
          const reason = reasonFor(name);
          if (!EMBEDDED_ENVIRONMENT_ALLOWLIST.has(name)) {
            const error = new Error("EmbeddedDriverError.Configuration");
            error.inner = { reason: reason ?? `environment variable ${name} is not in the embedded safe allowlist` };
            events.push("rejected");
            throw error;
          }
        }
        return new this();
      }
      async start() { events.push("start"); return { socketPath: "/nonexistent.sock", generation: "one" }; }
      async stop() {}
      waitForExit() { return new Promise(() => {}); }
      uniffiDestroy() {}
    },
  };
}

test("the embedded driver is configured only with environment the SDK accepts", async () => {
  const dir = await mkdtemp(join(tmpdir(), "branch-mac-driver-env-"));
  await writeFile(join(dir, "cua-driver"), "fixture");
  const lines = [];
  const events = [];
  const driver = new MacComputerDriver(line => lines.push(line), () => allowlistedSdk(events), () => "ai.branch.mac");
  try {
    assert.equal(JSON.parse(await driver.start(dir)).v, 2);
    assert.deepEqual(events, ["start"]);
    assert.deepEqual(lines, []);
  } finally { await driver.stop(); await rm(dir, { recursive: true, force: true }); }
});

test("a rejected embedded configuration surfaces the SDK's reason, not just its name", async () => {
  const dir = await mkdtemp(join(tmpdir(), "branch-mac-driver-reason-"));
  await writeFile(join(dir, "cua-driver"), "fixture");
  const sdk = {
    currentMacOsPermissionStatus: () => ({ accessibility: true, screenRecording: true }),
    requestMacOSPermissions: () => ({ accessibility: true, screenRecording: true }),
    hasRequiredMacOSPermissions: status => status.accessibility && status.screenRecording,
    EmbeddedPermissionMode: { Standard: 0 },
    EmbeddedCuaDriverHost: {
      withOptions() {
        throw Object.assign(new Error("EmbeddedDriverError.Configuration"), { inner: { reason: "rejected for test" } });
      },
    },
  };
  const driver = new MacComputerDriver(() => {}, () => sdk, () => "ai.branch.mac");
  try {
    const error = await driver.start(dir).then(() => undefined, reason => reason);
    assert.ok(error, "start should reject when the SDK rejects the configuration");
    assert.equal(describeDriverError(error), "rejected for test");
    assert.equal(describeDriverError(new Error("plain")), "Error: plain");
  } finally { await driver.stop(); await rm(dir, { recursive: true, force: true }); }
});
