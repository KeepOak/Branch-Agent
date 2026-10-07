import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

if (!process.env.BRANCH_DESKTOP_TEST_DIST) throw new Error("Set BRANCH_DESKTOP_TEST_DIST to the strict-compiled current source output");
const dist = process.env.BRANCH_DESKTOP_TEST_DIST;
const desktopUpdate = await import(pathToFileURL(join(dist, "desktop-update.js")));
const {
  BUSY_RETRY_ATTEMPTS,
  BUSY_RETRY_DELAY_MS,
  listFolderProcesses,
  move,
  restartFolderProcesses,
  runHelper,
  stopFolderProcesses,
} = await import(pathToFileURL(join(dist, "desktop-update-helper.js")));

const pause = (ms) => new Promise(resolve => setTimeout(resolve, ms));
async function eventually(predicate, ms = 15_000) {
  for (const end = Date.now() + ms; !await predicate(); await pause(50)) if (Date.now() > end) throw new Error("Fixture deadline");
}
function alive(pid) {
  try { process.kill(pid, 0); return true; } catch (error) { return error.code === "EPERM"; }
}
function killPid(pid) {
  if (pid === undefined) return;
  try {
    if (process.platform === "win32") execFileSync("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
    else process.kill(pid, "SIGKILL");
  } catch { /* already gone */ }
}
const nodeName = process.platform === "win32" ? "node.exe" : "node";

async function installNode(folder) {
  const dest = join(folder, "resources", "node", nodeName);
  await mkdir(dirname(dest), { recursive: true });
  await copyFile(process.execPath, dest);
  if (process.platform !== "win32") await chmod(dest, 0o755);
  return dest;
}

async function fixture(run) {
  const parent = join(tmpdir(), "Codex-session-files");
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(join(parent, "desktop-helper-"));
  const appDir = join(root, "installed");
  const staged = join(root, "staged");
  const dataDir = join(root, "data");
  await mkdir(join(appDir, "resources"), { recursive: true });
  await mkdir(join(staged, "resources"), { recursive: true });
  await mkdir(dataDir, { recursive: true });
  await writeFile(join(appDir, "Branch Agent.exe"), "old runtime");
  await writeFile(join(appDir, "resources", "app.asar"), "old desktop asar");
  await writeFile(join(staged, "Branch Agent.exe"), "new runtime");
  await writeFile(join(staged, "resources", "app.asar.staged"), "new desktop asar");
  const journal = { version: "0.4.5", sha256: "abc", kind: "runtime", staged, target: appDir, phase: "staged" };
  await writeFile(join(dataDir, "desktop-update-pending.json"), JSON.stringify(journal));
  const exited = spawn(process.execPath, ["-e", ""]);
  await new Promise(resolve => exited.on("exit", resolve));
  const confirm = join(root, "confirm.cjs");
  await writeFile(confirm, `require(${JSON.stringify(join(dist, "desktop-update.js"))}).confirmDesktopUpdate(${JSON.stringify({ dataDir })});`);
  const plan = {
    journal: join(dataDir, "desktop-update-pending.json"),
    versionFile: join(dataDir, "desktop-update-version.txt"),
    rejectedFile: join(dataDir, "desktop-update-rejected.json"),
    log: join(dataDir, "desktop.log"),
    waitPid: exited.pid,
    relaunch: { command: process.execPath, args: [confirm] },
    confirmTimeoutMs: 15_000,
  };
  const leftover = [];
  try { await run({ root, appDir, staged, dataDir, plan, leftover }); }
  finally {
    for (const pid of leftover) killPid(pid);
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
}

test("EBUSY retries are bounded and then throw, without sleeping forever", async () => {
  assert.equal(BUSY_RETRY_ATTEMPTS, 120, "production keeps the original 120-attempt budget");
  assert.equal(BUSY_RETRY_DELAY_MS, 250);
  let attempts = 0;
  const sleeps = [];
  const busy = Object.assign(new Error("EBUSY: resource busy, rename"), { code: "EBUSY" });
  await assert.rejects(move("from", "to", {
    busyAttempts: 3,
    rename: async () => { attempts += 1; throw busy; },
    sleep: async (ms) => { sleeps.push(ms); },
    listFolderProcesses: async () => [{ pid: 4242, name: "node.exe", executable: "node.exe", args: ["branch.mjs", "node", "run"] }],
  }), { code: "EBUSY" });
  assert.equal(attempts, 4, "the first try plus 3 retries, then fail");
  assert.deepEqual(sleeps, [250, 250, 250]);
});

test("a persistent EBUSY leaves the old app folder in place and names the holder", () => fixture(async ({ appDir, dataDir, plan }) => {
  const busy = Object.assign(new Error("EBUSY: resource busy, rename"), { code: "EBUSY" });
  let attempts = 0;
  assert.equal(await runHelper(plan, {
    busyAttempts: 3,
    rename: async () => { attempts += 1; throw busy; },
    sleep: async () => {},
    listFolderProcesses: async () => [{ pid: 4242, name: "node.exe", executable: join(appDir, "resources", "node", nodeName), args: ["branch.mjs", "node", "run"] }],
  }), "kept");
  assert.equal(attempts, 4);
  assert.equal(await readFile(join(appDir, "Branch Agent.exe"), "utf8"), "old runtime");
  assert.equal(await readFile(join(appDir, "resources", "app.asar"), "utf8"), "old desktop asar");
  const journal = await desktopUpdate.readDesktopJournal({ dataDir });
  assert.equal(journal.phase, "staged");
  assert.ok(journal.heldUntil > Date.now());
  const log = await readFile(join(dataDir, "desktop.log"), "utf8");
  assert.match(log, /EBUSY/);
  assert.match(log, /node\.exe pid 4242 \(node host\)/);
  assert.match(log, /kept staged for the next start/);
}));

test("a runtime swap stops the install-folder node host before the rename and restarts it after", () => fixture(async ({ root, appDir, staged, dataDir, plan, leftover }) => {
  const oldNode = await installNode(appDir);
  await installNode(staged);
  const host = join(root, "host.cjs");
  await writeFile(host, "setInterval(() => {}, 1000);\n");
  const child = spawn(oldNode, [host, "run"], { windowsHide: true, stdio: "ignore", detached: true });
  leftover.push(child.pid);
  child.unref();
  await eventually(async () => (await listFolderProcesses(appDir)).some(proc => proc.pid === child.pid));
  assert.equal(await runHelper(plan), "applied");
  assert.equal(await readFile(join(appDir, "Branch Agent.exe"), "utf8"), "new runtime");
  assert.equal(await readFile(join(appDir, "resources", "app.asar"), "utf8"), "new desktop asar");
  await eventually(() => !alive(child.pid));
  const restarted = await listFolderProcesses(appDir);
  assert.ok(restarted.some(proc => proc.pid !== child.pid && /^(node|node\.exe)$/i.test(proc.name)), "the node host is restarted from the new install folder");
  for (const proc of restarted) leftover.push(proc.pid);
  const log = await readFile(join(dataDir, "desktop.log"), "utf8");
  assert.match(log, /stopping .+ pid .+ so the install folder can be swapped/);
  assert.match(log, /restarted .+ from the new install folder/);
}));

test("stopFolderProcesses waits for the host to exit and restartFolderProcesses respawns it", async () => {
  const parent = join(tmpdir(), "Codex-session-files");
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(join(parent, "desktop-helper-stop-"));
  const leftover = [];
  try {
    const nodePath = await installNode(root);
    const host = join(root, "host.cjs");
    await writeFile(host, "setInterval(() => {}, 1000);\n");
    const child = spawn(nodePath, [host, "run"], { windowsHide: true, stdio: "ignore", detached: true });
    leftover.push(child.pid);
    child.unref();
    await eventually(async () => (await listFolderProcesses(root)).some(proc => proc.pid === child.pid));
    const lines = [];
    const stopped = await stopFolderProcesses(root, line => lines.push(line));
    assert.ok(stopped.some(proc => proc.pid === child.pid));
    await eventually(() => !alive(child.pid));
    assert.match(lines.join("\n"), /stopping .+ pid /);
    restartFolderProcesses(stopped, line => lines.push(line));
    await eventually(async () => (await listFolderProcesses(root)).some(proc => proc.pid !== child.pid));
    for (const proc of await listFolderProcesses(root)) leftover.push(proc.pid);
    assert.match(lines.join("\n"), /restarted /);
  } finally {
    for (const pid of leftover) killPid(pid);
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});
