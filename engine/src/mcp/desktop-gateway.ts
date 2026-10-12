// `branch mcp serve` started by an outside agent (`claude mcp add branch -- branch mcp serve`) finds the Branch
// Agent desktop app's gateway by itself: the token file the desktop writes and its loopback port. The token is
// read here and passed to the Gateway client only; it is never printed or handed to the MCP client.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** The desktop app's gateway port (desktop/src/config.ts DEFAULTS.gatewayPort). */
export const DESKTOP_GATEWAY_PORT = 19031;

/**
 * The port the desktop's engine serves on right now. An in-place update can move the engine to another loopback
 * port; the desktop records the live one in <data>/gateway-port (desktop/src/main.ts adoptGatewayPort).
 */
export function readDesktopGatewayPort(dataDir: string): number | undefined {
  try {
    const value = fs.readFileSync(path.join(dataDir, "gateway-port"), "utf8").trim();
    const port = /^\d{1,5}$/.test(value) ? Number(value) : 0;
    return port > 0 && port < 65536 ? port : undefined;
  } catch {
    return undefined;
  }
}

/** The desktop app's data directory, resolved exactly as desktop/src/config.ts defaultDataDirectory(). */
export function desktopDataDirectory(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  home: string = os.homedir(),
): string {
  if (env.BRANCH_DESKTOP_DATA) return env.BRANCH_DESKTOP_DATA;
  const legacy = path.join(home, "BranchApp");
  const isFile = (file: string) => fs.existsSync(file) && fs.statSync(file).isFile();
  if (
    isFile(path.join(legacy, "desktop.json")) ||
    (isFile(path.join(legacy, "gateway-token")) && isFile(path.join(legacy, "engine-current.txt")))
  ) {
    return legacy;
  }
  if (platform === "win32") {
    return path.join(env.LOCALAPPDATA ?? path.join(home, "AppData", "Local"), "BranchAgent");
  }
  if (platform === "darwin") {
    return path.join(home, "Library", "Application Support", "BranchAgent");
  }
  return path.join(env.XDG_DATA_HOME ?? path.join(home, ".local", "share"), "BranchAgent");
}

/** The live loopback URL from <data>/gateway-port, re-read on every reconnect; undefined keeps the current URL. */
export function liveDesktopGatewayUrl(dataDir: string): string | undefined {
  const port = readDesktopGatewayPort(dataDir);
  return port ? `ws://127.0.0.1:${port}` : undefined;
}

function readDesktopToken(dataDir: string): string {
  try {
    return fs.readFileSync(path.join(dataDir, "gateway-token"), "utf8").split(/\r?\n/)[0]!.trim();
  } catch {
    return "";
  }
}

/**
 * The desktop data directory whose own gateway the environment's token names, or undefined. The desktop's `branch`
 * command (desktop/src/desktop-controls.ts) exports the desktop's token and the port that was live when it ran, so a
 * long-running `branch mcp serve` or Graft it started must still follow the port an in-place update moves the
 * engine to. Shims from before BRANCH_DATA was exported still match through the default data directory.
 */
export function desktopDataForEnvToken(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const envToken = env.BRANCH_GATEWAY_TOKEN?.trim();
  if (!envToken) {
    return undefined;
  }
  const candidates = [env.BRANCH_DATA, desktopDataDirectory(env)].filter((dir): dir is string =>
    Boolean(dir),
  );
  return candidates.find((dir) => readDesktopToken(dir) === envToken);
}

/**
 * Loopback URL and token of the desktop app's gateway, used only when the command line and environment name no
 * gateway auth. Undefined when the desktop app has never run on this computer.
 */
export function resolveDesktopGateway(
  opts: { url?: string; token?: string; password?: string },
  env: NodeJS.ProcessEnv = process.env,
  dataDir: string = desktopDataDirectory(env),
): { url: string; token: string; dataDir: string } | undefined {
  // The desktop token only ever goes to the desktop's own loopback port: an explicit --url keeps upstream's
  // rules (it needs its own token), and so do configured gateways when no desktop app exists.
  if (
    opts.url ||
    opts.token ||
    opts.password ||
    env.BRANCH_GATEWAY_TOKEN ||
    env.BRANCH_GATEWAY_PASSWORD
  ) {
    return undefined;
  }
  const token = readDesktopToken(dataDir);
  if (!token) {
    return undefined;
  }
  const envPort = Number(env.BRANCH_GATEWAY_PORT);
  const port =
    (Number.isInteger(envPort) && envPort > 0 ? envPort : undefined) ??
    readDesktopGatewayPort(dataDir) ??
    DESKTOP_GATEWAY_PORT;
  return { url: `ws://127.0.0.1:${port}`, token, dataDir };
}
