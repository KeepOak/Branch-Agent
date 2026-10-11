import { readBrowserPresentation } from "./browser-presentation";
// Rebuilds the thread from `chat.history` messages and the engine's terminal approval ledger
// (`approval.history`), so steps, approval outcomes and Done lines come back after a reload.
import {
  describeToolCall,
  isDeniedResultText,
  wrapperFailed,
  isCodeModeCall,
  keepOutput,
  toolInput,
  resultText,
  recordedAt,
  readFileChanges,
  type Approval,
  type Attachment,
  type Block,
  type MessageMeta,
  type StepStatus,
} from "./model";
import { readTextToolCall, stepFromTextToolCall } from "./text-tool-call";
import { teamFromToolText } from "./team-proposal";
import { displayToolInput, displayToolOutput, sanitizeBlocks } from "./tool-output-display";
import { readOwner, readSender } from "../rooms/sender";

/** One terminal approval from `approval.history`. */
export type ApprovalRecord = {
  id: string;
  status: string;
  commandText: string;
  sessionKey?: string;
  createdAtMs: number;
};

type Message = Record<string, unknown>;
type Builder = {
  blocks: Block[];
  steps: Map<string, { at: number; command: string; ts: number }>;
  /** Code Mode wrappers (an `exec` whose code called real tools): their nested calls are the steps, not them. */
  wrappers: Set<string>;
  runId: string | null;
  runStart: number;
  runFinished: boolean;
  /** The run was stopped (an aborted partial the engine kept: `branchAbort`). */
  runStopped: boolean;
  /** When the newest message was written (`__branch.recordTimestampMs`), so a run ends when its last reply ended. */
  lastTs: number;
  /** Keep every tool result whole (complete transcript exports); the thread keeps a tail of long ones. */
  wholeOutput: boolean;
};

const rec = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" ? (v as Record<string, unknown>) : {};
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const num = (v: unknown): number => (typeof v === "number" ? v : 0);

/** Reads `approval.history` items into the fields the thread needs. */
export function readApprovalRecords(result: unknown): ApprovalRecord[] {
  const items = rec(result).items;
  if (!Array.isArray(items)) {
    return [];
  }
  return items.map((item) => {
    const r = rec(item);
    return {
      id: str(r.id),
      status: str(r.status),
      commandText: str(rec(r.presentation).commandText),
      sessionKey: str(rec(r.source).sessionKey) || undefined,
      createdAtMs: num(r.createdAtMs),
    };
  });
}

/** The Via line for Branch apps (DESIGN-SPEC §4.2.2 Parity adds), from the transport the engine recorded. */
const VIA: Record<string, string> = {
  cli: "via the branch command",
  "branch-tui": "via the terminal",
  "branch-control-ui": "via the browser",
  webchat: "via the browser",
  "branch-browser-copilot": "via the browser",
  "gateway-client": "via a script",
  "node-host": "via a script",
};

function readVia(branch: Record<string, unknown>): string | undefined {
  const clients = rec(branch.transport).clients;
  const first = Array.isArray(clients) ? rec(clients[0]) : {};
  return VIA[str(first.id)];
}

/** What the engine recorded about a message: entry id, run, time, model and usage. */
export function readMeta(m: Message): MessageMeta {
  const branch = rec(m.__branch);
  const sender = readSender(m);
  const usage = rec(m.usage);
  const cost = rec(usage.cost);
  const key = str(m.idempotencyKey) || str(branch.idempotencyKey);
  return {
    ...(str(branch.id) ? { entryId: str(branch.id) } : {}),
    ...(str(branch.runId) ? { runId: str(branch.runId) } : {}),
    ...(key.endsWith(":user") ? { runKey: key.slice(0, -":user".length) } : {}),
    ...(num(m.timestamp) ? { timestamp: num(m.timestamp) } : {}),
    ...(str(m.model) ? { model: str(m.model) } : {}),
    ...(str(m.provider) ? { provider: str(m.provider) } : {}),
    ...(str(m.stopReason) ? { stopReason: str(m.stopReason) } : {}),
    ...(readVia(branch) ? { via: readVia(branch) } : {}),
    ...(sender ? { sender } : {}),
    ...(readOwner(m) ? { owner: true } : {}),
    ...(m.excludeFromContext === true ? { excluded: true } : {}),
    ...(m.usage
      ? {
          usage: {
            input: num(usage.input),
            output: num(usage.output),
            total: num(usage.totalTokens),
            cost: num(cost.total),
          },
        }
      : {}),
  };
}

function messageText(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  return content
    .filter((c) => rec(c).type === "text")
    .map((c) => str(rec(c).text))
    .join("");
}

const KIND_BY_TYPE: Record<string, Attachment["kind"]> = {
  image: "image",
  audio: "audio",
  video: "video",
  file: "file",
};

/** A media or file part of a message's content, as an attachment the thread can show. */
export function readAttachment(part: unknown): Attachment | null {
  const p = rec(part);
  const kind = KIND_BY_TYPE[str(p.type)];
  if (!kind) {
    return null;
  }
  const mimeType = str(p.mimeType) || str(p.mediaType) || undefined;
  const data = str(p.data);
  const url = str(p.url) || str(rec(p.source).url);
  const src = data
    ? `data:${mimeType ?? "application/octet-stream"};base64,${data}`
    : url || undefined;
  return {
    kind,
    name: str(p.name) || str(p.fileName) || str(p.filename) || str(p.alt) || kind,
    ...(str(p.artifactId) ? { artifactId: str(p.artifactId) } : {}),
    ...(mimeType ? { mimeType } : {}),
    ...(src ? { src } : {}),
    ...(num(p.sizeBytes) ? { sizeBytes: num(p.sizeBytes) } : {}),
    kept: Boolean(src),
  };
}

function attachmentsOf(content: unknown): Attachment[] {
  return Array.isArray(content)
    ? content.map(readAttachment).filter((a): a is Attachment => a !== null)
    : [];
}

function closeRun(b: Builder, inFlightRunId: string | null): void {
  if (b.runId && b.runFinished && b.runId !== inFlightRunId) {
    b.blocks.push({
      kind: "done",
      key: `${b.runId}:done`,
      runId: b.runId,
      durationMs: Math.max(0, b.lastTs - b.runStart),
      ...(b.runStopped ? { stopped: true } : {}),
    });
  }
  b.runId = null;
  b.runFinished = false;
  b.runStopped = false;
}

/** When a message was written: the engine's record time, else the message's own time. An assistant message's own
 *  `timestamp` is when its stream began, so a long reply would end its run too early ("Done in 7s" for 55 s). */
function writtenAt(m: Message): number {
  return num(rec(m.__branch).recordTimestampMs) || num(m.timestamp);
}

function pushAssistantText(b: Builder, key: string, text: string, m: Message): void {
  const call = readTextToolCall(text);
  if (call) {
    b.blocks.push(
      stepFromTextToolCall(call, key, {
        outputKey: `${b.runId ?? key}:${key}`,
        at: num(m.timestamp),
      }),
    );
    return;
  }
  b.blocks.push({ kind: "text", key, text, streaming: false, meta: readMeta(m) });
}

function onAssistantPart(b: Builder, part: unknown, key: string, m: Message): void {
  const p = rec(part);
  if (p.type === "text" && str(p.text).trim()) {
    pushAssistantText(b, key, str(p.text), m);
  } else if (p.type === "thinking" && str(p.thinking).trim()) {
    b.blocks.push({ kind: "thinking", key, text: str(p.thinking), live: false });
  } else if (p.type === "toolCall") {
    const id = str(p.id) || key;
    const title = describeToolCall(str(p.name), p.arguments);
    b.blocks.push({
      kind: "step",
      key: id,
      outputKey: `${b.runId ?? key}:${id}`,
      tool: str(p.name),
      title,
      detail: "",
      status: "ok",
      input: toolInput(p.arguments),
      changes: readFileChanges(p.arguments),
      ...recordedAt(m.timestamp),
      ...(isCodeModeCall(str(p.name), p.arguments) ? { codeMode: true } : {}),
    });
    b.steps.set(id, {
      at: b.blocks.length - 1,
      command: str(rec(p.arguments).command),
      ts: num(m.timestamp),
    });
  } else if (typeof part === "string" && part.trim()) {
    pushAssistantText(b, key, part, m);
  }
}

function onAssistant(b: Builder, m: Message, index: number): void {
  const content = Array.isArray(m.content) ? m.content : [m.content];
  for (const [i, part] of content.entries()) {
    onAssistantPart(b, part, `h:${index}:${i}`, m);
  }
  const media = attachmentsOf(m.content);
  if (media.length) {
    b.blocks.push({
      kind: "text",
      key: `h:${index}:media`,
      text: "",
      streaming: false,
      meta: readMeta(m),
      attachments: media,
    });
  }
  if (str(m.stopReason) === "error" && str(m.errorMessage)) {
    b.blocks.push({
      kind: "error",
      key: `h:${index}:error`,
      runId: b.runId ?? undefined,
      message: str(m.errorMessage),
    });
  }
  b.runFinished = str(m.stopReason) !== "toolUse";
  b.runStopped ||= rec(m.branchAbort).aborted === true;
}

function findApproval(
  records: readonly ApprovalRecord[],
  sessionKey: string,
  step: { command: string; ts: number },
  resultTs: number,
): ApprovalRecord | undefined {
  return records.find(
    (r) =>
      r.commandText === step.command &&
      (!r.sessionKey || r.sessionKey === sessionKey) &&
      r.createdAtMs >= step.ts - 1000 &&
      r.createdAtMs <= resultTs + 1000,
  );
}

function approvalState(status: string): Approval["state"] {
  return status === "allowed" ? "allowed" : status === "pending" ? "pending" : "denied";
}

function onToolResult(
  b: Builder,
  m: Message,
  records: readonly ApprovalRecord[],
  sessionKey: string,
): void {
  const step = b.steps.get(str(m.toolCallId));
  if (!step) return;
  const block = b.blocks[step.at] as Extract<Block, { kind: "step" }>;
  const text = resultText(m);
  // A Code Mode run that failed says so in its own result (status "failed", no isError).
  const codeFailed = block.codeMode === true && wrapperFailed(m.isError, text, m.details);
  if (b.wrappers.has(str(m.toolCallId))) {
    // A wrapper's own result is the code's JSON; its nested calls already carry what ran and how it ended, unless
    // the code itself failed, which shows as the wrapper's step.
    if (!codeFailed) return;
    b.wrappers.delete(str(m.toolCallId));
  }
  const status: StepStatus = isDeniedResultText(text)
    ? "denied"
    : m.isError || codeFailed
      ? "failed"
      : "ok";
  const shown = displayToolOutput({ tool: block.tool, text, title: block.title });
  b.blocks[step.at] = {
    ...block,
    status,
    detail: shown.slice(0, 400),
    output: b.wholeOutput ? shown : keepOutput(block.outputKey ?? block.key, shown),
    input: displayToolInput(block.tool, block.input),
    browser: status === "ok" ? readBrowserPresentation(m, block.tool, block.key) : undefined,
    ...recordedAt(m.timestamp),
  };
  if (status === "ok" && block.tool === "team_propose") {
    const team = teamFromToolText(text);
    if (team) b.blocks.push({ kind: "team", key: `${str(m.toolCallId)}:team`, result: team });
  }
  const deniedId = /gateway id=([0-9a-f-]{8,})/i.exec(text)?.[1];
  const found = findApproval(records, sessionKey, step, num(m.timestamp));
  const id = deniedId ?? found?.id;
  if (!id) {
    return;
  }
  const state = deniedId && status === "denied" ? "denied" : approvalState(found?.status ?? "");
  const approval: Approval = { id, command: step.command, state };
  b.blocks.splice(step.at + 1, 0, { kind: "approval", key: `approval:${id}`, approval });
  for (const [key, value] of b.steps) {
    if (value.at > step.at) {
      b.steps.set(key, { ...value, at: value.at + 1 });
    }
  }
}

/**
 * A tool a Code Mode `exec` called from its code (`branch.nested-tool.v1`: the nested call and its result). It is
 * the step the person reads (the real command, its approval, "Not allowed" when refused); the wrapper around it
 * (`{title, code}` and a JSON result that always says "completed") is dropped, so a refused command no longer reads
 * "Ran a command · Done", and the live view and the finished turn count the same steps.
 */
function onNestedTool(
  b: Builder,
  m: Message,
  records: readonly ApprovalRecord[],
  sessionKey: string,
): void {
  const parts = Array.isArray(m.content) ? m.content.map(rec) : [];
  for (const part of parts) {
    if (part.type === "toolCall" && str(part.id)) {
      const id = str(part.id);
      if (str(part.parentToolCallId)) b.wrappers.add(str(part.parentToolCallId));
      if (b.steps.has(id)) continue;
      const at = num(part.timestamp) || writtenAt(m);
      b.blocks.push({
        kind: "step",
        key: id,
        outputKey: `${b.runId ?? id}:${id}`,
        tool: str(part.name),
        title: describeToolCall(str(part.name), part.arguments),
        detail: "",
        status: "ok",
        input: toolInput(part.arguments),
        changes: readFileChanges(part.arguments),
        ...recordedAt(at),
      });
      b.steps.set(id, {
        at: b.blocks.length - 1,
        command: str(rec(part.arguments).command),
        ts: at,
      });
    } else if (part.type === "toolResult" || part.role === "toolResult") {
      onToolResult(b, part, records, sessionKey);
    }
  }
}

/** Removes the Code Mode wrappers whose nested calls became the steps. */
function dropWrappers(b: Builder): Block[] {
  return b.wrappers.size
    ? b.blocks.filter((block) => block.kind !== "step" || !b.wrappers.has(block.key))
    : b.blocks;
}

/** A `custom` transcript entry the engine marks for display: a failed run, or a note. */
function onCustom(b: Builder, m: Message, index: number): void {
  if (m.display !== true) {
    return;
  }
  const text = messageText(m.content).trim();
  if (!text) {
    return;
  }
  if (str(m.customType) === "run-failed-before-reply") {
    b.blocks.push({ kind: "error", key: `h:${index}`, runId: b.runId ?? undefined, message: text });
    return;
  }
  b.blocks.push({ kind: "notice", key: `h:${index}`, text });
}

/** The turn the engine's restart recovery sent to carry an interrupted run on (provenance
 * internal_system / main_session_restart_recovery, engine sessions/input-provenance.ts). */
function isRestartResume(m: Message): boolean {
  const provenance = rec(m.provenance);
  return (
    str(provenance.kind) === "internal_system" &&
    str(provenance.sourceTool).toLowerCase() === "main_session_restart_recovery"
  );
}

function onUser(b: Builder, m: Message, index: number, inFlightRunId: string | null): void {
  if (str(rec(m.__branch).steerTargetRunId)) {
    // Steered into the turn that was running: it stays that turn's, so its Done line and steps stay whole.
    b.blocks.push({
      kind: "steer",
      key: `h:${index}`,
      text: messageText(m.content),
      meta: readMeta(m),
    });
    return;
  }
  closeRun(b, inFlightRunId);
  // A message sent while the turn before still ran starts its own turn when that one ended.
  b.runStart = Math.max(num(m.timestamp), b.lastTs);
  if (isRestartResume(m)) {
    b.blocks.push({ kind: "notice", key: `h:${index}`, text: RESUMED_AFTER_RESTART });
    return;
  }
  const attachments = attachmentsOf(m.content);
  b.blocks.push({
    kind: "user",
    key: `h:${index}`,
    text: messageText(m.content),
    meta: readMeta(m),
    ...(attachments.length ? { attachments } : {}),
  });
}

/** The mark where restart recovery carried an interrupted run on. */
export const RESUMED_AFTER_RESTART = "Continued after update";

/** Builds the thread from `chat.history` messages. `inFlightRunId` is a run that is still going. */
export function historyToBlocks(
  messages: readonly unknown[],
  records: readonly ApprovalRecord[],
  sessionKey: string,
  inFlightRunId: string | null,
  options: { wholeOutput?: boolean } = {},
): Block[] {
  const b: Builder = {
    blocks: [],
    steps: new Map(),
    wrappers: new Set(),
    runId: null,
    runStart: 0,
    runFinished: false,
    runStopped: false,
    lastTs: 0,
    wholeOutput: options.wholeOutput === true,
  };
  for (const [index, raw] of messages.entries()) {
    const m = rec(raw);
    const runId = str(rec(m.__branch).runId) || null;
    if (m.role === "user") {
      onUser(b, m, index, inFlightRunId);
    } else if (m.role === "assistant") {
      b.runId = runId ?? b.runId;
      onAssistant(b, m, index);
    } else if (m.role === "toolResult") {
      onToolResult(b, m, records, sessionKey);
    } else if (m.role === "custom" && str(m.customType) === "branch.nested-tool.v1") {
      onNestedTool(b, m, records, sessionKey);
    } else if (m.role === "custom") {
      onCustom(b, m, index);
      b.runFinished ||= str(m.customType) === "run-failed-before-reply";
    }
    // Only a turn's own messages move its end; notes the engine writes between turns (compaction and reset markers,
    // context) can be stamped "now" and would zero every later "Done in".
    if (
      (m.role !== "custom" && m.role !== "system") ||
      ["run-failed-before-reply", "branch.nested-tool.v1"].includes(str(m.customType))
    )
      b.lastTs = Math.max(b.lastTs, writtenAt(m));
  }
  closeRun(b, inFlightRunId);
  return sanitizeBlocks(dropWrappers(b), { wholeOutput: b.wholeOutput });
}

/**
 * Marks the turns of runs that were stopped (`stopped` holds their run ids): their Done line becomes "Stopped". A run
 * stopped before it wrote anything has no Done line in the history, so one is added after your message's turn.
 */
export function markStopped(blocks: readonly Block[], stopped: ReadonlySet<string>): Block[] {
  if (!stopped.size) return [...blocks];
  const out = blocks.map((block) =>
    block.kind === "done" && stopped.has(block.runId) && !block.stopped
      ? { ...block, stopped: true }
      : block,
  );
  const done = new Set(
    out
      .filter((block) => block.kind === "done")
      .map((block) => (block as Extract<Block, { kind: "done" }>).runId),
  );
  for (let i = out.length - 1; i >= 0; i -= 1) {
    const block = out[i];
    const runId = block.kind === "user" ? block.meta?.runKey : undefined;
    if (!runId || !stopped.has(runId) || done.has(runId)) continue;
    let end = i + 1;
    while (end < out.length && out[end].kind !== "user") end += 1;
    out.splice(end, 0, { kind: "done", key: `${runId}:done`, runId, stopped: true });
  }
  return out;
}
