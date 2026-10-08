import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

if (!process.env.BRANCH_DESKTOP_TEST_DIST) throw new Error("Set BRANCH_DESKTOP_TEST_DIST to the strict-compiled current source output");
const holders = await import(pathToFileURL(join(process.env.BRANCH_DESKTOP_TEST_DIST, "install-folder-holders.js")));

// Image paths from the packaged Windows app. Node lives at resources\node\node.exe (config.ts).
const INSTALL = "C:\\Program Files\\Branch Agent";
const NODE_INSIDE = `${INSTALL}\\resources\\node\\node.exe`;
const SHELL_INSIDE = `${INSTALL}\\Branch Agent.exe`;
const BESIDE = "C:\\Program Files\\Branch Agent (updated)";
const WINDOWS_PROCESSES = JSON.stringify([
  { ProcessId: 4242, ExecutablePath: NODE_INSIDE, CommandLine: `"${NODE_INSIDE}" "${INSTALL}\\resources\\engine\\branch.mjs" mcp serve` },
  { ProcessId: 4243, ExecutablePath: SHELL_INSIDE, CommandLine: `"${SHELL_INSIDE}"` },
  { ProcessId: 7, ExecutablePath: "C:\\Other\\Branch Agent\\Branch Agent.exe", CommandLine: "Branch Agent.exe" },
  { ProcessId: 8, ExecutablePath: "C:\\Program Files\\nodejs\\node.exe", CommandLine: `node.exe "${INSTALL}\\resources\\engine\\branch.mjs" mcp serve` },
  { ProcessId: 9, ExecutablePath: "C:\\Program Files\\Branch Agent Extra\\Branch Agent.exe", CommandLine: "Branch Agent.exe" },
]);

function harness(list, { dieOnForce = true, unlockOnForce = true } = {}) {
  const asked = [];
  const forced = [];
  const moves = [];
  const logs = [];
  const alive = new Set(list.map(item => item.pid));
  let locked = true;
  const deps = {
    list: async () => list,
    askExit: async pid => { asked.push(pid); },
    forceStop: async pid => {
      forced.push(pid);
      if (dieOnForce) alive.delete(pid);
      if (unlockOnForce) locked = false;
    },
    alive: pid => alive.has(pid),
    wait: async () => {},
    move: async (from, to) => {
      moves.push([from, to]);
      if (locked && from === INSTALL) throw Object.assign(new Error("folder in use"), { code: "EBUSY" });
    },
    remove: async () => {},
    log: line => logs.push(line),
  };
  const request = {
    installDir: INSTALL, target: INSTALL, staged: "C:\\Program Files\\staged-shell", previous: `${INSTALL}.previous`,
    besideDir: BESIDE, kind: "runtime", targetRelative: "", relaunchCommand: SHELL_INSIDE, excludePids: [], attempts: 2, deps,
  };
  return { asked, forced, moves, logs, request };
}

function windowsHolders() {
  return holders.parseWindowsProcessList(WINDOWS_PROCESSES);
}

test("a leftover process in the install folder gets stopped and the swap succeeds", async () => {
  const list = windowsHolders();
  const { asked, forced, moves, request } = harness(list);
  const result = await holders.placeAppShell(request);
  assert.equal(result.result, "swapped");
  assert.deepEqual(asked, [4242, 4243]);
  assert.deepEqual(forced, [4242, 4243]);
  assert.equal(asked.includes(7) || asked.includes(8) || asked.includes(9), false);
  assert.equal(moves.at(-2)[0], INSTALL);
  assert.equal(moves.at(-1)[0], request.staged);
  assert.deepEqual(holders.holdersInInstall(INSTALL, list, new Set()).map(item => item.executable), [NODE_INSIDE, SHELL_INSIDE]);
});

test("a process outside the folder is never touched", async () => {
  const list = windowsHolders().filter(item => item.pid !== 4242 && item.pid !== 4243);
  const { asked, forced, request } = harness(list, { dieOnForce: false, unlockOnForce: true });
  // Nothing inside is holding the folder, so the rename is not locked.
  request.deps.move = async (from, to) => { request.deps.moves ??= []; request.deps.moves.push([from, to]); };
  const result = await holders.placeAppShell(request);
  assert.equal(result.result, "swapped");
  assert.deepEqual(asked, []);
  assert.deepEqual(forced, []);
  assert.equal(holders.pathInsideInstall(INSTALL, NODE_INSIDE), true);
  assert.equal(holders.pathInsideInstall(INSTALL, SHELL_INSIDE), true);
  assert.equal(holders.pathInsideInstall(INSTALL, "C:\\Other\\Branch Agent\\Branch Agent.exe"), false);
  assert.equal(holders.pathInsideInstall(INSTALL, "C:\\Program Files\\nodejs\\node.exe"), false);
  assert.equal(holders.pathInsideInstall(INSTALL, "C:\\Program Files\\Branch Agent Extra\\Branch Agent.exe"), false);
});

test("a process that won't die leads to the fallback, not a silent failure", async () => {
  const stubborn = windowsHolders().filter(item => item.pid === 4242);
  const outsider = windowsHolders().find(item => item.pid === 7);
  const { asked, forced, logs, request } = harness([...stubborn, outsider], { dieOnForce: false, unlockOnForce: false });
  const result = await holders.placeAppShell(request);
  assert.equal(result.result, "beside");
  assert.deepEqual(asked, [4242]);
  assert.deepEqual(forced, [4242]);
  assert.equal(holders.pathInsideInstall(BESIDE, result.relaunch), true);
  assert.equal(result.relaunch.endsWith("Branch Agent.exe"), true);
  assert.match(logs.join("\n"), /install folder stayed in use/);
  assert.match(logs.join("\n"), /4242/);
  assert.match(result.blockers.join("\n"), new RegExp(NODE_INSIDE.replaceAll("\\", "\\\\")));
  assert.equal(result.blockers.join("\n").includes("C:\\Other\\Branch Agent"), false);
});

// Paths from a running Windows install. The folder being replaced is the versioned shell, not the data folder.
const ROOT = "C:\\Users\\Example\\AppData\\Local\\BranchAgent";
const SHELL = `${ROOT}\\dist\\v0.4.4\\Branch Agent-win32-x64`;
const SHELL_EXE = `${SHELL}\\Branch Agent.exe`;
const ENGINE_NODE = `${SHELL}\\resources\\node\\node.exe`;
const CODEX = `${ROOT}\\updates\\release-0.4.4-build-engine\\engine\\node_modules\\@openai\\codex-win32-x64\\vendor\\x86_64-pc-windows-msvc\\bin\\codex.exe`;
const OUTSIDE_CMD = "C:\\Windows\\System32\\cmd.exe";

function shellRequest(list, { locked = true, dieOnForce = true } = {}) {
  const asked = [];
  const forced = [];
  const moves = [];
  const logs = [];
  const alive = new Set(list.map(item => item.pid));
  let folder = "live";
  const deps = {
    list: async () => list,
    askExit: async pid => { asked.push(pid); },
    forceStop: async pid => {
      forced.push(pid);
      if (dieOnForce) alive.delete(pid);
    },
    alive: pid => alive.has(pid),
    wait: async () => {},
    move: async (from, to) => {
      moves.push([from, to]);
      if (from === SHELL && to === `${SHELL}.previous`) {
        if (locked || folder !== "live") throw Object.assign(new Error("folder in use"), { code: "EBUSY" });
        folder = "aside";
        return;
      }
      if (from === `${SHELL}.previous` && to === SHELL) {
        folder = "live";
        return;
      }
      if (from === "C:\\Users\\Example\\AppData\\Local\\BranchAgent\\updates\\staged-shell" && to === SHELL) {
        if (folder !== "aside") throw Object.assign(new Error("live folder is not aside"), { code: "ENOENT" });
        if (locked) throw Object.assign(new Error("folder in use"), { code: "EBUSY" });
        folder = "swapped";
        return;
      }
      if (folder === "aside") throw Object.assign(new Error("half-swapped"), { code: "EBUSY" });
    },
    log: line => logs.push(line),
  };
  const request = {
    installDir: SHELL, target: SHELL, staged: "C:\\Users\\Example\\AppData\\Local\\BranchAgent\\updates\\staged-shell",
    previous: `${SHELL}.previous`, besideDir: `${SHELL} (updated)`, kind: "runtime", targetRelative: "",
    relaunchCommand: SHELL_EXE, excludePids: [], attempts: 2, deps,
  };
  return { asked, forced, moves, logs, request, where: () => folder };
}

test("a process whose working directory is the shell folder gets stopped and one outside does not", async () => {
  const listed = holders.parseWindowsProcessList(JSON.stringify([
    { ProcessId: 31, ExecutablePath: OUTSIDE_CMD, CommandLine: "cmd.exe", CurrentDirectory: SHELL },
    { ProcessId: 32, ExecutablePath: OUTSIDE_CMD, CommandLine: "cmd.exe", CurrentDirectory: "C:\\Users\\Example\\Desktop" },
    { ProcessId: 33, ExecutablePath: CODEX, CommandLine: "codex.exe", CurrentDirectory: `${ROOT}\\updates\\release-0.4.4-build-engine\\engine` },
  ]));
  assert.equal(listed.find(item => item.pid === 31).cwd, SHELL);
  const { asked, forced, request } = shellRequest(listed, { locked: false });
  const result = await holders.placeAppShell(request);
  assert.equal(result.result, "swapped");
  assert.deepEqual(asked, [31]);
  assert.deepEqual(forced, [31]);
  assert.equal(asked.includes(32) || asked.includes(33), false);
  assert.equal(forced.includes(32) || forced.includes(33), false);
});

test("the engine node.exe inside the shell folder is stopped and processes outside it are not", async () => {
  const listed = [
    { pid: 41, executable: ENGINE_NODE, command: `"${ENGINE_NODE}" branch.mjs gateway`, cwd: `${ROOT}\\updates\\release-0.4.4-build-engine\\engine`, files: [] },
    { pid: 42, executable: SHELL_EXE, command: `"${SHELL_EXE}"`, cwd: SHELL, files: [] },
    { pid: 43, executable: CODEX, command: "codex.exe", cwd: `${ROOT}\\updates\\release-0.4.4-build-engine\\engine`, files: [] },
    { pid: 44, executable: "C:\\Program Files\\nodejs\\node.exe", command: "node.exe branch.mjs", cwd: "C:\\Program Files\\nodejs", files: [] },
    { pid: 45, executable: "C:\\Other\\Branch Agent\\Branch Agent.exe", command: "Branch Agent.exe", cwd: "C:\\Other\\Branch Agent", files: [] },
  ];
  const { asked, forced, logs, request } = shellRequest(listed, { locked: false });
  const result = await holders.placeAppShell(request);
  assert.equal(result.result, "swapped");
  assert.deepEqual(asked, [41, 42]);
  assert.deepEqual(forced, [41, 42]);
  for (const outsider of [43, 44, 45]) {
    assert.equal(asked.includes(outsider), false);
    assert.equal(forced.includes(outsider), false);
  }
  assert.match(logs.join("\n"), new RegExp(ENGINE_NODE.replaceAll("\\", "\\\\")));
  assert.equal(logs.join("\n").includes(CODEX), false);
  assert.deepEqual(holders.holdersInInstall(SHELL, listed, new Set()).map(item => item.pid), [41, 42]);
});

test("a move that cannot finish puts the live shell back and logs the path that holds it", async () => {
  const listed = [{ pid: 41, executable: ENGINE_NODE, command: "", cwd: "", files: [] }];
  const { logs, moves, request, where } = shellRequest(listed, { locked: true, dieOnForce: false });
  request.deps.move = async (from, to) => {
    moves.push([from, to]);
    if (from === SHELL && to === `${SHELL}.previous`) return;
    if (from === `${SHELL}.previous` && to === SHELL) return;
    if (to === SHELL) throw Object.assign(new Error("folder in use"), { code: "EBUSY" });
  };
  const result = await holders.placeAppShell(request);
  assert.equal(result.result, "beside");
  assert.equal(where(), "live");
  const restored = moves.filter(([from, to]) => from === `${SHELL}.previous` && to === SHELL);
  assert.equal(restored.length > 0, true);
  const besideAt = moves.findIndex(([from, to]) => to === `${SHELL} (updated)`);
  const lastRestore = moves.findLastIndex(([from, to]) => from === `${SHELL}.previous` && to === SHELL);
  assert.equal(lastRestore < besideAt, true);
  assert.match(logs.join("\n"), /put .* back/);
  assert.match(logs.join("\n"), new RegExp(ENGINE_NODE.replaceAll("\\", "\\\\")));
  assert.match(logs.join("\n"), /retrying the move/);
});

test("shortcut working directories are repaired to a folder outside the swapped shell", () => {
  const link = { path: "C:\\Users\\Example\\Desktop\\Branch Agent.lnk", target: SHELL_EXE, workingDirectory: SHELL };
  assert.equal(holders.repairedWorkingDirectory(link, SHELL, ROOT), ROOT);
  assert.equal(holders.pathInsideInstall(SHELL, holders.stableShortcutDirectory(SHELL, ROOT)), false);
  assert.equal(holders.repairedWorkingDirectory({ ...link, workingDirectory: ROOT }, SHELL, ROOT), undefined);
  assert.equal(holders.repairedWorkingDirectory({ ...link, target: "C:\\Other\\Branch Agent\\Branch Agent.exe", workingDirectory: "C:\\Other\\Branch Agent" }, SHELL, ROOT), undefined);
  assert.equal(holders.repairedWorkingDirectory({ ...link, target: CODEX, workingDirectory: SHELL }, SHELL, ROOT), undefined);
  const script = holders.shortcutRepairScript(SHELL_EXE, ROOT);
  assert.match(script, /WorkingDirectory=\$work/);
  assert.match(script, /GetFolderPath\('Startup'\)/);
  assert.match(script, /TargetPath -ieq \$exe/);
  assert.match(script, /IconLocation=/);
  assert.equal(script.includes("Split-Path -Parent"), false);
  assert.equal(script.includes(SHELL), true);
  assert.equal(script.includes(ROOT), true);
});

test("the engine node is copied outside the shell folder and other node binaries stay put", async () => {
  const root = await mkdtemp(join(tmpdir(), "branch-node-home-"));
  try {
    const shell = join(root, "Branch Agent-win32-x64");
    const bundled = join(shell, "resources", "node", "node");
    await mkdir(join(shell, "resources", "node"), { recursive: true });
    await writeFile(bundled, "bundled-node");
    const data = join(root, "BranchAgent");
    await mkdir(data);
    const outside = holders.nodeOutsideSwappedFolder(bundled, data);
    assert.equal(holders.pathInsideInstall(shell, outside), false);
    assert.equal(await readFile(outside, "utf8"), "bundled-node");
    assert.equal(holders.nodeOutsideSwappedFolder(process.execPath, data), process.execPath);
    assert.equal(holders.shellOfBundledNode(ENGINE_NODE), SHELL);
    assert.equal(holders.shellOfBundledNode("C:\\Program Files\\nodejs\\node.exe"), undefined);
    assert.equal(holders.pathInsideInstall(SHELL, CODEX), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
