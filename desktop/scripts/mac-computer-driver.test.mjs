import assert from "node:assert/strict";
import { createConnection, createServer } from "node:net";
import { mkdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import * as driverModule from "../dist/mac-computer-driver.js";
const { MacComputerDriver, describeDriverError, macDriverStore, macScreenControlEnabled, readEnginePins } = driverModule;

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
  const sdk = () => ({
    currentMacOsPermissionStatus: () => ({ accessibility: granted, screenRecording: granted }),
    requestMacOSPermissions: () => { events.push("permission request"); return { accessibility: granted, screenRecording: granted }; },
    hasRequiredMacOSPermissions: status => status.accessibility && status.screenRecording,
    EmbeddedPermissionMode: { Standard: 0 },
    EmbeddedDriverHostState: { Ready: 2 },
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
      state() { return 2; }
      waitForExit() { throw new Error("the exit watch must never leave waitForExit pending (trycua/cua#4339)"); }
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
    EmbeddedDriverHostState: { Ready: 2 },
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
      state() { return 2; }
      waitForExit() { throw new Error("the exit watch must never leave waitForExit pending (trycua/cua#4339)"); }
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
    EmbeddedDriverHostState: { Ready: 2 },
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

// Release builds fetch the driver on first use (#983): the engine keeps it in <state dir>/tools/computer-use/.
const sha256 = text => createHash("sha256").update(text).digest("hex");
const NATIVE = { "libcua_driver_sdk.dylib": "native library", "cua_driver_node_runtime.node": "node runtime" };

/** A release engine (no bundled driver, only the plugin's pins) and a per-user download of that driver. */
async function downloadedDriver(t, { driverText = "verified driver" } = {}) {
  const dir = await mkdtemp(join(tmpdir(), "branch-mac-driver-download-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const engineDir = join(dir, "engine");
  const stateDir = join(dir, "state");
  const pluginDir = join(engineDir, "dist", "extensions", "cua-computer");
  await mkdir(pluginDir, { recursive: true });
  const nativePins = Object.fromEntries(Object.entries(NATIVE).map(([name, text]) => [name, sha256(text)]));
  await writeFile(join(pluginDir, "package.json"), JSON.stringify({
    dependencies: { "@trycua/cua-driver": "0.28.2" },
    cuaDriverArtifacts: { "darwin-universal-binary": { files: { "cua-driver": sha256("verified driver") } }, "darwin-arm64": { files: nativePins } },
  }));
  const root = macDriverStore(stateDir, "0.28.2", "arm64");
  const nativeDir = join(root, "node_modules", "@trycua", "cua-driver-darwin-arm64");
  await mkdir(nativeDir, { recursive: true });
  for (const [name, text] of Object.entries(NATIVE)) await writeFile(join(nativeDir, name), text);
  await writeFile(join(root, "cua-driver"), driverText);
  return { engineDir, stateDir, root, receipt: () => writeFile(join(root, "computer-use-install.json"), "{}") };
}

test("a release engine starts the per-user download only after it matches the engine's pins", async t => {
  const { engineDir, stateDir, root, receipt } = await downloadedDriver(t);
  const loaded = [];
  const events = [];
  const lines = [];
  const driver = new MacComputerDriver(line => lines.push(line), sdkRoot => { loaded.push(sdkRoot); return allowlistedSdk(events); },
    () => "ai.branch.mac", () => stateDir, "arm64");
  t.after(() => driver.stop());
  assert.deepEqual(readEnginePins(engineDir, "arm64")?.version, "0.28.2");
  // Not downloaded yet: nothing loads, and the log says why.
  assert.equal(driver.installed(engineDir), false);
  assert.equal(await driver.start(engineDir), undefined);
  assert.match(lines.join("\n"), /not downloaded yet/);
  assert.deepEqual(loaded, []);
  await receipt();
  assert.equal(driver.installed(engineDir), true);
  assert.equal(JSON.parse(await driver.start(engineDir)).v, 2);
  assert.deepEqual(loaded, [root]);
  assert.deepEqual(events, ["start"]);
  assert.equal(driver.permissionsGranted(engineDir), true);
});

test("a downloaded driver that differs from its pin is refused before the SDK loads or the driver runs", async t => {
  const { engineDir, stateDir, receipt } = await downloadedDriver(t, { driverText: "tampered driver" });
  await receipt();
  const loaded = [];
  const lines = [];
  const driver = new MacComputerDriver(line => lines.push(line), sdkRoot => { loaded.push(sdkRoot); throw new Error("must not load"); },
    () => "ai.branch.mac", () => stateDir, "arm64");
  t.after(() => driver.stop());
  assert.equal(await driver.start(engineDir), undefined);
  assert.deepEqual(loaded, []);
  assert.match(lines.join("\n"), /refused: .*cua-driver does not match the SHA-256 this engine pins .*not loaded or run/);
  assert.equal(driver.permissionsGranted(engineDir), false);
  assert.deepEqual((await driver.locate(engineDir)).state, "refused");
});

test("the Coming reasons are the preview's copy: none for a missing driver, its permission line for permissions", () => {
  assert.equal(driverModule.DRIVER_NOT_PACKAGED, "");
  assert.equal(driverModule.DRIVER_START_FAILED, "");
  assert.equal(driverModule.DRIVER_NEEDS_PERMISSION, "macOS asks you to allow this once, in System Settings.");
});

test("the driver keeps a plain reason while it has no endpoint, and clears it once ready", async () => {
  const dir = await mkdtemp(join(tmpdir(), "branch-mac-driver-why-"));
  let granted = false;
  let reject = true;
  const sdk = {
    currentMacOsPermissionStatus: () => ({ accessibility: granted, screenRecording: granted }),
    requestMacOSPermissions: () => ({ accessibility: granted, screenRecording: granted }),
    hasRequiredMacOSPermissions: status => status.accessibility && status.screenRecording,
    EmbeddedPermissionMode: { Standard: 0 },
    EmbeddedDriverHostState: { Ready: 2 },
    EmbeddedCuaDriverHost: {
      withOptions(options) {
        if (reject) throw Object.assign(new Error("EmbeddedDriverError.Configuration"), { inner: { reason: "X is not in the embedded safe allowlist" } });
        return allowlistedSdk([]).EmbeddedCuaDriverHost.withOptions(options);
      },
    },
  };
  const driver = new MacComputerDriver(() => {}, () => sdk, () => "ai.branch.mac");
  try {
    assert.equal(await driver.start(dir), undefined);
    assert.equal(driver.reason, "");
    await writeFile(join(dir, "cua-driver"), "fixture");
    assert.equal(await driver.start(dir), undefined);
    assert.equal(driver.reason, "macOS asks you to allow this once, in System Settings.");
    granted = true;
    const failure = await driver.start(dir).then(() => assert.fail("start should reject"), error => error);
    // A driver that fails to start shows no reason sentence; its SDK reason stays for desktop.log only.
    assert.equal(driver.reason, "");
    assert.equal(driverModule.describeDriverError(failure), "X is not in the embedded safe allowlist");
    reject = false;
    assert.equal(JSON.parse(await driver.start(dir)).v, 2);
    assert.equal(driver.reason, undefined);
  } finally { await driver.stop(); await rm(dir, { recursive: true, force: true }); }
});

test("the driver notices an exit by checking its state, never by a pending waitForExit, and stop ends the checks", async () => {
  const dir = await mkdtemp(join(tmpdir(), "branch-mac-driver-exit-"));
  await writeFile(join(dir, "cua-driver"), "fixture");
  const lines = [];
  let state = 2;
  let checks = 0;
  const base = allowlistedSdk([]);
  const Host = base.EmbeddedCuaDriverHost;
  const sdk = { ...base, EmbeddedCuaDriverHost: class extends Host { state() { checks += 1; return state; } } };
  const tick = () => new Promise(resolve => setTimeout(resolve, 30));
  const driver = new MacComputerDriver(line => lines.push(line), () => sdk, () => "ai.branch.mac", undefined, undefined, 5);
  try {
    const endpoint = await driver.start(dir);
    assert.equal(JSON.parse(endpoint).v, 2);
    await tick();
    assert.ok(checks > 0, "the state is checked while the driver runs");
    assert.equal(await driver.start(dir), endpoint, "a ready driver keeps its endpoint");
    state = 0;
    await tick();
    assert.deepEqual(lines, ["Mac computer driver exited; restart Branch Agent to reconnect computer control"]);
    const after = checks;
    await tick();
    assert.equal(checks, after, "checks stop once the exit is seen");
    state = 2;
    await driver.start(dir);
    await driver.stop();
    const stopped = checks;
    await tick();
    assert.equal(checks, stopped, "stop ends the checks");
  } finally { await driver.stop(); await rm(dir, { recursive: true, force: true }); }
});
