// The branch command: a pointer-backed launcher that survives updates and app moves.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

const dist = process.env.BRANCH_DESKTOP_TEST_DIST;
if (!dist) throw new Error("Set BRANCH_DESKTOP_TEST_DIST to current strict-compiled source");
const {
  CLI_LAUNCHER_MARKER, CLI_LAUNCHER_REPAIR_MESSAGE, activeEngineDir, cliEntryPath, cliPointerPath,
  cliTargetExists, ensureCliLauncher, isOwnedCliLauncher, posixCliLauncher, readCliPointer, writeCliPointer,
} = await import(pathToFileURL(join(dist, "cli-launcher.js")));
const { branchShim, branchShShim } = await import(pathToFileURL(join(dist, "desktop-controls.js")));

function runProcess(command, args, options = {}) {
  const child = spawn(command, args, { windowsHide: true, ...options });
  let stdout = "", stderr = "";
  child.stdout?.on("data", (chunk) => { stdout += chunk; });
  child.stderr?.on("data", (chunk) => { stderr += chunk; });
  const done = new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code, signal) => resolve({ code, signal, stdout, stderr }));
  });
  return { child, done };
}

async function stopProcess(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => child.once("close", resolve)),
    new Promise((resolve) => setTimeout(resolve, 2000)),
  ]);
  if (child.exitCode === null && child.signalCode === null) {
    try { child.kill("SIGKILL"); } catch { /* already gone */ }
    await new Promise((resolve) => child.once("close", resolve));
  }
}

async function fixture(run) {
  const parent = join(tmpdir(), "claude-session-files", "cli-launcher");
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(join(parent, "fixture-"));
  const children = [];
  const spawnTracked = (command, args, options) => {
    const started = runProcess(command, args, options);
    children.push(started.child);
    return started;
  };
  try { await run({ root, spawnTracked }); }
  finally {
    await Promise.all(children.map(stopProcess));
    await rm(root, { recursive: true, force: true });
  }
}

function activeOf(root, engineName, extra = {}) {
  return {
    dataDir: join(root, "data"),
    nodePath: process.execPath,
    engineDir: join(root, engineName),
    gatewayPort: 19111,
    ...extra,
  };
}

async function writeEngine(dir, token) {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "branch.mjs"), `console.log(${JSON.stringify(token)});\n`);
  await mkdir(join(dir, "dist"), { recursive: true });
  await writeFile(join(dir, "dist", "build-info.json"), '{"version":"fixture"}\n');
}

async function writeLegacyLauncher(file, appPath) {
  await mkdir(join(file, ".."), { recursive: true });
  await writeFile(file, [
    "#!/bin/sh",
    `exec /usr/bin/env node ${JSON.stringify(`${appPath}/Contents/Resources/app/dist/cli.js`)} "$@"`,
    "",
  ].join("\n"));
}

test("the launcher target exists after an update is applied", async () => fixture(async ({ root, spawnTracked }) => {
  const previous = join(root, "updates", "release-0.4.3-111aaa", "engine");
  const next = join(root, "updates", "release-0.4.4-222bbb", "engine");
  const dataDir = join(root, "data");
  const launcher = join(root, "bin", "branch");
  const oldApp = "/Volumes/OtherDrive/Branch Agent.app";
  await writeEngine(next, "updated-cli");
  await mkdir(dataDir, { recursive: true });
  await writeFile(join(dataDir, "engine-current.txt"), `${next}\n`);
  await writeFile(join(dataDir, "engine-running.txt"), `${next}\n`);
  await writeLegacyLauncher(launcher, oldApp);
  const active = { dataDir, nodePath: process.execPath, engineDir: next, gatewayPort: 19111 };
  const result = ensureCliLauncher({ launcherPath: launcher, active, create: false });
  assert.equal(result.action, "wrote");
  assert.equal(activeEngineDir(dataDir, previous), next);
  assert.equal(cliTargetExists(active), true);
  assert.ok((await readFile(cliPointerPath(dataDir), "utf8")).includes(`engineDir=${next}`));
  assert.ok((await readFile(launcher, "utf8")).includes(CLI_LAUNCHER_MARKER));
  assert.ok((await readFile(launcher, "utf8")).includes(cliPointerPath(dataDir)));
  if (process.platform === "win32") return;
  const ran = spawnTracked("sh", [launcher]);
  const finished = await ran.done;
  assert.equal(finished.code, 0, finished.stderr);
  assert.equal(finished.stdout.trim(), "updated-cli");
}));

test("a moved app path gets rewritten", async () => fixture(async ({ root }) => {
  const dataDir = join(root, "data");
  const launcher = join(root, "bin", "branch");
  const engine = join(root, "updates", "release-0.4.4-222bbb", "engine");
  const oldNode = "/Volumes/OtherDrive/Branch Agent.app/Contents/Resources/node/node";
  await writeEngine(engine, "moved");
  await mkdir(dataDir, { recursive: true });
  await mkdir(join(root, "bin"), { recursive: true });
  await writeFile(join(dataDir, "engine-running.txt"), `${engine}\n`);
  writeCliPointer({ dataDir, nodePath: oldNode, engineDir: engine, gatewayPort: 19111 });
  await writeFile(launcher, posixCliLauncher(cliPointerPath(dataDir)));
  assert.ok((await readFile(launcher, "utf8")).includes(cliPointerPath(dataDir)));
  const stale = readCliPointer(cliPointerPath(dataDir));
  assert.equal(stale?.nodePath, oldNode);
  const active = { dataDir, nodePath: process.execPath, engineDir: engine, gatewayPort: 19111 };
  assert.equal(ensureCliLauncher({ launcherPath: launcher, active, create: false }).action, "wrote");
  const pointer = readCliPointer(cliPointerPath(dataDir));
  assert.equal(pointer?.nodePath, process.execPath);
  assert.equal(pointer?.dataDir, dataDir);
  assert.equal(cliTargetExists(active), true);
}));

test("a wrong data folder gets corrected", async () => fixture(async ({ root }) => {
  const oldData = join(root, "old-data");
  const newData = join(root, "new-data");
  const engine = join(root, "updates", "release-0.4.4-222bbb", "engine");
  const launcher = join(root, "bin", "branch");
  await writeEngine(engine, "data-folder");
  await mkdir(oldData, { recursive: true });
  await mkdir(newData, { recursive: true });
  await mkdir(join(root, "bin"), { recursive: true });
  await writeFile(join(newData, "engine-running.txt"), `${engine}\n`);
  writeCliPointer({ dataDir: oldData, nodePath: process.execPath, engineDir: "/Volumes/OtherDrive/old-engine", gatewayPort: 19031 });
  await writeFile(launcher, posixCliLauncher(cliPointerPath(oldData)));
  assert.ok((await readFile(launcher, "utf8")).includes(cliPointerPath(oldData)));
  const active = { dataDir: newData, nodePath: process.execPath, engineDir: engine, gatewayPort: 19111 };
  assert.equal(ensureCliLauncher({ launcherPath: launcher, active, create: false }).action, "wrote");
  const rewritten = await readFile(launcher, "utf8");
  assert.ok(rewritten.includes(cliPointerPath(newData)));
  assert.ok(!rewritten.includes(cliPointerPath(oldData)));
  const pointer = readCliPointer(cliPointerPath(newData));
  assert.equal(pointer?.dataDir, newData);
  assert.equal(pointer?.engineDir, engine);
  assert.equal(cliTargetExists(active), true);
}));

test("a foreign branch file is left alone", async () => fixture(async ({ root }) => {
  const launcher = join(root, "bin", "branch");
  const foreign = "#!/bin/sh\necho foreign-cli\n";
  await mkdir(join(root, "bin"), { recursive: true });
  await writeFile(launcher, foreign);
  const active = activeOf(root, "engine");
  await writeEngine(active.engineDir, "ignored");
  await mkdir(active.dataDir, { recursive: true });
  assert.equal(isOwnedCliLauncher(foreign), false);
  assert.equal(ensureCliLauncher({ launcherPath: launcher, active, create: true }).action, "skipped");
  assert.equal(await readFile(launcher, "utf8"), foreign);
}));

test("a missing target tells the owner to open Branch once", async () => fixture(async ({ root, spawnTracked }) => {
  const active = activeOf(root, "engine");
  const launcher = join(root, "bin", "branch");
  await mkdir(active.dataDir, { recursive: true });
  await mkdir(active.engineDir, { recursive: true });
  assert.equal(ensureCliLauncher({ launcherPath: launcher, active, create: true }).action, "wrote");
  if (process.platform === "win32") {
    const cmd = join(root, "bin", "branch.cmd");
    await writeFile(cmd, branchShim(active));
    const ran = spawnTracked(cmd, [], { shell: true });
    const finished = await ran.done;
    assert.notEqual(finished.code, 0);
    assert.match(`${finished.stdout}\n${finished.stderr}`, new RegExp(CLI_LAUNCHER_REPAIR_MESSAGE));
    return;
  }
  const ran = spawnTracked("sh", [launcher]);
  const finished = await ran.done;
  assert.notEqual(finished.code, 0);
  assert.equal(finished.stderr.trim(), CLI_LAUNCHER_REPAIR_MESSAGE);
}));

test("refresh never creates a missing launcher and never overwrites an unrelated file", async () => fixture(async ({ root }) => {
  const launcher = join(root, "bin", "branch");
  const active = activeOf(root, "engine");
  await writeEngine(active.engineDir, "fresh");
  await mkdir(active.dataDir, { recursive: true });
  assert.equal(ensureCliLauncher({ launcherPath: launcher, active, create: false }).action, "pointer");
  await assert.rejects(readFile(launcher, "utf8"), /ENOENT/);
  assert.ok(readCliPointer(cliPointerPath(active.dataDir)));
}));

test("legacy app-bundle launchers and existing desktop shims are treated as owned", () => {
  assert.equal(isOwnedCliLauncher("#!/bin/sh\nexec node '/Volumes/OtherDrive/Branch Agent.app/Contents/Resources/app/dist/cli.js'\n"), true);
  assert.equal(isOwnedCliLauncher(branchShim({
    dataDir: "C:\\Data", engineDir: "C:\\App\\engine", nodePath: "C:\\App\\node.exe", gatewayPort: 19031,
  }).replace("@rem Created by Branch Agent\r\n", "")), true);
  assert.equal(isOwnedCliLauncher("#!/bin/sh\nexec node /usr/local/bin/other\n"), false);
});

test("Windows shims keep the live engine files and refuse a missing target", () => {
  const shim = branchShim({ dataDir: "C:\\Data", engineDir: "C:\\App\\engine", nodePath: "C:\\App\\node.exe", gatewayPort: 19031 });
  assert.ok(shim.includes("@rem Created by Branch Agent"));
  assert.ok(shim.includes('set /p ENGINE=<"%BRANCH_DATA%\\engine-current.txt"'));
  assert.ok(shim.indexOf("engine-current.txt") < shim.indexOf('set /p ENGINE=<"%BRANCH_DATA%\\engine-running.txt"'));
  assert.ok(shim.includes(CLI_LAUNCHER_REPAIR_MESSAGE));
  assert.ok(shim.includes('if not exist "%ENGINE%\\branch.mjs"'));
  const sh = branchShShim({ dataDir: "C:\\Data's", engineDir: "C:\\App\\engine", nodePath: "C:\\App\\node.exe", gatewayPort: 19031 });
  assert.ok(sh.startsWith(`#!/bin/sh\n${CLI_LAUNCHER_MARKER}\n`));
  assert.ok(sh.includes(CLI_LAUNCHER_REPAIR_MESSAGE));
  assert.ok(sh.includes(`exec 'C:/App/node.exe' "$engine/branch.mjs" "$@"`));
});

test("cli entry stays the per-build engine file, not an app.asar cli.js", () => {
  const engine = "/tmp/branch-data/updates/release-0.4.4-222bbb/engine";
  assert.equal(cliEntryPath(engine), join(engine, "branch.mjs"));
  assert.doesNotMatch(cliEntryPath(engine), /dist\/cli\.js/);
  assert.doesNotMatch(posixCliLauncher("/tmp/branch-data/cli-active"), /dist\/cli\.js/);
});
