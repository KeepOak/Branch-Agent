// Real desktop login adapter, fake Electron/systemctl, scratch XDG directory. No app or OS settings touched.
import assert from "node:assert/strict";
import { createRequire, registerHooks } from "node:module";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

const require = createRequire(import.meta.url);
let sequence = 0;
// CI checks strict-compiled code; Node's native type stripping permits no-build local regression runs.
const dist = process.env.BRANCH_DESKTOP_TEST_DIST;
const source = dist ?? fileURLToPath(new URL("../src", import.meta.url));
const extension = dist ? ".js" : ".ts";

async function fixture(run) {
  const root = mkdtempSync(join(tmpdir(), "branch-login-"));
  const entry = join(root, "autostart", "ai.branch.app.desktop");
  const platform = Object.getOwnPropertyDescriptor(process, "platform");
  const executable = Object.getOwnPropertyDescriptor(process, "execPath");
  const calls = [];
  const state = { sleep: "masked", packaged: true };
  const app = {
    get isPackaged() { return state.packaged; },
    getPath: name => { assert.equal(name, "appData"); return root; },
    // Electron exposes these APIs only on macOS/Windows. Main must not call them on Linux.
    getLoginItemSettings: () => { throw new Error("Electron login items are not supported on Linux"); },
    setLoginItemSettings: () => { throw new Error("Electron login items are not supported on Linux"); },
  };
  const childProcess = require("node:child_process");
  Object.defineProperty(process, "platform", { value: "linux", configurable: true });
  Object.defineProperty(process, "execPath", { value: join(root, "Branch Agent.bin"), configurable: true });
  writeFileSync(join(root, "branch-agent"), "");
  const id = ++sequence;
  const bridge = `branch-login-test-${id}`;
  globalThis[bridge] = { ...childProcess, execFileSync: (command, args, options) => {
    calls.push([command, args, options]);
    if (state.sleep instanceof Error) throw state.sleep;
    return `${state.sleep}\n`;
  } };
  const mocks = {
    electron: "export const nativeImage = {}, powerSaveBlocker = {}, shell = {};",
    "./desktop-controls": "export const branchShim = null, branchShShim = null, editUserPath = null, pathHas = null, ringBitmap = null;",
    "./resident-window": "export const menuBarIcon = null;",
    "node:child_process": `export const { execFile, execFileSync } = globalThis[${JSON.stringify(bridge)}];`,
  };
  const hooks = registerHooks({ resolve(request, context, nextResolve) {
    if (Object.hasOwn(mocks, request)) return {
      url: `data:text/javascript,${encodeURIComponent(mocks[request])}#${id}`, format: "module", shortCircuit: true,
    };
    if (request === "./linux-login") return {
      url: pathToFileURL(join(source, `linux-login${extension}`)).href + (dist ? "" : `?fixture=${id}`), shortCircuit: true,
    };
    return nextResolve(request, context);
  }, load(url, context, nextLoad) {
    // CommonJS compiled output also needs an explicit loader for the virtual ESM mocks.
    if (url.startsWith("data:text/javascript,") && url.endsWith(`#${id}`)) return {
      format: "module", shortCircuit: true,
      source: decodeURIComponent(url.slice("data:text/javascript,".length, url.lastIndexOf("#"))),
    };
    return nextLoad(url, context);
  } });
  try {
    assert.deepEqual(require("electron").shell, {}, "mocks support compiled CommonJS requires too");
    for (const name of ["desktop-os", "linux-login"]) delete require.cache[join(source, `${name}${extension}`)];
    // Use require for compiled CJS so clearing require.cache really isolates each fixture;
    // dynamic import keeps a second CJS translation cache even when its URL query changes.
    const { desktopOs } = dist
      ? require(join(source, `desktop-os${extension}`))
      : await import(pathToFileURL(join(source, `desktop-os${extension}`)).href + `?fixture=${id}`);
    const launch = () => desktopOs(app, { dataDir: root }, () => undefined, "").login;
    await run({ root, entry, state, calls, launch });
  } finally {
    hooks.deregister();
    delete globalThis[bridge];
    Object.defineProperty(process, "platform", platform);
    Object.defineProperty(process, "execPath", executable);
    rmSync(root, { recursive: true, force: true });
  }
}

test("always-on Linux defaults login start on and preserves later opt-outs", () => fixture(({ entry, calls, launch }) => {
  const login = launch();
  assert.equal(login.get(), true);
  const saved = readFileSync(entry, "utf8");
  assert.match(saved, /^Exec=".*branch-agent" --start-in-tray$/m);
  assert.match(saved, /^Hidden=false$/m);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "systemctl");
  assert.deepEqual(calls[0][1], ["show", "sleep.target", "--property=UnitFileState", "--value"]);
  assert.equal(calls[0][2].timeout, 1000);
  assert.equal(calls[0][2].windowsHide, true);
  login.set(false);
  assert.equal(launch().get(), false, "explicit off survives a relaunch on an always-on machine");
  assert.equal(calls.length, 1, "a saved choice bypasses detection");
  login.set(true);
  writeFileSync(entry, `${readFileSync(entry, "utf8")}X-GNOME-Autostart-enabled=false\n`);
  assert.equal(launch().get(), false, "desktop-environment opt-out also wins");
}));

test("non-always-on Linux keeps the off default without changing startup files", () => fixture(({ root, entry, state, launch }) => {
  for (const sleep of ["static", "disabled", "", "masked-runtime", "not-found", new Error("systemctl unavailable")]) {
    state.sleep = sleep;
    const login = launch();
    assert.equal(login.get(), false);
    assert.equal(existsSync(entry), false, "ordinary and unknown machines get no automatic registration");
  }
  const login = launch();
  login.set(true);
  assert.equal(launch().get(), true, "manual enable works without an always-on signal");
  login.set(false);
  state.sleep = "masked";
  assert.equal(launch().get(), false, "a later power-policy change cannot override the saved off choice");
  rmSync(join(root, "autostart"), { recursive: true });
  state.packaged = false;
  assert.equal(launch().get(), false, "development launches do not register themselves");
  assert.equal(existsSync(entry), false);
}));

test("Linux login refreshes its launcher after updates and safely quotes Exec", () => fixture(({ root, entry, launch }) => {
  const login = launch();
  assert.equal(login.get(), true);
  const next = join(root, 'release "quoted" $cash `literal` %field \\slash');
  Object.defineProperty(process, "execPath", { value: join(next, "Branch Agent.bin"), configurable: true });
  assert.equal(launch().get(), true);
  const line = readFileSync(entry, "utf8").split("\n").find(line => line.startsWith("Exec="));
  assert.ok(line.includes('\\\\"quoted\\\\"'));
  assert.ok(line.includes('\\\\$cash'));
  assert.ok(line.includes('\\\\`literal\\\\`'));
  assert.ok(line.includes('%%field'));
  assert.ok(line.includes('\\\\\\\\slash'));
  assert.ok(line.endsWith('Branch Agent.bin" --start-in-tray'));
}));
