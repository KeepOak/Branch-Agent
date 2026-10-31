// #2161: tests that load main.js run its settings apply, which refreshes the branch command under HOME
// (~/.local/bin/branch). They run with their own temporary HOME, and the fixture engines they start are stopped when
// the run ends, even when it is interrupted.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Points HOME (and USERPROFILE) at a fresh temporary folder for the rest of this test process. */
export function isolateHome(prefix = "branch-test-home-") {
  const home = mkdtempSync(join(tmpdir(), prefix));
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  process.once("exit", () => rmSync(home, { recursive: true, force: true }));
  return home;
}

const running = new Set();
function stopAll() {
  for (const pids of running) {
    for (const pid of pids()) {
      if (!Number.isInteger(pid) || pid <= 0) continue;
      try { process.kill(-pid, "SIGKILL"); } catch { /* not a group leader, or gone */ }
      try { process.kill(pid, "SIGKILL"); } catch { /* gone */ }
    }
  }
}
process.once("exit", stopAll);
for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => { stopAll(); process.exit(130); });

/** Stops the engines `pids()` lists when the process exits or is stopped. Returns the unregister call. */
export function stopOnExit(pids) {
  running.add(pids);
  return () => { running.delete(pids); };
}
