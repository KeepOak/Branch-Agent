/** Pure parent completion findings; transcript reads remain in the announcement owner. */
import { truncateUtf16WithEllipsis } from "../../../shared/text-truncate.js";
import { wrapPromptDataBlock } from "../../sanitize-for-prompt.js";
import { resolveSubagentCompletionResultText } from "../completion/subagent-completion-result.js";
import { SUBAGENT_ENDED_REASON_KILLED } from "../registry/subagent-lifecycle-events.js";
import type { ChildCompletionRow } from "./subagent-announce-result.js";
import { buildFailureReply, extractFailureReason } from "./subagent-failure-reason.js";

const MAX_CHILD_COMPLETION_FIELD_CHARS = 256;

function describeSubagentOutcome(child: ChildCompletionRow): string {
  const outcome = child.execution.outcome;
  if (child.endedReason === SUBAGENT_ENDED_REASON_KILLED) {
    const error = outcome?.error?.trim();
    return error ? `cancelled: ${error}` : "cancelled";
  }
  if (child.execution.interruptionReason === "gateway-restart") {
    return "interrupted by gateway restart";
  }
  if (!outcome) {
    return "unknown";
  }
  if (outcome.status === "ok") {
    return "ok";
  }
  if (outcome.status === "timeout" || outcome.status === "error") {
    const error = outcome.error?.trim();
    return error ? `${outcome.status}: ${error}` : outcome.status;
  }
  return "unknown";
}

function formatChildResultData(resultText?: string | null): string {
  return (
    wrapPromptDataBlock({
      label: "Child result",
      text: resultText?.trim() || "(no output)",
    }) || "Child result: (no output)"
  );
}

export function buildChildCompletionFindings(
  children: Array<ChildCompletionRow>,
): string | undefined {
  const sorted = children.toSorted((a, b) => {
    if (a.createdAt !== b.createdAt) {
      return a.createdAt - b.createdAt;
    }
    const aEnded =
      typeof a.execution.endedAt === "number" ? a.execution.endedAt : Number.MAX_SAFE_INTEGER;
    const bEnded =
      typeof b.execution.endedAt === "number" ? b.execution.endedAt : Number.MAX_SAFE_INTEGER;
    if (aEnded !== bEnded) {
      return aEnded - bEnded;
    }
    // Parallel children commonly share millisecond timestamps; their stable
    // session identity keeps parent-visible findings and prompt bytes ordered.
    return a.childSessionKey < b.childSessionKey
      ? -1
      : a.childSessionKey > b.childSessionKey
        ? 1
        : 0;
  });

  const sections: string[] = [];
  for (const [index, child] of sorted.entries()) {
    const capturedResult = child.announceResult ?? resolveSubagentCompletionResultText(child);
    const failedWithoutResult =
      child.execution.outcome?.status === "error" &&
      child.endedReason !== SUBAGENT_ENDED_REASON_KILLED &&
      child.execution.interruptionReason !== "gateway-restart";
    const resultText =
      capturedResult ||
      (failedWithoutResult
        ? buildFailureReply(
            child.label?.trim() ?? "",
            extractFailureReason(child.execution.outcome?.error ?? ""),
          )
        : capturedResult);
    const outcome = describeSubagentOutcome(child);
    if (
      child.execution.outcome?.status === "ok" &&
      !resultText &&
      child.completion?.terminalReply?.disposition !== "empty" &&
      (child.completion?.terminalReply ||
        child.completion?.resultText?.trim() ||
        child.completion?.fallbackResultText?.trim())
    ) {
      continue;
    }
    const title =
      child.taskName?.trim() ||
      child.label?.trim() ||
      child.task.trim() ||
      child.childSessionKey.trim() ||
      `child ${index + 1}`;
    const displayIndex = sections.length + 1;
    sections.push(
      [
        wrapPromptDataBlock({
          label: `${displayIndex}. Child task`,
          text: title,
          maxEscapedChars: MAX_CHILD_COMPLETION_FIELD_CHARS,
          truncationMarker: "…",
        }),
        `status: ${truncateUtf16WithEllipsis(outcome, MAX_CHILD_COMPLETION_FIELD_CHARS)}`,
        formatChildResultData(resultText),
      ].join("\n"),
    );
  }

  if (sections.length === 0) {
    return undefined;
  }

  return ["Child completion results:", "", ...sections].join("\n\n");
}
