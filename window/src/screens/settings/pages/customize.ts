// Settings › Customize: the rows of the R1 Customize page, in the approved preview's order and words (preview.html PG
// czP17, item 36: the kinds hub, then Saved prompts, Tools and skills, Skills, Plugins, Helpers and other agents, What it
// can do, and the connected-agents cards Allow, Connected agents, Connect an agent and Another Branch). Keys follow the
// Classic Advanced and Connected agents pages (places/settings/set2/advanced*.tsx, agents.tsx), whose rows are wired and
// tested. A row the engine has no key for is Coming, naming what it waits for. Rows whose control does more than one key
// are drawn by the page (customize-live.tsx), named here as "slot" rows.
import { COMING_REASON } from "../../../glass/coming-registry";
import type { Row, RowOption } from "../rows";

const HUB = "";
const TOOLS = "Tools and skills";
const SKILLS = "Skills";
const PLUGINS = "Plugins";
const HELPERS = "Helpers and other agents";
const WHAT = "What it can do";
const ALLOW = "Allow";
const CONNECT = "Connect an agent";
const ANOTHER = "Another Branch";

/** Said on a row the engine has no setting for yet: the Coming contract's own line (HANDOFF R1-10). */
export const NO_KEY = COMING_REASON;
const no = (what: string, reason = NO_KEY) => ({ kind: "coming" as const, need: `config: ${what}`, reason });
const opts = (...labels: string[]): RowOption[] => labels.map((l) => ({ v: l, label: l }));
const slot = (calls: string[], reason: string) => ({ kind: "slot" as const, calls, reason });

type Base = Pick<Row, "id" | "card" | "level" | "control" | "source"> & Partial<Row>;
const row = (r: Base): Row => ({ page: "customize", ...r });

export const CUSTOMIZE_ROWS: Row[] = [
  // The kinds hub is the page's own card (customize-live.tsx); at Technical three more skill rows follow it.
  row({ id: "customize.hub.pinned", card: HUB, label: "Pinned skills", help: "Load these in every conversation, before any others.", level: 2, control: "button", button: "Open", source: no("a list of skills loaded in every conversation") }),
  row({ id: "customize.hub.signed", card: HUB, label: "Signed packages only", help: "Refuse skills whose package isn’t signed.", level: 2, control: "button", button: "Open", source: no("a signed-packages-only switch") }),
  row({ id: "customize.hub.search", card: HUB, label: "Search back end", help: "Local index (default) · or your own search server.", level: 2, control: "button", button: "Open", source: no("a skill search back end") }),

  row({ id: "customize.tools.own-files", card: TOOLS, label: "Your own tools from files", help: "Loads tool files from the tools folder. Each one is checked before it’s offered.", level: 2, control: "toggle", source: no("a tools folder switch") }),
  row({ id: "customize.tools.find-command", card: TOOLS, label: "Find tools with a command", help: "A command that prints more tools for this project.", level: 2, control: "text", source: no("a tool discovery command") }),
  row({ id: "customize.tools.node", card: TOOLS, label: "Run connector programs on Branch’s own Node.js", help: "Off: the Node.js installed on this computer.", level: 2, control: "toggle", source: no("a bundled Node.js switch") }),
  row({ id: "customize.tools.python", card: TOOLS, label: "Python service", help: "Comes with Branch. Runs Python for tools that need it.", level: 2, control: "custom", source: { kind: "coming", need: "engine: a Python service status", reason: "The Python service’s state comes in a later update." } }),
  row({ id: "customize.tools.skill-ready", card: TOOLS, label: "Check a skill is ready first", help: "Programs, keys and systems it needs.", level: 1, control: "toggle", fallback: true, source: no("a skill readiness switch") }),
  row({ id: "customize.tools.signed", card: TOOLS, label: "Only signed skill packages", help: "Off until you choose: it would block most community skills; the malware check stays on.", level: 1, control: "toggle", source: no("a signed skill packages switch") }),
  row({ id: "customize.tools.malware", card: TOOLS, label: "Check install requests for malware", help: "Against the OSV database, before you approve.", level: 1, control: "toggle", source: no("a malware check switch") }),
  row({ id: "customize.tools.web", card: TOOLS, label: "Search the web", help: "Trunks can look up current information. Each person’s “Look things up” (Settings › People) still applies.", level: 1, control: "toggle", fallback: true, source: { kind: "config", path: "tools.web.search.enabled" } }),
  row({ id: "customize.tools.web-provider", card: TOOLS, label: "Web search", help: "Automatic uses the model’s own search where it has one, otherwise the first search service with a key. DuckDuckGo needs no key.", level: 1, control: "custom",
    source: slot(["webSearch.status", "config.patch"], "Choosing the web search service comes in a later update.") }),
  row({ id: "customize.tools.web-details", card: TOOLS, label: "Web search details", help: "Which search each model uses, setting up a search service, and checking it works.", level: 1, control: "custom",
    source: slot(["webSearch.status", "webSearch.test"], "Web search details come in a later update.") }),
  row({ id: "customize.tools.x", card: TOOLS, label: "Search X", help: "Turns on when an X account is connected.", level: 1, control: "toggle", fallback: false, source: { kind: "config", path: "plugins.entries.xai.config.xSearch.enabled" } }),
  row({ id: "customize.tools.video", card: TOOLS, label: "Video tools", help: "Download, read captions, and make short videos.", level: 1, control: "toggle", source: no("a video tools switch") }),
  row({ id: "customize.tools.plugin-views", card: TOOLS, label: "Let plugins add their own views", help: "Pages, widgets and views from plugins you installed. Off until you choose: their code runs with your sign-in, so turn it on only for plugins you trust.", level: 1, control: "toggle", fallback: false,
    source: { kind: "config", path: "gateway.controlUi.experimental.customPlugins" } }),
  row({ id: "customize.tools.app-views", card: TOOLS, label: "Connector app views", help: "Small apps a connector can show inside a step. Off until you choose: they run pages the connector supplies.", level: 1, control: "toggle", fallback: false, source: { kind: "config", path: "mcp.apps.enabled" } }),

  row({ id: "customize.skills.auto-start", card: SKILLS, label: "Start a skill by itself when it clearly fits", help: "Only when one skill clearly fits better than the next.", level: 1, control: "toggle", source: no("a skill auto-start switch") }),
  row({ id: "customize.skills.commands", card: SKILLS, label: "Run !`command` lines in skills", help: "A skill may fill itself in with a command’s output when it loads. Code blocks never run.", level: 2, control: "toggle", source: no("a skill command lines switch") }),
  row({ id: "customize.skills.save-to", card: SKILLS, label: "Where new skills are saved", help: "Skills Trunks write go here. A synced folder works.", level: 2, control: "text", source: no("a folder for new skills") }),
  row({ id: "customize.skills.pinned", card: SKILLS, label: "Always read in full", help: "A pinned skill’s whole instructions go with every message, not only when it seems to fit.", level: 1, control: "select", options: opts("None"), fallback: "None",
    source: no("pinned skills", "Pinning a skill comes in a later update.") }),
  row({ id: "customize.skills.extra-dirs", card: SKILLS, label: "Extra skill folders", help: "Searched last, after Branch’s own and the project’s.", level: 2, control: "custom", source: slot(["config.patch"], "Extra skill folders come in a later update.") }),
  row({ id: "customize.skills.bundled", card: SKILLS, label: "Built-in skills to offer", help: "All: every built-in skill is offered until you pick some.", level: 2, control: "custom", source: slot(["config.patch"], "Choosing built-in skills comes in a later update.") }),
  row({ id: "customize.skills.watch", card: SKILLS, label: "Pick up skill changes by themselves", level: 2, control: "toggle", fallback: true, source: { kind: "config", path: "skills.load.watch" } }),
  row({ id: "customize.skills.installer", card: SKILLS, label: "Install skills with", level: 2, control: "select", options: opts("npm", "pnpm", "yarn", "bun"), fallback: "npm", source: { kind: "config", path: "skills.install.nodeManager" } }),
  row({ id: "customize.skills.every", card: SKILLS, label: "Every skill setting", help: "Proposals from Budding keep their own place under Customize › Tools › Skills.", level: 2, control: "custom", source: slot(["config.get", "config.patch"], "Editing every skill setting comes in a later update.") }),

  row({ id: "customize.plugins.load", card: PLUGINS, label: "Load plugins", help: "Off loads no plugins at the next start.", level: 2, control: "toggle", fallback: true, source: { kind: "config", path: "plugins.enabled" } }),
  row({ id: "customize.plugins.allow", card: PLUGINS, label: "Only these plugins", help: "Empty means all.", level: 2, control: "custom", source: slot(["config.patch"], "Choosing plugins comes in a later update.") }),
  row({ id: "customize.plugins.deny", card: PLUGINS, label: "Never these plugins", level: 2, control: "custom", source: slot(["config.patch"], "Blocking plugins comes in a later update.") }),
  row({ id: "customize.plugins.paths", card: PLUGINS, label: "Extra plugin folders", level: 2, control: "custom", source: slot(["config.patch"], "Extra plugin folders come in a later update.") }),
  row({ id: "customize.plugins.memory", card: PLUGINS, label: "Memory engine", help: "The same row as in Memory.", level: 2, control: "custom", source: slot(["plugins.list", "config.patch"], "Choosing the memory engine comes in a later update.") }),
  row({ id: "customize.plugins.context", card: PLUGINS, label: "Context engine", level: 2, control: "custom", source: slot(["plugins.list", "config.patch"], "Choosing the context engine comes in a later update.") }),

  row({ id: "customize.helpers.model", card: HELPERS, label: "Helpers’ model", help: "A Trunk’s helpers can use a cheaper or stronger model, and their own account.", level: 1, control: "custom", source: slot(["models.list", "config.patch"], "Choosing the helpers’ model comes in a later update.") }),
  row({ id: "customize.helpers.connectors", card: HELPERS, label: "Helpers get the connectors", help: "Off: helpers get the Trunk’s tools minus connectors. They never get more than the Trunk.", level: 1, control: "toggle", source: no("a helpers' connectors switch") }),
  row({ id: "customize.helpers.start", card: HELPERS, label: "New helpers start with", help: "A copy of the conversation gives a helper everything said so far.", level: 1, control: "segmented", options: opts("The task only", "A copy of the conversation"), fallback: "The task only",
    source: no("what new helpers start with") }),
  row({ id: "customize.helpers.use", card: HELPERS, label: "Helpers use", help: "Their own: the model set in each specialist.", level: 1, control: "segmented", options: opts("The Trunk’s model", "Their own"), fallback: "The Trunk’s model",
    source: no("which model helpers use") }),
  row({ id: "customize.helpers.stronger", card: HELPERS, label: "Ask a stronger model on hard calls", help: "Off until you choose: it spends a call on a bigger model.", level: 1, control: "toggle", source: no("a stronger-model switch") }),
  row({ id: "customize.helpers.plan", card: HELPERS, label: "Plan first on long tasks", help: "Off until you choose: an extra planning call on long tasks.", level: 1, control: "toggle", source: no("a plan-first switch") }),
  row({ id: "customize.helpers.plan-yes", card: HELPERS, label: "Wait for my yes on the plan", help: "Off until you choose: it adds a wait for your go-ahead.", level: 1, control: "toggle", source: no("a plan approval switch") }),
  row({ id: "customize.helpers.check", card: HELPERS, label: "Check the answer before saying done", help: "A second look compares the answer with what was asked. Off until you choose: a reviewer call on every answer.", level: 1, control: "toggle", source: no("a reviewer switch") }),
  row({ id: "customize.helpers.a2a", card: HELPERS, label: "Trunks message each other", help: "A Trunk can ask another and wait for the answer. A chain stops after three hops.", level: 1, control: "toggle", fallback: true, source: { kind: "config", path: "tools.agentToAgent.enabled" } }),
  row({ id: "customize.helpers.protocol", card: HELPERS, label: "Take work over the agent protocol", help: "Other agents can send Branch tasks. Off until you choose: an outside program hands Branch work.", level: 1, control: "custom", source: slot(["plugins.list", "config.patch"], "Taking work over the agent protocol comes in a later update.") }),
  row({ id: "customize.helpers.outside", card: HELPERS, label: "Who may call your Trunks from outside", help: "Careful and Strict ask you about strangers; Open answers anyone who signs their request.", level: 1, control: "segmented", options: opts("Nobody", "Strict", "Careful", "Open"), fallback: "Nobody", source: no("who may call Trunks from outside") }),
  row({ id: "customize.helpers.lent-tools", card: HELPERS, label: "Tools lent by a connected program", help: "Off until you choose: an outside program lends tools.", level: 1, control: "toggle", source: no("a lent tools switch") }),
  row({ id: "customize.helpers.carry", card: HELPERS, label: "Carry a conversation on somewhere else", help: "Hands a conversation, with its history, to another assistant. Off until you choose: it sends to others.", level: 1, control: "toggle", source: no("a hand-over switch") }),
  row({ id: "customize.helpers.acp", card: HELPERS, label: "Look after several assistants at once", help: "Off until you choose: it sends work to other assistants.", level: 1, control: "toggle", fallback: false, source: { kind: "config", path: "acp.enabled" } }),
  row({ id: "customize.helpers.side-by-side", card: HELPERS, label: "Other computers running Branch, side by side", help: "Off until you choose: it hands work to other computers.", level: 1, control: "toggle", source: no("a side-by-side switch") }),
  row({ id: "customize.helpers.remote-trunks", card: HELPERS, label: "Trunks on other computers", help: "Off until you choose: it talks to Trunks on other computers.", level: 1, control: "toggle", source: no("a remote Trunks switch") }),
  row({ id: "customize.helpers.at-once", card: HELPERS, label: "Helpers at once", help: "In each conversation; each conversation’s helpers count on their own.", level: 2, control: "number", fallback: 8, source: { kind: "config", path: "agents.defaults.subagents.maxConcurrent" } }),
  row({ id: "customize.helpers.busy", card: HELPERS, label: "When every helper slot is busy", help: "Wait in line keeps the request until a slot frees up.", level: 2, control: "segmented", options: opts("Wait in line", "Say no"), fallback: "Wait in line", source: no("what happens when every helper slot is busy") }),
  row({ id: "customize.helpers.line", card: HELPERS, label: "Waiting line", help: "Requests that can wait for a slot.", level: 2, control: "number", source: no("a helper waiting line") }),
  row({ id: "customize.helpers.wait", card: HELPERS, label: "Wait at most", help: "Then the request is turned down.", level: 2, control: "number", unit: "seconds", source: no("a helper wait limit") }),

  row({ id: "customize.what.links", card: WHAT, label: "Read links you paste", help: "Opens the page and reads it, including PDFs and videos with captions.", level: 1, control: "toggle", source: { kind: "config", path: "tools.links" },
    // On when the links tool is set up and not turned off (Classic advanced.tsx); a change merges { enabled } into it.
    codec: { read: (v) => typeof v === "object" && v !== null && (v as { enabled?: unknown }).enabled !== false, write: (on) => ({ enabled: on === true }) } }),
  row({ id: "customize.what.research", card: WHAT, label: "Deep research reports", help: "Many searches, then a brief with numbered sources.", level: 1, control: "toggle", source: no("a deep research switch") }),
  row({ id: "customize.what.documents", card: WHAT, label: "Edit documents exactly", help: "Word, Excel and PowerPoint changes that leave everything else as it was.", level: 1, control: "toggle", source: no("an exact document edits switch") }),
  row({ id: "customize.what.tables", card: WHAT, label: "Tables and charts from spreadsheets", help: "Read-only questions over CSV and Excel files, answered with a chart.", level: 1, control: "toggle", source: no("a spreadsheet questions switch") }),
  row({ id: "customize.what.gitlab", card: WHAT, label: "GitLab", help: "Issues and merge requests, like the GitHub connection. Turns on when a GitLab account is connected.", level: 1, control: "toggle", source: no("a GitLab switch") }),
  row({ id: "customize.what.home", card: WHAT, label: "Smart home", help: "Lights, heating and sensors through Home Assistant. Turns on when Home Assistant is connected.", level: 1, control: "toggle", source: no("a smart home switch") }),
  row({ id: "customize.what.sources", card: WHAT, label: "Numbered sources you can check", help: "Each claim in a brief has a number that opens the passage it came from.", level: 1, control: "button", button: "See an example",
    source: { kind: "coming", need: "engine: research briefs", reason: "Numbered sources come in a later update." } }),

  row({ id: "customize.allow.connect", card: ALLOW, label: "Let agents connect", help: "Off disconnects every agent right away.", level: 0, control: "toggle", source: slot(["contacts.outside.list", "contacts.outside.set"], "Letting agents connect comes in a later update.") }),
  row({ id: "customize.allow.window", card: ALLOW, label: "Let agents use this window", help: "An agent with permission can click and read Branch’s own screens, for testing. Each agent still needs its own switch below.",
    level: 0, control: "toggle", fallback: false, source: { kind: "desktop", name: "agentControl" } }),

  row({ id: "customize.connect.branch-command", card: CONNECT, label: "Type branch in any terminal", help: "Needed for these lines: adds the branch command.", level: 0, control: "toggle", fallback: false, source: { kind: "desktop", name: "branchOnPath" } }),

  row({ id: "customize.another.pair", card: ANOTHER, label: "Pair with Branch on another computer", help: "Found on your network or Tailscale. Pair once; after that they meet as contacts.", level: 0, control: "custom",
    source: slot(["device.pair.setupCode", "graft.join"], "Pairing with another Branch comes in a later update.") }),
];
