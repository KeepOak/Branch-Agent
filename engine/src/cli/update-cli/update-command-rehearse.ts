import { createConfigIO } from "../../config/io.factory.js";
import { resolveStateDir } from "../../config/paths.js";
import { validateUpdateCandidateCanary } from "../../infra/update-candidate-canary.js";
import { defaultRuntime } from "../../runtime.js";
import { resolveUpdateRoot } from "./shared.js";

export type UpdateRehearsePolicy = "startup-only" | "rehearse";

/** One JSON line for the desktop's pre-switch check; "passed" only when the copy reached readiness. */
export type UpdateRehearseResult = {
  outcome: "passed" | "refused";
  policy: UpdateRehearsePolicy;
  phase: string;
  durationMs: number;
  /** Failing check and the last line it printed, so the owner can be told in one line. */
  failedStep?: string;
  detail?: string;
};

type CanaryResult = Awaited<ReturnType<typeof validateUpdateCandidateCanary>>;

function lastLine(text: string | null | undefined): string | undefined {
  const line = text
    ?.split(/\r?\n/u)
    .map((value) => value.trim())
    .findLast(Boolean);
  return line ? line.slice(0, 300) : undefined;
}

export function summarizeUpdateRehearsal(
  policy: UpdateRehearsePolicy,
  result: CanaryResult,
): UpdateRehearseResult {
  const base = { policy, phase: result.phase, durationMs: result.durationMs };
  const startup = result.steps.find((step) => step.name === "candidate-gateway-startup");
  if (result.status === "ok" && result.phase === "readiness" && startup?.exitCode === 0) {
    return { outcome: "passed", ...base };
  }
  const failed =
    result.steps.find((step) => step.exitCode !== 0 && !step.advisory) ?? result.steps.at(-1);
  return {
    outcome: "refused",
    ...base,
    failedStep: failed?.name ?? result.phase,
    detail:
      lastLine(failed?.stderrTail) ??
      lastLine(failed?.stdoutTail) ??
      lastLine(result.logTail.join("\n")) ??
      (result.status === "error" ? result.reason : "the copy never reached readiness"),
  };
}

/**
 * Boots this (staged) engine against private verified snapshots of the serving state, the way
 * `branch update` rehearses a candidate, while the serving engine keeps running untouched.
 * startup-only: the copy must start as-is, including canonical session validation.
 * rehearse: Doctor repairs the copy first, then the copy must start.
 */
export async function updateRehearseCommand(
  opts: { repair: boolean; timeoutMs?: number },
  deps: {
    validate?: typeof validateUpdateCandidateCanary;
    readConfig?: (
      env: NodeJS.ProcessEnv,
    ) => Promise<Parameters<typeof validateUpdateCandidateCanary>[0]["config"]>;
    resolveRoot?: () => Promise<string>;
    env?: NodeJS.ProcessEnv;
  } = {},
): Promise<UpdateRehearseResult> {
  const env = deps.env ?? process.env;
  const policy: UpdateRehearsePolicy = opts.repair ? "rehearse" : "startup-only";
  const started = Date.now();
  let summary: UpdateRehearseResult;
  try {
    const root = await (deps.resolveRoot ?? resolveUpdateRoot)();
    const config = deps.readConfig
      ? await deps.readConfig(env)
      : (
          await createConfigIO({
            env,
            observe: false,
            pluginValidation: "skip",
          }).readBestEffortConfigSnapshot()
        ).sourceConfig;
    const result = await (deps.validate ?? validateUpdateCandidateCanary)({
      root,
      config,
      stateDir: resolveStateDir(env),
      env,
      nodeRunner: process.execPath,
      timeoutMs: opts.timeoutMs,
      migrationPolicy: policy,
    });
    summary = summarizeUpdateRehearsal(policy, result);
  } catch (error) {
    summary = {
      outcome: "refused",
      policy,
      phase: "snapshot",
      durationMs: Date.now() - started,
      failedStep: "candidate-rehearsal",
      detail: lastLine(error instanceof Error ? error.message : String(error)) ?? "failed",
    };
  }
  defaultRuntime.writeJson(summary, 0);
  if (summary.outcome !== "passed") {
    defaultRuntime.exit(1);
  }
  return summary;
}
