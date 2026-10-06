// Checks a staged engine beside the running one before the swap, as upstream's updater does ("The test Gateway binds
// a free loopback port", engine/docs/cli/update/how-updates-run.md): the candidate starts on a spare port with its own
// scratch state, so the owner's engine keeps serving and its state is never touched. A build that cannot start is
// caught here with nothing stopped, and the candidate's start warms the OS file cache for the real one.
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { DesktopConfig } from "./config";
import { freeLoopbackPort, stopGateway, waitForReady } from "./gateway";

export type CandidateResult = "ready" | "exited" | "slow";

let running: ChildProcess | undefined;
/** Quitting during a check must not leave the candidate engine behind. */
export function stopCandidate(): void {
  if (running) stopGateway(running);
}

function startCandidate(cfg: DesktopConfig, engineDir: string, token: string, port: number): ChildProcess {
  const root = join(cfg.dataDir, "candidate-check"), profile = join(root, "profile");
  for (const dir of [join(root, "home"), join(profile, "AppData", "Local"), join(profile, "AppData", "Roaming")]) mkdirSync(dir, { recursive: true });
  const env = { ...process.env, BRANCH_PROFILE: "dev", BRANCH_HOME: join(root, "home"), BRANCH_SKIP_CHANNELS: "1",
    BRANCH_GATEWAY_PORT: String(port), BRANCH_GATEWAY_TOKEN: token,
    USERPROFILE: profile, HOME: profile, LOCALAPPDATA: join(profile, "AppData", "Local"), APPDATA: join(profile, "AppData", "Roaming") };
  return spawn(cfg.nodePath, ["branch.mjs", "gateway", "--dev", "--port", String(port)], {
    cwd: engineDir, env, windowsHide: true, detached: process.platform !== "win32", stdio: ["ignore", "ignore", "ignore", "ipc"],
  });
}

/** Starts the candidate on a spare port, waits for its readiness, then stops it. The running engine is untouched. */
export async function checkCandidateBeside(cfg: DesktopConfig, engineDir: string, token: string, timeoutMs: number): Promise<CandidateResult> {
  const port = await freeLoopbackPort();
  const child = startCandidate(cfg, engineDir, token, port);
  running = child;
  try {
    await waitForReady({ ...cfg, gatewayPort: port }, child, timeoutMs);
    return "ready";
  } catch {
    return child.exitCode !== null || child.signalCode !== null ? "exited" : "slow";
  } finally {
    stopGateway(child);
    running = undefined;
  }
}
