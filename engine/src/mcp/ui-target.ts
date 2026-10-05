// Where the UI tools look and click (`branch mcp serve` ui_* tools).
// - "test" (default): a separate Branch on this computer, started on demand: a scratch engine with its own home,
//   profile and state (no owner accounts, no owner conversations) on a free loopback port, and the Branch window
//   build served next to it, opened in a Chromium-based browser the tools drive over CDP.
// - "owner": the owner's real desktop window, only when the owner turned on "Let agents use this window"
//   (desktop-settings.json agentControl). The desktop app then opens Chromium's remote debugging on a random
//   loopback port and Chromium writes it to <data>/electron/DevToolsActivePort.
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { BrowserContext, Page } from "playwright-core";
import { desktopDataDirectory } from "./desktop-gateway.js";

export type UiTargetKind = "test" | "owner";
export type UiTarget = {
  kind: UiTargetKind;
  page: Page;
  close: () => Promise<void>;
  /** For the report: where the window and its engine live. */
  describe: Record<string, string | number>;
};

/** Never used: the old app's port and the owner's preview ports. */
export const FORBIDDEN_PORTS = new Set([3210, 3299, 3300, 19021, 19031, 19032]);

const READY_TIMEOUT_MS = 180_000;

/** The owner's switch. Off unless desktop-settings.json says `"agentControl": true`. */
export function ownerControlAllowed(dataDir: string): boolean {
  try {
    const saved = JSON.parse(fs.readFileSync(path.join(dataDir, "desktop-settings.json"), "utf8"));
    return saved?.agentControl === true;
  } catch {
    return false;
  }
}

/** Chromium's DevToolsActivePort file: first line the port, second the browser target path. */
export function readDevToolsPort(dataDir: string): number | undefined {
  try {
    const [first] = fs
      .readFileSync(path.join(dataDir, "electron", "DevToolsActivePort"), "utf8")
      .split(/\r?\n/);
    const port = Number(first);
    return Number.isInteger(port) && port > 0 && port < 65536 ? port : undefined;
  } catch {
    return undefined;
  }
}

/** A free loopback port that is none of the reserved ones. */
export async function freePort(): Promise<number> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const port = await new Promise<number>((resolve, reject) => {
      const probe = net.createServer();
      probe.once("error", reject);
      probe.listen(0, "127.0.0.1", () => {
        const address = probe.address();
        probe.close(() => resolve(typeof address === "object" && address ? address.port : 0));
      });
    });
    if (port && !FORBIDDEN_PORTS.has(port)) return port;
  }
  throw new Error("No free loopback port for the test Branch");
}

/** The engine folder running this command (it holds branch.mjs), unless BRANCH_UI_ENGINE_DIR names another. */
export function engineDirectory(env: NodeJS.ProcessEnv = process.env): string {
  if (env.BRANCH_UI_ENGINE_DIR) return env.BRANCH_UI_ENGINE_DIR;
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    if (fs.existsSync(path.join(dir, "branch.mjs"))) return dir;
    dir = path.dirname(dir);
  }
  throw new Error("Could not find the Branch engine folder (branch.mjs); set BRANCH_UI_ENGINE_DIR");
}

/** The window build to serve: BRANCH_UI_WINDOW_DIR, else the desktop app's current window. */
export function windowDirectory(
  env: NodeJS.ProcessEnv = process.env,
  dataDir = desktopDataDirectory(env),
): string {
  const dir = env.BRANCH_UI_WINDOW_DIR ?? path.join(dataDir, "window-current");
  if (!fs.existsSync(path.join(dir, "index.html"))) {
    throw new Error(
      `No Branch window build at ${dir}; set BRANCH_UI_WINDOW_DIR to a built window folder`,
    );
  }
  return dir;
}

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
};

/** A loopback static server for the window build (the desktop app serves it the same way). */
export function serveWindow(root: string, port: number): Promise<http.Server> {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const rel = decodeURIComponent(url.pathname).replace(/^\/+/, "") || "index.html";
    const file = path.resolve(root, rel);
    const inside = file === root || file.startsWith(root + path.sep);
    const target =
      inside && fs.existsSync(file) && fs.statSync(file).isFile()
        ? file
        : path.join(root, "index.html");
    res.writeHead(200, {
      "content-type": TYPES[path.extname(target)] ?? "application/octet-stream",
    });
    fs.createReadStream(target).pipe(res);
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}

/** The environment of the scratch engine: its own home, profile and state, so nothing touches the owner's. */
export function scratchEngineEnv(scratch: string, port: number, token: string, env = process.env) {
  const profile = path.join(scratch, "profile");
  const {
    BRANCH_STATE_DIR: _state,
    BRANCH_GATEWAY_PASSWORD: _password,
    BRANCH_CONFIG_PATH: _config,
    ...rest
  } = env;
  return {
    ...rest,
    BRANCH_PROFILE: "dev",
    BRANCH_HOME: path.join(scratch, "home"),
    BRANCH_SKIP_CHANNELS: "1",
    BRANCH_GATEWAY_PORT: String(port),
    BRANCH_GATEWAY_TOKEN: token,
    BRANCH_DESKTOP_DATA: scratch,
    USERPROFILE: profile,
    HOME: profile,
    LOCALAPPDATA: path.join(profile, "AppData", "Local"),
    APPDATA: path.join(profile, "AppData", "Roaming"),
  };
}

async function waitForGateway(port: number, child: ChildProcess, deadline: number): Promise<void> {
  while (Date.now() < deadline) {
    if (child.exitCode !== null)
      throw new Error(`The test Branch engine exited with code ${child.exitCode}`);
    const ok = await fetch(`http://127.0.0.1:${port}/readyz`)
      .then((r) => r.ok)
      .catch(() => false);
    if (ok) return;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error("The test Branch engine did not become ready in time");
}

/** A Chromium-based browser with its own profile folder (Edge on Windows, Chrome elsewhere, or BRANCH_UI_BROWSER). */
export async function launchBrowser(
  profileDir: string,
  env = process.env,
): Promise<BrowserContext> {
  const { chromium } = await import("playwright-core");
  const executablePath = env.BRANCH_UI_BROWSER ?? env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  return await chromium.launchPersistentContext(profileDir, {
    headless: env.BRANCH_UI_HEADED !== "1",
    viewport: { width: 1280, height: 860 },
    ...(executablePath
      ? { executablePath }
      : { channel: process.platform === "win32" ? "msedge" : "chrome" }),
  });
}

function stopChild(child: ChildProcess): void {
  if (child.pid === undefined || child.exitCode !== null) return;
  try {
    process.kill(child.pid);
  } catch {
    // Already gone.
  }
}

/** A test Branch opens on its window, not on first-run setup, unless asked (setup-model.ts setupDone reads
 *  wizard.lastRunAt). Written before the scratch engine first starts, as `branch setup` would record it. */
export function markSetupDone(scratch: string, now = new Date()): void {
  const dir = path.join(scratch, "home", ".branch");
  fs.mkdirSync(dir, { recursive: true });
  const config = {
    gateway: { mode: "local", bind: "loopback" },
    wizard: { lastRunAt: now.toISOString(), lastRunCommand: "test-instance", lastRunMode: "local" },
  };
  fs.writeFileSync(path.join(dir, "branch.json"), JSON.stringify(config, null, 2) + os.EOL);
}

/** Start the test Branch: scratch engine, window server and a browser page with the desktop bridge. */
export async function openTestInstance(
  env = process.env,
  opts: { firstRun?: boolean } = {},
): Promise<UiTarget> {
  const scratch = fs.mkdtempSync(
    path.join(env.BRANCH_UI_TEST_ROOT ?? os.tmpdir(), "branch-ui-test-"),
  );
  if (!opts.firstRun) markSetupDone(scratch);
  const [gatewayPort, windowPort] = [await freePort(), await freePort()];
  const token = randomBytes(24).toString("hex");
  const engineDir = engineDirectory(env);
  const engine = spawn(
    process.execPath,
    ["branch.mjs", "gateway", "--dev", "--port", String(gatewayPort)],
    {
      cwd: engineDir,
      env: scratchEngineEnv(scratch, gatewayPort, token, env),
      windowsHide: true,
      stdio: [
        "ignore",
        fs.openSync(path.join(scratch, "gateway.log"), "a"),
        fs.openSync(path.join(scratch, "gateway.log"), "a"),
      ],
    },
  );
  let server: http.Server | undefined;
  let context: BrowserContext | undefined;
  try {
    server = await serveWindow(windowDirectory(env), windowPort);
    await waitForGateway(gatewayPort, engine, Date.now() + READY_TIMEOUT_MS);
    context = await launchBrowser(path.join(scratch, "browser"), env);
    const gatewayUrl = `ws://127.0.0.1:${gatewayPort}`;
    // What the desktop preload gives its own window (desktop/src/preload.ts: gatewayUrl and gatewayToken).
    await context.addInitScript(
      `window.branchDesktop = ${JSON.stringify({ gatewayUrl, gatewayToken: token })};`,
    );
    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto(`http://127.0.0.1:${windowPort}/`);
    const opened = { context, server };
    return {
      kind: "test",
      page,
      describe: {
        window: `http://127.0.0.1:${windowPort}/`,
        gateway: gatewayUrl,
        scratch,
        enginePid: engine.pid ?? 0,
      },
      close: async () => {
        await opened.context.close().catch(() => undefined);
        opened.server.close();
        stopChild(engine);
      },
    };
  } catch (error) {
    await context?.close().catch(() => undefined);
    server?.close();
    stopChild(engine);
    throw error;
  }
}

/** Attach to the owner's desktop window, only behind the owner's switch. */
export async function openOwnerWindow(dataDir = desktopDataDirectory()): Promise<UiTarget> {
  if (!ownerControlAllowed(dataDir)) {
    throw new Error(
      'Driving your own Branch window is off. Turn on Settings › Branch itself › "Let agents use this window", then restart Branch. The UI tools use a separate test Branch until then.',
    );
  }
  const port = readDevToolsPort(dataDir);
  if (!port)
    throw new Error("Branch has not opened agent control yet; restart Branch after turning it on.");
  const { chromium } = await import("playwright-core");
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const page = browser
    .contexts()
    .flatMap((context) => context.pages())
    .find((candidate) => /^http:\/\/127\.0\.0\.1:\d+\//.test(candidate.url()));
  if (!page) {
    await browser.close();
    throw new Error("The Branch window is not open");
  }
  return {
    kind: "owner",
    page,
    describe: { window: page.url(), devtoolsPort: port },
    // Never browser.close() here: the owner's window must stay open. The CDP link ends with this process.
    close: async () => undefined,
  };
}
