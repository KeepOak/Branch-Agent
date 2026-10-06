import assert from "node:assert/strict";
import { createServer } from "node:http";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

if (!process.env.BRANCH_DESKTOP_TEST_DIST) throw new Error("Set BRANCH_DESKTOP_TEST_DIST to the strict-compiled current source output");
const { GatewayReadinessTimeoutError, waitForReady } = await import(pathToFileURL(join(process.env.BRANCH_DESKTOP_TEST_DIST, "gateway.js")));

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
    await rm(root, { recursive: true, force: true });
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
    await rm(root, { recursive: true, force: true });
  }
});
