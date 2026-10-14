// Settings › Learning & self-updates: the rows of the R1 page, in the approved preview's cards (preview.html PG
// learning). They come from Classic About Branch (set2/self.tsx) and Seasons (set2/seasons.tsx). A config row saves the
// engine key Classic saved, a "slot" row is drawn by the page (learning-live.tsx) on Classic's engine calls, and every
// row Classic greyed is a Coming row naming what it waits for, so nothing pretends and nothing working is left behind.
import type { Level } from "../nav";
import type { Codec, Control, Row, RowOption } from "../rows";

type Extra = { help?: string; level?: Level; control?: Control; options?: RowOption[]; unit?: string; codec?: Codec };
/** A Coming row says only that it comes later, in the row's own words (R1-10); the call it waits for stays in `need`. */
const coming = (id: string, card: string, label: string, need: string, extra: Extra = {}): Row =>
  ({ id, page: "learning", card, label, level: 0, control: "custom", ...extra, source: { kind: "coming", need, reason: `${label} comes in a later update.` } });
const slot = (id: string, card: string, label: string, calls: string[], extra: Extra = {}): Row =>
  ({ id, page: "learning", card, label, level: 0, control: "custom", ...extra, source: { kind: "slot", calls, reason: `${label} comes in a later update.` } });
const config = (id: string, card: string, label: string, path: string, control: Control, extra: Extra = {}): Row =>
  ({ id, page: "learning", card, label, level: 0, ownerLevel: true, control, ...extra, source: { kind: "config", path } });

export const MAY = "What Branch may change about itself";
export const LEARNING = "Learning";
export const OWN_CODE = "Working on its own code";
export const FIX = "What it may fix by itself";
export const GARDENER = "Gardener";
export const BUDDING = "Budding";
export const KEEPING = "Keeping a change";
export const EXTRAS = "Extras fetched when first used";
export const RUNS = "How the engine runs";
export const TALK = "Settings you can talk to";

const RINGS = "plugins.entries.memory-core.config.rings";
const SELF = "engine: a self-change policy";
const LOOP = "engine: a learning loop";
const RETIRED = "engine: skill maintenance (retired)";
const SETTING = "engine: a setting for it";
const MODE: RowOption[] = [{ v: "mode", label: "Follows the mode" }, { v: "ask", label: "Ask me first" }, { v: "never", label: "Never" }];
const toggle = (id: string, card: string, label: string, need: string, help?: string, level: Level = 0) =>
  coming(id, card, label, need, { control: "toggle", level, ...(help ? { help } : {}) });

/** Facts the page states as they are (Classic shows them as values), by row id. */
export const FACTS: Record<string, string> = {
  "learning.may.program": "Never, by itself",
  "learning.learning.adopts": "Decided by tests",
  "learning.code.pull-requests": "Drafts, merged after checks",
  "learning.code.reaching": "Only through a tested build",
};
/** The terminal commands the page shows, by row id. */
export const CODE: Record<string, string> = {
  "learning.runs.start-stop": "branch gateway status --json",
};
const ZONES = ["America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles", "Europe/London", "Europe/Berlin", "Africa/Lagos", "Asia/Kolkata", "Asia/Tokyo", "Australia/Sydney"];

const LEARN_REGULAR: [string, string, string?][] = [
  ["look-back", "Look back after each task", "A short review saves what to remember and which skills to improve."],
  ["idle", "Wait until the computer is idle", "For a model on this computer: reviews wait their turn."],
  ["tell", "Tell me what it learned", "A short line after each review."],
  ["fix-skill", "Fix a skill as soon as it’s found wrong", "A small, exact change, in the same task."],
  ["reactions", "Learn from your reactions and corrections"],
  ["thumbs", "Think again after a thumbs-down", "Saves what to do differently."],
  ["worked", "Remember what worked", "What was tried, how it went and the lesson, for similar tasks."],
  ["rules", "Turn repeated instructions into rules", "When you say the same thing three times, it offers a rule, then checks it helped."],
  ["mistake", "Make a rule from a mistake", "Say what went wrong; it becomes a rule that warns or stops it next time."],
  ["persona", "A Trunk may edit its own persona", "Each change is listed below and can be undone."],
];
const LEARN_MORE: [string, string, string][] = [
  ["blind", "Compare two models blind", "Now and then, two models answer and you pick one without knowing which."],
  ["script", "Turn a run that worked into a script", "Next time the script runs; the model steps in only where it fails."],
  ["recording", "Learn from a recording of you doing it", "A screen recording becomes a plan it can follow."],
  ["ideas", "Ideas for you", "A feed of ideas drawn from your history, with its own prompt."],
  ["write", "Write like me", "Learns how you write, from what you send."],
  ["assistants", "Learn from your other coding assistants", "Reads their history on this computer, finds repeated failures and fixes the instruction files."],
  ["coaching", "Coaching on your prompts", "Tips on prompts and sessions, from rules you can read."],
  ["drift", "Notice when it changes how it works", "Flags when the same kind of task is suddenly done differently."],
  ["team", "Learn from the team’s runs", "Repeated steps across the team become skills after a check."],
  ["search", "Tune how memory is searched", "A new way of searching is kept only if replaying past questions shows it does better."],
  ["tests", "Make tests from runs you approved", "Approved runs, with private details taken out, become test cases."],
  ["teach", "Teach the model on this computer from your feedback", "For a model on this computer only."],
  ["tester", "A tester that uses Branch like you", "On a separate copy: it never deletes, sends, spends or changes safety settings."],
];
const RUN_SWITCHES: [string, string, string][] = [
  ["memory", "If memory stays high", "Lets go of cached conversations first, then restarts cleanly."],
  ["rest", "Let idle conversations rest", "Ones nobody is watching leave memory and come back when opened."],
  ["battery", "Pause suggestions on battery", "Typing suggestions stop while this computer runs on battery."],
];
const RUN_LATER: [string, string, string][] = [
  ["real-calls", "Check and fix with real calls", "Sends one small request to each account and address to prove it works. Off until you choose: each check is a real call."],
  ["put-back", "Put back settings that broke it", "After a change, if health checks keep failing, the last settings that worked come back."],
  ["approved", "Run the approved settings", "Trunks load settings and skills from a checked release, not from a copy they are editing. Off until you choose: changes wait for a release."],
  ["send-files", "Send files to your other computers", "Encrypted; straight across when it can, through your Gateway when it can’t."],
  ["take-job", "Let other computers take a job", "Hand a task to another computer with its folder, model and permissions; it reports back here."],
];

export const LEARNING_ROWS: Row[] = [
  // What Branch may change about itself
  coming("learning.may.settings", MAY, "Its own settings", SELF, { control: "segmented", options: MODE,
    help: "Full access changes it at once; other modes show you the change first. Each change is tried on a throwaway copy." }),
  toggle("learning.may.loosen", MAY, "Loosening what it may do", SELF, "On: it may loosen what it may do as the mode allows; where the mode asks, it asks every time and the answer is never kept. Off: it never asks."),
  coming("learning.may.timings", MAY, "The gateway’s timings", SELF, { control: "segmented", options: [MODE[0], MODE[2]], help: "Full access changes them at once; other modes ask you first." }),
  coming("learning.may.restart", MAY, "Restarting its own engine", SELF, { control: "segmented", options: [MODE[0], MODE[1]], help: "When it’s stuck: at once in Full access, after your yes in other modes. Safe steps carry on after." }),
  coming("learning.may.update", MAY, "Updating itself", "engine: an ask-first update mode", { control: "segmented",
    options: [{ v: "on", label: "Allowed" }, { v: "ask", label: "Ask me first" }, { v: "never", label: "Never" }], help: "With a safety copy. Running work gets until the update deadline." }),
  slot("learning.may.program", MAY, "Its own program and your saved work", [], { control: "toggle", help: "Its program changes only through an update, never by editing its files. This one can’t be switched on." }),
  toggle("learning.may.own-code", MAY, "Work on its own code in a separate copy", SELF, "A private copy of Branch’s source. The installed app is never touched. Every change asks you first."),
  { id: "learning.may.terminal", page: "learning", card: MAY, label: "Type branch in any terminal", level: 1, ownerLevel: true, control: "toggle", help: "Adds the branch command, so the terminal view and scripts work anywhere.", source: { kind: "desktop", name: "branchOnPath" } },
  { id: "learning.may.agents", page: "learning", card: MAY, label: "Let agents use this window", level: 1, ownerLevel: true, control: "toggle",
    help: "Connected coding agents may see and click this window. A bar with Stop shows while one does. Takes effect the next time Branch starts.", source: { kind: "desktop", name: "agentControl" } },

  // Learning
  toggle("learning.learning.look-back", LEARNING, LEARN_REGULAR[0][1], LOOP, LEARN_REGULAR[0][2]),
  coming("learning.learning.model", LEARNING, "Model for looking back", LOOP, { control: "select", options: [{ v: "", label: "Same as the Trunk" }], help: "A cheaper model keeps the cost down." }),
  ...LEARN_REGULAR.slice(1).map(([id, label, help]) => toggle(`learning.learning.${id}`, LEARNING, label, LOOP, help)),
  slot("learning.learning.learned", LEARNING, "What it learned", ["skills.proposals.list", "doctor.memory.status"], { help: "What it kept and learned, newest first." }),
  ...LEARN_MORE.map(([id, label, help]) => toggle(`learning.learning.${id}`, LEARNING, label, LOOP, help, 1)),
  slot("learning.learning.adopts", LEARNING, "What it adopts", [], { control: "toggle", level: 1, help: "A change is kept only if the tests show it does better, not because a model says so." }),
  coming("learning.learning.overnight", LEARNING, "Learn overnight on", LOOP, { level: 1, control: "select",
    options: [{ v: "local", label: "Models on this computer" }, { v: "plans", label: "Your plans" }, { v: "both", label: "Models on this computer, then your plans" }], help: "Never on a paid-per-use key." }),
  coming("learning.learning.costs", LEARNING, "Unused, and what each costs", "engine: what each skill, connector and agent costs", { level: 1 }),

  // Working on its own code (Advanced)
  slot("learning.code.pull-requests", OWN_CODE, "Pull requests", [], { control: "toggle", level: 1, help: "Changes go to branch/… lines as draft pull requests with “Why merge” and evidence; merged only after every check passes on that exact commit." }),
  slot("learning.code.reaching", OWN_CODE, "Reaching the app", [], { control: "toggle", level: 1, help: "A new build must pass a self-test on a copy of your data; if it doesn’t stay up, it rolls back by itself." }),
  toggle("learning.code.missing", OWN_CODE, "Build a missing setting when you ask", SELF, "“There’s no setting for X” becomes a change that adds one, for your review.", 1),
  coming("learning.code.improve", OWN_CODE, "Ask for a change", "engine: the /improve command", { level: 1, help: "From any conversation or chat app." }),

  // What it may fix by itself (Advanced)
  toggle("learning.fix.allowed", FIX, "Only through allowed actions", SELF, "It can restart a part, reload settings, clear a cache, roll back settings or reconnect a chat app. Anything else asks you.", 1),

  // Gardener: Seasons' skill maintenance (retired in the engine) and Seasons, more.
  toggle("learning.gardener.look-after", GARDENER, "Look after skills", RETIRED, "Rests skills unused for 14 days and sets them aside at 30. Nothing is deleted, and built-in skills are never touched."),
  coming("learning.gardener.look-now", GARDENER, "Look at skills now", RETIRED),
  coming("learning.gardener.rest", GARDENER, "Rest a skill after", RETIRED, { level: 1, control: "number", unit: "days", help: "Unused this long, a skill rests: it stays installed but isn’t offered." }),
  coming("learning.gardener.aside", GARDENER, "Set it aside after", RETIRED, { level: 1, control: "number", unit: "days", help: "Set-aside skills move to Customize › Skills › Set aside." }),
  coming("learning.gardener.costs", GARDENER, "What each night costs", "engine: a record of each night’s model use",
    { level: 1, help: "Each night’s model use: free on this computer, or the plan it used when paid models are allowed." }),
  slot("learning.gardener.clear", GARDENER, "Clear replayed notes", ["doctor.memory.resetGroundedShortTerm"], { control: "toggle", level: 1,
    help: "Removes the notes Rings pulled back from older daily logs and is still weighing. Nothing already kept is touched." }),
  slot("learning.gardener.weighing", GARDENER, "What Rings is weighing", ["doctor.memory.status"], { control: "toggle", level: 1, help: "Notes waiting to be kept for good, and where each came from." }),
  config("learning.gardener.zone", GARDENER, "Time zone for the night window", `${RINGS}.timezone`, "select", { level: 1,
    options: [{ v: "", label: "This computer’s" }, ...ZONES.map((z) => ({ v: z, label: z.replace(/_/g, " ") }))], help: "The night window is read in this time zone.",
    codec: { read: (v) => (typeof v === "string" ? v : ""), write: (v) => (v === "" ? null : v) } }),
  slot("learning.gardener.model", GARDENER, "Model that writes the diary", ["models.list", "config.get", "config.patch"], { control: "select", level: 1, help: "Writes the Rings diary’s sentences." }),
  config("learning.gardener.storage", GARDENER, "Where Rings writes what it keeps", `${RINGS}.storage.mode`, "segmented", { level: 1,
    options: [{ v: "inline", label: "In memory" }, { v: "separate", label: "Its own file" }, { v: "both", label: "Both" }],
    codec: { read: (v) => (typeof v === "string" && v ? v : "separate"), write: (v) => v }, help: "In memory writes into the memory file; its own file keeps a separate report." }),
  config("learning.gardener.reports", GARDENER, "Keep reports out of memory", `${RINGS}.storage.separateReports`, "toggle", { level: 1,
    codec: { read: (v) => v === true, write: (v) => v === true }, help: "Rings’ nightly reports stay out of the main memory file." }),

  // Budding: the skill workshop (skills.workshop.autonomous.mode).
  config("learning.budding.learn", BUDDING, "Learn what a Trunk can’t do yet", "skills.workshop.autonomous.mode", "toggle", {
    codec: { read: (v) => typeof v === "string" && v !== "off" && v !== "", write: (v) => (v === true ? "propose" : "off") },
    help: "It tries the simplest way first, and learns from your corrections and finished work as skills. Installing anything, writing its own tool or changing Branch’s code always asks you." }),
  coming("learning.budding.step", BUDDING, "Highest step it may take", "engine: learning beyond skills", { control: "segmented",
    options: [{ v: "skill", label: "A skill" }, { v: "addon", label: "An add-on" }, { v: "tool", label: "Its own tool" }, { v: "code", label: "Branch’s code" }], help: "Steps above this aren’t tried." }),

  // Keeping a change
  coming("learning.keeping.better", KEEPING, "Keep a change only if it does better by", "engine: practice runs", { control: "number", unit: "%", help: "Measured on practice runs of your recent tasks." }),
  toggle("learning.keeping.paid", KEEPING, "Use paid models at night", "engine: a paid-models-at-night switch",
    "Rings uses your usual model while you sleep. Off: it uses only the model on this computer."),

  // Extras fetched when first used (Advanced)
  coming("learning.extras.list", EXTRAS, "Extras fetched when first used", "engine: the list of fetched extras", { level: 1,
    help: "Speech, office files and connector kits fetched the first time they were used." }),

  // How the engine runs (Advanced; the terminal and process rows are Technical)
  coming("learning.runs.as", RUNS, "Runs as", "engine: how it was started", { level: 1, help: "The same way on every system: systemd on Linux, launchd on a Mac, a task on Windows." }),
  slot("learning.runs.start-stop", RUNS, "Start, stop and status", [], { control: "text", level: 2, help: "Also: branch gateway start, branch gateway stop, branch gateway restart." }),
  coming("learning.runs.socket", RUNS, "Control socket", "engine: its control socket", { level: 2, help: "Only programs on this computer can use it." }),
  coming("learning.runs.status-files", RUNS, "Status files", "engine: its status files", { level: 2, help: "Other programs read these to tell whether Branch runs." }),
  slot("learning.runs.process", RUNS, "Process names", ["system.info"], { control: "toggle", level: 2, help: "How they show in Task Manager and ps." }),
  slot("learning.runs.connected", RUNS, "Connected now", ["system-presence"], { control: "toggle", level: 1, help: "Windows, terminals, phones and chat apps on this engine." }),
  slot("learning.runs.people", RUNS, "People on this engine", ["users.list"], { control: "toggle", level: 1, help: "One engine serves everyone’s profile; each starts and stops on its own." }),
  coming("learning.runs.freezes", RUNS, "If it freezes", "engine: an outside watchdog", { level: 1, help: "A watchdog outside the engine notices a stuck start, a frozen loop or a hung shutdown." }),
  ...RUN_SWITCHES.map(([id, label, help]) => toggle(`learning.runs.${id}`, RUNS, label, SETTING, help, 1)),
  slot("learning.runs.tasks", RUNS, "Tasks at once", ["config.get"], { control: "toggle", level: 1, help: "Branch adds no cap of its own; a service’s own limits still apply." }),
  coming("learning.runs.temp", RUNS, "Old temporary files", SETTING, { level: 1, control: "select",
    options: [{ v: "7", label: "7 days" }, { v: "30", label: "30 days" }, { v: "never", label: "Until I clear them" }], help: "Downloads, logs and caches past this are cleared in a quiet moment." }),
  ...RUN_LATER.map(([id, label, help]) => toggle(`learning.runs.${id}`, RUNS, label, SETTING, help, 1)),
  // Classic's running status and its actions, kept on their own rows (not in the preview's list; listed in the PR).
  slot("learning.runs.health", RUNS, "Check and fix", ["health", "doctor.memory.status"], { control: "toggle", level: 1 }),
  slot("learning.runs.restart-now", RUNS, "Restart the engine", ["gateway.restart.request"], { control: "toggle", level: 1 }),
  coming("learning.runs.setup", RUNS, "Set up the Gateway again", "desktop: the Branch app’s setup", { level: 1, help: "Install or reconfigure the Gateway on this computer. Your conversations and settings stay." }),

  // Settings you can talk to (Advanced)
  coming("learning.talk.change", TALK, "Change settings by talking", "engine: changing settings by talking", { level: 1,
    help: "Ask “why does a Trunk ask before every email?” or “let it book without asking” in any conversation." }),
  coming("learning.talk.suggestions", TALK, "Suggestions made on this computer", "engine: suggestions made on this computer", { level: 1,
    help: "Small suggestions from what you do, worked out here without asking a model." }),
];
