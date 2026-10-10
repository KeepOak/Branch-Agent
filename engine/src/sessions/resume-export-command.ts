/** Conversation export command; native selection matches commands/export-trajectory.ts. */
import { resolveConfiguredAgentId } from "../agents/agent-scope-config.js";
import { ExpectedCliError } from "../cli/failure-output.js";
import { getRuntimeConfig } from "../config/config.js";
import { resolveSessionStorePathCore } from "../config/sessions/paths.js";
import { loadSessionEntryReadOnly, listSessionEntriesReadOnly, resolveSessionTranscriptReadTarget,
  readSessionTranscriptMessageEventPage, readTranscriptExportSnapshotReadOnlySync } from "../config/sessions/session-accessor.js";
import { resolveAgentIdFromSessionKey } from "../routing/session-key.js";
import type { RuntimeEnv } from "../runtime.js";
import { resolveExplicitSessionStorePath, resolveCommandSessionStoreTargets } from "../commands/session-store-targets.js";
import { formatContextTranscript } from "./resume-context-transcript.js";
import { nativeTranscriptEntries } from "./resume-transcript-entries.js";
import { entriesToHtml, entriesToMarkdown } from "./resume-transcript-render.js";
import { entriesToPlainText } from "./resume-export-plaintext.js";
import { buildSessionRecap, nativeRecapMessages } from "./resume-session-recap.js";
import { nativeMessageTree } from "./resume-native-message-tree.js";

export type SessionExportCommandOptions = {
  sessionKey?: string;
  agent?: string;
  store?: string;
  format?: string;
  includeToolDetails?: boolean;
  includeTimestamps?: boolean;
  includeReasoning?: boolean;
  contextMax?: string;
  all?: boolean;
  allAgents?: boolean;
  /** Recap only: print the recap as a JSON document instead of text. */
  json?: boolean;
};

function fail(message: string): never {
  throw new ExpectedCliError({ message, humanOutput: message, machineOutput: message });
}

function selectTranscript(options: SessionExportCommandOptions) {
  const sessionKey = options.sessionKey?.trim();
  if (!sessionKey) {
    fail("--session-key is required");
  }
  if (options.agent !== undefined && !options.agent.trim()) {
    fail("--agent must not be blank");
  }
  if (options.store !== undefined && !options.store.trim()) {
    fail("--store must not be blank");
  }
  const cfg = getRuntimeConfig();
  const agentId = options.agent ? resolveConfiguredAgentId(cfg, options.agent.trim())
    : resolveAgentIdFromSessionKey(sessionKey);
  let storePath = resolveSessionStorePathCore(options.store ?? cfg.session?.store, { agentId });
  if (options.store) {
    storePath = resolveExplicitSessionStorePath({ storePath, inputStorePath: options.store, agentId });
  }
  const entry = loadSessionEntryReadOnly({ agentId, sessionKey, storePath });
  if (!entry?.sessionId) {
    fail(`Session not found: ${sessionKey}`);
  }
  const target = resolveSessionTranscriptReadTarget({ agentId, sessionKey, storePath,
    sessionEntry: entry, sessionId: entry.sessionId });
  return { entry, target, sessionKey };
}

function validateFormat(options: SessionExportCommandOptions) {
  const format = options.format ?? "markdown";
  if (!["markdown", "html", "json", "context", "plaintext", "recap", "graph"].includes(format)) {
    fail("Unknown export format");
  }
  const max = options.contextMax === undefined ? undefined : Number(options.contextMax);
  if (max !== undefined && (!/^\d+$/.test(options.contextMax!) || !Number.isSafeInteger(max)
    || max <= 0)) {
    fail("--context-max must be a positive integer");
  }
  if (max !== undefined && format !== "context") {
    fail("--context-max requires --format context");
  }
  return { format, max };
}

function selectAllTranscripts(options: SessionExportCommandOptions) {
  if (options.sessionKey !== undefined) {
    fail("--all cannot be combined with --session-key");
  }
  const targets = resolveCommandSessionStoreTargets({ cfg: getRuntimeConfig(), opts: options });
  return targets.flatMap(({ agentId, storePath }) => listSessionEntriesReadOnly({
    agentId, storePath, projection: "list" }).flatMap(({ sessionKey, entry }) => {
      if (!entry.sessionId) {
        return [];
      }
      const target = resolveSessionTranscriptReadTarget({ agentId, storePath, sessionKey,
        sessionEntry: entry, sessionId: entry.sessionId });
      return [{ entry, target, sessionKey }];
    }));
}

function exportConversation(selection: ReturnType<typeof selectTranscript>, options: SessionExportCommandOptions) {
  const { entry, target, sessionKey } = selection;
  const page = readSessionTranscriptMessageEventPage(target, { offset: 0,
    offsetFrom: "start", maxMessages: Number.MAX_SAFE_INTEGER, readOnly: true });
  const renderOptions = { includeToolDetails: options.includeToolDetails ?? true,
    includeTimestamps: options.includeTimestamps ?? true, includeReasoning: options.includeReasoning ?? false,
    title: entry.label || entry.subject || sessionKey, model: entry.model };
  return { sessionKey, sessionId: entry.sessionId, title: renderOptions.title, renderOptions,
    ...(options.format === "recap" ? { recap: buildSessionRecap(nativeRecapMessages(page.events.map((row) => row.event)),
      { title: renderOptions.title, sessionId: entry.sessionId }) } : {}),
    entries: nativeTranscriptEntries(page.events.map((row) => row.event), renderOptions) };
}

/** Emits an export to stdout. Every selected read stays in the readonly active-path API. */
export async function sessionExportCommand(options: SessionExportCommandOptions,
  runtime: RuntimeEnv): Promise<void> {
  const { format, max } = validateFormat(options);
  if (options.allAgents && !options.all) {
    fail("--all-agents requires --all");
  }
  const selections = options.all ? selectAllTranscripts(options) : [selectTranscript(options)];
  if (format === "graph") {
    const graphs = selections.map(({ target, sessionKey }) => {
      const snapshot = readTranscriptExportSnapshotReadOnlySync(target, { includeActiveLeaf: true });
      if (!snapshot || snapshot.activeLeafEntryId === undefined) {
        fail("Session graph snapshot is unavailable");
      }
      return { sessionKey, ...nativeMessageTree(snapshot.events, snapshot.activeLeafEntryId) };
    });
    runtime.log(JSON.stringify(options.all ? { conversations: graphs } : graphs[0], null, 2));
    return;
  }
  const conversations = selections.map((selection) => exportConversation(selection, options));
  if (options.json === true && format === "recap") {
    const recaps = conversations.map(({ sessionKey, sessionId, title, recap }) => ({ sessionKey, sessionId, title, recap }));
    runtime.log(JSON.stringify(options.all ? { conversations: recaps } : recaps[0], null, 2));
    return;
  }
  const json = conversations.map(({ renderOptions: _renderOptions, ...conversation }) => conversation);
  if (options.all && format === "html") {
    const entries = conversations.flatMap((conversation) => [{ kind: "note" as const,
      summary: conversation.title, content: conversation.sessionKey, timestamp: "" }, ...conversation.entries]);
    runtime.log(entriesToHtml(entries, { includeToolDetails: options.includeToolDetails ?? true,
      includeTimestamps: options.includeTimestamps ?? true, title: "Conversation archive" }));
    return;
  }
  const output = format === "json" ? JSON.stringify(options.all ? { conversations: json } : json[0], null, 2)
    : conversations.map(({ entries, renderOptions, recap }) => format === "recap" ? recap
      : format === "html" ? entriesToHtml(entries, renderOptions)
      : format === "context" ? formatContextTranscript(renderOptions.title, entries, { max })
      : format === "plaintext" ? entriesToPlainText(entries, renderOptions.title)
      : entriesToMarkdown(entries, renderOptions)).join("\n");
  runtime.log(output);
}
