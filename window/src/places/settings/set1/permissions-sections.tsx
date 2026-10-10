// Permissions, every section below "Mode everywhere" as row tables, in the preview's order. Regular shows the
// level-0 sections; Advanced and Technical add theirs in place. Config keys and their engine defaults:
// tools.exec.* and tools.* (schema.help.runtime.ts), agents.defaults.sandbox.* (agents/sandbox/config.ts),
// gateway.terminal.* and gateway.controlUi.automaticallyFetchFavicons; the command rules live in the exec approvals file.
// TODO(engine-lane): the greyed reasons in this file say what is still missing; shownWhy (shell/shown-why.ts) keeps them out of sight.
import { record } from "../adapter";
import { CommandDefaults, RulesFor, RulesList } from "./permissions-commands";
import { WHY, type Cfg, type Dead, type Row, type Section } from "./permissions-rows";
import { ApprovalsRow, Connectors, Lockdown, WhoMay } from "./permissions-top";

const off = (t: string, sub: string | undefined, c: Dead, why = WHY.key, lv?: 0 | 1 | 2): Row => ({ k: "off", t, sub, c, why, lv });
const offSw = (t: string, sub: string, on: boolean, why = WHY.key): Row => off(t, sub, { sw: on }, why);
const pill = (t: string, sub: string): Row => ({ k: "pill", t, sub, word: "Always on" });
const isObj = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === "object" && !Array.isArray(v);

/** tools.toolSearch may be a boolean; writing one key then needs the whole object, keeping it on or off. */
function toolSearchSet(c: Cfg, key: string, value: unknown) {
  const cur = c.get("tools.toolSearch");
  return isObj(cur) ? c.set(`tools.toolSearch.${key}`, value) : c.set("tools.toolSearch", { enabled: cur !== false, [key]: value });
}
/** tools.codeMode: absent is "auto"; an object without enabled is off. */
function codeModeOf(c: Cfg): string {
  const v = c.get("tools.codeMode");
  const e = isObj(v) ? v.enabled : v === undefined ? "auto" : v;
  return e === "auto" ? "auto" : e === true ? "on" : "off";
}
function codeModeSet(c: Cfg, id: string) {
  const value = id === "auto" ? "auto" : id === "on";
  return isObj(c.get("tools.codeMode")) ? c.set("tools.codeMode.enabled", value) : c.set("tools.codeMode", value);
}
const MEDIA = ["image", "audio", "video"];
const mediaOn = (c: Cfg) => MEDIA.every((k) => c.get(`tools.media.${k}.enabled`) !== false);
const mediaSet = (c: Cfg, on: boolean) => c.set("tools.media", Object.fromEntries(MEDIA.map((k) => [k, { enabled: on ? null : false }])));
const list = (v: unknown) => (Array.isArray(v) ? v.map(String) : []);
const SAFE_BINS = ["cut", "uniq", "head", "tail", "tr", "wc"];
const SB_SUB: Record<string, string> = { off: "Off: commands follow “Where commands run”.", all: "Every conversation: each Trunk works in its own sealed container.", "non-main": "Every conversation except each Trunk’s main one. Group chats and chat-app conversations are never a main one." };

export const LOCKS: Section = { title: "Locks and records", lv: 0, rows: [
  off("App lock", "Turns on when you set a PIN.", { seg: ["Off", "After 15 min", "Always"] }, WHY.pin),
  off("Set a PIN", "At least four digits, kept on this computer.", { btn: "Set a PIN" }, WHY.pin),
  off("Tell me about wrong PINs", "After 5 wrong PINs in a row, Branch messages you in a chat app. It only ever messages you.", { none: true }, WHY.pin, 1),
  off("Emergency stop", "Stops every task at once, on every computer, and holds them.", { btn: "Stop everything" }, "The engine can’t stop every task on every computer at once yet.", 1),
  off("Every change to what Branch may reach", "Each time access widens or narrows it’s written down. Export it as a spreadsheet.", { btn: "See the record" }, "The engine doesn’t keep a record of access changes yet.", 1),
  off("A practice workspace", "A folder of made-up files where a Trunk can try something risky first.", { btn: "Open it" }, "The engine has no practice workspace yet.", 1),
  { k: "el", t: "Approvals", lv: 1, el: (x) => <ApprovalsRow x={x} /> },
  off("Older file-transfer permissions", "Older yeses for copying files to and from your computers stay paused until you review them. Blocks, size limits and link settings keep working meanwhile.", { btn: "Review" }, "The engine can’t list them here yet; move them by command.", 2),
  { k: "code", t: "Move them by command", lv: 2, code: "branch file-transfer approvals migrate --dry-run" },
], tail: (x) => <Lockdown engine={x.engine} /> };

export const RULES: Section = { title: "Rules for each tool and folder", group: "Rules and checks", lv: 1, rows: [
  { k: "el", t: "Rules for", el: (x) => <RulesFor x={x} /> },
  { k: "el", t: "Add a rule", words: "allow command pattern allowlist", el: (x) => <RulesList x={x} /> },
  offSw("Practice runs", "A Trunk can show what it would do without doing it.", true),
  { k: "num", t: "Standing permissions end after", sub: "How long a new Always allow for an automation lasts. Empty means until revoked.", path: "tools.exec.grantExpiryDays", unit: "days", ph: "Until revoked", min: 1, max: 3650 },
] };

export const COMMANDS: Section = { title: "Commands, by default", group: "Rules and checks", showHeading: false, lv: 1, rows: [
  { k: "el", t: "Commands may run", words: "ask before a command when nobody can be asked skill programs allowed commands", el: (x) => <CommandDefaults x={x} /> },
] };

export const MORE_WITHOUT: Section = { title: "Without asking, more", group: "Without asking, Trunks may…", showHeading: false, lv: 1, hint: "Branch still tells you each time and counts down before a recording. Allowing the capture question once turns the matching switch on.", rows: [
  offSw("Capture the screen", "Screenshots and recordings of this computer’s screen. Off means the next capture asks you first.", false),
  offSw("Use the camera", "Photos and clips from this computer’s camera. Off means the next capture asks you first.", false),
  offSw("Share location", "Where this computer is. Off means the next capture asks you first.", false),
] };

export const CHECKS: Section = { title: "Checks before anything runs", group: "Rules and checks", showHeading: false, lv: 1, rows: [
  offSw("Scan commands for hidden characters", "Invisible and look-alike characters that hide what a command does.", true),
  offSw("Scan for personal details", "Card numbers, ID numbers and addresses are held back from outside services. Off until you choose: it can hold back details a task needs.", false),
  offSw("Authenticator code for sensitive tools", "A six-digit code before sending money or deleting a lot. Off until you choose: you set it up with an authenticator app first.", false),
] };

export const ISOLATION: Section = { title: "Isolation", group: "Sandbox", lv: 1, rows: [
  { k: "seg", t: "Sandbox", lv: 2, path: "agents.defaults.sandbox.mode", def: "off", opts: [{ id: "off", label: "Off" }, { id: "non-main", label: "All but each Trunk’s main conversation" }, { id: "all", label: "Every conversation" }], subOf: (v) => SB_SUB[v] ?? "" },
  { k: "pick", t: "One sandbox per", lv: 2, path: "agents.defaults.sandbox.scope", def: "agent", opts: [{ id: "agent", label: "Trunk" }, { id: "session", label: "Conversation" }, { id: "shared", label: "Shared by all" }], subOf: (v) => (v === "shared" ? "Shared ignores per-Trunk settings." : "") },
  { k: "pick", t: "Runs in", lv: 2, sub: "Plugins can add more (OpenShell, Cuttings).", path: "agents.defaults.sandbox.backend", def: "docker", opts: [{ id: "docker", label: "Docker" }, { id: "podman", label: "Podman" }, { id: "ssh", label: "SSH" }, { id: "openshell", label: "OpenShell" }, { id: "crabbox", label: "Cuttings" }] },
  off("System sandbox for commands", "Every command runs contained here.", { seg: ["Off", "When needed", "Always"], v: "Always" }, WHY.desk, 2),
  { k: "sw", t: "Let a conversation run commands outside the sealed box", sub: "Commands may leave the sealed box only for the people and chats on the list. No one is on it at first. Turning it off turns it off in every conversation.", path: "tools.elevated.enabled", def: true },
  { k: "el", t: "Who may", when: (c) => c.get("tools.elevated.enabled") !== false, el: (x) => <WhoMay x={x} /> },
  off("Add sign-ins from outside the sandbox", "The sandbox never holds a password; Branch adds it on the way out. Off until you choose: a Trunk’s web requests then pass through Branch.", { sw: false }, WHY.key, 2),
  off("Verify each release", "Checks the signature before installing an update.", { sw: true }, WHY.key, 2),
  { k: "sw", t: "Pin SSH hosts", lv: 2, sub: "Refuses a computer whose fingerprint changed.", path: "agents.defaults.sandbox.ssh.strictHostKeyChecking", def: true },
  off("Downloads may come from", "Private-network addresses stay blocked.", { seg: ["Anywhere", "Known sites", "Ask each time"] }, WHY.key, 2),
  { k: "code", t: "Extra commands computers may run", lv: 2, sub: "Commands beyond each computer’s and phone’s usual set, such as taking a photo, recording the screen or sending a text. Change it in the settings file; a blocked command always wins.", code: (c) => list(c.get("gateway.nodes.commands.allow")).join(", ") || "None" },
  { k: "pick", t: "Commands run on", lv: 2, sub: "Auto uses the sandbox when one is running, otherwise the Gateway’s computer.", path: "tools.exec.host", def: "auto", opts: [{ id: "auto", label: "Auto" }, { id: "sandbox", label: "The sandbox" }, { id: "gateway", label: "The Gateway" }, { id: "node", label: "A computer" }] },
  { k: "code", t: "Safe programs", lv: 2, sub: "Run on plain input without a rule; a program counts only with a profile.", code: (c) => (list(c.get("tools.exec.safeBins")).length ? list(c.get("tools.exec.safeBins")) : SAFE_BINS).join(" ") },
  off("The Linux sandbox here", "No Windows programs or drives; never an administrator.", { btn: "Check it" }, WHY.desk, 2),
  off("Refuse commands when the sandbox can’t start", "Stops commands until the sandbox works.", { sw: false }, WHY.key, 2),
] };

export const TOOLS_TECH: Section = { title: "Tools, technical", group: "Sandbox", showHeading: false, lv: 2, rows: [
  { k: "seg", t: "Code mode", sub: "A model can write a short script that calls several tools at once. Auto uses it only for models made for it.", path: "tools.codeMode", def: "auto", opts: [{ id: "auto", label: "Auto" }, { id: "on", label: "On" }, { id: "off", label: "Off" }], read: codeModeOf, save: codeModeSet },
  { k: "pick", t: "How tools are found", path: "tools.toolSearch.mode", def: "tools", opts: [{ id: "tools", label: "By search" }, { id: "directory", label: "From a directory" }], read: (c) => (record(c.get("tools.toolSearch")).mode === "directory" ? "directory" : "tools"), save: (c, v) => toolSearchSet(c, "mode", v) },
  { k: "num", t: "Search results", path: "tools.toolSearch.searchDefaultLimit", def: 8, min: 1, max: 50, when: (c) => record(c.get("tools.toolSearch")).mode !== "directory", save: (c, n) => toolSearchSet(c, "searchDefaultLimit", n) },
  { k: "num", t: "Most results a model may ask for", sub: "Up to 50.", path: "tools.toolSearch.maxSearchLimit", def: 20, min: 1, max: 50, when: (c) => record(c.get("tools.toolSearch")).mode !== "directory", save: (c, n) => toolSearchSet(c, "maxSearchLimit", n) },
  { k: "seg", t: "Conversations a Trunk can see", path: "tools.sessions.visibility", def: "all", opts: [{ id: "self", label: "Its own" }, { id: "tree", label: "Its helpers’" }, { id: "agent", label: "Its Trunk’s" }, { id: "all", label: "All" }] },
  { k: "sw", t: "Trunks may message each other", path: "tools.agentToAgent.enabled", def: true },
  { k: "sw", t: "Files only inside the project folder", path: "tools.fs.workspaceOnly", def: false },
  off("Every tools setting", "The settings file, at its tools section.", { btn: "Open" }, WHY.desk),
] };

export const TEST: Section = { title: "Test and explain", group: "Rules and checks", showHeading: false, lv: 1, rows: [
  off("Test a rule", "Type a command, a file or a site and see which rule decides, before any Trunk tries it.", { btn: "Test" }, WHY.test),
  off("What Trunks may reach, in sentences", "Every site and network rule written out as plain sentences.", { btn: "Read it" }),
  off("Why is this set?", "Each setting that differs from the default: who set it, when, and why. Put any back.", { btn: "See" }),
  off("A second look before approvals", "Another model reads risky actions first and says what worries it.", { sw: true }, "In Auto a reviewer model always reads commands first; there is no separate switch."),
  offSw("Hold back keys found in answers", "A key or password in a reply is hidden before it is sent anywhere.", true),
  off("Trusted folders", "Folders a Trunk may change without asking. A new project folder asks the first time.", { btn: "See" }),
  off("Security check", "Checks this Branch’s settings and says what to fix.", { btn: "Check" }, "The engine runs the security check only from the terminal: branch security audit."),
  { k: "code", t: "Deep check from the terminal", lv: 2, code: "branch security audit --deep" },
] };

export const SECURITY_TECH: Section = { title: "Security, technical", group: "Sandbox", showHeading: false, lv: 2, rows: [
  off("Hidden findings", "Security check findings you chose to hide, each with your reason. Put any back.", { btn: "See" }),
  offSw("Check installs with my own program", "Runs your command on every skill or plugin before it installs; its no stops the install. Off until you choose: it needs a program of your own.", false),
  off("Every security setting", "The settings file, at its security and approvals sections.", { btn: "Open" }, WHY.desk),
] };

export const GUARDS_ON: Section = { title: "Guards that are always on", group: "Rules and checks", showHeading: false, lv: 2, rows: [
  off("Outside content is only information", "Always on: web pages, emails and files are treated as information, never as instructions.", { btn: "Show an example" }, WHY.guard),
  off("Tasks started from chat apps", "Always on: your own chat-app tasks follow their conversation’s mode; anyone else starts on Ask first, and only the approval button or /approve counts as a yes, never a typed yes.", { btn: "See the four" }, WHY.guard),
  off("Loops and empty answers", "Always on: an empty answer counts as a failure. A task going in circles is stopped when “Stop a Trunk that repeats itself” is on.", { btn: "Last week" }, WHY.guard),
  off("Keys never land in transcripts", "Always on: a key or password that shows up in output is blanked before it’s saved or sent.", { btn: "Show an example" }, WHY.guard),
  off("Check scripts before they run", "Looks for forbidden calls, hidden decoders and disguised commands in any script a Trunk writes.", { btn: "Check an example" }, WHY.guard),
] };

export const TOOLS_LOOPS: Section = { title: "Tools and loops", group: "Rules and checks", showHeading: false, lv: 1, rows: [
  { k: "seg", t: "Tools every Trunk starts with", sub: "Minimal is only status and updates; Coding adds files, commands, the web and memory; Messaging adds chat apps and conversations; Full adds the optional tools plugins offer. Each Trunk’s toolsets (Customize › Tools › Toolsets) still decide per Trunk.", path: "tools.profile", def: "full", opts: [{ id: "minimal", label: "Minimal" }, { id: "coding", label: "Coding" }, { id: "messaging", label: "Messaging" }, { id: "full", label: "Full" }] },
  off("When tools are loaded", "“When needed” keeps a tool one step away until a task calls for it. This used to be a three-way switch on every feature.", { seg: ["Never", "When needed", "Always"], v: "When needed" }),
  { k: "sw", t: "Stop a Trunk that repeats itself", sub: "Warns at 10 repeated steps, stops the step at 20 and the task at 30. Off until you choose.", path: "tools.loopDetection.enabled", def: false, save: (c, on) => c.set("tools.loopDetection.enabled", on ? true : null) },
  { k: "sw", t: "Tell me when a background command ends", sub: "A Trunk hears when a command it left running finishes.", path: "tools.exec.notifyOnExit", def: true },
  { k: "sw", t: "Also when it ends quietly", sub: "A command that succeeds with no output sends a notice too.", path: "tools.exec.notifyOnExitEmptySuccess", def: false },
  { k: "num", t: "Move a command to the background after", sub: "Up to 120.", path: "tools.exec.backgroundMs", def: 10, scale: 1000, unit: "s", min: 1, max: 120 },
  { k: "num", t: "Stop a command after", sub: "0 in one call means no limit.", path: "tools.exec.timeoutSeconds", def: 1800, unit: "s", min: 1 },
  { k: "sw", t: "Show a plan card", sub: "A Trunk shows its plan as a checklist while it works.", path: "tools.updatePlan", def: true },
  { k: "sw", t: "Read pictures, sound and video", sub: "Pictures, sound and video in messages and files are read.", path: "tools.media", def: true, read: mediaOn, save: mediaSet },
  { k: "num", t: "At once", path: "tools.media.concurrency", def: 2, min: 1, when: mediaOn },
] };

export const PRIVACY: Section = { title: "Privacy", lv: 1, rows: [
  { k: "sw", t: "Site icons and link previews", sub: "The Gateway fetches each link’s icon, title and picture, without cookies, and only when you point at a link. The sites see the link and the Gateway’s address.", subOff: "Off also stops browser-tab previews; live browser pictures are not affected.", path: "gateway.controlUi.automaticallyFetchFavicons", def: true },
] };

const termOn = (c: Cfg) => c.get("gateway.terminal.enabled") !== false;
export const TERMINAL: Section = { title: "Your terminal", lv: 1, rows: [
  { k: "sw", t: "A terminal of your own", sub: "Lets you use “Open a terminal for me” in a conversation. It runs as you on the Gateway’s computer, outside any sandbox; only the owner can open it, and never for a Trunk whose every conversation is sandboxed.", path: "gateway.terminal.enabled", def: true },
  { k: "num", t: "Keep a closed terminal running", sub: "0 ends it when you close it.", path: "gateway.terminal.detachedSessionTimeoutSeconds", def: 300, unit: "s", min: 0, when: termOn },
  { k: "pick", t: "Shell", lv: 2, path: "gateway.terminal.shell", def: "", when: termOn, opts: [{ id: "", label: "Your login shell" }, { id: "pwsh.exe", label: "pwsh.exe" }, { id: "cmd.exe", label: "cmd.exe" }, { id: "wsl.exe", label: "wsl.exe" }], save: (c, v) => c.set("gateway.terminal.shell", v || null) },
] };

const FOLDER = { seg: ["Blocked", "Read only", "Read and write"] };
const SB_FOLDERS = "The sandbox reaches only its project folder; other folders can’t be chosen here yet.";
export const FOLDERS: Section = { title: "Folders the sandbox may reach", group: "Sandbox", showHeading: false, lv: 1, hint: "Commands in the sandbox see only these folders.", rows: [
  off("Documents", undefined, FOLDER, SB_FOLDERS), off("Downloads", undefined, FOLDER, SB_FOLDERS), off("Desktop", undefined, FOLDER, SB_FOLDERS),
  off("Add a folder", undefined, { btn: "Add a folder" }, SB_FOLDERS),
] };

export const POLICY: Section = { title: "Company policy", group: "Company policy", showHeading: false, lv: 2, rows: [
  offSw("Check Branch against a policy file", "Reports where Branch differs from your organisation’s policy file (policy.jsonc). It changes nothing by itself. Off until you choose: it is for organisations with a written policy.", false, WHY.policy),
  offSw("Let it repair project folders", "Off until you choose: it changes files in your projects.", false, WHY.policy),
] };

export const MORE_APPROVALS: Section = { title: "Approvals, more", group: "Approvals", lv: 1, rows: [
  offSw("Change files inside the project folder", "In Auto: edits inside the project run without asking. Outside it, and Branch’s own files, still ask.", false),
  offSw("Use connectors’ tools", "In Auto: tools from your connectors run without asking.", false),
  offSw("Switch to another mode", "In Auto: a Trunk can move from Plan first to doing it.", false),
  off("Ask again after", "Even in Auto, it checks in after this many model requests in one task. Empty: never.", { num: "Never", unit: "requests" }),
  off("Ask again after spending", "In one task, on accounts that bill per use. Empty: never.", { num: "Never", unit: "USD" }, WHY.money),
  off("Ask about", "Every action carries a risk level; this picks which ones wait for you in Auto.", { seg: ["Everything that changes something", "Only risky actions"], v: "Only risky actions" }),
  offSw("Let me edit a change before I allow it", "Open the change, edit it, and your version is what lands.", true),
  offSw("Pick the suggested answer by itself", "A countdown picks the suggested answer unless you type. Off until you choose: it answers for you.", false),
  off("Countdown", "When the switch above is on.", { num: "30", unit: "s" }),
  offSw("Answer several at once", "Questions that arrive together come as one card: allow all, skip all, don’t ask again.", true),
  offSw("If the second look keeps saying no, ask me", "After three refusals in a row, the question comes to you instead.", true),
  offSw("Keep a copy before deleting or overwriting", "The approval names the exact change; the old files go to Checkpoints first.", true),
  off("An unanswered question expires after", "Then the task asks again or stops. A late yes is never lost: it continues the task.", { num: "30", unit: "minutes" }),
  pill("A yes covers that exact request", "Allow covers the action you saw, with the same details, once. Anything different asks again."),
  off("Automations only narrow", "Unattended steps, replayed procedures and resumed work never get more than they had when you said yes.", { none: true }, WHY.guard),
  off("Rules can also say", "Besides Allow, Ask and Never: “Hand it to me” (the Trunk prepares the step and you do it) and “Only if I asked” (it runs only when your own message asked for it).", { none: true }, "The engine’s rules only allow."),
] };

const g = (t: string, sub: string): Row => off(t, sub, { none: true }, WHY.guard);
export const MORE_GUARDS: Section = { title: "Guards, more", group: "Guards", lv: 1, rows: [
  g("Dangerous commands are spotted", "Commands are read the way the shell reads them, wrappers and pipes included, and checked against known harmful ones."),
  g("A few commands always ask", "Deleting a whole folder tree, force-pushing, formatting a disk and piping a password to sudo ask in every mode."),
  g("Branch can’t break itself", "Commands that would change Branch’s own program or settings, or its instructions, always ask."),
  g("Keys and private folders ask", ".env files, ~/.ssh, cloud sign-in files and other people’s folders ask before any read or write."),
  { ...off("Files Trunks never see", "Like .gitignore: one pattern per line. Kept in .branchignore in each project.", { text: "secrets/" }), stack: true } as Row,
  offSw("Ask again when a project’s hooks change", "New or changed hooks and policy files in a project wait for your yes.", true),
  offSw("Spot instructions hidden in what Trunks read", "Pages, files, memory and scheduled prompts are checked; a hit is shown and set aside.", true),
  offSw("Clean pages before a Trunk reads them", "Hidden text, comments and invisible characters are taken out first.", true),
  offSw("Load outside pictures only when I click", "A picture’s address can carry data out, so it waits for you.", true),
  offSw("Check what Trunks write for keys and risky code", "Files and memory a Trunk writes are checked before they’re saved.", true),
  offSw("Hold an address that carries a key", "A web request with a key or code in its address waits for your yes.", true),
  offSw("Note every address a command sends to", "curl, git push, uploads: written to the record.", true),
  offSw("Check connectors’ tool descriptions", "Flags hidden instructions or a tool that changed after you allowed it.", true),
  pill("Helpers never get more than their Trunk", "A helper keeps every “Never” of the Trunk that started it."),
  g("Plugins can’t loosen your rules", "Your rules run outside any plugin’s hooks."),
  g("Says it did something only when it did", "A reply claiming an action without a record of it is corrected."),
  g("Private details stay out of the wrong rooms", "Before sharing something private, it checks who is in the chat."),
  pill("Thinking and tool markup never reach a chat", "Stripped before any reply leaves."),
  g("Database questions stay read-only", "A query it writes can’t hide a change."),
  g("Asks for the least access", "Each sign-in asks only for what that job needs."),
  g("Reads a file before changing it", "A file changed since it was read must be read again."),
  g("Mail goes out encrypted", "Mail sign-ins use TLS; plain is allowed only on this computer."),
  g("Loosening a setting asks first", "An unreadable setting counts as off."),
  g("Coding apps it hands work to stay boxed", "They get one job and no shell of their own."),
  g("Tool servers start safely", "A local tool server starts only from an allowed command, inside the sandbox."),
  offSw("Check for harmful content", "Messages in and out are checked by the model service. Off until you choose: it sends text for checking.", false),
  { ...off("Words to block or mask", "One word or pattern per line.", { text: "" }), stack: true } as Row,
  { ...off("Topics to stay away from", "One per line. A message about one gets a polite no.", { text: "" }), stack: true } as Row,
  offSw("Translate messages in other languages", "Detected and translated before the Trunk reads them. Off until you choose: it changes what the Trunk sees.", false),
  offSw("Encrypt Branch’s database", "The key stays in your computer’s own key store. Off until you choose: it needs that key at every start.", false),
  offSw("Hide passwords in recordings", "Anything typed into a password field is blanked in recordings and previews.", true),
  offSw("Face, finger or PIN for sensitive actions", "Your device’s own check before money or a big delete. Off until you choose: you set it up on the device first.", false),
  offSw("One task at a time", "A new task waits while one runs.", false),
  offSw("Skills may run their own shell lines", "Only skills you trust, after one yes. Off until you choose: a skill could run commands.", false),
  off("Block distracting sites and apps", "Trunks and the browser won’t open them.", { field: "site.example", btn: "Block" }),
  off("Trust in each contact", "Worked out from what each person has asked before.", { btn: "See" }),
  off("Check installed packages", "Every package Branch and your skills installed, against known flaws.", { btn: "Check now" }),
] };

export const MONEY: Section = { title: "Money", group: "Locks", lv: 1, rows: [
  off("Most per payment", "Payments and trades above this are refused; raise it here, not in a chat.", { num: "None allowed", unit: "USD" }, WHY.money),
  off("Most a day", undefined, { num: "None allowed", unit: "USD" }, WHY.money),
  offSw("Ask before paying someone new", "A new recipient always asks, with the exact amount.", true, WHY.money),
  off("Pay for metered web services", "Some services ask for a small payment per call.", { seg: ["Never", "Ask each time"] }, WHY.money),
] };

const NET = "The engine has no network rules for the sandbox yet.";
export const NETWORK: Section = { title: "Network and sandbox, technical", group: "Sandbox", showHeading: false, lv: 2, rows: [
  off("Ready-made network rules", "Each adds the addresses that service needs, and says where the list came from.", { seg: ["GitHub", "Gmail", "Outlook", "Jira", "npm", "PyPI", "Hugging Face"], v: "" }, NET),
  { ...off("Sites sandboxed commands may reach", "One per line. Everything else is refused.", { text: "registry.npmjs.org" }, NET), stack: true } as Row,
  offSw("Ask about a new site", "Instead of refusing, a new site asks once.", true, NET),
  { ...off("Finer rules for an address", "Allow or refuse by method and path, such as “GET api.github.com/repos/*”.", { text: "" }, NET), stack: true } as Row,
  { k: "num", t: "Sandbox: most processes", sub: "Empty means no limit.", path: "agents.defaults.sandbox.docker.pidsLimit", ph: "No limit", min: 1 },
  off("Sandbox: most disk", "Empty means no limit.", { num: "No limit", unit: "GB" }),
  off("Sandbox: longest run", "Empty means no limit.", { num: "No limit", unit: "minutes" }),
  { ...off("Send all model traffic through", "One address for every model request and coding app. Empty: straight to each service.", { text: "https://models.example.com" }), stack: true } as Row,
  off("Lend keys to a task for at most", "A task gets a key for this long, then must ask again. Empty: for the whole task.", { num: "Whole task", unit: "minutes" }),
  off("New rules start", "Watching only writes down what a rule would have done, without doing it.", { seg: ["Enforced", "Watching only"] }),
  off("Policy files", "Rules written as files: a guard, a playbook or a tool guide, each with what starts it.", { none: true }, WHY.policy),
  offSw("Watch each task’s path", "A checker reads each run as it goes and stops one going somewhere risky. Off until you choose: it adds a model call to each step.", false),
  offSw("Tell me when a Trunk acts unusually", "Compared with its own last week.", false),
  offSw("Pause the sandbox on a threat", "Watches the sandbox’s processes and connections; a match pauses it.", false),
  offSw("Check sandbox changes for new reach", "Before a change applies, it lists anything newly reachable.", true),
  off("Learn what a task needs", "Run it once while every file it touches is noted, then keep only that.", { btn: "Start learning" }),
  off("Rules in the system itself", "Linux only: rules that follow every program a Trunk starts.", { btn: "Set up" }),
  offSw("Cloud calls are read-only until you say", "A cloud or GitHub call that would change something waits for your yes.", true),
  offSw("Weigh what it reads by where it came from", "Your words count most; web pages least.", true),
  offSw("Agree a scope before each task", "Which folders, review or edit, how many helpers; anything outside asks.", false),
  offSw("Outside work goes to throwaway helpers", "The Trunk itself keeps no web or file reach; short-lived helpers do that work.", false),
  offSw("Unattended runs only propose changes", "A run with no one watching writes comments and drafts; you apply them.", false),
  offSw("More freedom as a Trunk proves itself", "A Trunk with a long clean record asks less. Off until you choose: it changes what asks.", false),
  offSw("Only approved answers", "For a public bot: it can only send answers you wrote, with blanks filled in.", false),
  offSw("Spot padded input", "Text stuffed to push its instructions out of view is flagged.", true),
  offSw("Check pictures, PDFs, sound and video for hidden instructions", "Text in them is read out and checked first. Off until you choose: it reads every file first.", false),
  offSw("Check addresses before fetching", "Against VirusTotal, with your key. Off until you choose: addresses go to VirusTotal.", false),
  offSw("Keys lent from my phone", "Keys stay on the paired phone and are lent to this computer only while needed. Off until you choose: your phone must be nearby.", false),
  offSw("Watch other coding apps on this computer", "The same checks over what other assistants here do. Off until you choose: it reads their activity.", false),
  offSw("Practice attacks", "Test your Trunks against made-up attacks in the practice workspace.", false),
  offSw("Stop an edit that removes a sign-in check", "In your code: a change that drops a check on a page or route asks first.", false),
  offSw("Check each commit a Trunk makes", "For keys, private files and changes too big to review.", false),
  offSw("Trunks push only to their own branch", "Work reaches others only as a pull request.", false),
  offSw("Shared documents change by request", "A Trunk’s change to shared data comes as a request you accept, field by field.", false),
  off("Seal a Trunk", "A fingerprint of its whole setup and a list of what it uses, to check later nothing changed.", { btn: "Seal" }),
  off("A computer per project", "A project of its own gets a computer where Trunks run freely; pushes and signing go through you.", { btn: "Set up" }),
] };

export const CONNECTORS: Section = { title: "What each connector may do", group: "Rules and checks", showHeading: false, lv: 1, rows: [
  { k: "el", t: "What each connector may do", words: "connector mcp read write", el: (x) => <Connectors x={x} /> },
] };

/** Every section after "Without asking, Trunks may…", in the preview's order. */
export const LOWER: Section[] = [LOCKS, RULES, COMMANDS, MORE_WITHOUT, CHECKS, ISOLATION, TOOLS_TECH, TEST, SECURITY_TECH, GUARDS_ON, TOOLS_LOOPS, PRIVACY, TERMINAL, FOLDERS, POLICY, MORE_APPROVALS, MORE_GUARDS, MONEY, NETWORK, CONNECTORS];
