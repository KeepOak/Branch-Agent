// Settings › History & backups: the rows of the R1 page, in the approved preview's cards (preview.html PG history:
// Backups, Snapshots, Roll back, see the change, undo, A copy of your setup). Every working control of the Classic
// pages these cards came from (Backups, Seasons' overnight memory cleanup, About Branch's Never dies, Every change and
// Your settings) is a row here: a config row where Classic saved one engine key, a "slot" row the page draws itself
// (history-live.tsx) where Classic made other engine calls, and a Coming row naming the call it waits for where Classic
// greyed it too.
import type { Level } from "../nav";
import type { Control, Codec, Row, RowOption } from "../rows";

type Extra = { help?: string; level?: Level; control?: Control; options?: RowOption[]; unit?: string; codec?: Codec; fallback?: unknown };
const coming = (id: string, card: string, label: string, need: string, reason: string, extra: Extra = {}): Row =>
  ({ id, page: "history", card, label, level: 0, control: "custom", ...extra, source: { kind: "coming", need, reason } });
const slot = (id: string, card: string, label: string, calls: string[], extra: Extra = {}): Row =>
  ({ id, page: "history", card, label, level: 0, control: "custom", ...extra, source: { kind: "slot", calls, reason: `${label} comes with the R1 History & backups page.` } });
const config = (id: string, card: string, label: string, path: string, control: Control, extra: Extra = {}): Row =>
  ({ id, page: "history", card, label, level: 0, ownerLevel: true, control, ...extra, source: { kind: "config", path } });

export const BACKUPS = "Backups";
export const SNAPSHOTS = "Snapshots";
export const ROLL_BACK = "Roll back, see the change, undo";
export const COPY = "A copy of your setup";

/** The memory engine's overnight cleanup settings (Classic seasons.tsx RINGS). */
export const RINGS = "plugins.entries.memory-core.config.rings";
const BACKUP = ["backup.status", "backup.schedule.set"];
const MEMORY = ["doctor.memory.status"];
const TERMINAL = "Runs from a terminal; Technical shows the command.";

/** Night window: the cleanup's five-field schedule as the hour it starts; any other schedule shows no hour. */
export const NIGHT_CODEC: Codec = {
  read: (stored) => { const m = /^0 ([135]) \* \* \*$/.exec(typeof stored === "string" && stored ? stored : "0 3 * * *"); return m ? m[1] : "custom"; },
  write: (shown) => `0 ${String(shown)} * * *`,
};
const on = (fallback: boolean): Codec => ({ read: (v) => (typeof v === "boolean" ? v : fallback), write: (v) => v === true });

/** One phase of the overnight cleanup and its numbers (Classic seasons.tsx PHASES), Technical. */
const PHASES: { id: string; title: string; rows: [key: string, label: string, unit?: string][] }[] = [
  { id: "light", title: "Light pass", rows: [["lookbackDays", "Look back", "days"], ["limit", "At most", "notes"], ["dedupeSimilarity", "Treat as the same above"]] },
  { id: "deep", title: "Deep pass", rows: [["limit", "At most", "notes"], ["minScore", "Lowest score"], ["minRecallCount", "Recalled at least", "times"], ["minUniqueQueries", "From at least", "different questions"],
    ["recencyHalfLifeDays", "Older signals count half after", "days"], ["maxAgeDays", "Ignore notes older than", "days"], ["maxPromotedSnippetTokens", "Longest kept snippet", "tokens"]] },
  { id: "rem", title: "Pattern pass", rows: [["lookbackDays", "Look back", "days"], ["limit", "At most", "notes"], ["minPatternStrength", "Lowest pattern strength"]] },
];

/** The terminal commands behind the cleanup's by-hand rows (Technical). */
export const CLEANUP_CODE: Record<string, string> = {
  "history.snapshots.code-keep": "branch memory promote",
  "history.snapshots.code-explain": "branch memory promote-explain <note>",
  "history.snapshots.code-dry": "branch memory rem-harness",
  "history.snapshots.code-folder": "branch memory rem-backfill --path <folder>",
  "history.snapshots.code-sessions": "branch memory session-backfill --agent <id>",
};

/** What the engine does when it stops (Classic Never dies), by row id. */
export const NEVER_DIES: Record<string, string> = {
  "history.undo.stops": "The gateway starts it again.",
  "history.undo.crashing": "After 3 unclean starts in 5 minutes it starts without its chat apps, so it stays up.",
  "history.undo.last-good": "Kept automatically.",
};

export const HISTORY_ROWS: Row[] = [
  // Backups: the Classic Backups page (backup.status, backup.schedule.set / clear, backup.run).
  slot("history.backups.schedule", BACKUPS, "Back up on a schedule", BACKUP, { control: "toggle", help: "Runs in the background. Running work isn’t interrupted." }),
  slot("history.backups.often", BACKUPS, "How often", BACKUP, { control: "segmented" }),
  slot("history.backups.where", BACKUPS, "Where", [...BACKUP, "backup.schedule.clear"], { help: "A private Git repository you own, or a folder on this computer outside Branch’s own data." }),
  slot("history.backups.now", BACKUPS, "Back up now", ["backup.run", "backup.status"], { control: "toggle", help: "Runs in the background; the result shows below." }),
  slot("history.backups.last", BACKUPS, "Last backup", ["backup.status"], { control: "toggle" }),
  coming("history.backups.restore", BACKUPS, "Restore a copy", "backup.restore", "Branch can’t restore a copy from here yet.", { help: "Puts back conversations, memory and settings from one copy." }),
  slot("history.backups.media-file", BACKUPS, "Largest media file", BACKUP, { control: "number", level: 1, help: "Large pictures, audio, video and PDFs are counted and left out." }),
  slot("history.backups.media-all", BACKUPS, "Media in all", BACKUP, { control: "number", level: 1, help: "Once a backup holds this much media, the rest is left out and counted." }),

  // Snapshots: the overnight memory cleanup (Classic Seasons), on the memory engine's own keys and doctor.memory.*.
  config("history.snapshots.tidy", SNAPSHOTS, "Tidy memory overnight", `${RINGS}.enabled`, "toggle", { codec: on(true), help: "Merges repeats, keeps what matters and lets go of what’s unused. Every change is in the diary." }),
  config("history.snapshots.window", SNAPSHOTS, "Night window", `${RINGS}.frequency`, "segmented", { codec: NIGHT_CODEC,
    options: [{ v: "1", label: "1 AM" }, { v: "3", label: "3 AM" }, { v: "5", label: "5 AM" }], help: "The cleanup starts when the window opens and runs until it is done." }),
  slot("history.snapshots.diary", SNAPSHOTS, "Rings diary", ["doctor.memory.dreamDiary"], { control: "toggle", help: "Every merge and every fact let go, night by night." }),
  coming("history.snapshots.keep-now", SNAPSHOTS, "Keep notes for good now", "engine: a memory promote preview call", TERMINAL, { level: 1, help: "The notes the deep pass would keep, with why." }),
  coming("history.snapshots.dry-run", SNAPSHOTS, "Try a night without keeping anything", "engine: a dry-run cleanup call", TERMINAL, { level: 1, help: "Shows what the pattern and deep passes would find. It writes nothing." }),
  slot("history.snapshots.fill", SNAPSHOTS, "Fill in from past conversations", ["memory.sessionBackfill.preview", "memory.sessionBackfill.apply", "memory.sessionBackfill.rollback"],
    { control: "toggle", level: 1, help: "Writes diary entries from conversations you pick; you can remove them all." }),
  ...[["code-keep", "Keep notes now"], ["code-explain", "Why a note scores as it does"], ["code-dry", "A night that keeps nothing"], ["code-folder", "Fill the diary from a folder"], ["code-sessions", "Fill the diary from conversations"]]
    .map(([id, label]) => slot(`history.snapshots.${id}`, SNAPSHOTS, label, [], { control: "text", level: 2 })),
  config("history.snapshots.schedule", SNAPSHOTS, "Exact schedule", `${RINGS}.frequency`, "text", { level: 2, help: "Five-field cron. Setting it makes Night window read “Custom”; empty uses the night window." }),
  ...PHASES.flatMap((p) => [
    config(`history.snapshots.${p.id}.run`, SNAPSHOTS, `${p.title}: run it`, `${RINGS}.phases.${p.id}.enabled`, "toggle", { level: 2, codec: on(true) }),
    ...p.rows.map(([key, label, unit]) => config(`history.snapshots.${p.id}.${key}`, SNAPSHOTS, `${p.title}: ${label.toLowerCase()}`, `${RINGS}.phases.${p.id}.${key}`, "number", { level: 2, ...(unit ? { unit } : {}) })),
  ]),
  config("history.snapshots.verbose", SNAPSHOTS, "Log each pass in detail", `${RINGS}.verboseLogging`, "toggle", { level: 2, codec: on(false), help: "For tuning the numbers above. Off until you choose: it writes a lot to the log." }),
  slot("history.snapshots.fill-notes", SNAPSHOTS, "Fill the diary from past notes", [...MEMORY, "doctor.memory.backfillDreamDiary"], { control: "toggle", level: 2 }),
  slot("history.snapshots.reset", SNAPSHOTS, "Remove filled-in entries", [...MEMORY, "doctor.memory.resetDreamDiary"], { control: "toggle", level: 2 }),
  slot("history.snapshots.dedupe", SNAPSHOTS, "Remove repeated diary entries", [...MEMORY, "doctor.memory.dedupeDreamDiary"], { control: "toggle", level: 2, help: "Only exact repeats." }),
  slot("history.snapshots.repair", SNAPSHOTS, "Repair Rings’ files", [...MEMORY, "doctor.memory.repairRingsArtifacts"], { control: "toggle", level: 2 }),

  // Roll back, see the change, undo: Classic About Branch's Never dies and Every change.
  slot("history.undo.stops", ROLL_BACK, "If the engine stops", [], { control: "toggle" }),
  slot("history.undo.crashing", ROLL_BACK, "If it keeps crashing", [], { control: "toggle" }),
  coming("history.undo.interrupted", ROLL_BACK, "Interrupted work", "engine: a record of interrupted work", "Branch doesn’t keep a record of interrupted work yet.",
    { help: "Safe steps carry on by themselves; anything that sends or changes something asks first." }),
  slot("history.undo.last-good", ROLL_BACK, "Last good settings", [], { control: "toggle" }),
  slot("history.undo.changes", ROLL_BACK, "Every change", ["branch.changes.list"], { help: "Each change to Branch’s setup, newest first, and what made it." }),
  coming("history.undo.roll-back", ROLL_BACK, "Roll back a change", "engine: rolling back a settings change", "Rolling back a change needs the engine’s roll back."),

  // A copy of your setup: Classic About Branch's A copy of your setup and Your settings.
  coming("history.copy.export-all", COPY, "Export a copy without secrets", "engine: a setup export", "Branch can’t export your whole setup yet; Export, below, saves the settings alone.",
    { help: "Skills, memory, personas, routines, plugins, settings and theme, with every key and sign-in taken out." }),
  slot("history.copy.export", COPY, "Export", ["config.get"], { control: "toggle", level: 1, help: "Every setting as one file. Keys and passwords are left out." }),
  slot("history.copy.import", COPY, "Import", ["config.get", "config.patch"], { control: "toggle", level: 1, help: "Shows each change before anything is applied." }),
  coming("history.copy.preset", COPY, "From a preset address", "desktop: fetching a preset from the web", "Fetching a preset from the web needs the Branch app.",
    { level: 1, control: "text", help: "A preset can update itself each time Branch starts." }),
  coming("history.copy.conversations", COPY, "Where conversations are stored", "engine: a PostgreSQL conversation store", "Needs the engine’s PostgreSQL store.",
    { level: 1, control: "select", options: [{ v: "local", label: "This computer" }, { v: "pg", label: "PostgreSQL" }], help: "PostgreSQL for a shared server. Changing it copies them across." }),
  coming("history.copy.files", COPY, "Where files are kept", "engine: keeping files somewhere else", "Needs the engine to keep files somewhere else.",
    { level: 1, control: "select", options: [{ v: "local", label: "This computer" }, { v: "s3", label: "Amazon S3" }, { v: "gcs", label: "Google Cloud Storage" }, { v: "azure", label: "Azure Blob" }], help: "Attachments and what Trunks make." }),
  slot("history.copy.data", COPY, "Where your data lives", ["system.info"], { control: "text", level: 1, help: "Moves conversations, memory and settings together. Portable mode (Developer) keeps them beside the program." }),
  coming("history.copy.usb", COPY, "Put Branch on a USB stick", "desktop: writing a copy to a USB stick", "Writing a copy to a USB stick needs the Branch app.",
    { level: 1, help: "Runs on Mac, Windows or Linux from the stick." }),
];
