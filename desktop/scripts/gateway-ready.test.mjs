import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createServer } from "node:http";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

if (!process.env.BRANCH_DESKTOP_TEST_DIST) throw new Error("Set BRANCH_DESKTOP_TEST_DIST to the strict-compiled current source output");
const { GatewayReadinessTimeoutError, killGatewayAndWait, waitForReady } = await import(pathToFileURL(join(process.env.BRANCH_DESKTOP_TEST_DIST, "gateway.js")));

test("a child that never emits exit cannot hold the update lock indefinitely", async () => {
  const child = Object.assign(new EventEmitter(), { pid: undefined, exitCode: null, signalCode: null });
  await assert.rejects(killGatewayAndWait(child, 30), /did not exit after SIGKILL/);
  assert.equal(child.listenerCount("exit"), 0);
});

async function fixture(handler, run) {
  const server = createServer(handler); await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const cfg = { gatewayPort: server.address().port };
  try { await run(cfg); }
  finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}

test("real HTTP readiness stall obeys the total startup deadline", async () => fixture(() => {}, async cfg => {
  const started = Date.now();
  await assert.rejects(waitForReady(cfg, { exitCode: null, signalCode: null }, 150), GatewayReadinessTimeoutError);
  assert.ok(Date.now() - started < 1000, "stalled individual fetch must not hang beyond startup budget");
}));

test("a live gateway that becomes ready after several probes is accepted", async () => {
  let probes = 0;
  await fixture((_req, res) => res.writeHead(++probes < 3 ? 503 : 200).end(), async cfg => {
    await waitForReady(cfg, { exitCode: null, signalCode: null }, 2000);
  });
  assert.equal(probes, 3);
});

test("real readyz200 response returns without waiting for a stalled response body", async () => fixture((_req, res) => {
  res.writeHead(200); res.flushHeaders();
}, async cfg => { await waitForReady(cfg, { exitCode: null, signalCode: null }, 1000); }));

test("child exit and signal termination fail readiness immediately", async () => fixture(() => {}, async cfg => {
  await assert.rejects(waitForReady(cfg, { exitCode: 7, signalCode: null }, 1000), /exited/);
  await assert.rejects(waitForReady(cfg, { exitCode: null, signalCode: "SIGTERM" }, 1000), /exited/);
}));

test("a prepared standby reports warm without replacing the live gateway pid", async () => {
  const { mkdtemp, readFile, rm, writeFile } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { startGateway, stopGateway, waitForGatewayStandby } = await import(pathToFileURL(join(process.env.BRANCH_DESKTOP_TEST_DIST, "gateway.js")));
  const { prepareNormalProfile } = await import(pathToFileURL(join(process.env.BRANCH_DESKTOP_TEST_DIST, "profile-migration.js")));
  const root = await mkdtemp(join(tmpdir(), "branch-gateway-standby-"));
  const cfg = { dataDir: root, nodePath: process.execPath, gatewayPort: 0 };
  let child;
  try {
    await writeFile(join(root, "branch.mjs"), 'process.send?.({type:"branch-desktop:standby-ready",pid:process.pid});setInterval(()=>{},1000);');
    await writeFile(join(root, "gateway.pid"), "12345");
    prepareNormalProfile(join(root, "home"));
    child = startGateway(cfg, root, "isolated-fixture-token", true);
    await waitForGatewayStandby(child, 3000);
    assert.equal(await readFile(join(root, "gateway.pid"), "utf8"), "12345");
  } finally {
    if (child) stopGateway(child);
    // Windows can hold a just-killed child's working directory for a moment.
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});

async function standbyFixture(script, run) {
  const { mkdtemp, rm, writeFile } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const gateway = await import(pathToFileURL(join(process.env.BRANCH_DESKTOP_TEST_DIST, "gateway.js")));
  const { prepareNormalProfile } = await import(pathToFileURL(join(process.env.BRANCH_DESKTOP_TEST_DIST, "profile-migration.js")));
  const root = await mkdtemp(join(tmpdir(), "branch-gateway-standby-port-"));
  const children = [];
  const exited = child => child.exitCode !== null || child.signalCode !== null;
  try {
    await writeFile(join(root, "branch.mjs"), script);
    prepareNormalProfile(join(root, "home"));
    await run(root, gateway, child => { children.push(child); return child; });
  } finally {
    for (const child of children) {
      gateway.stopGateway(child);
      if (!exited(child)) await new Promise(resolve => child.once("exit", resolve));
    }
    // Windows can hold a just-killed child's working directory for a moment.
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
}

test("a standby comes up on its own loopback port while the live engine still holds the configured one", async () => {
  // As the real engine: report warm first, then listen once on exactly the port it was given (no EADDRINUSE retry).
  const script = `import fs from "node:fs";import http from "node:http";
const port=Number(process.argv.at(-1));
fs.writeFileSync("launch.json",JSON.stringify({port,env:Number(process.env.BRANCH_GATEWAY_PORT),token:process.env.BRANCH_GATEWAY_TOKEN}));
process.send({type:"branch-desktop:standby-ready",pid:process.pid});
http.createServer((q,r)=>r.writeHead(q.url==="/readyz"?200:404).end()).listen(port,"127.0.0.1");`;
  await fixture((_req, res) => res.writeHead(200).end(), live => standbyFixture(script, async (root, gateway, track) => {
    const { readFile } = await import("node:fs/promises");
    const cfg = { dataDir: root, nodePath: process.execPath, gatewayPort: live.gatewayPort };
    const prepared = await gateway.prepareStandbyGateway(cfg, root, "shared-token", 5000);
    track(prepared.child);
    assert.notEqual(prepared.port, live.gatewayPort, "the standby was pointed at the live engine's port");
    await gateway.waitForReady({ ...cfg, gatewayPort: prepared.port }, prepared.child, 5000);
    assert.deepEqual(JSON.parse(await readFile(join(root, "launch.json"), "utf8")),
      { port: prepared.port, env: prepared.port, token: "shared-token" });
    assert.equal(cfg.gatewayPort, live.gatewayPort, "the configured port changed");
    assert.equal((await fetch(`http://127.0.0.1:${live.gatewayPort}/readyz`)).status, 200, "the live engine stopped serving");
  }));
});

test("a standby that never warms is stopped at its deadline and leaves no process behind", async () => standbyFixture(
  'import fs from "node:fs";fs.writeFileSync("standby.pid",String(process.pid));setInterval(()=>{},1000);',
  async (root, gateway) => {
    const { readFile } = await import("node:fs/promises");
    const cfg = { dataDir: root, nodePath: process.execPath, gatewayPort: 0 };
    const started = Date.now();
    await assert.rejects(gateway.prepareStandbyGateway(cfg, root, "shared-token", 2000), /did not warm in time/);
    assert.ok(Date.now() - started < 5000, "the warm-up wait was not bounded");
    const pid = Number(await readFile(join(root, "standby.pid"), "utf8"));
    const alive = () => { try { process.kill(pid, 0); return true; } catch { return false; } };
    for (const end = Date.now() + 5000; alive() && Date.now() < end;) await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal(alive(), false, "the timed-out standby was left running");
  }));

test("the owned desktop gateway starts configured channels even when the launcher environment skips them", async () => {
  const { mkdtemp, readFile, rm, writeFile } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { startGateway, stopGateway } = await import(pathToFileURL(join(process.env.BRANCH_DESKTOP_TEST_DIST, "gateway.js")));
  const root = await mkdtemp(join(tmpdir(), "branch-gateway-channels-"));
  const cfg = { dataDir: root, nodePath: process.execPath, gatewayPort: 0 };
  const prior = process.env.BRANCH_SKIP_CHANNELS;
  let child;
  try {
    await writeFile(join(root, "branch.mjs"), 'import {writeFileSync} from "node:fs"; writeFileSync("channel-env.txt", process.env.BRANCH_SKIP_CHANNELS ?? "<unset>"); setInterval(()=>{},1000);');
    process.env.BRANCH_SKIP_CHANNELS = "1";
    child = startGateway(cfg, root, "isolated-fixture-token");
    const deadline = Date.now() + 3000;
    let value;
    while (value === undefined && Date.now() < deadline) {
      try { value = await readFile(join(root, "channel-env.txt"), "utf8"); } catch {}
      if (value === undefined) await new Promise(resolve => setTimeout(resolve, 25));
    }
    assert.equal(value, "<unset>");
  } finally {
    if (child) stopGateway(child);
    if (prior === undefined) delete process.env.BRANCH_SKIP_CHANNELS;
    else process.env.BRANCH_SKIP_CHANNELS = prior;
    // Windows can hold a just-killed child's working directory for a moment.
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});

test("owned gateway shutdown also reaps its spawned child", async () => {
  const { mkdir, mkdtemp, readFile, rm, writeFile } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { startGateway, stopGateway } = await import(pathToFileURL(join(process.env.BRANCH_DESKTOP_TEST_DIST, "gateway.js")));
  const root = await mkdtemp(join(tmpdir(), "branch-gateway-tree-"));
  const cfg = { dataDir: root, nodePath: process.execPath, gatewayPort: 0 };
  const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
  let child; let descendant;
  try {
    await writeFile(join(root, "branch.mjs"), 'import {spawn} from "node:child_process"; import {writeFileSync} from "node:fs"; const child=spawn(process.execPath,["-e","setInterval(()=>{},1000)"],{windowsHide:true}); writeFileSync("descendant.pid",String(child.pid)); setInterval(()=>{},1000);');
    child = startGateway(cfg, root, "isolated-fixture-token");
    const deadline = Date.now() + 3000;
    while (!descendant && Date.now() < deadline) {
      try { descendant = Number(await readFile(join(root, "descendant.pid"), "utf8")); } catch {}
      if (!descendant) await new Promise(resolve => setTimeout(resolve, 25));
    }
    assert.ok(descendant, "owned gateway must create its descendant");
    stopGateway(child);
    while ((alive(child.pid) || alive(descendant)) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 25));
    assert.equal(alive(child.pid), false, "owned gateway survived shutdown");
    assert.equal(alive(descendant), false, "owned gateway descendant survived shutdown");
  } finally {
    if (child) stopGateway(child);
    if (descendant && alive(descendant)) process.kill(descendant, "SIGTERM");
    // Windows can hold a just-killed child's working directory for a moment.
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});
