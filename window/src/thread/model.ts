import { readBrowserPresentation, type BrowserPresentation } from "./browser-presentation";
// The thread's blocks, built from a live run's `agent` events (in seq order) and from `chat.history`.
import type { RunEvent } from "../connect/stream-order";
import type { Sender } from "../rooms/sender";

export type ApprovalState = "pending" | "allowed" | "denied";
export type StepStatus = "running" | "ok" | "failed" | "denied";
export type ApprovalDecision = "allow-once" | "allow-always" | "deny";

export type Approval = {
  id: string;
  command: string;
  cwd?: string;
  /** Where it runs and what the engine noticed about it, shown by "Open". */
  host?: string;
  warnings?: string[];
  state: ApprovalState;
  runId?: string;
  /** Set once the person answered "Always allow" (the decided line says so). */
  always?: boolean;
};

/** What the engine recorded about one transcript entry (`chat.history` message fields and `__branch`). */
export type MessageMeta = {
  /** The transcript entry id (`__branch.id`): what rewind, fork and reactions address. */
  entryId?: string;
  runId?: string;
  timestamp?: number;
  model?: string;
  provider?: string;
  stopReason?: string;
  usage?: { input?: number; output?: number; total?: number; cost?: number };
  /** Where the message was typed, when that is not this window ("via the branch command"). */
  via?: string;
  /** Who wrote it, when the engine recorded someone (a person, an agent on another computer, another Trunk). */
  sender?: Sender;
  /** The engine marks it as the owner's own message (`__branch.senderIsOwner`). */
  owner?: boolean;
};

/** A picture, sound, video or file carried by a message. `src` is a data: or http(s) address. */
export type Attachment = {
  kind: "image" | "audio" | "video" | "file";
  name: string;
  mimeType?: string;
  src?: string;
  sizeBytes?: number;
  /** False when the engine left the bytes out of the history ("Not kept in the history"). */
  kept: boolean;
};

export type Block =
  | { kind: "user"; key: string; text: string; meta?: MessageMeta; attachments?: Attachment[] }
  | { kind: "text"; key: string; text: string; streaming: boolean; meta?: MessageMeta; attachments?: Attachment[] }
  | { kind: "thinking"; key: string; text: string; live: boolean }
  | { kind: "step"; key: string; tool: string; title: string; detail: string; status: StepStatus; output?: string; browser?: BrowserPresentation }
  | { kind: "approval"; key: string; approval: Approval }
  | { kind: "done"; key: string; runId: string; durationMs?: number }
  | { kind: "error"; key: string; runId?: string; message: string }
  | { kind: "notice"; key: string; text: string }
  | { kind: "status"; key: string; phase: string; attempt?: number; maxAttempts?: number };

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : {};
const str = (value: unknown): string => (typeof value === "string" ? value : "");

/** One line that says what a tool call does, for the step line. */
export function describeToolCall(name: string, args: unknown): string {
  const a = record(args);
  const nested = record(a.args);
  const command = str(a.command) || str(nested.command);
  if (command) {
    return command;
  }
  const path = str(a.path) || str(a.file_path) || str(a.filePath);
  const query = str(a.query) || str(a.url) || str(a.task) || str(a.label);
  return path || query || name;
}

/** Reads whether a tool result means "the person said no". */
export function isDeniedResultText(text: string): boolean {
  return /^Exec denied \(/.test(text.trim());
}

/** Reads one pending approval from `exec.approval.requested` or an `exec.approval.list` item. */
export function readApproval(payload: Record<string, unknown>): Approval | null {
  const request = record(payload.request);
  const id = str(payload.id);
  if (!id) {
    return null;
  }
  const warnings = record(request.commandAnalysis).warningLines;
  return {
    id,
    command: str(request.command) || str(request.title),
    cwd: str(request.cwd) || undefined,
    host: str(request.host) || undefined,
    warnings: Array.isArray(warnings) ? warnings.filter((w): w is string => typeof w === "string") : [],
    state: "pending",
    runId: str(request.runId) || undefined,
  };
}

type Builder = { blocks: Block[]; steps: Map<string, number>; text: number | null; thinking: number | null };

function addText(b: Builder, runId: string, seq: number, delta: string): void {
  if (b.text === null) {
    b.blocks.push({ kind: "text", key: `${runId}:text:${seq}`, text: "", streaming: true });
    b.text = b.blocks.length - 1;
  }
  const block = b.blocks[b.text] as Extract<Block, { kind: "text" }>;
  b.blocks[b.text] = { ...block, text: block.text + delta };
}

/** Thinking arrives as a growing snapshot (`text`) with its `delta`; the snapshot wins when present. */
function addThinking(b: Builder, event: RunEvent): void {
  const text = str(event.data.text);
  const delta = str(event.data.delta);
  if (b.thinking === null || b.text !== null) {
    b.blocks.push({ kind: "thinking", key: `${event.runId}:thinking:${event.seq}`, text: "", live: true });
    b.thinking = b.blocks.length - 1;
    b.text = null;
  }
  const block = b.blocks[b.thinking] as Extract<Block, { kind: "thinking" }>;
  b.blocks[b.thinking] = { ...block, text: text || block.text + delta };
}

function startStep(b: Builder, id: string, name: string, args: unknown): void {
  b.text = null;
  b.thinking = null;
  b.blocks.push({ kind: "step", key: id, tool: name, title: describeToolCall(name, args), detail: "", status: "running" });
  b.steps.set(id, b.blocks.length - 1);
}

function onTool(b: Builder, event: RunEvent): void {
  const d = event.data;
  const id = str(d.toolCallId) || `${event.runId}:${event.seq}`;
  const name = str(d.name);
  if (name === "tool_call" || name === "tool_search" || name === "tool_describe") {
    return; // Tool Search controls; the nested real tool gets its own step line.
  }
  if (d.phase === "start") {
    startStep(b, id, name, d.args);
    return;
  }
  const at = b.steps.get(id);
  if (at === undefined) {
    return;
  }
  const step = b.blocks[at] as Extract<Block, { kind: "step" }>;
  if (d.phase === "update") {
    const output = resultText(d.partialResult);
    b.blocks[at] = output ? { ...step, output } : step;
    return;
  }
  if (d.phase !== "result") {
    return;
  }
  const text = resultText(d.result);
  const status: StepStatus = isDeniedResultText(text) ? "denied" : d.isError ? "failed" : "ok";
  b.blocks[at] = { ...step, status, detail: text.slice(0, 400), output: text, browser: status === "ok" ? readBrowserPresentation(d.result, step.tool, id) : undefined };
}

/** The visible text of a tool result: its text blocks, joined. */
export function resultText(result: unknown): string {
  const content = record(result).content;
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .filter((c) => record(c).type === "text")
      .map((c) => str(record(c).text))
      .join("\n");
  }
  return "";
}

function onLifecycle(b: Builder, event: RunEvent, approvals: ReadonlyMap<string, Approval>): void {
  const phase = event.data.phase;
  if (phase === "waiting-approval") {
    const id = str(event.data.approvalId);
    const approval = approvals.get(id) ?? { id, command: "", state: "pending" as const };
    b.text = null;
    b.blocks.push({ kind: "approval", key: `approval:${id}`, approval });
  } else if (phase === "error") {
    const message = str(event.data.error);
    if (message) {
      b.blocks.push({ kind: "error", key: `${event.runId}:error`, runId: event.runId, message });
    }
  }
  if (phase === "end" || phase === "error") {
    const started = Number(event.data.startedAt);
    const ended = Number(event.data.endedAt);
    b.blocks.push({
      kind: "done",
      key: `${event.runId}:done`,
      runId: event.runId,
      ...(started && ended ? { durationMs: ended - started } : {}),
    });
  }
}

/** The run's startup phase (`run_status`), while nothing else has come after it. */
function lastStatus(events: readonly RunEvent[]): Extract<Block, { kind: "status" }> | null {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const e = events[i];
    if (e.stream === "assistant" || e.stream === "tool" || e.stream === "thinking") {
      return null;
    }
    if (e.stream === "run_status" && str(e.data.phase)) {
      const retry = record(e.data.retry);
      return {
        kind: "status",
        key: `${e.runId}:status`,
        phase: str(e.data.phase),
        ...(typeof retry.attempt === "number" ? { attempt: retry.attempt } : {}),
        ...(typeof retry.maxAttempts === "number" ? { maxAttempts: retry.maxAttempts } : {}),
      };
    }
  }
  return null;
}

function settle(blocks: Block[]): Block[] {
  return blocks.map((block) =>
    block.kind === "text" ? { ...block, streaming: false } : block.kind === "thinking" ? { ...block, live: false } : block,
  );
}

/**
 * Turns one run's events, already in seq order, into thread blocks.
 * `approvals` holds the cards from `exec.approval.requested`, keyed by approval id.
 */
export function projectRun(events: readonly RunEvent[], approvals: ReadonlyMap<string, Approval>): Block[] {
  const b: Builder = { blocks: [], steps: new Map(), text: null, thinking: null };
  let ended = false;
  for (const event of events) {
    if (event.stream === "assistant") {
      b.thinking = null;
      addText(b, event.runId, event.seq, str(event.data.delta));
    } else if (event.stream === "thinking") {
      addThinking(b, event);
    } else if (event.stream === "tool") {
      onTool(b, event);
    } else if (event.stream === "lifecycle") {
      onLifecycle(b, event, approvals);
      ended ||= event.data.phase === "end" || event.data.phase === "error";
    }
  }
  if (ended) {
    return settle(b.blocks);
  }
  const status = lastStatus(events);
  return status ? [...b.blocks, status] : b.blocks;
}
