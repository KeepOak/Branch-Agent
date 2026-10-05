// `branch mcp serve` started by an outside agent (`claude mcp add branch -- branch mcp serve`) finds the Branch
// Agent desktop app's gateway by itself: the token file the desktop writes and its loopback port. The token is
// read here and passed to the Gateway client only; it is never printed or handed to the MCP client.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** The desktop app's gateway port (desktop/src/config.ts DEFAULTS.gatewayPort). */
export const DESKTOP_GATEWAY_PORT = 19031;

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

/**
 * Loopback URL and token of the desktop app's gateway, used only when the command line and environment name no
 * gateway auth. Undefined when the desktop app has never run on this computer.
 */
export function resolveDesktopGateway(
  opts: { url?: string; token?: string; password?: string },
  env: NodeJS.ProcessEnv = process.env,
  dataDir: string = desktopDataDirectory(env),
): { url: string; token: string } | undefined {
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
  let token = "";
  try {
    token = fs.readFileSync(path.join(dataDir, "gateway-token"), "utf8").split(/\r?\n/)[0]!.trim();
  } catch {
    return undefined;
  }
  if (!token) return undefined;
  const port = Number(env.BRANCH_GATEWAY_PORT) || DESKTOP_GATEWAY_PORT;
  return { url: `ws://127.0.0.1:${port}`, token };
}
