import { isDeepStrictEqual } from "node:util";
import { isRecord } from "@branch/normalization-core/record-coerce";
import { extractStoredAssistantText } from "../../tools/chat-history-text.js";
import { resolveSubagentCompletionResultText } from "../completion/subagent-completion-result.js";
import type { SubagentRunRecord } from "../registry/subagent-registry.types.js";
import { isSameSubagentRunOwner } from "../registry/subagent-run-generation.js";

export { buildChildCompletionFindings } from "./subagent-child-findings.js";

type OutputRuntime = typeof import("./subagent-announce.runtime.js");
type SubagentAnnounceResultDeps = Pick<
  OutputRuntime,
  | "getRuntimeConfig"
  | "readSubagentSessionEntry"
  | "resolveAgentIdFromSessionKey"
  | "resolveSessionStorePathCore"
> & {
  readSubagentRun: (runId: string) => SubagentRunRecord | undefined;
  findTranscriptEvent: typeof import("../../../config/sessions/session-accessor.js").findTranscriptEvent;
  findSessionTranscriptArchiveEventReadOnly: typeof import("../../../config/sessions/session-history.js").findSessionTranscriptArchiveEventReadOnly;
};

export type PreparedAnnounceResult = { text: string | undefined; isCurrent: () => boolean };

function announceResultFacts(child: SubagentRunRecord) {
  return {
    task: child.task,
    taskName: child.taskName,
    label: child.label,
    endedReason: child.endedReason,
    status: child.execution.status,
    endedAt: child.execution.endedAt,
    outcome: child.execution.outcome,
    interruptionReason: child.execution.interruptionReason,
    transcriptTarget: child.execution.transcriptTarget,
    terminalReply: child.completion?.terminalReply,
    resultText: child.completion?.resultText,
    fallbackResultText: child.completion?.fallbackResultText,
  };
}

function captureAnnounceResultAuthority(
  child: SubagentRunRecord,
  readSubagentRun: SubagentAnnounceResultDeps["readSubagentRun"],
): () => boolean {
  const facts = structuredClone(announceResultFacts(child));
  const runId = child.runId;
  return () => {
    const current = readSubagentRun(runId);
    return Boolean(
      current &&
      isSameSubagentRunOwner(current, child) &&
      isDeepStrictEqual(announceResultFacts(current), facts),
    );
  };
}

/** Read the final assistant message from the transcript identity owned by this run. */
export async function readSubagentRunAnnounceResultUsing(
  observed: SubagentRunRecord,
  deps: SubagentAnnounceResultDeps,
): Promise<PreparedAnnounceResult> {
  const child = deps.readSubagentRun(observed.runId);
  if (!child || !isSameSubagentRunOwner(child, observed)) {
    throw new Error("The completed child run's owner changed before announcement.");
  }
  const isCurrent = captureAnnounceResultAuthority(child, deps.readSubagentRun);
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

export type ChildCompletionRow = Pick<
  SubagentRunRecord,
  "childSessionKey" | "task" | "taskName" | "label" | "createdAt" | "endedReason"
> & {
  announceResult?: string;
  execution: Pick<
    SubagentRunRecord["execution"],
    "endedAt" | "outcome" | "transcriptTarget" | "interruptionReason"
  >;
  completion?: Partial<
    Pick<
      NonNullable<SubagentRunRecord["completion"]>,
      "required" | "resultText" | "fallbackResultText" | "terminalReply"
    >
  >;
};
