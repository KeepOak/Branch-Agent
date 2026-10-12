/** The repair request the scheduler posts into a failing automation's owner conversation. */
import { sliceUtf16Safe } from "@branch/normalization-core/utf16-slice";
import type { FailoverReason } from "../../agents/failover/signal.js";
import { wrapUntrustedPromptDataBlock } from "../../agents/sanitize-for-prompt.js";
import { SILENT_REPLY_TOKEN } from "../../auto-reply/tokens.js";
import type { CronJob } from "../types.js";

const REPAIR_PAYLOAD_MAX_CHARS = 4_000;
const REPAIR_ERROR_MAX_CHARS = 1_000;

/*
 * Tail selection harvested from OpenHands/OpenHands@a8c05584ec6bb063a0857460b9cbff48e136919f
 * src/utils/automation-debug-prompt.ts keepTail. Reserve the marker inside Branch
 * bounds and reuse canonical surrogate-safe slicing.
 * The MIT License (MIT)
 *
 * Copyright © 2025 OpenHands contributors
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the “Software”), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED “AS IS”, WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */
function keepRepairErrorTail(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const marker = ".(truncated).\n";
  return `${marker}${sliceUtf16Safe(text, -(maxChars - marker.length))}`;
}

export function buildCronFailureRepairBrief(params: {
  job: CronJob;
  consecutiveErrors: number;
  error?: string;
  errorReason?: FailoverReason;
}): string {
  const { job } = params;
  const payload = job.payload;
  const payloadText =
    payload.kind === "agentTurn"
      ? payload.message
      : payload.kind === "systemEvent"
        ? payload.text
        : payload.kind === "script"
          ? payload.script
          : payload.kind === "command"
            ? JSON.stringify({ argv: payload.argv, ...(payload.cwd ? { cwd: payload.cwd } : {}) })
            : "";
  const cause = params.errorReason ? `cause: ${params.errorReason}` : "";
  const detail = params.error?.trim() ?? "";
  const detailBudget = REPAIR_ERROR_MAX_CHARS - cause.length - (cause && detail ? 1 : 0);
  const error = [cause, keepRepairErrorTail(detail, detailBudget)].filter(Boolean).join("\n");
  return [
    `Automation repair request from the scheduler, not a user message. Do not relay it; follow the steps below.`,
    `An automation (id ${job.id}), created in this conversation, failed ${params.consecutiveErrors} consecutive runs. No failure alert was sent.`,
    `Schedule: ${JSON.stringify(job.schedule)}. Payload kind: ${payload.kind}.`,
    // Job text and provider errors can carry third-party content: data, never instructions.
    wrapUntrustedPromptDataBlock({ label: "Automation name", text: job.name, maxChars: 200 }),
    wrapUntrustedPromptDataBlock({
      label: "Current payload",
      text: payloadText,
      maxChars: REPAIR_PAYLOAD_MAX_CHARS,
      truncationMarker: " [truncated]",
    }),
    wrapUntrustedPromptDataBlock({
      label: "Last error",
      text: error || "No error text recorded.",
      maxChars: REPAIR_ERROR_MAX_CHARS,
      truncationMarker: " [truncated]",
    }),
    "",
    "Diagnose the failure, then do exactly one:",
    `1. Transient (provider outage, network, rate limit, or temporary upstream error): change nothing and reply exactly ${SILENT_REPLY_TOKEN}.`,
    "2. Fixable in the workspace (for example the helper script or instructions file the payload follows): fix it, then reply with one line saying what you fixed.",
    "3. Otherwise: ask the user for exactly what you need to fix it.",
    "If the automation keeps failing, the user gets the normal failure alert.",
  ].join("\n");
}
