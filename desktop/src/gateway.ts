// Starts the Branch engine gateway as a child process (as the early copy's start.sh does) and stops it by PID.
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { createWriteStream, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import type { DesktopConfig } from "./config";

export function readToken(cfg: DesktopConfig): string {
  return readFileSync(join(cfg.dataDir, "gateway-token"), "utf8").trim();
}

/** Resolves true when nothing listens on 127.0.0.1:port. */
export function portIsFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.once("error", () => resolve(false));
    probe.listen(port, "127.0.0.1", () => probe.close(() => resolve(true)));
  });
}

/**
 * Tests only: BRANCH_DESKTOP_ENGINE_PROFILE gives the engine its own user profile, so its state-owner lock
 * (under the profile's AppData/Local/Branch Agent/locks) never mixes with a real engine's. Unset for the owner's runs.
 */
function testProfile(): Record<string, string> {
  const dir = process.env.BRANCH_DESKTOP_ENGINE_PROFILE;
  if (!dir) return {};
  return {
    USERPROFILE: dir,
    HOME: dir,
    LOCALAPPDATA: join(dir, "AppData", "Local"),
    APPDATA: join(dir, "AppData", "Roaming"),
  };
}

export function startGateway(cfg: DesktopConfig, engineDir: string, token: string): ChildProcess {
  const log = createWriteStream(join(cfg.dataDir, "gateway.log"), { flags: "a" });
  const env = {
    ...process.env,
    BRANCH_PROFILE: "dev",
    BRANCH_HOME: join(cfg.dataDir, "home"),
    BRANCH_SKIP_CHANNELS: "1",
    BRANCH_GATEWAY_PORT: String(cfg.gatewayPort),
    BRANCH_GATEWAY_TOKEN: token,
    ...testProfile(),
  };
  const args = ["branch.mjs", "gateway", "--dev", "--port", String(cfg.gatewayPort)];
  const child = spawn(cfg.nodePath, args, {
    cwd: engineDir,
    env,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.pipe(log);
  child.stderr?.pipe(log);
  if (child.pid !== undefined) {
    writeFileSync(join(cfg.dataDir, "gateway.pid"), String(child.pid));
  }
  return child;
}

/** Polls the gateway's /readyz until it answers 200, the child exits, or the time runs out. */
export async function waitForReady(cfg: DesktopConfig, child: ChildProcess, ms: number): Promise<void> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (child.exitCode !== null) {
      throw new Error(`the engine exited with code ${child.exitCode}; see gateway.log`);
    }
    try {
      const res = await fetch(`http://127.0.0.1:${cfg.gatewayPort}/readyz`);
      if (res.status === 200) return;
    } catch {
      // not listening yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("the engine did not become ready in time; see gateway.log");
}

/** Stops the gateway and its own child processes by its PID only. */
export function stopGateway(child: ChildProcess): void {
  if (child.pid === undefined || child.exitCode !== null) return;
  try {
    execFileSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
  } catch {
    // already gone
  }
}
