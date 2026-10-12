// Settings › General: the rows of the R1 General page that have an engine key or a person's pref behind them. Keys and
// copy follow the Classic General page (places/settings/set1/general*.tsx), whose rows are wired and tested; cards with
// their own component (Pinned, Starting up, Projects, Keyboard) are drawn by the page, not by this table.
import { ttlMinutes } from "../../../places/settings/set1/general-summaries";
import type { Codec, Row } from "../rows";

const onOff: Codec = { read: (v) => (v ?? "off") !== "off", write: (on) => (on ? "on" : "off") };
const notFalse: Codec = { read: (v) => v !== false, write: (on) => on === true };

/** Normal hides thoughts and steps, Thinking shows the thinking, Verbose shows every step too. Two engine defaults,
 *  saved together as one merge into agents.defaults (sibling keys stay as they are). */
export const agentsWork: Codec = {
  read: (stored) => {
    const d = stored && typeof stored === "object" ? (stored as Record<string, unknown>) : {};
    if ((d.verboseDefault ?? "off") !== "off") return "verbose";
    return (d.reasoningDefault ?? "off") !== "off" ? "thinking" : "normal";
  },
  write: (mode) => ({ reasoningDefault: mode === "normal" ? "off" : "on", verboseDefault: mode === "verbose" ? "on" : "off" }),
};

const WORK = "Show agents’ work";
const CONVO = "The conversation";
const SUMS = "Summaries of older turns";
const LINE = "Waiting line";
const C = "agents.defaults.compaction";
const PRUNE = "agents.defaults.contextPruning";

export const GENERAL_ROWS: Row[] = [
  { id: "general.work.mode", page: "general", card: WORK, label: "Show agents’ work", help: "Normal keeps replies plain. Thinking adds the model’s reasoning, folded. Verbose shows every step.", level: 0, ownerLevel: true, control: "segmented",
    options: [{ v: "normal", label: "Normal" }, { v: "thinking", label: "Thinking" }, { v: "verbose", label: "Verbose" }], source: { kind: "config", path: "agents.defaults" }, codec: agentsWork },
  { id: "general.work.thinking", page: "general", card: WORK, label: "Show the thinking", help: "Adds the model’s reasoning under each reply, folded.", level: 1, control: "toggle", source: { kind: "config", path: "agents.defaults.reasoningDefault" }, codec: onOff },
  { id: "general.work.steps", page: "general", card: WORK, label: "Show tool steps", help: "Each reply keeps a folded list of the tools it used.", level: 1, control: "toggle", source: { kind: "config", path: "agents.defaults.verboseDefault" }, codec: onOff },
  { id: "general.work.progress", page: "general", card: WORK, label: "Task progress above the message box", level: 1, control: "toggle", source: { kind: "pref", key: "conversation.taskProgress" }, fallback: true },
  { id: "general.work.progress-starts", page: "general", card: WORK, label: "Task progress starts", level: 1, control: "segmented",
    options: [{ v: "open", label: "Open" }, { v: "folded", label: "Folded" }], source: { kind: "pref", key: "conversation.taskProgressStarts" }, fallback: "open" },

  { id: "general.conversation.vim", page: "general", card: CONVO, label: "Vim keys in the message box", help: "Normal and insert modes, for people who type that way.", level: 1, control: "toggle", source: { kind: "pref", key: "conversation.vimKeys" }, fallback: false },
  { id: "general.conversation.times", page: "general", card: CONVO, label: "Message times", help: "When a message was sent, and when a task started and ended.", level: 1, control: "segmented",
    options: [{ v: "hover", label: "On hover" }, { v: "always", label: "Always" }, { v: "never", label: "Never" }], source: { kind: "pref", key: "conversation.messageTimes" }, fallback: "hover" },
  { id: "general.conversation.queue", page: "general", card: CONVO, label: "When you send while it works", level: 1, control: "segmented",
    options: [{ v: "steer", label: "Steer it now" }, { v: "followup", label: "Wait in line" }, { v: "collect", label: "Gather into one" }, { v: "interrupt", label: "Stop and start over" }],
    source: { kind: "config", path: "messages.queue.mode" }, fallback: "steer" },
  { id: "general.conversation.send", page: "general", card: CONVO, label: "Send with", help: "Enter sends and Shift Enter adds a line, or the other way round.", level: 1, control: "segmented",
    options: [{ v: "enter", label: "Enter" }, { v: "ctrl", label: "Ctrl Enter" }], source: { kind: "pref", key: "conversation.sendWith" }, fallback: "enter" },

  { id: "general.summaries.on", page: "general", card: SUMS, label: "Summarise older turns by themselves", help: "Keeps long conversations fast. The summary card shows what was kept.", level: 1, control: "toggle", source: { kind: "config", path: `${C}.enabled` }, codec: notFalse },
  { id: "general.summaries.keep", page: "general", card: SUMS, label: "Always keep the latest", help: "The newest part of the conversation, kept word for word.", level: 1, control: "number", unit: "tokens", source: { kind: "config", path: `${C}.keepRecentTokens` }, fallback: 20_000 },
  { id: "general.summaries.how", page: "general", card: SUMS, label: "How it summarises", help: "Careful mode checks each summary before replacing history.", level: 2, control: "segmented",
    options: [{ v: "safeguard", label: "Careful" }, { v: "default", label: "Quick" }], source: { kind: "config", path: `${C}.mode` }, fallback: "safeguard" },
  { id: "general.summaries.timeout", page: "general", card: SUMS, label: "Summary time limit", level: 2, control: "number", unit: "s", source: { kind: "config", path: `${C}.timeoutSeconds` }, fallback: 180 },
  { id: "general.summaries.exact", page: "general", card: SUMS, label: "Keep names and numbers exact", help: "IDs, names and numbers are copied word for word.", level: 2, control: "toggle",
    source: { kind: "config", path: `${C}.identifierPolicy` }, codec: { read: (v) => v !== "off", write: (on) => (on ? "strict" : "off") } },
  { id: "general.summaries.trim", page: "general", card: SUMS, label: "Trim old tool results", help: "Clears old tool output after the cache expires.", level: 2, control: "toggle",
    source: { kind: "config", path: `${PRUNE}.mode` }, codec: { read: (v) => (v ?? "off") !== "off", write: (on) => (on ? "cache-ttl" : "off") } },
  { id: "general.summaries.trim-after", page: "general", card: SUMS, label: "Trim after", level: 2, control: "number", unit: "minutes",
    source: { kind: "config", path: `${PRUNE}.ttl` }, codec: { read: ttlMinutes, write: (n) => (typeof n === "number" ? `${n}m` : null) } },

  { id: "general.line.cap", page: "general", card: LINE, label: "Most messages in line", level: 2, control: "number", source: { kind: "config", path: "messages.queue.cap" }, fallback: 20 },
  { id: "general.line.drop", page: "general", card: LINE, label: "When the line is full", help: "Summarising keeps the gist of what is dropped.", level: 2, control: "segmented",
    options: [{ v: "summarize", label: "Summarise the oldest" }, { v: "old", label: "Drop the oldest" }, { v: "new", label: "Refuse the newest" }], source: { kind: "config", path: "messages.queue.drop" }, fallback: "summarize" },

  { id: "general.history-repair.before-call", page: "general", card: "History repair", label: "Repair the history before each call", level: 2, control: "toggle",
    source: { kind: "coming", need: "config: a history-repair switch", reason: "Repairing the history before each call comes in a later update." } },
];
