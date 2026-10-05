import assert from "node:assert/strict";
import { createServer } from "node:http";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

if (!process.env.BRANCH_DESKTOP_TEST_DIST) throw new Error("Set BRANCH_DESKTOP_TEST_DIST to the strict-compiled current source output");
const { GatewayReadinessError, waitForReady } = await import(pathToFileURL(join(process.env.BRANCH_DESKTOP_TEST_DIST, "gateway.js")));

async function fixture(handler, run) {
  const server = createServer(handler); await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const cfg = { gatewayPort: server.address().port };
  try { await run(cfg); }
  finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}

test("real HTTP readiness stall obeys the total startup deadline", async () => fixture(() => {}, async cfg => {
  const started = Date.now();
  await assert.rejects(waitForReady(cfg, { exitCode: null, signalCode: null }, 150), error =>
    error instanceof GatewayReadinessError && error.reason === "timeout");
  assert.ok(Date.now() - started < 1000, "stalled individual fetch must not hang beyond startup budget");
}));

test("a responding listener may become ready after the 180-second gate", async () => {
  let probes = 0;
  await fixture((_req, res) => res.writeHead(++probes < 8 ? 503 : 200).end(), async cfg => {
    await waitForReady(cfg, { exitCode: null, signalCode: null }, 30, { maxWaitMs: 500, pollMs: 10 });
  });
  assert.equal(probes, 8);
});

test("continuing startup phases keep an unbound child eligible beyond the soft deadline", async () => {
  const reservation = createServer();
  await new Promise(resolve => reservation.listen(0, "127.0.0.1", resolve));
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  const child = { exitCode: null, signalCode: null, startupPhaseAt: Date.now() };
  const phases = setInterval(() => { child.startupPhaseAt = Date.now(); }, 20);
  const listener = createServer((_req, res) => res.writeHead(200).end());
  const later = setTimeout(() => listener.listen(port, "127.0.0.1"), 100);
  try {
    await waitForReady({ gatewayPort: port }, child, 40, { maxWaitMs: 500, phaseQuietMs: 60, pollMs: 10 });
  } finally {
    clearInterval(phases); clearTimeout(later);
    if (listener.listening) await new Promise(resolve => listener.close(resolve));
  }
});

test("real readyz200 response returns without waiting for a stalled response body", async () => fixture((_req, res) => {
  res.writeHead(200); res.flushHeaders();
}, async cfg => { await waitForReady(cfg, { exitCode: null, signalCode: null }, 1000); }));

test("child exit and signal termination fail readiness immediately", async () => fixture(() => {}, async cfg => {
  await assert.rejects(waitForReady(cfg, { exitCode: 7, signalCode: null }, 1000), error =>
    error instanceof GatewayReadinessError && error.reason === "exit");
  await assert.rejects(waitForReady(cfg, { exitCode: null, signalCode: "SIGTERM" }, 1000), error =>
    error instanceof GatewayReadinessError && error.reason === "exit");
}));

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
