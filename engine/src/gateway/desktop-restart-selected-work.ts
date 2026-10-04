import {
  ACTIVE_EMBEDDED_RUNS,
  ACTIVE_EMBEDDED_RUNS_BY_RUN_ID,
  ACTIVE_EMBEDDED_RUN_REGISTRATIONS,
} from "../agents/embedded-agent-runner/run-state.js";
import { resolveActiveReplyRunOwnerForSignal } from "../auto-reply/reply/reply-run-registry.state.js";
import {
  getActiveAgentRunDelegatedAuthority,
  getAgentRunContext,
  hasAgentRunContextExecutionOwner,
} from "../infra/agent-run-registry.js";
import { readSelectedRunWorkCoverage } from "../process/gateway-work-ownership-coverage.js";
import type { ChatAbortControllerEntry } from "./chat-abort.types.js";

/** Counts are observations of exact canonical owners, never permissions or hints. */
export function readDesktopSelectedWorkCoverage(runId: string, entry: ChatAbortControllerEntry) {
  const selected = {
    runId,
    sessionKey: entry.sessionKey,
    sessionId: entry.sessionId,
    controller: entry.controller,
  };
  const counts = readSelectedRunWorkCoverage(selected).coveredCounts;
  let agentRuns = 0,
    embeddedRuns = 0;
  const instance = entry.operationalRunInstance;
  const authority = instance && getActiveAgentRunDelegatedAuthority(instance);
  const context = getAgentRunContext(runId);
  if (
    instance?.runId === runId &&
    authority &&
    hasAgentRunContextExecutionOwner(runId) &&
    context?.sessionKey === entry.sessionKey &&
    context.sessionId === entry.sessionId &&
    context.lifecycleGeneration === entry.lifecycleGeneration
  )
    agentRuns = 1;
  const handle = ACTIVE_EMBEDDED_RUNS_BY_RUN_ID.get(runId);
  const registration = handle && ACTIVE_EMBEDDED_RUN_REGISTRATIONS.get(handle);
  if (
    instance &&
    authority &&
    handle &&
    registration?.operationalRunInstance === instance &&
    registration.delegatedAuthority === authority &&
    registration.sessionId === entry.sessionId &&
    registration.sessionKey === entry.sessionKey &&
    ACTIVE_EMBEDDED_RUNS.get(entry.sessionId) === handle &&
    handle.isAborted?.() !== true &&
    handle.isStopped?.() !== true
  )
    embeddedRuns = 1;
  const replyOwner = resolveActiveReplyRunOwnerForSignal(entry.controller.signal);
  if (replyOwner?.sessionKey === entry.sessionKey && replyOwner.sessionId === entry.sessionId)
    embeddedRuns = 1;
  return { ...counts, chatRuns: 1, agentRuns, embeddedRuns };
}
