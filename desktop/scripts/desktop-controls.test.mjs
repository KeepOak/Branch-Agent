// Desktop controls bridge: every OS call is a fake, so nothing on this computer changes.
import assert from "node:assert/strict";
import { chmod, mkdtemp, mkdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { execFileSync, spawnSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

const dist = process.env.BRANCH_DESKTOP_TEST_DIST;
if (!dist) throw new Error("Set BRANCH_DESKTOP_TEST_DIST to current strict-compiled source");
const { createDesktopControls, readSettings, registerDesktopControlsIpc, ringBitmap, branchShim, branchShShim, editUserPath, pathHas, DOWNLOAD_PAGES,
  branchPosixShim, branchCommandOwner, posixBranchCommand, BRANCH_COMMAND_MARKER, LEGACY_BRANCH_COMMAND_MARKER, appRemoval, appRemovalPlan, APP_REMOVAL_KEEPS } =
  await import(pathToFileURL(join(dist, "desktop-controls.js")));

async function fixture(run) {
  const parent = join(tmpdir(), "claude-session-files", "desktop-controls");
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(join(parent, "fixture-"));
  const calls = [];
  const state = { login: false, onPath: false };
  const deps = {
    settingsFile: join(root, "desktop-settings.json"),
    login: { get: () => state.login, set: on => { calls.push(["login", on]); state.login = on; } },
    cli: { installed: async () => state.onPath, install: async () => { calls.push(["cli-install"]); state.onPath = true; },
      uninstall: async () => { calls.push(["cli-uninstall"]); state.onPath = false; } },
    tray: { usage: (left, on) => calls.push(["tray", left, on]) },
    openExternal: async url => calls.push(["open", url]),
  };
  try { await run({ root, deps, calls, state }); } finally { await rm(root, { recursive: true, force: true }); }
}

test("defaults keep working, keep awake (plugged in) and auto-apply on; awake on battery and tray ring off", async () => fixture(async ({ deps }) => {
  const controls = createDesktopControls(deps);
  assert.deepEqual(await controls.get(), { keepWorking: true, keepAwake: true, keepAwakeOnBattery: false, trayUsage: false, autoApplyUpdates: true, agentControl: false, startWithWindows: false, branchOnPath: false });
}));

test("letting agents use the window is off by default, saved, and read at the next launch", async () => fixture(async ({ deps, calls }) => {
  const controls = createDesktopControls(deps);
  assert.equal((await controls.set("agentControl", true)).agentControl, true);
  assert.deepEqual(calls, []);
  assert.equal(readSettings(deps.settingsFile).agentControl, true);
  await controls.set("agentControl", false);
  assert.equal(readSettings(deps.settingsFile).agentControl, false);
}));

test("Start with Windows goes to the login item, not the settings file", async () => fixture(async ({ deps, calls, state }) => {
  const controls = createDesktopControls(deps);
  assert.equal((await controls.set("startWithWindows", true)).startWithWindows, true);
  assert.deepEqual(calls, [["login", true]]);
  state.login = false; // turned off elsewhere, in the Startup apps list
  assert.equal((await controls.get()).startWithWindows, false);
}));

test("keep awake is saved and read back; the blocker itself follows runs (keep-awake.ts), never the switch", async () => fixture(async ({ deps, calls }) => {
  const changes = [];
  const controls = createDesktopControls({ ...deps, onChange: settings => changes.push(settings) });
  await controls.set("keepAwake", false);
  await controls.set("keepAwakeOnBattery", true);
  assert.deepEqual(calls, []);
  assert.deepEqual(changes.map(s => [s.keepAwake, s.keepAwakeOnBattery]), [[false, false], [false, true]]);
  const saved = JSON.parse(await readFile(deps.settingsFile, "utf8"));
  assert.equal(saved.keepAwake, false);
  assert.equal(saved.keepAwakeOnBattery, true);
  const relaunched = createDesktopControls(deps);
  relaunched.apply();
  assert.equal(relaunched.settings().keepAwake, false);
  relaunched.dispose();
  assert.deepEqual(calls, []);
}));

test("keep working when the window closes is saved and read back", async () => fixture(async ({ deps }) => {
  const controls = createDesktopControls(deps);
  await controls.set("keepWorking", false);
  assert.equal(createDesktopControls(deps).settings().keepWorking, false);
}));

test("the branch command installs and removes through the cli adapter", async () => fixture(async ({ deps, calls }) => {
  const controls = createDesktopControls(deps);
  assert.equal((await controls.set("branchOnPath", true)).branchOnPath, true);
  assert.equal((await controls.set("branchOnPath", false)).branchOnPath, false);
  assert.deepEqual(calls, [["cli-install"], ["cli-uninstall"]]);
}));

test("tray ring follows the usage only while the setting is on", async () => fixture(async ({ deps, calls }) => {
  const controls = createDesktopControls(deps);
  controls.trayUsage(42);
  await controls.set("trayUsage", true);
  controls.trayUsage(140);
  assert.deepEqual(calls, [["tray", 42, false], ["tray", 42, true], ["tray", 100, true]]);
}));

test("Get it opens only the known download pages", async () => fixture(async ({ deps, calls }) => {
  const controls = createDesktopControls(deps);
  await controls.openDownload("windows");
  await controls.openDownload("iphone");
  await assert.rejects(controls.openDownload("https://example.com"), /No download page/);
  await assert.rejects(controls.openDownload("__proto__"), /No download page/);
  assert.deepEqual(calls, [["open", "https://github.com/KeepOak/Branch-Agent/releases/latest"], ["open", DOWNLOAD_PAGES.iphone]]);
  for (const url of Object.values(DOWNLOAD_PAGES)) assert.match(url, /^https:\/\//);
}));

test("unknown controls and non-boolean values are refused", async () => fixture(async ({ deps }) => {
  const controls = createDesktopControls(deps);
  await assert.rejects(controls.set("format", true), /Unknown desktop control/);
  await assert.rejects(controls.set("keepAwake", "yes"), /on or off/);
}));

test("IPC answers only the owned served window", async () => fixture(async ({ deps, calls }) => {
  const handlers = new Map(), listeners = new Map();
  const ipc = { handle: (c, f) => handlers.set(c, f), on: (c, f) => listeners.set(c, f) };
  const frame = { url: "http://127.0.0.1:19032/" };
  const owner = { getURL: () => frame.url, mainFrame: frame };
  registerDesktopControlsIpc(ipc, () => owner, "http://127.0.0.1:19032/", createDesktopControls(deps));
  const ok = { sender: owner, senderFrame: frame };
  const strangerFrame = { url: "https://elsewhere.test/" };
  const stranger = { sender: { getURL: () => strangerFrame.url, mainFrame: strangerFrame }, senderFrame: strangerFrame };
  assert.equal((await handlers.get("branch-desktop:controls:set")(ok, "startWithWindows", true)).startWithWindows, true);
  await assert.rejects(handlers.get("branch-desktop:controls:set")(stranger, "startWithWindows", false), /owned served window/);
  await assert.rejects(handlers.get("branch-desktop:controls:open-download")(stranger, "windows"), /owned served window/);
  listeners.get("branch-desktop:controls:tray-usage")(stranger, 50);
  listeners.get("branch-desktop:controls:tray-usage")(ok, 50);
  assert.deepEqual(calls, [["login", true], ["tray", 50, false]]);
}));

// Private #1102: "Remove the app, keep my data" removes only what the installer put down, never the data folder.
test("app removal finds the install each platform's installer made, and says why when there is none", () => {
  const has = (...paths) => (path) => paths.includes(path);
  const win = join("C:", "Users", "o", "AppData", "Local");
  const uninstaller = join(win, "Programs", "Branch Agent Uninstall", "unins000.exe");
  assert.deepEqual(appRemoval({ platform: "win32", execPath: "x", packaged: true, localAppData: win, exists: has(uninstaller) }), { kind: "windows", uninstaller });
  assert.equal(appRemoval({ platform: "win32", execPath: "x", packaged: true, localAppData: win, exists: has() }).kind, "none");
  const bundle = "/Users/o/Applications/Branch Agent.app";
  assert.deepEqual(appRemoval({ platform: "darwin", execPath: `${bundle}/Contents/MacOS/Branch Agent`, packaged: true, exists: has() }), { kind: "mac", bundles: [bundle] });
  const aside = join("/Users/o/Applications", ".Branch.previous");
  assert.deepEqual(appRemoval({ platform: "darwin", execPath: `${bundle}/Contents/MacOS/Branch Agent`, packaged: true, exists: has(aside) }).bundles, [bundle, aside]);
  assert.deepEqual(appRemoval({ platform: "linux", execPath: "/tmp/.mount/branch", packaged: true, appImage: "/home/o/.local/bin/branch-agent", exists: has("/home/o/.local/bin/branch-agent.previous") }),
    { kind: "appimage", files: ["/home/o/.local/bin/branch-agent", "/home/o/.local/bin/branch-agent.previous"] });
  assert.match(appRemoval({ platform: "linux", execPath: "/usr/lib/branch/branch", packaged: true, exists: has() }).reason, /package manager/);
  assert.match(appRemoval({ platform: "win32", execPath: "x", packaged: false, localAppData: win, exists: has(uninstaller) }).reason, /source folder/);
});

test("the removal plan names what goes and keeps conversations, Trunks and settings", () => {
  const plan = appRemovalPlan({ kind: "windows", uninstaller: "u" }, { dataDir: "D", startsAtLogin: true, branchOnPath: true, service: true });
  assert.equal(plan.supported, true);
  assert.deepEqual(plan.removes, ["The Branch app, with its Start menu and desktop shortcuts", "Branch’s background service, so nothing keeps running", "Starting Branch when you sign in", "The branch command in your terminal"]);
  assert.deepEqual(plan.keeps, ["Your conversations", "Your Trunks and what they remember", "Your settings and connected accounts"]);
  assert.deepEqual(plan.keeps, APP_REMOVAL_KEEPS);
  assert.equal(plan.dataDir, "D");
  assert.deepEqual(appRemovalPlan({ kind: "mac", bundles: ["b"] }, { dataDir: "D", startsAtLogin: false, branchOnPath: false, service: false }).removes, ["The Branch app (it goes to the Trash)"]);
  const none = appRemovalPlan({ kind: "none", reason: "why" }, { dataDir: "D", startsAtLogin: true, branchOnPath: true, service: true });
  assert.deepEqual([none.supported, none.reason, none.removes], [false, "why", []]);
});

test("Remove the app takes the service, login item and command first, then the app, then quits; the data folder stays", async () => fixture(async ({ root, deps, calls, state }) => {
  const dataDir = join(root, "data");
  await mkdir(dataDir, { recursive: true });
  await writeFile(join(dataDir, "conversation.jsonl"), "kept\n");
  state.login = true; state.onPath = true;
  const removal = { kind: "appimage", files: [join(root, "branch-agent")] };
  const controls = createDesktopControls({ ...deps, removeApp: { dataDir, removal: () => removal,
    service: async () => { calls.push(["service-uninstall"]); },
    launch: async (r) => { calls.push(["launch", r.kind]); }, quit: () => calls.push(["quit"]) } });
  const plan = await controls.removalPlan();
  assert.equal(plan.supported, true);
  assert.equal(plan.removes.length, 4);
  await controls.removeApp();
  assert.deepEqual(calls, [["service-uninstall"], ["login", false], ["cli-uninstall"], ["launch", "appimage"], ["quit"]]);
  assert.equal(await readFile(join(dataDir, "conversation.jsonl"), "utf8"), "kept\n");
  const none = createDesktopControls({ ...deps, removeApp: { dataDir, removal: () => ({ kind: "none", reason: "Not installed here." }), launch: async () => calls.push(["launch"]), quit: () => calls.push(["quit"]) } });
  await assert.rejects(none.removeApp(), /Not installed here/);
  assert.equal((await createDesktopControls(deps).removalPlan()).supported, false);
  await assert.rejects(createDesktopControls(deps).removeApp(), /newer Branch app/);
  assert.equal(calls.filter(([c]) => c === "quit").length, 1);
}));

test("removal IPC answers only the owned served window", async () => fixture(async ({ deps, calls }) => {
  const handlers = new Map();
  const ipc = { handle: (c, f) => handlers.set(c, f), on: () => undefined };
  const frame = { url: "http://127.0.0.1:19032/" };
  const owner = { getURL: () => frame.url, mainFrame: frame };
  const removeApp = { dataDir: "D", removal: () => ({ kind: "mac", bundles: ["b"] }), launch: async () => calls.push(["launch"]), quit: () => calls.push(["quit"]) };
  registerDesktopControlsIpc(ipc, () => owner, "http://127.0.0.1:19032/", createDesktopControls({ ...deps, removeApp }));
  const strangerFrame = { url: "https://elsewhere.test/" };
  const stranger = { sender: { getURL: () => strangerFrame.url, mainFrame: strangerFrame }, senderFrame: strangerFrame };
  await assert.rejects(handlers.get("branch-desktop:controls:remove-app")(stranger), /owned served window/);
  await assert.rejects(handlers.get("branch-desktop:controls:removal-plan")(stranger), /owned served window/);
  assert.deepEqual(calls, []);
  assert.equal((await handlers.get("branch-desktop:controls:removal-plan")({ sender: owner, senderFrame: frame })).supported, true);
  await handlers.get("branch-desktop:controls:remove-app")({ sender: owner, senderFrame: frame });
  assert.deepEqual(calls, [["launch"], ["quit"]]);
}));

test("ring bitmap draws the share left as an arc over a faint track", () => {
  const size = 32, px = (img, x, y) => [...img.subarray((y * size + x) * 4, (y * size + x) * 4 + 4)];
  const half = ringBitmap(50, size);
  assert.equal(half.length, size * size * 4);
  assert.equal(px(half, 16, 16)[3], 0, "the middle stays clear");
  assert.equal(px(half, 28, 16)[3], 255, "right side (first half, clockwise from top) is filled");
  assert.equal(px(half, 3, 16)[3], 110, "left side is the track");
  assert.notDeepEqual(px(ringBitmap(10, size), 17, 2).slice(0, 3), px(ringBitmap(80, size), 17, 2).slice(0, 3), "low turns amber");
});

test("branch shim reads the published engine and token at run time", () => {
  const shim = branchShim({ dataDir: "C:\\Data", engineDir: "C:\\App\\engine", nodePath: "C:\\App\\node.exe", gatewayPort: 19031 });
  assert.ok(shim.includes('call :read_engine "%BRANCH_DATA%\\engine-current.txt"'));
  // The engine that runs, not a staged one still waiting to be applied.
  assert.ok(shim.indexOf("engine-current.txt") < shim.indexOf('call :read_engine "%BRANCH_DATA%\\engine-running.txt"'));
  assert.ok(shim.includes('set /p BRANCH_GATEWAY_TOKEN=<"%BRANCH_DATA%\\gateway-token"'));
  // The configured port is the default; the live port an update moved the engine to wins.
  assert.ok(shim.indexOf('set "BRANCH_GATEWAY_PORT=19031"') < shim.indexOf('set /p BRANCH_GATEWAY_PORT=<"%BRANCH_DATA%\\gateway-port"'));
  assert.ok(shim.includes('"C:\\App\\node.exe" "%ENGINE%\\branch.mjs" %*'));
  assert.doesNotMatch(shim, /[0-9a-f]{64}/);
});

test("Git Bash shim reads the same files, drops CR and passes arguments through", () => {
  const shim = branchShShim({ dataDir: "C:\\Data's", engineDir: "C:\\App\\engine", nodePath: "C:\\App\\node.exe", gatewayPort: 19031 });
  assert.ok(shim.startsWith("#!/bin/sh\n"));
  assert.ok(shim.includes("data='C:/Data'\\''s'"));
  assert.ok(shim.includes("tr -d '\\r'"));
  assert.ok(shim.indexOf("engine-current.txt") < shim.indexOf('read_engine "$data/engine-running.txt"'));
  // An empty read (never expected: the desktop renames the file into place) keeps the configured port.
  assert.ok(shim.includes(`if [ -f "$data/gateway-port" ]; then live=$(head -n 1 "$data/gateway-port" | tr -d '\\r'); if [ -n "$live" ]; then BRANCH_GATEWAY_PORT=$live; fi; fi`));
  assert.ok(shim.indexOf("BRANCH_GATEWAY_PORT=19031") < shim.indexOf("$data/gateway-port"));
  // As the cmd shim: a long-running `branch mcp serve` finds the desktop's gateway-port again after an update.
  assert.ok(shim.includes("BRANCH_DATA='C:\\Data'\\''s'"));
  assert.match(shim, /export BRANCH_DATA /);
  assert.ok(shim.includes(`exec 'C:/App/node.exe' "$engine/branch.mjs" "$@"`));
  assert.doesNotMatch(shim, /\r/);
});

async function cliFixture(run) {
  const parent = join(tmpdir(), "Codex-session-files");
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(join(parent, "branch-cli-"));
  const dataDir = join(root, "data"), engineDir = join(root, "bundled engine");
  await mkdir(dataDir); await mkdir(engineDir);
  const engine = async name => {
    const dir = join(root, name); await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "branch.mjs"), `console.log(JSON.stringify({engine:${JSON.stringify(name)},args:process.argv.slice(2)}));`);
    return dir;
  };
  await engine("bundled engine");
  const options = { dataDir, engineDir, nodePath: process.execPath, gatewayPort: 19045 };
  const execute = async kind => {
    const cmd = kind === "cmd", file = join(root, cmd ? "branch.cmd" : "branch");
    await writeFile(file, cmd ? branchShim(options) : branchShShim(options));
    const shell = cmd ? process.env.ComSpec : process.platform === "win32" ? "C:/Program Files/Git/bin/bash.exe" : "/bin/sh";
    return spawnSync(shell, cmd ? ["/d", "/c", file, "status", "quoted arg"] : [file, "status", "quoted arg"],
      { windowsHide: true, encoding: "utf8" });
  };
  try { await run({ dataDir, engineDir, engine, execute }); } finally { await rm(root, { recursive: true, force: true }); }
}

for (const kind of process.platform === "win32" ? ["cmd", "sh"] : ["sh"]) {
  test(`${kind} branch command ignores stale running engine and uses valid published engine`, async () => cliFixture(async f => {
    const current = await f.engine("published engine");
    await writeFile(join(f.dataDir, "engine-current.txt"), current + "\r\n");
    await writeFile(join(f.dataDir, "engine-running.txt"), join(f.dataDir, "missing") + "\r\n");
    const result = await f.execute(kind);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), { engine: "published engine", args: ["status", "quoted arg"] });
  }));

  test(`${kind} branch command ignores stale and empty pointers and uses bundled engine`, async () => cliFixture(async f => {
    for (const current of ["", join(f.dataDir, "missing")]) {
      for (const running of ["", join(f.dataDir, "missing")]) {
        await writeFile(join(f.dataDir, "engine-current.txt"), current + "\r\n");
        await writeFile(join(f.dataDir, "engine-running.txt"), running + "\r\n");
        const result = await f.execute(kind);
        assert.equal(result.status, 0, result.stderr);
        assert.equal(JSON.parse(result.stdout).engine, "bundled engine");
      }
    }
  }));

  test(`${kind} branch command prefers valid running engine`, async () => cliFixture(async f => {
    await writeFile(join(f.dataDir, "engine-current.txt"), await f.engine("published engine"));
    await writeFile(join(f.dataDir, "engine-running.txt"), await f.engine("running engine"));
    const result = await f.execute(kind);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).engine, "running engine");
  }));

  test(`${kind} branch command reports missing engines before launching node`, async () => cliFixture(async f => {
    await rm(join(f.engineDir, "branch.mjs"));
    const result = await f.execute(kind);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Branch Agent engine is unavailable.*Open Branch Agent/);
    assert.doesNotMatch(result.stderr, /MODULE_NOT_FOUND/);
  }));

  test(`${kind} branch command reports unreadable pointer without falling back`, async () => cliFixture(async f => {
    await mkdir(join(f.dataDir, "engine-running.txt"));
    const result = await f.execute(kind);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Cannot read Branch Agent engine pointer.*check.*permissions/i);
    assert.equal(result.stdout, "");
  }));
}

/** A packaged install as it ships now: the app code is sealed in app.asar (no Resources/app/dist/cli.js), node sits
 *  beside it, and the engine the app runs is the unpacked copy named in the data folder's engine-*.txt files. */
async function packagedLayout(root) {
  const app = join(root, "Applications", "Branch Agent.app");
  const resources = join(app, "Contents", "Resources");
  const data = join(root, "Library", "Application Support", "BranchAgent");
  await mkdir(join(resources, "node"), { recursive: true });
  await writeFile(join(resources, "app.asar"), "sealed archive: only Electron reads inside it");
  // The bundled node: here a stand-in that hands over to the node running the tests.
  const nodePath = join(resources, "node", "node");
  await writeFile(nodePath, `#!/bin/sh\nexec '${process.execPath}' "$@"\n`);
  await chmod(nodePath, 0o755);
  const engine = async (name) => {
    const dir = join(data, "updates", name, "engine");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "branch.mjs"), `const e = process.env;
console.log(JSON.stringify({ engine: ${JSON.stringify(name)}, args: process.argv.slice(2), home: e.BRANCH_HOME, state: e.BRANCH_STATE_DIR,
  config: e.BRANCH_CONFIG_PATH, profile: e.BRANCH_PROFILE, port: e.BRANCH_GATEWAY_PORT, token: e.BRANCH_GATEWAY_TOKEN, data: e.BRANCH_DATA }));\n`);
    return dir;
  };
  const published = await engine("release-published"), running = await engine("release-running");
  await writeFile(join(data, "engine-current.txt"), `${published}\n`);
  await writeFile(join(data, "gateway-token"), "fixture-token\n");
  await writeFile(join(data, "gateway-port"), "19045\n");
  const command = join(root, "home", ".local", "bin", "branch");
  // The earlier installer's command, exactly as it was written before the app moved into app.asar.
  await mkdir(join(root, "home", ".local", "bin"), { recursive: true });
  await writeFile(command, ["#!/bin/sh", LEGACY_BRANCH_COMMAND_MARKER, "# Removing Branch Agent removes this file too.",
    "ELECTRON_RUN_AS_NODE=1", `exec '${nodePath}' '${join(resources, "app", "dist", "cli.js")}' "$@"`, ""].join("\n"));
  await chmod(command, 0o755);
  const cfg = { dataDir: data, engineDir: join(resources, "engine"), nodePath, gatewayPort: 19031 };
  return { app, resources, data, published, running, command, cfg };
}

const posixOnly = { skip: process.platform === "win32" && "the macOS and Linux command is a sh script" };

test("the macOS and Linux branch command runs the unpacked engine of a packaged (app.asar) install", posixOnly, async () => {
  const root = await mkdtemp(join(tmpdir(), "branch command "));
  try {
    const { data, published, running, command, cfg } = await packagedLayout(root);
    const stale = spawnSync(command, ["--version"], { encoding: "utf8" });
    assert.notEqual(stale.status, 0, "the earlier command finds no dist/cli.js in a packaged app");
    assert.match(stale.stderr, /dist\/cli\.js/);

    const cli = posixBranchCommand(command, () => branchPosixShim(cfg));
    assert.equal(branchCommandOwner(command), "installer");
    assert.equal(await cli.installed(), false, "the broken command does not count as installed");
    cli.refresh();
    assert.equal(branchCommandOwner(command), "app", "launch takes the earlier installer's command over");
    assert.equal(await cli.installed(), true);
    const text = await readFile(command, "utf8");
    assert.equal(text.split("\n")[1], BRANCH_COMMAND_MARKER);
    assert.doesNotMatch(text, /dist\/cli\.js|app\.asar/);
    assert.equal((await stat(command)).mode & 0o111, 0o111, "the command stays executable");

    const run = (...args) => JSON.parse(execFileSync(command, args, { encoding: "utf8", env: { PATH: process.env.PATH } }));
    const first = run("status", "--json", "it's a \"quoted\" arg");
    assert.deepEqual(first, { engine: "release-published", args: ["status", "--json", "it's a \"quoted\" arg"],
      home: join(data, "home"), state: join(data, "home", ".branch"), config: join(data, "home", ".branch", "branch.json"),
      profile: "default", port: "19045", token: "fixture-token", data });
    // The engine actually running wins over a published one that has not been applied yet.
    await writeFile(join(data, "engine-running.txt"), `${running}\n`);
    assert.equal(run().engine, "release-running");
    // With no live port recorded, the configured one is used.
    await rm(join(data, "gateway-port"));
    assert.equal(run().port, "19031");
    assert.ok(published);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("the macOS and Linux branch command installs, refreshes and removes only its own file", posixOnly, async () => {
  const root = await mkdtemp(join(tmpdir(), "branch command "));
  try {
    const { command, cfg } = await packagedLayout(root);
    const cli = posixBranchCommand(command, () => branchPosixShim(cfg));
    await cli.uninstall();
    assert.equal(branchCommandOwner(command), "none", "turning it off removes the earlier installer's command too");
    cli.refresh();
    assert.equal(branchCommandOwner(command), "none", "a launch never creates the command");
    await cli.install();
    assert.equal(await cli.installed(), true);
    await cli.uninstall();
    assert.equal(await cli.installed(), false);

    await writeFile(command, "#!/bin/sh\necho someone else's branch\n");
    await assert.rejects(cli.install(), /another program's branch command/);
    cli.refresh();
    await cli.uninstall();
    assert.equal(await readFile(command, "utf8"), "#!/bin/sh\necho someone else's branch\n", "another program's file is left as it was");
    await rm(command);
    await symlink(join(root, "elsewhere"), command);
    assert.equal(branchCommandOwner(command), "other", "a link is never followed or replaced");
    await assert.rejects(cli.install(), /another program's branch command/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("user Path edits add once and remove case-insensitively", () => {
  assert.equal(editUserPath("C:\\A;;C:\\B", "C:\\Bin", true), "C:\\A;C:\\B;C:\\Bin");
  assert.equal(editUserPath("C:\\A;c:\\bin\\;C:\\B", "C:\\Bin", true), "C:\\A;C:\\B;C:\\Bin");
  assert.equal(editUserPath("C:\\A;c:\\bin;C:\\B", "C:\\Bin", false), "C:\\A;C:\\B");
  assert.equal(pathHas("C:\\A;C:\\BIN\\", "C:\\Bin"), true);
  assert.equal(pathHas("C:\\A", "C:\\Bin"), false);
});

test("close policy and tray click follow the controls (mocked Electron, no window or tray)", async () => {
  const { createRequire } = await import("node:module");
  const { EventEmitter } = await import("node:events");
  const require = createRequire(import.meta.url), Module = require("node:module"), originalLoad = Module._load;
  let tray;
  class Tray extends EventEmitter { constructor() { super(); tray = this; } setToolTip() {} setContextMenu() {} destroy() {} }
  Module._load = function (request, ...rest) {
    return request === "electron" ? { Tray, Menu: { buildFromTemplate: v => v } } : originalLoad.call(this, request, ...rest);
  };
  try {
    const { keepWindowResident } = require(join(dist, "resident-window.js"));
    const app = new EventEmitter(), win = new EventEmitter();
    Object.assign(win, { hidden: false, hide() { this.hidden = true; }, show() { this.hidden = false; }, focus() {}, isMinimized: () => false, restore() {} });
    let keep = true, clicks = 0;
    keepWindowResident(app, win, "icon.ico", { platform: "win32", keepRunning: () => keep, onTrayClick: () => clicks++ });
    const close = () => { const e = { prevented: false, preventDefault() { this.prevented = true; } }; win.emit("close", e); return e.prevented; };
    assert.equal(close(), true, "on: closing hides to the tray");
    keep = false;
    assert.equal(close(), false, "off: closing ends Branch");
    tray.emit("click");
    assert.equal(clicks, 1);
  } finally { Module._load = originalLoad; }
});

test("launch refreshes an existing branch command and never installs one", async () => fixture(async ({ deps, calls }) => {
  let refreshed = 0;
  deps.cli.refresh = () => { refreshed++; calls.push(["cli-refresh"]); };
  const controls = createDesktopControls(deps);
  controls.apply();
  assert.equal(refreshed, 1);
  assert.ok(!calls.some(([name]) => name === "cli-install"));
  deps.cli.refresh = () => { throw new Error("locked"); };
  assert.doesNotThrow(() => createDesktopControls(deps).apply());
  controls.dispose();
}));

test("a full disk keeps a changed setting in memory, shows the disk-full banner once, and saves on the next write", async () => fixture(async ({ deps }) => {
  const { diskIsFull, onDiskFullChange } = await import(pathToFileURL(join(dist, "disk-full.js")));
  const seen = [];
  const stop = onDiskFullChange(full => seen.push(full));
  let failing = true;
  const writes = [];
  // ENOSPC is injected into the settings write; the real disk is never filled.
  const { writeFileSync } = await import("node:fs");
  const writeFile = (file, text) => {
    if (failing) throw Object.assign(new Error("ENOSPC: no space left on device, write"), { code: "ENOSPC", errno: -28, syscall: "write" });
    writes.push(file);
    writeFileSync(file, text);
  };
  const controls = createDesktopControls({ ...deps, writeFile });
  try {
    assert.equal((await controls.set("keepWorking", false)).keepWorking, false, "the toggle never throws on a full disk");
    assert.equal((await controls.set("trayUsage", true)).trayUsage, true);
    assert.equal(controls.settings().keepWorking, false, "the new value stays in memory");
    assert.equal(diskIsFull(), true);
    assert.deepEqual(seen, [true], "one banner for both failed saves");
    failing = false;
    await controls.set("keepAwake", false);
    assert.deepEqual(writes, [deps.settingsFile]);
    assert.equal(readSettings(deps.settingsFile).keepWorking, false, "the next save writes the kept value");
    assert.equal(diskIsFull(), false);
    assert.deepEqual(seen, [true, false], "the banner goes away once a save lands");
  } finally { stop(); }
}));

test("tools find the engine on its live port from gateway-port, not the configured 19031 (Private #1054)", async () => {
  const helper = fileURLToPath(new URL("./live-gateway-port.mjs", import.meta.url));
  const { liveGatewayPort, CONFIGURED_GATEWAY_PORT } = await import(pathToFileURL(helper));
  const data = await mkdtemp(join(tmpdir(), "branch-gateway-port-"));
  try {
    assert.equal(CONFIGURED_GATEWAY_PORT, 19031);
    assert.equal(liveGatewayPort(data), 19031, "an app that never wrote gateway-port keeps the configured port");
    await writeFile(join(data, "gateway-port"), "57072\r\n");
    assert.equal(liveGatewayPort(data), 57072);
    assert.equal(execFileSync(process.execPath, [helper, data], { encoding: "utf8", windowsHide: true }).trim(), "57072");
    await writeFile(join(data, "gateway-port"), "not a port\n");
    assert.equal(liveGatewayPort(data), 19031);
    const script = await readFile(new URL("./publish-window.sh", import.meta.url), "utf8");
    assert.doesNotMatch(script, /19031/u, "publish-window.sh hard-codes the configured port");
    assert.match(script, /PORT="\$\{3:-\$\(node "\$\(dirname "\$0"\)\/live-gateway-port\.mjs" "\$DATA"\)\}"/u);
  } finally {
    await rm(data, { recursive: true, force: true });
  }
});
