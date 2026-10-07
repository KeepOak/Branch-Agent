import { finiteSecondsToTimerSafeMilliseconds } from "@branch/normalization-core/number-coercion";
import { resolveCurrentBranchCliInvocation } from "../infra/branch-cli-invocation.js";
import { beginLifecycleWriteCustody } from "../infra/lifecycle-write-custody.js";
import { hasCommandProcessCleanupError, type SpawnResult } from "../process/exec-result.js";
import { withCommandProcessScope } from "../process/exec-spawn.js";
import { runCommandWithTimeout } from "../process/exec.js";
import { isScheduledBackupCommand } from "./backup-command.js";
import {
  buildCronCommandSummary,
  isCronCommandActionCriticalLine,
} from "./command-output-summary.js";
import type { CronRunDiagnostics, CronRunOutcome, CronRunStatus, CronJob } from "./types.js";

const DEFAULT_COMMAND_TIMEOUT_MS = 10 * 60_000;
const EFFECTIVELY_UNBOUNDED_TIMEOUT_MS = 2_147_483_647;

function secondsToMs(value: number | undefined): number | undefined {
  if (typeof value !== "number") {
    return undefined;
  }
  if (value <= 0) {
    return EFFECTIVELY_UNBOUNDED_TIMEOUT_MS;
  }
  return finiteSecondsToTimerSafeMilliseconds(value) ?? undefined;
}

function formatCommand(argv: string[]): string {
  return argv.map((arg) => JSON.stringify(arg)).join(" ");
}

function commandErrorMessage(params: {
  code: number | null;
  signal: NodeJS.Signals | null;
  termination: string;
}): string {
  if (params.termination === "timeout") {
    return "command timed out";
  }
  if (params.termination === "no-output-timeout") {
    return "command produced no output before noOutputTimeoutSeconds";
  }
  if (params.termination === "signal") {
    return params.signal ? `command stopped by signal ${params.signal}` : "command stopped";
  }
  if (typeof params.code === "number") {
    return `command exited with code ${params.code}`;
  }
  return "command failed";
}

function buildDiagnostics(params: {
  command: string;
  status: CronRunStatus;
  summary?: string;
  code: number | null;
  signal: NodeJS.Signals | null;
  stdoutTruncatedBytes?: number;
  stderrTruncatedBytes?: number;
  cleanupError?: string;
  nowMs: () => number;
}): CronRunDiagnostics {
  const truncated =
    Boolean(params.stdoutTruncatedBytes && params.stdoutTruncatedBytes > 0) ||
    Boolean(params.stderrTruncatedBytes && params.stderrTruncatedBytes > 0);
  return {
    ...(params.summary ? { summary: params.summary } : {}),
    entries: [
      {
        ts: params.nowMs(),
        source: "exec",
        severity: params.status === "ok" ? "info" : "error",
        message: params.summary
          ? `command ${params.status}: ${params.command}`
          : `command ${params.status} with no output: ${params.command}`,
        exitCode: params.code,
        truncated,
        ...(params.signal ? { toolName: `signal:${params.signal}` } : {}),
      },
      ...(params.cleanupError
        ? [
            {
              ts: params.nowMs(),
              source: "exec" as const,
              severity: "error" as const,
              message: `${params.cleanupError}: ${params.command}`,
              exitCode: params.code,
            },
          ]
        : []),
    ],
  };
}

type CommandPayload = Extract<CronJob["payload"], { kind: "command" }>;

/**
 * Branch: a scheduled backup names `branch`, which need not be on PATH (the desktop app only adds it
 * when asked). Run the Gateway's own CLI instead, so the schedule works everywhere and always uses
 * the same engine version that wrote the job.
 */
export function resolveCronCommandSpawn(
  job: CronJob,
  payload: CommandPayload,
): { argv: string[]; cwd?: string; env?: Record<string, string> } {
  const base = {
    argv: payload.argv,
    ...(payload.cwd ? { cwd: payload.cwd } : {}),
    ...(payload.env ? { env: payload.env } : {}),
  };
  if (!isScheduledBackupCommand(job) || payload.argv[0] !== "branch") {
    return base;
  }
  const invocation = resolveCurrentBranchCliInvocation(payload.argv.slice(1));
  const env = { ...invocation.env, ...payload.env };
  return {
    argv: [invocation.command, ...invocation.args],
    cwd: payload.cwd ?? invocation.cwd,
    ...(Object.keys(env).length > 0 ? { env } : {}),
  };
}

/** Executes a cron command payload without starting an agent/model run. */
export async function runCronCommandJob(params: {
  job: CronJob;
  abortSignal?: AbortSignal;
  nowMs?: () => number;
}): Promise<CronRunOutcome> {
  const nowMs = params.nowMs ?? Date.now;
  const { payload } = params.job;
  if (payload.kind !== "command") {
    return {
      status: "skipped",
      error: 'command runner requires payload.kind="command"',
    };
  }
  if (!Array.isArray(payload.argv) || payload.argv.length === 0) {
    return {
      status: "skipped",
      error: 'command payload requires non-empty "argv"',
    };
  }

  const command = formatCommand(payload.argv);
  const noOutputTimeoutMs = secondsToMs(payload.noOutputTimeoutSeconds);
  const releaseCustody = isScheduledBackupCommand(params.job)
    ? beginLifecycleWriteCustody("backup")
    : undefined;
  let failure: unknown;
  try {
    // Scope settlement replaces an already-produced command result with its cleanup
    // failure. Keep that result so the command's own outcome stays terminal while
    // the cleanup uncertainty is recorded beside it and still reaches custody.
    const produced: { result?: SpawnResult } = {};
    let result: SpawnResult;
    let cleanupFailure: Error | undefined;
    try {
      const spawn = resolveCronCommandSpawn(params.job, payload);
      result = await withCommandProcessScope(async () => {
        produced.result = await runCommandWithTimeout(spawn.argv, {
          timeoutMs: secondsToMs(payload.timeoutSeconds) ?? DEFAULT_COMMAND_TIMEOUT_MS,
          ...(spawn.cwd ? { cwd: spawn.cwd } : {}),
          ...(payload.input !== undefined ? { input: payload.input } : {}),
          ...(spawn.env ? { env: spawn.env } : {}),
          ...(noOutputTimeoutMs !== undefined ? { noOutputTimeoutMs } : {}),
          ...(payload.outputMaxBytes !== undefined
            ? { maxOutputBytes: payload.outputMaxBytes }
            : {}),
          preserveOutputLine: isCronCommandActionCriticalLine,
          ...(params.abortSignal ? { signal: params.abortSignal } : {}),
          killProcessTree: true,
        });
        return produced.result;
      });
    } catch (err) {
      if (!produced.result || !hasCommandProcessCleanupError(err) || !(err instanceof Error)) {
        throw err;
      }
      failure = cleanupFailure = err;
      result = produced.result;
    }
    const termination =
      result.termination === "signal" &&
      params.abortSignal?.reason instanceof Error &&
      params.abortSignal.reason.name === "TimeoutError"
        ? "timeout"
        : result.termination;
    const ok =
      result.code === 0 &&
      !result.killed &&
      termination !== "timeout" &&
      termination !== "no-output-timeout" &&
      termination !== "signal";
    const status: CronRunStatus = ok && !cleanupFailure ? "ok" : "error";
    const summary = buildCronCommandSummary({
      stdout: result.stdout,
      stderr: result.stderr,
      preservedStdoutLines: result.preservedStdoutLines,
      preservedStderrLines: result.preservedStderrLines,
    });
    const error = ok
      ? cleanupFailure?.message
      : commandErrorMessage({
          code: result.code,
          signal: result.signal,
          termination,
        });
    const failureNotificationDetail =
      termination === "timeout"
        ? ({ kind: "command-timeout", mode: "wall-clock" } as const)
        : termination === "no-output-timeout"
          ? ({ kind: "command-timeout", mode: "no-output" } as const)
          : termination === "exit" && typeof result.code === "number" && result.code !== 0
            ? ({ kind: "command-exit", exitCode: result.code } as const)
            : undefined;
    return {
      status,
      ...(error ? { error } : {}),
      ...(failureNotificationDetail
        ? {
            failureNotificationDetail,
            errorClassification:
              failureNotificationDetail.kind === "command-timeout"
                ? ({ kind: "reason", reason: "timeout" } as const)
                : ({ kind: "permanent" } as const),
          }
        : ok && cleanupFailure
          ? { errorClassification: { kind: "permanent" as const } }
          : {}),
      ...(summary ? { summary } : {}),
      diagnostics: buildDiagnostics({
        command,
        status,
        summary,
        code: result.code,
        signal: result.signal,
        stdoutTruncatedBytes: result.stdoutTruncatedBytes,
        stderrTruncatedBytes: result.stderrTruncatedBytes,
        ...(cleanupFailure ? { cleanupError: cleanupFailure.message } : {}),
        nowMs,
      }),
    };
  } catch (err) {
    failure = err;
    const error = err instanceof Error ? err.message : String(err);
    return {
      status: "error",
      error,
      ...(err instanceof Error && "code" in err && err.code === "ENOENT"
        ? { errorClassification: { kind: "permanent" as const } }
        : {}),
      diagnostics: {
        summary: error,
        entries: [
          {
            ts: nowMs(),
            source: "exec",
            severity: "error",
            message: `command failed to start: ${command}: ${error}`,
            exitCode: null,
          },
        ],
      },
    };
  } finally {
    releaseCustody?.(failure);
  }
}
