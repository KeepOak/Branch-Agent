import assert from "node:assert/strict";
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
