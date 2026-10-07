// The moment Lockdown turns on, everything already running stops, wherever it started: window chats,
// channel messages, cron, hooks, subagents, ACP harnesses and background commands.
import { peekAcpSessionManager } from "../acp/control-plane/manager.js";
import { cancelBackgroundExecSession } from "../agents/bash-process-control.js";
import { listRunningSessions } from "../agents/bash-process-registry.js";
import { abortEmbeddedAgentRun } from "../agents/embedded-agent-runner/runs.js";
import { abortActiveCronTaskRuns } from "../cron/service/active-run-cancellation.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { abortChatRunById, type ChatAbortOps } from "./chat-abort.js";

const log = createSubsystemLogger("gateway/lockdown");
export const LOCKDOWN_STOP_REASON = "Lockdown is on";

/** True when this commit switches Lockdown from off to on. */
export function isLockdownEngaging(previous: unknown, next: unknown): boolean {
  const flag = (config: unknown) =>
    (config as { security?: { lockdown?: unknown } } | undefined)?.security?.lockdown === true;
  return flag(next) && !flag(previous);
}

function abortWindowRuns(ops: ChatAbortOps): void {
  for (const [runId, entry] of ops.chatAbortControllers) {
    abortChatRunById(ops, { runId, sessionKey: entry.sessionKey, stopReason: LOCKDOWN_STOP_REASON });
  }
}

/** Stops every running Trunk. `ops` is the gateway's chat run state when the gateway context is up. */
export function stopRunningWorkForLockdown(ops?: ChatAbortOps): void {
  if (ops) abortWindowRuns(ops);
  // Channel inbound, cron, hooks and subagents run outside the window's chat registry.
  abortEmbeddedAgentRun(undefined, { mode: "all" });
  abortActiveCronTaskRuns(LOCKDOWN_STOP_REASON);
  // Only agent-owned background commands; desktop and update processes share the supervisor and keep running.
  for (const session of listRunningSessions()) {
    cancelBackgroundExecSession(session.id);
  }
  void peekAcpSessionManager()
    ?.cancelAllTurns(LOCKDOWN_STOP_REASON)
    .catch((error: unknown) => log.warn(`ACP turns did not all stop for Lockdown: ${String(error)}`));
}
