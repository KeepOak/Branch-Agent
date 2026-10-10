// Where the desktop app finds the engine, the built window and its own data.
// Packaged defaults are per user; desktop.json can override any field.
// The engine is installed separately: use the published copy, with the source build as a development fallback.
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export interface DesktopConfig {
  /** The app's own data: engine home, gateway token, logs, Electron profile. */
  dataDir: string;
  /**
   * Fallback engine folder (holding branch.mjs), used while dataDir/engine-current.txt does not exist. That file
   * names the installed engine copy made by scripts/publish-engine.sh, which is what the app normally runs.
   */
  engineDir: string;
  /**
   * The current window build (`vite build` output of window/). It lives outside the packaged app and is watched:
   * scripts/publish-window.sh swaps a new build in and the open window reloads itself.
   */
  windowDir: string;
  /** The system Node that runs the engine (absolute, since a shortcut launch may lack PATH). */
  nodePath: string;
  gatewayPort: number;
  /** Port of the tiny static server that serves the window on 127.0.0.1. */
  windowPort: number;
  /**
   * Seamless handoff (the old engine steps down and finishes its runs while the standby takes over). On by
   * default; set false to fall back to drain-first updates.
   */
  seamlessHandoff?: boolean;
  /**
   * The engine outlives the app: it is started detached on every OS (outside Windows' kill-on-close job) and quit
   * leaves it running; the next launch attaches to it. Off by default; set true in desktop.json to try it.
   */
  detachedEngine?: boolean;
}

function isFile(file: string): boolean {
  try { return statSync(file).isFile(); } catch (error) {
    if (["ENOENT", "ENOTDIR"].includes((error as NodeJS.ErrnoException).code ?? "")) return false;
    throw error;
  }
}

export function defaultDataDirectory(): string {
  if (process.env.BRANCH_DESKTOP_DATA) return process.env.BRANCH_DESKTOP_DATA;
  const legacy = join(homedir(), "BranchApp");
  if (isFile(join(legacy, "desktop.json"))
    || isFile(join(legacy, "gateway-token")) && isFile(join(legacy, "engine-current.txt"))) return legacy;
  if (process.platform === "win32") return join(process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"), "BranchAgent");
  if (process.platform === "darwin") return join(homedir(), "Library", "Application Support", "BranchAgent");
  return join(process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share"), "BranchAgent");
}

const DATA_DIR = defaultDataDirectory();
const RESOURCES = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath ?? join(__dirname, "..");

const DEFAULTS: DesktopConfig = {
  dataDir: DATA_DIR,
  engineDir: join(RESOURCES, "engine"),
  windowDir: join(DATA_DIR, "window-current"),
  nodePath: (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath
    ? join(RESOURCES, "node", process.platform === "win32" ? "node.exe" : "node") : process.execPath,
  gatewayPort: 19031,
  windowPort: 19032,
};

/** Never used: the old app's port and the owner's preview ports. */
const FORBIDDEN_PORTS = new Set([3210, 3299, 3300, 19021]);

const readOr = (path: string): string => {
  try {
    return readFileSync(path, "utf8").trim();
  } catch {
    return "";
  }
};

/** The engine folder to start now: the published copy named in engine-current.txt, else the fallback. */
export function resolveEngineDir(cfg: DesktopConfig): string {
  const published = readOr(join(cfg.dataDir, "engine-current.txt"));
  const dir = published || cfg.engineDir;
  if (!existsSync(join(dir, "branch.mjs")) || !existsSync(join(dir, "dist", "build-info.json"))) {
    throw new Error(`The ${published ? "published" : "development"} Branch engine is incomplete at ${dir}. Publish a complete engine before starting the app.`);
  }
  return dir;
}

/** Changes whenever a new engine is published or the engine in use is rebuilt. */
export function engineSignature(cfg: DesktopConfig): string {
  // Watching a new publication must not terminate the running engine. Validate only when booting/restarting.
  const dir = readOr(join(cfg.dataDir, "engine-current.txt")) || cfg.engineDir;
  return `${dir}
${readOr(join(dir, "dist", "build-info.json"))}`;
}

export function loadConfig(): DesktopConfig {
  const file = join(DATA_DIR, "desktop.json");
  const override: Partial<DesktopConfig> = existsSync(file)
    ? (JSON.parse(readFileSync(file, "utf8")) as Partial<DesktopConfig>)
    : {};
  const cfg = { ...DEFAULTS, ...override };
  for (const port of [cfg.gatewayPort, cfg.windowPort]) {
    if (FORBIDDEN_PORTS.has(port)) {
      throw new Error(`port ${port} is reserved for another Branch copy`);
    }
  }
  return cfg;
}
