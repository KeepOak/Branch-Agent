import { computerActionLabel, isComputerToolName, isScreenToolName, screenActionLabel } from "./computer-action-label";
import { readBrowserPresentation, type BrowserPresentation } from "./browser-presentation";
import { teamFromToolText, type TeamToolResult } from "./team-proposal";
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
  /** Your message's own run (its idempotency key, "<runId>:user"): what this window sent it as. */
  runKey?: string;
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
  /** The engine omits this message from future model context while keeping it in the transcript. */
  excluded?: boolean;
};

/** A picture, sound, video or file carried by a message. `src` is a data: or http(s) address. */
export type Attachment = {
  kind: "image" | "audio" | "video" | "file";
  artifactId?: string;
  name: string;
  mimeType?: string;
  src?: string;
  sizeBytes?: number;
  /** False when the engine left the bytes out of the history ("Not kept in the history"). */
  kept: boolean;
};

export type FileChange = { path: string; added: number; removed: number; diff?: string };
const fullOutputs = new Map<string, string>();
/** Keep large command output outside React snapshots until someone opens it. The block keeps the last 2,000
 *  characters, so the default view shows the real final lines (where failures and summaries are). */
export function keepOutput(key: string, value: string): string {
  if (value.length <= 2_000) { fullOutputs.delete(key); return value; }
  fullOutputs.delete(key);
  fullOutputs.set(key, value);
  if (fullOutputs.size > 100) fullOutputs.delete(fullOutputs.keys().next().value!);
  return `…\n${value.slice(-2_000)}`;
}
export function fullOutput(key: string): string | undefined { return fullOutputs.get(key); }
export function readFileChanges(args: unknown): FileChange[] {
  const changes = record(args).changes;
  if (!Array.isArray(changes)) return [];
  return changes.map(record).filter((change) => str(change.path)).map((change) => ({
    path: str(change.path), added: Number(record(change.stat).added) || 0, removed: Number(record(change.stat).removed) || 0,
    ...(str(change.diff) ? { diff: str(change.diff) } : {}),
  }));
}

export type Block =
  | { kind: "user"; key: string; text: string; meta?: MessageMeta; attachments?: Attachment[] }
  /** Words you sent while the turn worked, which it took at its next step (`__branch.steerTargetRunId`). Part of
   *  that turn, not a turn of its own. */
  | { kind: "steer"; key: string; text: string; meta?: MessageMeta }
  | { kind: "text"; key: string; text: string; streaming: boolean; meta?: MessageMeta; attachments?: Attachment[] }
  | { kind: "thinking"; key: string; text: string; live: boolean }
  | { kind: "preamble"; key: string; text: string }
  | { kind: "plan"; key: string; steps: { step: string; status: "pending" | "in_progress" | "completed" }[] }
  | { kind: "usage"; key: string; input: number; output: number; total: number }
  /** `codeMode`: an `exec` running code (Code Mode); its result's own status says whether the code failed. */
  | { kind: "step"; key: string; outputKey?: string; tool: string; title: string; detail: string; status: StepStatus; input?: string; output?: string; changes?: FileChange[]; browser?: BrowserPresentation; at?: number; codeMode?: boolean }
  | { kind: "approval"; key: string; approval: Approval }
  /** A team the Trunk drafted with team_propose: the card with Approve, Edit and Not now. */
  | { kind: "team"; key: string; result: TeamToolResult }
  /** The end of a turn. `stopped`: you (or the engine) stopped it; the thread says so instead of "Done in". */
  | { kind: "done"; key: string; runId: string; durationMs?: number; stopped?: boolean }
  | { kind: "error"; key: string; runId?: string; message: string }
  | { kind: "notice"; key: string; text: string; at?: number; topicKey?: string }
  | { kind: "status"; key: string; phase: string; attempt?: number; maxAttempts?: number };

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : {};
const str = (value: unknown): string => (typeof value === "string" ? value : "");

/** Only positive finite timestamps recorded by the engine are observation times. */
export function recordedAt(value: unknown): { at?: number } {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? { at: value } : {};
}

/** One line that says what a tool call does, for the step line. */
export function describeToolCall(_name: string, args: unknown): string {
  const a = record(args);
  const nested = record(a.args);
  if (isComputerToolName(_name)) {
    return computerActionLabel(str(a.action) || str(nested.action));
  }
  if (isScreenToolName(_name)) {
    return screenActionLabel(str(a.action) || str(nested.action));
  }
  const command = str(a.command) || str(nested.command);
  if (command) {
    return command;
  }
  const path = str(a.path) || str(a.file_path) || str(a.filePath);
  const changes = Array.isArray(a.changes) ? a.changes.map((change) => str(record(change).path)).filter(Boolean) : [];
  if (changes.length) return changes.join(", ");
  const query = str(a.query) || str(a.url) || str(a.task) || str(a.label);
  const first = Object.values(a).find((value): value is string => typeof value === "string" && value.trim().length > 0 && value.length <= 120);
  return path || query || first || "";
}

/** A tool call's whole input, for the step's expanded view, when the one-line title can't carry it. */
export function toolInput(args: unknown): string | undefined {
  const a = record(args);
  if (!Object.keys(a).length || str(a.command) || str(record(a.args).command) || Array.isArray(a.changes)) return undefined;
  return JSON.stringify(a, null, 2);
}

/** The statuses a Code Mode run reports when its code failed; any other (completed, yielded, waiting, …) is not. */
const FAILED_STATUSES = new Set(["failed", "error", "timed_out", "cancelled"]);

/** Whether a Code Mode wrapper's own run failed (an error result, or code that didn't complete), as opposed to what
 *  its nested calls did: then the wrapper stays a step, so the failure shows. */
export function wrapperFailed(isError: unknown, text: string, details?: unknown): boolean {
  if (isError === true) return true;
  const status = codeModeStatus(text, details);
  return status !== null && FAILED_STATUSES.has(status);
}

/**
 * The status a Code Mode run reports. A guest failure is not an error result: it is a normal result whose payload
 * (`details`, and the text) says `"status":"failed"` (engine code-mode-execution.ts, tool-search-runtime.ts). When
 * the code read web content the text is wrapped in external-content markers, so the JSON is found inside it.
 */
export function codeModeStatus(text: string, details?: unknown): string | null {
  const fromDetails = record(details).status;
  if (typeof fromDetails === "string") return fromDetails;
  try {
    const status = record(JSON.parse(text)).status;
    if (typeof status === "string") return status;
  } catch {
    // Wrapped text: read the first JSON object's leading status below.
  }
  const start = text.indexOf("{");
  return start < 0 ? null : /^\{\s*"status"\s*:\s*"([a-z_]+)"/.exec(text.slice(start))?.[1] ?? null;
}

/** Code Mode's own tool (engine agents/code-mode-control-tools.ts CODE_MODE_EXEC_TOOL_NAME). */
const CODE_MODE_TOOL = "exec";

/** A Code Mode call: Code Mode's `exec` given code to run rather than a command. Another tool with a `code` argument
 *  (a plugin's run_python, a sandbox) is not one: its result's status means whatever that tool says. */
export const isCodeModeCall = (name: string, args: unknown): boolean => name === CODE_MODE_TOOL && typeof record(args).code === "string";

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

/** `wrappers`: Code Mode `exec` calls whose code called real tools (their events name it `parentToolCallId`). */
type Builder = { blocks: Block[]; steps: Map<string, number>; items: Map<string, number>; wrappers: Set<string>; text: number | null; thinking: number | null; plan: number | null };

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

function startStep(b: Builder, id: string, name: string, args: unknown, at: number, runId: string): void {
  b.text = null;
  b.thinking = null;
  b.blocks.push({ kind: "step", key: id, outputKey: `${runId}:${id}`, tool: name, title: describeToolCall(name, args), detail: "", status: "running", input: toolInput(args), changes: readFileChanges(args), ...recordedAt(at), ...(isCodeModeCall(name, args) ? { codeMode: true } : {}) });
  b.steps.set(id, b.blocks.length - 1);
}

function onTool(b: Builder, event: RunEvent): void {
  const d = event.data;
  const id = str(d.toolCallId) || `${event.runId}:${event.seq}`;
  const name = str(d.name);
  if (name === "tool_call" || name === "tool_search" || name === "tool_describe") {
    return; // Tool Search controls; the nested real tool gets its own step line.
  }
  if (str(d.parentToolCallId)) b.wrappers.add(str(d.parentToolCallId));
  if (d.phase === "start") {
    if (!b.steps.has(id)) startStep(b, id, name, d.args, event.ts, event.runId);
    else {
      const at = b.steps.get(id)!;
      const step = b.blocks[at] as Extract<Block, { kind: "step" }>;
      b.blocks[at] = { ...step, tool: name || step.tool, title: describeToolCall(name, d.args) || step.title, input: toolInput(d.args), changes: readFileChanges(d.args), ...(isCodeModeCall(name || step.tool, d.args) ? { codeMode: true } : {}) };
    }
    return;
  }
  const at = b.steps.get(id);
  if (at === undefined) {
    return;
  }
  const step = b.blocks[at] as Extract<Block, { kind: "step" }>;
  if (d.phase === "update") {
    const output = resultText(d.partialResult);
    b.blocks[at] = output ? { ...step, output: keepOutput(step.outputKey ?? id, output), ...recordedAt(event.ts) } : step;
    return;
  }
  if (d.phase !== "result") {
    return;
  }
  const text = str(record(d.result).output) || resultText(d.result);
  const codeFailed = step.codeMode === true && wrapperFailed(d.isError, text, record(d.result).details);
  if (b.wrappers.has(id) && codeFailed) b.wrappers.delete(id);
  const exitCode = record(d.result).exitCode;
  const status: StepStatus = isDeniedResultText(text) ? "denied" : d.isError || codeFailed || (typeof exitCode === "number" && exitCode !== 0) ? "failed" : "ok";
  b.blocks[at] = { ...step, status, detail: typeof exitCode === "number" ? `Exit ${exitCode}` : text.slice(0, 400), output: text ? keepOutput(step.outputKey ?? id, text) : step.output, browser: status === "ok" ? readBrowserPresentation(d.result, step.tool, id) : undefined, ...recordedAt(event.ts) };
  if (status === "ok" && step.tool === "team_propose") {
    const team = teamFromToolText(text);
    if (team) b.blocks.push({ kind: "team", key: `${id}:team`, result: team });
  }
}

/** Codex's item stream supplies the ordered shell of activity; its tool stream adds inputs/results. */
function onItem(b: Builder, event: RunEvent): void {
  const d = event.data;
  const kind = str(d.kind);
  const id = str(d.toolCallId) || str(d.itemId) || `${event.runId}:${event.seq}`;
  if (kind === "answer_candidate") return;
  if (kind === "analysis") {
    const value = str(d.text) || str(d.progressText);
    if (value || !b.blocks.some((block) => block.kind === "thinking")) addThinking(b, { ...event, data: { text: value } });
    return;
  }
  if (kind === "preamble") {
    const value = str(d.progressText);
    if (!value) return;
    const at = b.items.get(id);
    if (at === undefined) {
      b.blocks.push({ kind: "preamble", key: `preamble:${id}`, text: value });
      b.items.set(id, b.blocks.length - 1);
    } else b.blocks[at] = { kind: "preamble", key: `preamble:${id}`, text: value };
    b.text = null;
    return;
  }
  if (!["tool", "command", "patch", "search"].includes(kind)) return;
  const name = str(d.name) || kind;
  const at = b.steps.get(id);
  if (at === undefined) {
    startStep(b, id, name, {}, event.ts, event.runId);
  }
  const position = b.steps.get(id)!;
  const step = b.blocks[position] as Extract<Block, { kind: "step" }>;
  const meta = str(d.meta);
  const title = meta || step.title;
  const status: StepStatus = d.status === "failed" || d.status === "blocked" ? "failed" : d.phase === "end" ? "ok" : "running";
  // A result already said "failed" or "denied" (not allowed); the item's own end must not turn it back into "ok".
  const settled = step.status === "failed" || step.status === "denied";
  b.blocks[position] = { ...step, tool: name, title, status: settled ? step.status : status, ...recordedAt(event.ts) };
}

function onPlan(b: Builder, event: RunEvent): void {
  const raw = event.data.steps;
  if (!Array.isArray(raw)) return;
  const steps = raw.map((value) => record(value)).filter((value) => str(value.step)).map((value) => ({
    step: str(value.step),
    status: value.status === "completed" ? "completed" as const : value.status === "in_progress" ? "in_progress" as const : "pending" as const,
  }));
  const block: Block = { kind: "plan", key: `${event.runId}:plan`, steps };
  if (b.plan === null) {
    b.blocks.push(block);
    b.plan = b.blocks.length - 1;
  } else b.blocks[b.plan] = block;
}

/** Result fields that describe how a call ended, not what it printed. */
const RESULT_METADATA = new Set(["status", "exitCode", "exit_code", "durationMs", "duration", "isError", "success", "output"]);

/** The visible text of a tool result: its text blocks, joined. */
export function resultText(result: unknown): string {
  if (typeof result === "string") return result;
  const value = record(result);
  if (typeof value.text === "string") return value.text;
  const content = value.content;
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .filter((c) => record(c).type === "text")
      .map((c) => str(record(c).text))
      .join("\n");
  }
  const shown = Object.keys(value).filter((key) => !RESULT_METADATA.has(key));
  return shown.length ? JSON.stringify(value, null, 2) : "";
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

/** `run_status` phases that explain an account change in plain words and stay in the thread. */
const NOTICE_PHASES = new Set(["account_switched", "account_limited"]);

/** The run's startup phase (`run_status`), while nothing else has come after it. */
function lastStatus(events: readonly RunEvent[]): Extract<Block, { kind: "status" }> | null {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const e = events[i];
    if (e.stream === "assistant" || e.stream === "tool" || e.stream === "thinking") {
      return null;
    }
    if (e.stream === "run_status" && str(e.data.phase) && !NOTICE_PHASES.has(str(e.data.phase))) {
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
  const b: Builder = { blocks: [], steps: new Map(), items: new Map(), wrappers: new Set(), text: null, thinking: null, plan: null };
  let ended = false;
  for (const event of events) {
    if (event.stream === "assistant") {
      b.thinking = null;
      addText(b, event.runId, event.seq, str(event.data.delta));
    } else if (event.stream === "thinking") {
      addThinking(b, event);
    } else if (event.stream === "tool") {
      onTool(b, event);
    } else if (event.stream === "item") {
      onItem(b, event);
    } else if (event.stream === "plan") {
      onPlan(b, event);
    } else if (event.stream === "usage") {
      const data = event.data;
      const input = Number(data.inputTokens ?? data.input) || 0;
      const output = Number(data.outputTokens ?? data.output) || 0;
      const total = Number(data.totalTokens ?? data.total) || input + output;
      const key = `${event.runId}:usage`;
      const at = b.blocks.findIndex((block) => block.key === key);
      const block: Block = { kind: "usage", key, input, output, total };
      if (at < 0) b.blocks.push(block);
      else b.blocks[at] = block;
    } else if (event.stream === "run_status" && NOTICE_PHASES.has(str(event.data.phase)) && str(event.data.message)) {
      // "Claude account 1 hit its limit until Sat 2:00 AM. Moved to Claude account 2." stays after later events.
      b.text = null;
      b.blocks.push({ kind: "notice", key: `${event.runId}:${str(event.data.phase)}:${event.seq}`, text: str(event.data.message), ...recordedAt(event.ts) });
    } else if (event.stream === "lifecycle") {
      onLifecycle(b, event, approvals);
      ended ||= event.data.phase === "end" || event.data.phase === "error";
    }
  }
  // A wrapper's nested calls are the steps (the real command, its approval); the wrapper itself would be a second
  // row for the same command, and the finished turn (history.ts) doesn't have it either.
  const blocks = b.wrappers.size ? b.blocks.filter((block) => block.kind !== "step" || !b.wrappers.has(block.key)) : b.blocks;
  if (ended) {
    return settle(blocks);
  }
  const status = lastStatus(events);
  return status ? [...blocks, status] : blocks;
}
