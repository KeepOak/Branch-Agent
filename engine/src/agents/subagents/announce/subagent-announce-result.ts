import { isRecord } from "@branch/normalization-core/record-coerce";
import type { AgentRunSessionTarget } from "../../run-session-target.types.js";
import { extractStoredAssistantText } from "../../tools/chat-history-text.js";
import { resolveSubagentCompletionResultText } from "../completion/subagent-completion-result.js";
import type { SubagentLifecycleEndedReason } from "../registry/subagent-lifecycle-events.js";
import type { SubagentRunRecord } from "../registry/subagent-registry.types.js";

export { buildChildCompletionFindings } from "./subagent-child-findings.js";

type OutputRuntime = typeof import("./subagent-announce.runtime.js");
type SubagentAnnounceResultDeps = Pick<
  OutputRuntime,
  | "getRuntimeConfig"
  | "readSubagentSessionEntry"
  | "resolveAgentIdFromSessionKey"
  | "resolveSessionStorePathCore"
> & {
  findTranscriptEvent: typeof import("../../../config/sessions/session-accessor.js").findTranscriptEvent;
  findSessionTranscriptArchiveEventReadOnly: typeof import("../../../config/sessions/session-history.js").findSessionTranscriptArchiveEventReadOnly;
};

type AnnounceChild = Pick<ChildCompletionRow, "childSessionKey" | "execution" | "completion"> & {
  runId: string;
};
export type PreparedAnnounceResult = { text: string | undefined; isCurrent: () => boolean };

function captureAnnounceResultAuthority(child: AnnounceChild): () => boolean {
  const { runId, childSessionKey } = child;
  const terminalReply = child.completion?.terminalReply;
  const outcome = child.execution.outcome;
  const target = child.execution.transcriptTarget;
  const targetIdentity = target ? { ...target } : undefined;
  return () => {
    const currentTarget = child.execution.transcriptTarget;
    return (
      child.runId === runId &&
      child.childSessionKey === childSessionKey &&
      child.completion?.terminalReply === terminalReply &&
      child.execution.outcome === outcome &&
      currentTarget === target &&
      currentTarget?.sessionId === targetIdentity?.sessionId &&
      currentTarget?.agentId === targetIdentity?.agentId &&
      currentTarget?.storePath === targetIdentity?.storePath
    );
  };
}

/** Read the final assistant message from the transcript identity owned by this run. */
export async function readSubagentRunAnnounceResultUsing(
  child: AnnounceChild,
  deps: SubagentAnnounceResultDeps,
): Promise<PreparedAnnounceResult> {
  const isCurrent = captureAnnounceResultAuthority(child);
  const terminalReply = child.completion?.terminalReply;
  const capturedResult = resolveSubagentCompletionResultText(child);
  if (
    !capturedResult ||
    terminalReply?.disposition !== "visible" ||
    child.execution.outcome?.status !== "ok"
  ) {
    return { text: capturedResult, isCurrent };
  }
  const runId = child.runId;
  const childSessionKey = child.childSessionKey;
  const target = child.execution.transcriptTarget;
  const agentId = target?.agentId ?? deps.resolveAgentIdFromSessionKey(childSessionKey);
  const storePath =
    target?.storePath ??
    deps.resolveSessionStorePathCore(deps.getRuntimeConfig().session?.store, { agentId });
  const sessionKey = target?.sessionKey ?? childSessionKey;
  const sessionId =
    target?.sessionId ?? deps.readSubagentSessionEntry(storePath, sessionKey)?.sessionId;
  const scope = { agentId, storePath, sessionKey };
  const found = sessionId
    ? await deps.findTranscriptEvent({ ...scope, sessionId }, { kind: "visible-final", runId })
    : undefined;
  let event: unknown = found?.event;
  if (!event) {
    // Delete commits the canonical archive before its derived file is published.
    event = (await deps.findSessionTranscriptArchiveEventReadOnly({ ...scope, sessionId }, runId))
      ?.event;
  }
  if (!isCurrent()) {
    throw new Error("The completed child run's transcript identity changed during announcement.");
  }
  const answer = isRecord(event) ? extractStoredAssistantText(event.message) : undefined;
  if (!answer) {
    return {
      text: `[truncated-by-retention: complete child answer unavailable]\n${terminalReply.text}`,
      isCurrent,
    };
  }
  return { text: answer, isCurrent };
}

type CompletionResultSource = Parameters<typeof resolveSubagentCompletionResultText>[0];
type ChildCompletionExecution = CompletionResultSource["execution"] & {
  endedAt?: number;
  outcome?: NonNullable<CompletionResultSource["execution"]["outcome"]> & { error?: string };
  transcriptTarget?: AgentRunSessionTarget;
  interruptionReason?: SubagentRunRecord["execution"]["interruptionReason"];
};

export type ChildCompletionRow = {
  announceResult?: string;
  childSessionKey: string;
  task: string;
  taskName?: string;
  label?: string;
  createdAt: number;
  execution: ChildCompletionExecution;
  endedReason?: SubagentLifecycleEndedReason;
  completion?: Parameters<typeof resolveSubagentCompletionResultText>[0]["completion"];
};
