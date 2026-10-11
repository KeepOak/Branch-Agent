// Before an engine switch, the staged engine boots on private verified snapshots of the owner's real state
// (`branch update rehearse`, the engine's own update canary), with full startup validation including canonical
// session validation, while the serving engine keeps running untouched. A copy that would refuse gets Doctor's
// repair on the copy; only a repair proven there is applied to the live state, in the swap's maintenance window.
// Prior art: the engine's `branch update` candidate canary (engine/docs/cli/update/how-updates-run.md, from
// OpenClaw's updater): "boots a test Gateway with copied configuration and verified SQLite snapshots".
import { spawn } from "node:child_process";

/** The JSON line `branch update rehearse` prints (engine update-command-rehearse.ts). */
export interface RehearsalReport {
  outcome: "passed" | "refused";
  policy: "startup-only" | "rehearse";
  phase: string;
  failedStep?: string;
  detail?: string;
}

export type PreflightOutcome =
  /** The new engine starts on a copy of this host's data as-is. */
  | { kind: "pass" }
  /** The copy refused, Doctor's repair made it start: repair the live state while the old engine is stopped. */
  | { kind: "repair"; detail: string }
  /** Even repaired, the copy would not start: keep the old engine and tell the owner this one line. */
  | { kind: "refuse"; line: string }
  /** No snapshot check possible (older candidate, no space for a copy): the scratch-state check decides. */
  | { kind: "unavailable"; reason: string };

/** Runs one rehearsal; resolves undefined when the candidate has no rehearsal command (no JSON result). */
export type Rehearse = (repair: boolean) => Promise<RehearsalReport | undefined>;

/** Plain words for the owner (shown after "The update didn't finish: "); the engine's error stays in the log. */
export function ownerRefusalLine(version: string): string {
  return `version ${version} would not start with this computer's saved data, even after an automatic repair on a copy, so the current version keeps running.`;
}

export async function runSnapshotPreflight(version: string, rehearse: Rehearse, log: (line: string) => void): Promise<PreflightOutcome> {
  const first = await rehearse(false);
  if (!first) return { kind: "unavailable", reason: "the staged engine has no snapshot rehearsal" };
  if (first.outcome === "passed") {
    log(`snapshot preflight ${version}: the new engine started on a copy of this host's data`);
    return { kind: "pass" };
  }
  // Only a copy that refused to start or become ready says something about this host's data. A copy that could not
  // be made, or a candidate runtime check that failed, leaves the decision to the scratch check, as before.
  if (first.phase !== "startup" && first.phase !== "readiness") {
    return { kind: "unavailable", reason: `${first.phase}: ${first.detail ?? "the rehearsal did not finish"}` };
  }
  log(`snapshot preflight ${version}: the copy refused at ${first.failedStep ?? first.phase} (${first.detail ?? "no detail"}); trying Doctor's repair on the copy`);
  const repaired = await rehearse(true);
  if (repaired?.outcome === "passed") {
    log(`snapshot preflight ${version}: Doctor's repair made the copy start; the live state is repaired during the swap`);
    return { kind: "repair", detail: first.detail ?? first.phase };
  }
  const report = repaired ?? first;
  log(`snapshot preflight ${version}: the repaired copy still refused at ${report.failedStep ?? report.phase} (${report.detail ?? "no detail"})`);
  return { kind: "refuse", line: ownerRefusalLine(version) };
}

/** Last stdout line that parses as a rehearsal report. */
export function parseRehearsalReport(stdout: string): RehearsalReport | undefined {
  for (const line of stdout.split(/\r?\n/).reverse()) {
    const text = line.trim();
    if (!text.startsWith("{")) continue;
    try {
      const value = JSON.parse(text) as Partial<RehearsalReport>;
      if ((value.outcome === "passed" || value.outcome === "refused") && typeof value.phase === "string") return value as RehearsalReport;
    } catch { /* not the report */ }
  }
  return undefined;
}

interface EngineCommand { nodePath: string; engineDir: string; env: NodeJS.ProcessEnv; timeoutMs: number }

let running = new Set<ReturnType<typeof spawn>>();
/** Quitting during a preflight must not leave a rehearsal or repair behind. */
export function stopPreflight(): void {
  for (const child of running) { try { child.kill("SIGKILL"); } catch { /* gone */ } }
  running = new Set();
}

function runEngine(command: EngineCommand, args: string[]): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise(resolve => {
    const child = spawn(command.nodePath, ["branch.mjs", ...args], {
      cwd: command.engineDir, env: command.env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
    });
    running.add(child);
    let stdout = "", stderr = "";
    child.stdout?.on("data", chunk => { stdout = (stdout + String(chunk)).slice(-64_000); });
    child.stderr?.on("data", chunk => { stderr = (stderr + String(chunk)).slice(-16_000); });
    const timer = setTimeout(() => { try { child.kill("SIGKILL"); } catch { /* gone */ } }, command.timeoutMs);
    const done = (code: number | null) => { clearTimeout(timer); running.delete(child); resolve({ code, stdout, stderr }); };
    child.once("error", () => done(null));
    child.once("close", code => done(code));
  });
}

/** `branch update rehearse` from the staged engine, against the live state env (it only reads it). */
export function engineRehearsal(command: EngineCommand): Rehearse {
  return async repair => {
    const result = await runEngine(command, ["update", "rehearse", "--json", ...(repair ? ["--repair"] : []), "--budget-ms", String(command.timeoutMs)]);
    return parseRehearsalReport(result.stdout);
  };
}

/**
 * The scoped repair proven on the copy, applied to live state: Doctor from the staged engine, non-interactive, only
 * while no engine owns the state (the swap's maintenance window). Resolves the last output line on failure.
 */
export async function repairLiveState(command: EngineCommand): Promise<{ ok: true } | { ok: false; detail: string }> {
  const result = await runEngine(command, ["doctor", "--fix", "--non-interactive", "--no-workspace-suggestions"]);
  if (result.code === 0) return { ok: true };
  const detail = `${result.stderr}\n${result.stdout}`.split(/\r?\n/).map(line => line.trim()).filter(Boolean).at(-1);
  return { ok: false, detail: detail ?? `Doctor exited with ${result.code ?? "a signal"}` };
}
