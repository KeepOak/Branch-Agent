import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createConnection, createServer } from "node:net";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import * as driverModule from "../dist/mac-computer-driver.js";
const { MacComputerDriver, describeDriverError, macScreenControlEnabled } = driverModule;

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
  // The daemon's private socket speaks the driver's own protocol, never MCP: anything piped straight to it fails.
  let daemonConnections = 0;
  const backend = createServer(socket => { daemonConnections += 1; socket.end('{"ok":false,"error":"Unknown method: initialize","exit_code":65}\n'); });
  await new Promise((resolve, reject) => { backend.once("error", reject); backend.listen(socketPath, resolve); });
  await writeFile(binary, "fixture");
  const events = [];
  const proxies = [];
  // Stands in for `cua-driver mcp --embedded --socket <daemon>`: an echoing MCP proxy.
  const spawnProxy = (command, args, options) => {
    proxies.push({ command, args, env: options.env });
    return spawn(process.execPath, ["-e", "process.stdin.pipe(process.stdout)"], { ...options, env: process.env });
  };
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
  const driver = new MacComputerDriver(() => {}, sdk, () => "ai.branch.mac", 2_000, spawnProxy);
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
    // Private #1103 item 5: the engine's MCP goes through the driver's MCP proxy, never raw into the daemon socket.
    assert.equal(daemonConnections, 0);
    assert.equal(proxies.length, 1);
    assert.equal(proxies[0].command, binary);
    assert.deepEqual(proxies[0].args, ["mcp", "--embedded", "--socket", socketPath]);
    assert.equal(proxies[0].env.CUA_DRIVER_RS_TELEMETRY_ENABLED, "false");
    assert.equal(proxies[0].env.CUA_DRIVER_RS_UPDATE_CHECK, "false");
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

test("the MCP proxy's environment drops driver overrides and the broker's own variables", () => {
  const env = driverModule.mcpProxyEnvironment({ PATH: "/bin", HOME: "/h", CUA_DRIVER_SOCKET: "x", CUA_TELEMETRY_ENABLED: "true", BRANCH_CUA_BROKER_SECRET: "s" });
  assert.deepEqual(env, { PATH: "/bin", HOME: "/h", CUA_DRIVER_RS_TELEMETRY_ENABLED: "false", CUA_DRIVER_RS_UPDATE_CHECK: "false" });
  assert.deepEqual(driverModule.mcpProxyArgs("/tmp/d.sock"), ["mcp", "--embedded", "--socket", "/tmp/d.sock"]);
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
  const driver = new MacComputerDriver(line => lines.push(line), () => sdk, () => "ai.branch.mac", 5);
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
