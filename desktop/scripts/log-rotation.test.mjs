import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, truncate, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

if (!process.env.BRANCH_DESKTOP_TEST_DIST) throw new Error("Set BRANCH_DESKTOP_TEST_DIST to the strict-compiled current source output");
const dist = process.env.BRANCH_DESKTOP_TEST_DIST;
const { startGateway } = await import(pathToFileURL(join(dist, "gateway.js")));

// The default cap (100 MB) and the number of numbered archives kept.
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

test("the update helper's log is capped the same way, with five numbered archives", async () => {
  const { runHelper } = await import(pathToFileURL(join(dist, "desktop-update-helper.js")));
  const root = await mkdtemp(join(tmpdir(), "desktop-helper-log-"));
  try {
    // An exited process: the helper does not wait, finds nothing staged, logs one line and relaunches a no-op.
    const exited = spawn(process.execPath, ["-e", ""]);
    await new Promise(resolve => exited.on("exit", resolve));
    const log = join(root, "desktop.log");
    const plan = { journal: join(root, "desktop-update-pending.json"), versionFile: join(root, "desktop-update-version.txt"),
      rejectedFile: join(root, "desktop-update-rejected.json"), log, waitPid: exited.pid,
      relaunch: { command: process.execPath, args: ["-e", ""] }, confirmTimeoutMs: 1000 };
    // Six rounds: each starts with a full live log (sparse, so cheap), so each helper line rotates it.
    for (let round = 0; round < 6; round++) {
      await writeFile(log, "");
      await truncate(log, CAP + 1);
      assert.equal(await runHelper(plan), "none");
    }
    const names = (await readdir(root)).filter(name => /^desktop(\.\d+)?\.log$/.test(name)).sort();
    assert.deepEqual(names, ["desktop.1.log", "desktop.2.log", "desktop.3.log", "desktop.4.log", "desktop.5.log", "desktop.log"]);
    assert.ok(await sizeOf(log) < 1024 * 1024, "the live desktop.log holds only the newest line");
    assert.match(await readFile(log, "utf8"), /nothing staged or the app is still running/);
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});

test("a write error never throws out of the capped log, and the next write lands once the path is writable", async () => {
  const { appendCappedLog, cappedLogStream } = await import(pathToFileURL(join(dist, "log-rotation.js")));
  const root = await mkdtemp(join(tmpdir(), "desktop-log-error-"));
  try {
    const file = join(root, "gateway.log");
    // A directory where the live log should be makes every append fail (EISDIR), as a full disk does.
    await mkdir(file);
    assert.doesNotThrow(() => appendCappedLog(file, "lost line\n", 1000));
    const stream = cappedLogStream(file, 1000);
    await new Promise((resolve, reject) => stream.write("lost chunk\n", error => (error ? reject(error) : resolve())));
    await rm(file, { recursive: true });
    appendCappedLog(file, "kept line\n", 1000);
    assert.equal(await readFile(file, "utf8"), "kept line\n");
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});

test("a failed rotation keeps appending to the live log instead of throwing", async () => {
  const { appendCappedLog } = await import(pathToFileURL(join(dist, "log-rotation.js")));
  const root = await mkdtemp(join(tmpdir(), "desktop-log-rotfail-"));
  try {
    const file = join(root, "gateway.log");
    await writeFile(file, "x".repeat(900));
    // A directory in the oldest archive slot makes the rotation's rmSync throw, so the live file cannot roll.
    await mkdir(join(root, "gateway.5.log"));
    const line = `${"y".repeat(200)}\n`;
    assert.doesNotThrow(() => appendCappedLog(file, line, 1000));
    const text = await readFile(file, "utf8");
    assert.equal(text.length, 900 + line.length, "the line went into the live file");
    assert.ok(text.endsWith(line));
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});

test("a failed macOS Applications install is logged through the same cap", async () => {
  const { ensureMacApplicationsInstall } = await import(pathToFileURL(join(dist, "mac-applications.js")));
  const root = await mkdtemp(join(tmpdir(), "desktop-mac-log-"));
  const platform = Object.getOwnPropertyDescriptor(process, "platform");
  const testDist = process.env.BRANCH_DESKTOP_TEST_DIST;
  try {
    const log = join(root, "desktop.log");
    await writeFile(log, "");
    await truncate(log, CAP + 1);
    // The launch path only installs on darwin outside tests; a missing bundle makes the install fail at once.
    delete process.env.BRANCH_DESKTOP_TEST_DIST;
    Object.defineProperty(process, "platform", { value: "darwin" });
    await ensureMacApplicationsInstall(join(root, "missing.app"), log);
    Object.defineProperty(process, "platform", platform);
    process.env.BRANCH_DESKTOP_TEST_DIST = testDist;
    assert.equal(await sizeOf(join(root, "desktop.1.log")), CAP + 1, "the full log was rotated to an archive");
    assert.match(await readFile(log, "utf8"), /macOS Applications install failed/);
    assert.ok(await sizeOf(log) < 1024 * 1024, "the live log is small again");
  } finally {
    if (platform) Object.defineProperty(process, "platform", platform);
    process.env.BRANCH_DESKTOP_TEST_DIST = testDist;
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});
