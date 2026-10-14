// Settings › General: the rows of the R1 General page, in the approved preview's cards, order and words (preview.html PG
// general, item 36, rendered at Regular, Advanced and Technical). Keys follow the Classic General page
// (places/settings/set1/general*.tsx), whose rows are wired and tested; Starting up, Writing and Ask before deleting carry
// Classic's controls on the same keys (#952). A row with no key is Coming in its own words (R1-10). Rows a page control
// draws (general-live.tsx) are "slot" rows; the project list and the pinned rows are bare rows that name their own items.
import { ttlMinutes } from "../../../places/settings/set1/general-summaries";
import { platformName } from "../../../setup/steps-later";
import { COMING_REASON } from "../../../glass/coming-registry";
import { currentKeys, keyActions, onMac, readCustomKeys, shownInline } from "../../../shell/keymap";
import type { Codec, Row, RowOption } from "../rows";

const onOff: Codec = { read: (v) => (v ?? "off") !== "off", write: (on) => (on ? "on" : "off") };
const notFalse: Codec = { read: (v) => v !== false, write: (on) => on === true };
/** Overview's "Finish setting up" checklist, the look's "checklist": shown unless it is false; on puts the default back. */
export const checklistShown: Codec = { read: (v) => v !== false, write: (on) => (on ? null : false) };
/** The delete dialog's own key on this device ("Don't ask me again" writes "0"); on removes it, as Classic does. */
export const askBeforeDeleting: Codec = { read: (v) => v !== "0", write: (on) => (on ? null : "0") };
/** The device key the delete dialog reads (shell/ConfirmDelete.tsx). */
export const ASK_BEFORE_DELETE_KEY = "branch.askBeforeDelete";

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

/**
 * Always on (Private #454 F): how Branch keeps working, in plain words, on the desktop app's switches. Defaults on,
 * except keeping awake on battery and, on Linux only, keeping working when nobody is signed in.
 */
export function startingUpRows(platform: string = platformName()): Row[] {
  const card = "Starting up";
  return [
    { id: "general.start.keep-working", page: "general", card, label: "Keep working when Branch is closed", help: "Your Trunks keep going after you close the window. Off: closing Branch stops them.", level: 0, control: "toggle",
      source: { kind: "desktop", name: "keepWorking" }, fallback: true },
    { id: "general.start.with-computer", page: "general", card, label: "Start Branch when I sign in", help: "Opens quietly in the tray.", level: 0, control: "toggle",
      source: { kind: "desktop", name: "startWithWindows" }, fallback: true },
    { id: "general.start.keep-awake", page: "general", card, label: "Keep this computer awake while Trunks work", help: "Only while a Trunk is working, and only when plugged in. The screen can still lock.", level: 0, control: "toggle",
      source: { kind: "desktop", name: "keepAwake" }, fallback: true },
    { id: "general.start.keep-awake-battery", page: "general", card, label: "Also on battery", help: "Keeps it awake while a Trunk works on battery too.", level: 1, control: "toggle",
      source: { kind: "desktop", name: "keepAwakeOnBattery" }, fallback: false },
    ...(platform === "Linux" ? [{ id: "general.start.signed-out", page: "general", card, label: "Keep working when nobody is signed in", help: "Your Trunks start after a restart, before anyone signs in.", level: 0, control: "toggle",
      source: { kind: "desktop", name: "keepWorkingSignedOut" }, fallback: false } satisfies Row] : []),
  ];
}

const WORK = "Show agents’ work";
const CONVO = "The conversation";
const SUMS = "Summaries of older turns";
const LINE = "Waiting line";
const WRITING = "Writing";
const C = "agents.defaults.compaction";
const PRUNE = "agents.defaults.contextPruning";
/** On every device: the row is the person's own (users.prefs), as the preview says of it. */
const EVERY = "Follows you on every device.";

const no = (what: string, reason = COMING_REASON) => ({ kind: "coming" as const, need: `config: ${what}`, reason });
const slot = (calls: string[], reason = COMING_REASON) => ({ kind: "slot" as const, calls, reason });
const opts = (...labels: string[]): RowOption[] => labels.map((l) => ({ v: l, label: l }));

/** The two most-used shortcuts in a sentence, as Classic General writes them on this computer. */
export function keyboardLine(mac: boolean = onMac()): string {
  const keys = currentKeys(keyActions(""), readCustomKeys());
  return `${shownInline(keys.palette, mac)} to find anything, ${shownInline(keys.newConversation, mac)} for a new conversation.`;
}

export const GENERAL_ROWS: Row[] = [
  // Pinned: the rows you pinned, each with Go to it and Unpin (general-live.tsx); the card shows only when there are some.
  { id: "general.pinned.list", page: "general", card: "Pinned", label: "Pinned", level: 0, control: "custom", bare: true, source: slot(["users.prefs.set"]) },

  { id: "general.work.mode", page: "general", card: WORK, label: "Show agents’ work as", level: 0, ownerLevel: true, control: "segmented",
    help: "Normal: replies and a one-line summary of the steps. Thinking: adds its thoughts as quiet lines inside the steps. Verbose: everything open, inputs and outputs too. A conversation’s ••• can differ.",
    options: [{ v: "normal", label: "Normal" }, { v: "thinking", label: "Thinking" }, { v: "verbose", label: "Verbose" }], source: { kind: "config", path: "agents.defaults" }, codec: agentsWork },
  { id: "general.work.progress", page: "general", card: WORK, label: "Task progress above the message box", help: `The task’s plan and ticked steps while it runs. Hiding it doesn’t stop anything. ${EVERY}`, level: 1, control: "toggle",
    source: { kind: "pref", key: "conversation.taskProgress" }, fallback: true },
  { id: "general.work.progress-starts", page: "general", card: WORK, label: "Task progress starts", help: `On a phone it always starts folded. ${EVERY}`, level: 1, control: "segmented",
    options: [{ v: "open", label: "Open" }, { v: "folded", label: "Folded" }], source: { kind: "pref", key: "conversation.taskProgressStarts" }, fallback: "open" },
  { id: "general.work.thinking", page: "general", card: WORK, label: "Show the thinking", help: "Adds the model’s reasoning under each reply, folded.", level: 1, control: "toggle", source: { kind: "config", path: "agents.defaults.reasoningDefault" }, codec: onOff },
  { id: "general.work.steps", page: "general", card: WORK, label: "Show tool steps", help: "Each reply keeps a folded list of the tools it used. The ⋯ › View row overrides it for one window.", level: 1, control: "toggle",
    source: { kind: "config", path: "agents.defaults.verboseDefault" }, codec: onOff },
  // Moved here from Chat apps › In every chat (preview item 36). Today each app keeps its own key
  // (channels.<app>.streaming.progress.toolProgress); one switch for every chat app doesn't exist yet.
  { id: "general.work.chat-steps", page: "general", card: WORK, label: "Show steps in chats", help: "One quiet message lists what the Trunk does, edited as it goes; a new one starts when it gets long. The answer is its own message.", level: 1, control: "toggle",
    source: { kind: "coming", need: "config: one steps switch for every chat app (today channels.<app>.streaming.progress.toolProgress)", reason: "Each chat app sets this on its own page until one switch covers them all." } },
  { id: "general.work.chat-steps-shown", page: "general", card: WORK, label: "Steps shown", help: "/verbose in a chat changes it there. Texts (SMS) never get steps.", level: 1, control: "segmented",
    options: [{ v: "off", label: "Off" }, { v: "new", label: "New kinds" }, { v: "all", label: "All" }, { v: "full", label: "Every detail" }],
    source: { kind: "coming", need: "config: a steps level for every chat app", reason: "How many steps chats show comes in a later update." } },
  { id: "general.work.chat-thinking", page: "general", card: WORK, label: "Show thinking in chats", help: "Off until you choose: it posts the model’s reasoning.", level: 1, control: "toggle",
    source: { kind: "coming", need: "config: a thinking switch for every chat app", reason: "Showing the thinking in chat apps comes in a later update." } },

  ...startingUpRows(),

  { id: "general.projects.list", page: "general", card: "Projects", label: "Projects", level: 0, control: "custom", bare: true, source: slot(["projects.list", "sessions.list"]) },

  { id: "general.keyboard.shortcuts", page: "general", card: "Keyboard", label: "Keyboard shortcuts", help: keyboardLine(), level: 0, control: "custom", source: slot([]) },

  { id: "general.writing.grows", page: "general", card: WRITING, label: "Message box grows with the text", help: "Off keeps it one size; drag its top edge to change it.", level: 0, control: "toggle", fallback: true, source: no("a growing message box switch") },
  { id: "general.writing.spelling", page: "general", card: WRITING, label: "Check spelling in the message box", help: "Uses this computer’s own spell checker.", level: 0, control: "toggle", fallback: true, source: no("a spell check switch") },
  { id: "general.writing.suggest", page: "general", card: WRITING, label: "Suggest the rest as I type", help: "Grey text you take with Tab. Off until you choose: each suggestion is a model call.", level: 0, control: "toggle", source: no("typing suggestions") },
  { id: "general.writing.editor", page: "general", card: WRITING, label: "Write long messages in your own editor", help: "Ctrl G opens the draft there and brings it back when you close it. Empty uses $EDITOR.", level: 1, control: "text", source: no("an outside editor for drafts") },
  { id: "general.writing.location", page: "general", card: WRITING, label: "Add my location to messages", help: "Your town, so “near me” works. Off until you choose: it shares where you are.", level: 0, control: "toggle", source: no("a location switch") },
  { id: "general.writing.replies-in", page: "general", card: WRITING, label: "Replies in", help: "Separate from the window’s language.", level: 0, control: "select", fallback: "Same as my message",
    options: opts("Same as my message", "English", "Español", "Français", "Deutsch", "Português", "Yorùbá", "العربية", "日本語", "中文"), source: no("a reply language") },
  { id: "general.writing.after-plan", page: "general", card: WRITING, label: "After a plan", help: "When a Trunk finishes planning, “Carry out this plan?”", level: 0, control: "segmented", fallback: "Ask to carry it out",
    options: opts("Ask to carry it out", "In a fresh conversation", "Don’t ask"), source: no("what happens after a plan") },
  { id: "general.writing.rounds", page: "general", card: WRITING, label: "Rounds before it checks in", help: "Empty means no limit; a number makes it stop and ask after that many rounds.", level: 1, control: "number", source: no("a round limit") },
  { id: "general.writing.open-on", page: "general", card: WRITING, label: "Open Branch on", help: "What you see first when Branch opens.", level: 0, control: "select", fallback: "The last conversation",
    options: opts("The last conversation", "Overview", "Canopy", "Inbox", "Automations"), source: no("where Branch opens") },
  { id: "general.writing.finish-setup", page: "general", card: WRITING, label: "Show “Finish setting up”", help: "The checklist on Overview until every step is done.", level: 0, control: "toggle",
    source: { kind: "look", key: "checklist" }, codec: checklistShown },

  { id: "general.conversation.vim", page: "general", card: CONVO, label: "Vim keys in the message box", help: `Normal and insert modes, for people who type that way. ${EVERY}`, level: 1, control: "toggle", source: { kind: "pref", key: "conversation.vimKeys" }, fallback: false },
  { id: "general.conversation.times", page: "general", card: CONVO, label: "Message times", help: `When a message was sent, and when a task started and ended. ${EVERY}`, level: 1, control: "segmented",
    options: [{ v: "hover", label: "On hover" }, { v: "always", label: "Always" }, { v: "never", label: "Never" }], source: { kind: "pref", key: "conversation.messageTimes" }, fallback: "hover" },
  { id: "general.conversation.queue", page: "general", card: CONVO, label: "When you send while it works", help: `What a message you send during a task does. ${EVERY}`, level: 1, control: "segmented",
    options: [{ v: "steer", label: "Steer it now" }, { v: "followup", label: "Wait in line" }, { v: "collect", label: "Gather into one" }, { v: "interrupt", label: "Stop and start over" }],
    source: { kind: "config", path: "messages.queue.mode" }, fallback: "steer" },
  { id: "general.conversation.send", page: "general", card: CONVO, label: "Send with", help: `Enter sends and Shift Enter adds a line, or the other way round. ${EVERY}`, level: 1, control: "segmented",
    options: [{ v: "enter", label: "Enter" }, { v: "ctrl", label: "Ctrl Enter" }], source: { kind: "pref", key: "conversation.sendWith" }, fallback: "enter" },
  { id: "general.conversation.past-sessions", page: "general", card: CONVO, label: "Open past sessions in", help: "Past sessions from other apps open in Branch’s reader, or in their own app in a terminal. This device only.", level: 1, control: "segmented",
    options: opts("Branch", "A terminal"), fallback: "Branch", source: no("where past sessions open") },
  { id: "general.conversation.ask-delete", page: "general", card: CONVO, label: "Ask before deleting a conversation", help: "Applies to deleting from the list. This device only.", level: 1, control: "toggle",
    source: { kind: "device", key: ASK_BEFORE_DELETE_KEY }, codec: askBeforeDeleting },
  { id: "general.conversation.all", page: "general", card: CONVO, label: "All conversations", help: "Every conversation, with its room used and status.", level: 1, control: "custom", source: slot(["sessions.list"]) },

  { id: "general.summaries.on", page: "general", card: SUMS, label: "Summarise older turns by themselves", help: "Keeps long conversations fast. The summary card shows what was kept.", level: 1, control: "toggle", source: { kind: "config", path: `${C}.enabled` }, codec: notFalse },
  { id: "general.summaries.under", page: "general", card: SUMS, label: "Summarise when the room left is under", help: "Of the model’s room for this conversation.", level: 1, control: "number", unit: "tokens", source: no("a summary threshold") },
  { id: "general.summaries.keep", page: "general", card: SUMS, label: "Always keep the latest", help: "The newest part of the conversation, kept word for word.", level: 1, control: "number", unit: "tokens", source: { kind: "config", path: `${C}.keepRecentTokens` }, fallback: 20_000 },
  { id: "general.summaries.model", page: "general", card: SUMS, label: "Model for summaries", help: "A cheaper or local model keeps summaries cheap.", level: 1, control: "custom", source: slot(["models.list", "config.patch"]) },
  { id: "general.summaries.room", page: "general", card: SUMS, label: "Room to plan for", help: "Overrides what the model says it can hold.", level: 2, control: "number", unit: "tokens", source: no("the room to plan for") },
  { id: "general.summaries.how", page: "general", card: SUMS, label: "How it summarises", help: "Careful works in chunks and checks the summary; if the check fails the history is kept as it was.", level: 2, control: "segmented",
    options: [{ v: "safeguard", label: "Careful" }, { v: "default", label: "Quick" }], source: { kind: "config", path: `${C}.mode` }, fallback: "safeguard" },
  { id: "general.summaries.timeout", page: "general", card: SUMS, label: "Summary time limit", level: 2, control: "number", unit: "s", source: { kind: "config", path: `${C}.timeoutSeconds` }, fallback: 180 },
  { id: "general.summaries.exact", page: "general", card: SUMS, label: "Keep names and numbers exact", help: "IDs, names and numbers are copied word for word.", level: 2, control: "toggle",
    source: { kind: "config", path: `${C}.identifierPolicy` }, codec: { read: (v) => v !== "off", write: (on) => (on ? "strict" : "off") } },
  { id: "general.summaries.trim", page: "general", card: SUMS, label: "Trim old tool results", help: "After the cache expires, old tool output is cleared from what the model sees; the conversation keeps it.", level: 2, control: "toggle",
    source: { kind: "config", path: `${PRUNE}.mode` }, codec: { read: (v) => (v ?? "off") !== "off", write: (on) => (on ? "cache-ttl" : "off") } },
  { id: "general.summaries.trim-after", page: "general", card: SUMS, label: "Trim after", level: 2, control: "number", unit: "minutes",
    source: { kind: "config", path: `${PRUNE}.ttl` }, codec: { read: ttlMinutes, write: (n) => (typeof n === "number" ? `${n}m` : null) } },
  { id: "general.summaries.instructions", page: "general", card: SUMS, label: "How to write the summary", help: "Your own instructions for summaries. Empty uses Branch’s.", level: 2, control: "text", source: no("summary instructions") },
  { id: "general.summaries.cant", page: "general", card: SUMS, label: "If a summary can’t be made", help: "The oldest messages are hidden behind a marker until there’s room.", level: 2, control: "segmented", fallback: "Hide the oldest messages",
    options: opts("Hide the oldest messages", "Stop and ask me"), source: no("what happens when a summary fails") },
  { id: "general.summaries.originals", page: "general", card: SUMS, label: "Keep the originals of what it summarises", help: "The summary replaces them for the model only. You can put the originals back from the Tidied up line.", level: 2, control: "toggle",
    source: no("keeping summarised originals") },
  { id: "general.summaries.receipt", page: "general", card: SUMS, label: "A receipt for each thing left out", help: "Lists what was left out and why, and lets you bring any of it back.", level: 2, control: "toggle", source: no("summary receipts") },

  { id: "general.history-repair.before-call", page: "general", card: "History repair", label: "Repair the history before each call", help: "Fixes a broken tool call or a half-written answer before the model sees it.", level: 2, control: "toggle",
    source: { kind: "coming", need: "config: a history-repair switch", reason: "History repair comes in a later update." } },
  { id: "general.history-repair.check", page: "general", card: "History repair", label: "Check the history now", help: "Looks for a broken tool call or a half-written answer, and fixes it before the next call.", level: 2, control: "custom",
    source: slot(["engine: a history check"], "History repair comes in a later update.") },

  { id: "general.line.wait", page: "general", card: LINE, label: "Wait before sending what’s in line", help: "Quick messages sent together go as one.", level: 2, control: "number", unit: "ms", source: { kind: "config", path: "messages.inbound.debounceMs" } },
  { id: "general.line.cap", page: "general", card: LINE, label: "Most messages in line", level: 2, control: "number", source: { kind: "config", path: "messages.queue.cap" }, fallback: 20 },
  { id: "general.line.drop", page: "general", card: LINE, label: "When the line is full", help: "Summarising keeps the gist of what is dropped.", level: 2, control: "segmented",
    options: [{ v: "summarize", label: "Summarise the oldest" }, { v: "old", label: "Drop the oldest" }, { v: "new", label: "Refuse the newest" }], source: { kind: "config", path: "messages.queue.drop" }, fallback: "summarize" },

  { id: "general.clipboard.keep", page: "general", card: "Clipboard history", label: "Keep after restart", help: "Off until you choose: copied text would be written to disk.", level: 1, control: "toggle", source: no("a clipboard history") },

  { id: "general.quick-ask.anywhere", page: "general", card: "Quick ask", label: "Quick ask from anywhere", help: "A small box over any app.", level: 1, control: "toggle", source: no("quick ask over other apps") },
  { id: "general.quick-ask.shortcut", page: "general", card: "Quick ask", label: "Quick ask shortcut", help: "Escape keeps the old keys.", level: 1, control: "custom", source: slot(["desktop: a quick ask shortcut"], "Changing the quick ask shortcut comes in a later update.") },

  { id: "general.controllers.pad", page: "general", card: "Controllers", label: "Use a gamepad or macro pad", help: "Buttons answer and steer Trunks; a keypad’s lights show who needs you.", level: 1, control: "toggle", source: no("controllers") },

  { id: "general.cover.now", page: "general", card: "Cover the screen", label: "Cover now", help: "Covers every display and blocks input without sleeping, so Trunks, builds and remote sessions keep going. Any key or click brings it back.", level: 0, control: "custom",
    source: slot(["desktop: covering the screen"], "Cover the screen comes in a later update.") },
];
