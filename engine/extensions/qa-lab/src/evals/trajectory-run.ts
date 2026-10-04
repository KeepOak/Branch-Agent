// Builds scorer runs from stored Branch runs: trajectory bundles written by /export-trajectory
// (events.jsonl) and raw session transcripts (*.jsonl). Transcript message events are the single
// source of truth; tool results are joined to their tool calls by toolCallId.
import fs from "node:fs/promises";
import path from "node:path";
import type {
  AgentScorerRun,
  EvalMessage,
  EvalMessagePart,
  EvalToolInvocation,
} from "./scorer-utils.js";

type JsonRecord = Record<string, unknown>;

export type StoredRunSource = "trajectory-bundle" | "session-transcript";

export type StoredScorerRun = {
  /** Path the run was read from (events.jsonl or the session file). */
  sourcePath: string;
  source: StoredRunSource;
  sessionId?: string;
  traceId?: string;
  run: AgentScorerRun;
};

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function parseJsonLines(raw: string): unknown[] {
  const rows: unknown[] = [];
  for (const line of raw.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    try {
      rows.push(JSON.parse(trimmed) as unknown);
    } catch {
      // Skip malformed rows the same way the trajectory exporter reports and skips them.
    }
  }
  return rows;
}

function textOfBlocks(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  return content
    .filter((block): block is JsonRecord => isRecord(block) && block.type === "text")
    .map((block) => (typeof block.text === "string" ? block.text : ""))
    .filter(Boolean)
    .join("\n");
}

function toArgs(value: unknown): Record<string, unknown> {
  if (isRecord(value)) {
    return value;
  }
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      return isRecord(parsed) ? parsed : { input: value };
    } catch {
      return { input: value };
    }
  }
  return {};
}

const TOOL_CALL_BLOCK_TYPES = new Set(["toolcall", "tooluse", "functioncall"]);

function assistantParts(content: unknown, invocations: Map<string, EvalToolInvocation>) {
  const parts: EvalMessagePart[] = [];
  const toolInvocations: EvalToolInvocation[] = [];
  if (typeof content === "string") {
    return { parts: content ? [{ type: "text" as const, text: content }] : [], toolInvocations };
  }
  if (!Array.isArray(content)) {
    return { parts, toolInvocations };
  }
  content.forEach((block, index) => {
    if (!isRecord(block)) {
      return;
    }
    const type = typeof block.type === "string" ? block.type.toLowerCase() : "";
    if (type === "text" && typeof block.text === "string" && block.text) {
      parts.push({ type: "text", text: block.text });
    } else if (type === "thinking" && typeof block.thinking === "string") {
      parts.push({ type: "reasoning", text: block.thinking });
    } else if (TOOL_CALL_BLOCK_TYPES.has(type)) {
      const toolCallId = typeof block.id === "string" ? block.id : `call-${index}`;
      const invocation: EvalToolInvocation = {
        toolCallId,
        toolName: typeof block.name === "string" ? block.name : "unknown",
        args: toArgs(block.arguments ?? block.input ?? block.parameters),
        state: "call",
      };
      invocations.set(toolCallId, invocation);
      toolInvocations.push(invocation);
      parts.push({ type: "tool-invocation", toolInvocation: invocation });
    }
  });
  return { parts, toolInvocations };
}

function applyToolResult(message: JsonRecord, invocations: Map<string, EvalToolInvocation>) {
  const toolCallId = typeof message.toolCallId === "string" ? message.toolCallId : undefined;
  const invocation = toolCallId ? invocations.get(toolCallId) : undefined;
  if (!invocation) {
    return;
  }
  const text = textOfBlocks(message.content);
  if (message.details !== undefined) {
    invocation.details = message.details;
  }
  if (message.isError === true) {
    invocation.state = "output-error";
    invocation.isError = true;
    invocation.errorText = text || "Tool failed";
    return;
  }
  invocation.state = "result";
  invocation.result = text;
}

/** Convert Branch agent messages (user / assistant / toolResult) into one whole-session run. */
export function buildScorerRunFromMessages(messages: readonly unknown[], runId?: string): AgentScorerRun {
  const invocations = new Map<string, EvalToolInvocation>();
  const inputMessages: EvalMessage[] = [];
  const output: EvalMessage[] = [];
  const systemMessages: Array<{ role: "system"; content: string }> = [];
  messages.forEach((value, index) => {
    if (!isRecord(value)) {
      return;
    }
    const createdAt = new Date(typeof value.timestamp === "number" ? value.timestamp : 0);
    if (value.role === "user") {
      const text = textOfBlocks(value.content);
      inputMessages.push({
        id: `user-${index}`,
        role: "user",
        createdAt,
        content: { format: 2, parts: text ? [{ type: "text", text }] : [], content: text },
      });
    } else if (value.role === "assistant") {
      const { parts, toolInvocations } = assistantParts(value.content, invocations);
      const text = parts
        .flatMap((part) => (part.type === "text" ? [part.text] : []))
        .join("\n");
      output.push({
        id: `assistant-${index}`,
        role: "assistant",
        createdAt,
        content: {
          format: 2,
          parts,
          content: text,
          ...(toolInvocations.length > 0 ? { toolInvocations } : {}),
        },
      });
    } else if (value.role === "toolResult") {
      applyToolResult(value, invocations);
    } else if (value.role === "system") {
      systemMessages.push({ role: "system", content: textOfBlocks(value.content) });
    }
  });
  return {
    ...(runId ? { runId } : {}),
    input: { inputMessages, rememberedMessages: [], systemMessages, taggedSystemMessages: {} },
    output,
  };
}

function messagesFromTrajectoryEvents(rows: readonly unknown[]) {
  const messages: unknown[] = [];
  let sessionId: string | undefined;
  let traceId: string | undefined;
  for (const row of rows) {
    if (!isRecord(row) || row.traceSchema !== "branch-trajectory") {
      continue;
    }
    sessionId ??= typeof row.sessionId === "string" ? row.sessionId : undefined;
    traceId ??= typeof row.traceId === "string" ? row.traceId : undefined;
    // Transcript rows carry the message (user.message, assistant.message, tool.result, ...);
    // tool.call rows repeat the assistant's tool calls and runtime rows are diagnostics.
    if (row.source !== "transcript" || row.type === "tool.call") {
      continue;
    }
    const data = isRecord(row.data) ? row.data : undefined;
    if (data && isRecord(data.message)) {
      messages.push(data.message);
    }
  }
  return { messages, sessionId, traceId };
}

/** Messages on the active branch of a session transcript (last entry back to the root). */
function messagesFromSessionEntries(rows: readonly unknown[]) {
  const entries = rows.filter(isRecord);
  const header = entries.find((entry) => entry.type === "session");
  const byId = new Map<string, JsonRecord>();
  for (const entry of entries) {
    if (typeof entry.id === "string" && entry.type !== "session") {
      byId.set(entry.id, entry);
    }
  }
  const last = entries.findLast((entry) => entry.type !== "session" && typeof entry.id === "string");
  const branch: JsonRecord[] = [];
  const seen = new Set<string>();
  let cursor: JsonRecord | undefined = last;
  while (cursor && typeof cursor.id === "string" && !seen.has(cursor.id)) {
    seen.add(cursor.id);
    branch.unshift(cursor);
    cursor = typeof cursor.parentId === "string" ? byId.get(cursor.parentId) : undefined;
  }
  const ordered = branch.length > 0 ? branch : entries;
  const messages = ordered
    .filter((entry) => entry.type === "message" && isRecord(entry.message))
    .map((entry) => entry.message);
  const sessionId = header && typeof header.id === "string" ? header.id : undefined;
  return { messages, sessionId };
}

/** Tool definitions the bundle recorded (tools.json beside events.jsonl), when present. */
async function readBundleTools(toolsFile: string): Promise<unknown[] | undefined> {
  try {
    const parsed = JSON.parse(await fs.readFile(toolsFile, "utf8")) as unknown;
    return Array.isArray(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

async function readStoredRunFile(filePath: string): Promise<StoredScorerRun | undefined> {
  const rows = parseJsonLines(await fs.readFile(filePath, "utf8"));
  const isTrajectory = rows.some((row) => isRecord(row) && row.traceSchema === "branch-trajectory");
  if (isTrajectory) {
    const { messages, sessionId, traceId } = messagesFromTrajectoryEvents(rows);
    const run = buildScorerRunFromMessages(messages, traceId);
    const availableTools = await readBundleTools(path.join(path.dirname(filePath), "tools.json"));
    return {
      sourcePath: filePath,
      source: "trajectory-bundle",
      ...(sessionId ? { sessionId } : {}),
      ...(traceId ? { traceId } : {}),
      run: availableTools ? { ...run, requestContext: { availableTools } } : run,
    };
  }
  const isSession = rows.some((row) => isRecord(row) && row.type === "message");
  if (!isSession) {
    return undefined;
  }
  const { messages, sessionId } = messagesFromSessionEntries(rows);
  return {
    sourcePath: filePath,
    source: "session-transcript",
    ...(sessionId ? { sessionId } : {}),
    run: buildScorerRunFromMessages(messages, sessionId),
  };
}

async function listCandidateFiles(target: string): Promise<string[]> {
  const stat = await fs.stat(target);
  if (stat.isFile()) {
    return [target];
  }
  const bundleEvents = path.join(target, "events.jsonl");
  try {
    if ((await fs.stat(bundleEvents)).isFile()) {
      return [bundleEvents];
    }
  } catch {
    // not a single bundle; scan children below
  }
  const files: string[] = [];
  const entries = await fs.readdir(target, { withFileTypes: true });
  for (const entry of entries.toSorted((a, b) => a.name.localeCompare(b.name))) {
    const child = path.join(target, entry.name);
    if (entry.isFile() && entry.name.endsWith(".jsonl")) {
      files.push(child);
    } else if (entry.isDirectory()) {
      const events = path.join(child, "events.jsonl");
      try {
        if ((await fs.stat(events)).isFile()) {
          files.push(events);
        }
      } catch {
        // directory without a bundle
      }
    }
  }
  return files;
}

/**
 * Load stored runs from trajectory bundles, bundle folders, or session transcripts.
 * A directory may hold one bundle (events.jsonl) or many bundles / transcripts.
 */
export async function loadStoredScorerRuns(targets: readonly string[]): Promise<StoredScorerRun[]> {
  const runs: StoredScorerRun[] = [];
  for (const target of targets) {
    for (const file of await listCandidateFiles(target)) {
      const run = await readStoredRunFile(file);
      if (run) {
        runs.push(run);
      }
    }
  }
  return runs;
}
