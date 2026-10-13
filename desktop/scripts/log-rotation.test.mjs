import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

if (!process.env.BRANCH_DESKTOP_TEST_DIST) throw new Error("Set BRANCH_DESKTOP_TEST_DIST to the strict-compiled current source output");
const dist = process.env.BRANCH_DESKTOP_TEST_DIST;
const { startGateway } = await import(pathToFileURL(join(dist, "gateway.js")));

// The upstream default for logging.maxFileBytes (100 MB), and the number of numbered archives upstream keeps.
const CAP = 100 * 1024 * 1024;
const ARCHIVES = 5;
const ENGINE_BYTES = CAP + 1024 * 1024;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function eventually(predicate, ms = 30_000) {
  for (const end = Date.now() + ms; !await predicate(); await pause(50)) if (Date.now() > end) throw new Error("Fixture deadline");
}
const sizeOf = async file => (await stat(file)).size;
const isGatewayLog = name => /^gateway(\.\d+)?\.log$/.test(name);

test("the gateway log stays under its cap when the engine writes past it, and keeps a few numbered archives", async () => {
  const root = await mkdtemp(join(tmpdir(), "desktop-log-rotation-"));
  try {
    const engineDir = join(root, "engine");
    const dataDir = join(root, "data");
    await mkdir(join(engineDir, "docs", "reference", "templates"), { recursive: true });
    await mkdir(dataDir, { recursive: true });
    // A stand-in engine: writes ENGINE_BYTES of output to stdout in 64 KiB chunks, then exits.
    await writeFile(join(engineDir, "branch.mjs"), [
      `const chunk = "x".repeat(65535) + "\\n";`,
      `let left = ${ENGINE_BYTES};`,
      `const pump = () => { while (left > 0) { const size = Math.min(chunk.length, left); left -= size; if (!process.stdout.write(chunk.slice(0, size))) { process.stdout.once("drain", pump); return; } } };`,
      `pump();`,
    ].join("\n"));
    const cfg = { dataDir, engineDir, nodePath: process.execPath, gatewayPort: 1 };
    const child = startGateway(cfg, engineDir, "test-token");
    await new Promise((resolve, reject) => { child.once("exit", resolve); child.once("error", reject); });
    const total = async () => {
      let bytes = 0;
      for (const name of (await readdir(dataDir)).filter(isGatewayLog)) bytes += await sizeOf(join(dataDir, name));
      return bytes;
    };
    await eventually(async () => await total() === ENGINE_BYTES, 60_000);
    assert.ok(await sizeOf(join(dataDir, "gateway.log")) <= CAP, "the live gateway.log is over its cap");
    const rolled = (await readdir(dataDir)).filter(name => isGatewayLog(name) && name !== "gateway.log");
    assert.ok(rolled.length >= 1 && rolled.length <= ARCHIVES, `expected 1 to ${ARCHIVES} archives, found ${rolled.length}`);
    assert.equal(await total(), ENGINE_BYTES, "rotation loses no output");
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});

test("a capped log rotates at its cap and keeps exactly five numbered archives", async () => {
  const { appendCappedLog } = await import(pathToFileURL(join(dist, "log-rotation.js")));
  const root = await mkdtemp(join(tmpdir(), "desktop-log-cap-"));
  try {
    const file = join(root, "gateway.log");
    const CAP_BYTES = 1000;
    for (let index = 0; index < 1000; index++) {
      appendCappedLog(file, `${String(index).padStart(4, "0")} ${"y".repeat(99)}\n`, CAP_BYTES);
    }
    const names = (await readdir(root)).filter(isGatewayLog).sort();
    assert.deepEqual(names, ["gateway.1.log", "gateway.2.log", "gateway.3.log", "gateway.4.log", "gateway.5.log", "gateway.log"]);
    for (const name of names) {
      const text = await readFile(join(root, name), "utf8");
      assert.ok(Buffer.byteLength(text) <= CAP_BYTES, `${name} is over the cap`);
      assert.ok(text.endsWith("\n") && text.split("\n").length - 1 > 0, `${name} ends mid-record`);
    }
    assert.match(await readFile(file, "utf8"), /^0999 /m, "the newest record is in the live file");
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});
