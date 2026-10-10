// Settings › Advanced (DESIGN-SPEC §4.7.19; shown at Advanced and Technical): the service tiles (status, health,
// system.info, models.list, browser.request; gateway.restart.request; the log window on logs.tail), then the
// preview's sections. Most rows are one engine config path (see advanced-more.tsx); the windows they open are in
// advanced-tech.tsx. Rows the engine can't back are greyed with why.
// TODO(engine-lane): the greyed reasons in this file say what is still missing; shownWhy (shell/shown-why.ts) keeps them out of sight.
import { useState, type ReactNode } from "react";
import type { SettingsPageProps } from "../index";
import { Btn, Ctl, LinkBtn, Page, Pick, Sec, Seg, Switch, useConfig, useScope, type Opt, type RowEntry } from "../kit";
import { list } from "../adapter";
import { useBranchVersion, versionParts } from "../../../connect/branch-version";
import { CallLine, CodeRow, Kv, bytes, lvOf, openPlace, rec, str, useCall, useLive, when, type RecordValue } from "./common";
import {
  APP, COMMANDS, DOCKER_SEC, FILES, LOG_ROWS, NOSET, SEEING, SKILLS_MORE, SPEC, Section, WEB_MORE, rowsOf,
  type Ctx, type SecSpec, type Spec,
} from "./advanced-more";
import { ConvDialog, EverythingElse, HealthDialog, HooksSec, LogsDialog, MigrateDialog, SectionDialog, WebSearchDialog } from "./advanced-tech";
import "./advanced.css";

const LEDE = "What’s running under the hood, for when something needs a look.";
const { sw, no } = SPEC;
const DEFAULT_PORT = 18789;

/** A row whose button opens one of the page's windows. */
function DialogRow({ t, s, btn, open }: { t: string; s?: ReactNode; btn: string; open: (close: () => void) => ReactNode }) {
  const [on, setOn] = useState(false);
  return <Ctl title={t} sub={s}><Btn sm onClick={() => setOn(true)}>{btn}</Btn>{on ? open(() => setOn(false)) : null}</Ctl>;
}

/* ---------- Logs, Setup, Helpers ---------- */
function GatewayLogRow({ c }: { c: Ctx }) {
  const tail = useLive<RecordValue>(c.engine, "logs.tail", { limit: 1 }, []);
  const file = str(rec(tail.data).file) || str(c.config.get("logging.file"));
  return <DialogRow t="Gateway log" s={tail.error ?? (file ? <code>{file}</code> : undefined)} btn="Open" open={(close) => <LogsDialog engine={c.engine} onClose={close} />} />;
}
/** Kept by the desktop app, not the engine: greyed, with the app's folder buttons. */
function DiagLogRow() {
  const t = "Detailed diagnostics log";
  return (
    <Ctl title={t} sub="A rolling, more detailed log kept only on this computer." help="A rolling, more detailed log kept only on this computer. Off until you choose: it writes a lot to disk, so turn it on while you chase a problem." off={APP}
      after={<span className="acts s2advanced-acts"><Btn sm ghost disabled>Open folder</Btn><Btn sm ghost disabled>Clear</Btn></span>}>
      <Switch label={t} checked={false} onChange={() => undefined} />
    </Ctl>
  );
}
function LogFileRow({ c }: { c: Ctx }) {
  const [edit, setEdit] = useState(false);
  const tail = useLive<RecordValue>(c.engine, "logs.tail", { limit: 1 }, []);
  const file = str(c.config.get("logging.file"));
  const shown = file || str(rec(tail.data).file);
  return (
    <Ctl title="Log file" sub="One file per day.">
      {edit ? <input className="inp s2advanced-mono" autoFocus aria-label="Log file" defaultValue={file} onBlur={(e) => { setEdit(false); if (e.target.value.trim() !== file) void c.config.set("logging.file", e.target.value.trim() || null); }} onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") setEdit(false); }} />
        : <><code className="s2-code" title={shown}>{shown || "The engine’s own place"}</code><Btn sm ghost onClick={() => setEdit(true)}>Change</Btn></>}
    </Ctl>
  );
}
const LOGS: SecSpec = { title: "Logs", lv: 2, rows: [
  { t: "This app’s own log", s: "How much the desktop app writes about itself.", kind: "pick", off: APP, def: "Info", opts: ["Trace", "Debug", "Info", "Notice", "Warning", "Error", "Critical"].map((x) => ({ id: x, label: x })) },
  { t: "Detailed diagnostics log", draw: () => <DiagLogRow /> },
  { t: "Gateway log", draw: (c) => <GatewayLogRow c={c} /> },
  { t: "Clear the log", kind: "btn", btn: "Clear", off: "The engine can’t clear its log." },
  LOG_ROWS.level, LOG_ROWS.console,
  { t: "Log file", draw: (c) => <LogFileRow c={c} /> },
  LOG_ROWS.size, LOG_ROWS.hide,
] };

function SetupSec({ c }: { c: Ctx }) {
  const g = (k: string) => c.config.get(`wizard.${k}`);
  const at = Date.parse(str(g("lastRunAt")));
  const ack = Date.parse(str(g("securityAcknowledgedAt")));
  const mode = str(g("lastRunMode"));
  const access = str(g("accessMode"));
  return (
    <>
      <Ctl title="Suggest tools during setup" sub="Setup’s Tools step recommends connectors for the Trunks you pick.">
        <Switch label="Suggest tools during setup" checked={g("appRecommendations") !== false} disabled={c.config.loading} onChange={(on) => void c.config.set("wizard.appRecommendations", on)} />
      </Ctl>
      {c.lv >= 2 ? <Kv rows={[["Last run", Number.isFinite(at) ? when(at) : "Not finished yet"], ["Started from", str(g("lastRunCommand"))], ["Where Branch runs", mode === "remote" ? "another computer" : mode === "local" ? "this computer" : ""],
        ["Access", access === "full" ? "Full access" : access === "guarded" ? "Ask first" : ""], ["Safety promise ticked", Number.isFinite(ack) ? when(ack) : "Not yet"]]} /> : null}
    </>
  );
}

function modelOpts(data: unknown): Opt[] {
  return list(rec(data).models).filter((m) => m.available !== false).map((m) => ({ id: `${str(m.provider)}/${str(m.id)}`, label: str(m.name) || str(m.id) }));
}
function HelpersModel({ c }: { c: Ctx }) {
  const models = useLive<RecordValue>(c.engine, "models.list", {}, []);
  const raw = c.config.get("agents.defaults.subagents.model");
  const value = typeof raw === "string" ? raw : str(rec(raw).primary);
  return (
    <Ctl title="Trunks’ model" sub="Trunks may use their own account and a different model." help="A Trunk’s sub-Trunks can use a cheaper or stronger model, and their own account.">
      <Pick label="Trunks’ model" value={value} disabled={c.config.loading} onChange={(v) => void c.config.set("agents.defaults.subagents.model", v || null)} options={[{ id: "", label: "Same as the Trunk" }, ...modelOpts(models.data)]} />
    </Ctl>
  );
}

/* ---------- Memory ---------- */
const PROVIDERS: Opt[] = [["openai", "OpenAI"], ["gemini", "Gemini"], ["voyage", "Voyage"], ["mistral", "Mistral"], ["bedrock", "Amazon Bedrock"], ["deepinfra", "DeepInfra"], ["github-copilot", "GitHub Copilot"], ["lmstudio", "LM Studio"], ["ollama", "Ollama"], ["local", "On this computer"], ["openai-compatible", "An OpenAI-compatible address"]].map(([id, label]) => ({ id, label }));
const LOCAL = new Set(["lmstudio", "ollama", "local"]);

function MeaningSearch({ c }: { c: Ctx }) {
  const params = c.agent ? { agentId: c.agent } : {};
  const st = useLive<RecordValue>(c.engine, "doctor.memory.status", params, ["memory", "agents.changed", "config.changed"]);
  const test = useCall();
  const [probe, setProbe] = useState<RecordValue | null>(null);
  const emb = rec((probe ?? rec(st.data)).embedding);
  const provider = str(rec(probe ?? st.data).provider) || str(c.config.get("memory.search.provider")) || "openai";
  const name = PROVIDERS.find((p) => p.id === provider)?.label ?? provider;
  const checked = emb.checked !== false && (emb.ok === true || Boolean(emb.error));
  const word = !checked ? "Not checked yet" : emb.ok === true ? "Working" : "Not working";
  const line = !checked ? "Branch hasn’t checked meaning search yet." : emb.ok === true ? "Meaning search answered." : str(emb.error);
  return (
    <Ctl title="Meaning search" sub={`${st.error ?? line} ${name} · ${LOCAL.has(provider) ? "on this computer" : "in the cloud"}`} after={<CallLine call={test} />}>
      <span className="s2advanced-v">{word}</span>
      <Btn sm disabled={test.busy} onClick={() => void test.run(async () => setProbe(rec(await c.engine.request("doctor.memory.status", { ...params, probe: true }))))}>Test</Btn>
    </Ctl>
  );
}

function slotOpts(c: Ctx, kind: string, base: Opt[]): Opt[] {
  const found = c.plugins.filter((p) => Array.isArray(p.kind) && p.kind.map(String).includes(kind) && !base.some((b) => b.id === p.id));
  return [...base, ...found.map((p) => ({ id: str(p.id), label: str(p.name) || str(p.id) }))];
}
function MemoryEngine({ c, same }: { c: Ctx; same?: boolean }) {
  const value = str(c.config.get("plugins.slots.memory")) || "memory-core";
  const sub = same ? "The same row as in Memory." : value === "none" ? "Memory is off. Trunks remember nothing new between conversations." : "One engine stores and searches memory. Choosing one turns the others off.";
  return (
    <Ctl title="Memory engine" sub={sub} id={same ? "Memory engine (plugins)" : undefined}>
      <Pick label="Memory engine" value={value} disabled={c.config.loading} onChange={(v) => void c.config.set("plugins.slots.memory", v === "memory-core" ? null : v)} options={slotOpts(c, "memory", [{ id: "memory-core", label: "Branch memory" }, { id: "none", label: "Off" }])} />
    </Ctl>
  );
}
function ContextEngine({ c }: { c: Ctx }) {
  const value = str(c.config.get("plugins.slots.contextEngine")) || "legacy";
  return (
    <Ctl title="Context engine">
      <Pick label="Context engine" value={value} disabled={c.config.loading} onChange={(v) => void c.config.set("plugins.slots.contextEngine", v === "legacy" ? null : v)} options={slotOpts(c, "context-engine", [{ id: "legacy", label: "Branch’s own" }])} />
    </Ctl>
  );
}

const MEMORY: SecSpec = { title: "Memory", lv: 1, rows: [
  { t: "How much memory loads at the start", s: "The whole memory file is kept. Only the copy loaded at the start is trimmed, and Branch says when it is.", k: "agents.defaults.bootstrapMaxChars", kind: "num", unit: "characters", def: 20000, min: 1 },
  { t: "All start files together", s: "All the files a Trunk reads first load up to this much together.", k: "agents.defaults.bootstrapTotalMaxChars", kind: "num", unit: "characters", def: 60000, min: 1 },
  sw("Match by meaning", "Finds “invoice” when the fact says “bill”.", "memory.search.store.vector.enabled", true),
  { t: "Meaning search", draw: (c) => <MeaningSearch c={c} /> },
  { t: "Meaning search uses", s: "The service that turns facts into something searchable by meaning. Changing it rebuilds the index.", k: "memory.search.provider", kind: "pick", def: "openai", opts: PROVIDERS },
  no("Share memory between Trunks", "Off: each Trunk keeps its own. Off until you choose: it changes where your data goes."),
  no("Ask before remembering", "Off: a Trunk writes what is worth keeping as it works, and the conversation shows “Remembered”. On: it asks “Remember this?” first."),
  { t: "Memory engine", lv: 2, draw: (c) => <MemoryEngine c={c} /> },
  { t: "Outside memory", s: "Off until you choose: it changes where your data goes.", kind: "seg", off: "This engine has none of these memory services.", opts: ["None", "Mem0", "Honcho", "Hindsight"].map((x) => ({ id: x, label: x })) },
  no("Keep a history in Git", "Every change to memory as a commit, on this computer."),
  { t: "Recall before replying", s: "Searches memory more deeply when quick recall finds nothing strong.", help: "Before a reply about the past, a Trunk searches memory more deeply. Off until you choose: it can add a model call before a reply.", plug: "active-memory" },
  { t: "Memory wiki", s: "Keeps what Trunks know as linked Markdown pages.", help: "Each fact has its source. Off until you choose: it adds a second, page-shaped copy of what Trunks know.", plug: "memory-wiki" },
], after: () => <p className="hint s2advanced-addons">Add-ons work beside the memory engine, so any mix can run. <LinkBtn onClick={() => openPlace("customize", "plugins")}>Open Plugins</LinkBtn></p> };

/* ---------- Automations ---------- */
const FA = "cron.failureAlert";
function AlertsTo({ c }: { c: Ctx }) {
  const mode = str(c.config.get(`${FA}.mode`)) || "announce";
  const channel = str(c.config.get(`${FA}.channel`));
  const chats = Object.keys(rec(c.config.get("channels"))).filter((k) => !["defaults", "modelByChannel"].includes(k));
  const value = mode === "webhook" ? "webhook" : channel;
  const pick = (v: string) => void c.config.set(FA, v === "webhook" ? { mode: "webhook", channel: null } : v ? { mode: "announce", channel: v } : { channel: null });
  const opts: Opt[] = [{ id: "", label: "Where each automation sends" }, ...chats.map((id) => ({ id, label: id.charAt(0).toUpperCase() + id.slice(1) })), { id: "webhook", label: "A web address" }];
  return <Ctl title="Send alerts to"><Pick label="Send alerts to" value={value} disabled={c.config.loading} onChange={pick} options={opts} /></Ctl>;
}
function AlertHow({ c }: { c: Ctx }) {
  const mode = str(c.config.get(`${FA}.mode`)) || "announce";
  return (
    <Ctl title="How" sub={mode === "webhook" ? "Posts the alert to the web address." : "Sends the alert as a message."}>
      <Seg label="How" value={mode} disabled={c.config.loading} onChange={(v) => void c.config.set(`${FA}.mode`, v)} options={[{ id: "announce", label: "As a message" }, { id: "webhook", label: "To a web address" }]} />
    </Ctl>
  );
}
const MIN = 60_000;
const AUTOMATIONS: SecSpec = { title: "Automations", showHeading: false, lv: 1, rows: [
  no("Report only what changed", "Checks compare with last time and stay quiet otherwise."),
  no("Checks and retries in procedures", "A step can check its own result, retry, and clean up."),
  no("Procedures that start themselves", "On a clock or after a task. Only procedures you set a time for."),
  no("Start when a USB device is plugged in", "Only for triggers you make."),
  no("Reach webhooks from outside", "Off until you choose: it opens a door from the internet.", "seg", { opts: ["Off", "cloudflared", "ngrok", "Tailscale"].map((x) => ({ id: x, label: x })) }),
  no("Use what the trigger sent", "{{payload}} and {{field.path}} in the prompt."),
  sw("Checks before a run and event triggers", "Lets a trigger look first and start a Trunk only when there is news. Off stops every “Check first”, script and stream trigger without deleting them.", "cron.triggers.enabled", true),
  sw("Tell me when an automation keeps failing", "Alerts after 2 failures in a row, at most once an hour.", `${FA}.enabled`, true, { help: "The alert goes where the automation reports. It only tells you where that automation already sends; each automation can choose its own destination (When it fails…)." }),
  { t: "After failures in a row", k: `${FA}.after`, kind: "num", unit: "failures", def: 2, min: 1 },
  { t: "At most every", k: `${FA}.cooldownMs`, kind: "pick", read: (v) => String(typeof v === "number" ? v : 60 * MIN), write: (v) => Number(v), opts: [[15, "15 minutes"], [60, "1 hour"], [360, "6 hours"], [1440, "1 day"]].map(([m, label]) => ({ id: String(Number(m) * MIN), label: String(label) })) },
  sw("Count skipped runs", "", `${FA}.includeSkipped`, false),
  { t: "Send alerts to", draw: (c) => <AlertsTo c={c} /> },
  { t: "Recipient", lv: 2, k: `${FA}.to`, kind: "text" },
  { t: "Chat-app account", lv: 2, k: `${FA}.accountId`, kind: "text" },
  { t: "How", draw: (c) => <AlertHow c={c} /> },
  { t: "Catch up on runs missed while Branch was off", s: "Off: a missed run is skipped and the next one waits for its time. One-off runs always catch up.", k: "cron.skipMissedJobs", kind: "sw", read: (v) => v !== true, write: (on) => !on },
  { t: "Keep each run’s own conversation for", k: "cron.sessionRetention", kind: "seg", read: (v) => (v === false ? "forever" : str(v) || "24h"), write: (v) => (v === "forever" ? false : v), opts: [["1h", "1 hour"], ["24h", "24 hours"], ["7d", "7 days"], ["forever", "Forever"]].map(([id, label]) => ({ id, label })) },
  { t: "Run history", kind: "none", off: "The engine doesn’t say how long it keeps run history." },
  { t: "Private addresses allowed for web addresses", lv: 2, k: "cron.webhookSsrfPolicy.allowedHostnames", kind: "list", ph: "192.168.1.20" },
  { t: "Chat commands", s: "Which slash commands are on and who may use them.", lv: 2, draw: (c) => <EditRow c={c} t="Chat commands" path="commands" s="Which slash commands are on and who may use them." /> },
  { t: "Hooks", s: "Programs that run when something happens.", lv: 2, draw: (c) => <EditRow c={c} t="Hooks" path="hooks" s="Programs that run when something happens." /> },
  { t: "Which Trunk answers", lv: 2, draw: (c) => <EditRow c={c} t="Which Trunk answers" path="bindings" s="Rules that send a chat to a Trunk." /> },
  { t: "Schedules", lv: 2, draw: (c) => <EditRow c={c} t="Schedules" path="cron" s="Every scheduler setting." /> },
] };
/** An Edit button that opens a whole settings section as JSON. */
function EditRow({ c, t, path, s }: { c: Ctx; t: string; path: string; s?: string }) {
  return <DialogRow t={t} s={s} btn="Edit" open={(close) => <SectionDialog c={c} path={path} title={t} onClose={close} />} />;
}

/* ---------- Tools and skills, Try early ---------- */
function WebSearchPick({ c }: { c: Ctx }) {
  const st = useLive<RecordValue>(c.engine, "webSearch.status", c.agent ? { agentId: c.agent } : {}, []);
  const on = c.config.get("tools.web.search.enabled") !== false;
  const value = str(c.config.get("tools.web.search.provider"));
  const opts: Opt[] = [{ id: "", label: "Automatic" }, ...list(rec(st.data).providers).map((p) => ({ id: str(p.id), label: str(p.label) || str(p.id) }))];
  return (
    <Ctl title="Web search" sub={on ? "Automatic uses the model’s own search where it has one, otherwise the first search service with a key. DuckDuckGo needs no key." : "Search is off."}>
      <Pick label="Web search" value={value} disabled={!on || c.config.loading} onChange={(v) => void c.config.set("tools.web.search.provider", v || null)} options={opts} />
    </Ctl>
  );
}
const DECISION_HELP = "Before each turn, the decision model (Settings › Models › Decision models) judges whether the message needs tools; for plain conversation the optional tools are left out of that turn. Not the same as “A second look before approvals” in Permissions. Off until you choose: it’s an early feature and can leave out a tool a turn needed.";
const CODE_HELP = "On means Auto: models Branch has tested can make several tool calls as one short script instead of one round each; other models are unchanged. Off turns the default off. A per-model choice lives in Settings › Models at Technical. Applies to the next task.";
function CodeMode({ c }: { c: Ctx }) {
  const raw = c.config.get("tools.codeMode");
  const on = raw === undefined ? true : typeof raw === "object" && raw !== null ? (rec(raw).enabled ?? false) !== false : raw !== false;
  const set = (x: boolean) => void c.config.set(typeof raw === "object" && raw !== null ? "tools.codeMode.enabled" : "tools.codeMode", x ? "auto" : false);
  return (
    <Ctl title="Code mode" sub="Several tool calls in one short script, for models that handle it well." help={CODE_HELP}>
      <Switch label="Code mode" checked={on} disabled={c.config.loading} onChange={set} />
    </Ctl>
  );
}
const TRY: SecSpec = { title: "Try early", lv: 1, hint: "Early features. They may change or go away in a later version.", rows: [
  sw("Skip tools on plain chat", "The decision model skips tools for plain chat.", "agents.defaults.experimental.decisionAssistance", false, { help: DECISION_HELP }),
  { t: "Code mode", draw: (c) => <CodeMode c={c} /> },
] };

const TOOLS_SKILLS: SecSpec = { title: "Tools and skills", lv: 1, rows: [
  { t: "Check a skill is ready first", s: "Programs, keys and systems it needs.", kind: "sw", def: true, off: "The engine always checks; there is no switch for it." },
  no("Only signed skill packages", "Off until you choose: it would block most community skills; the malware check stays on."),
  no("Check install requests for malware", "Against the OSV database, before you approve."),
  sw("Search the web", "Trunks can look up current information. Each person’s “Look things up” (Settings › People) still applies.", "tools.web.search.enabled", true),
  { t: "Web search", draw: (c) => <WebSearchPick c={c} /> },
  { t: "Web search details", draw: (c) => <DialogRow t="Web search details" s="Which search each model uses, setting up a search service, and checking it works." btn="Open" open={(close) => <WebSearchDialog engine={c.engine} agent={c.agent} onClose={close} />} /> },
  sw("Search X", "Turns on when an X account is connected.", ["plugins", "entries", "xai", "config", "xSearch", "enabled"], false),
  no("Video tools", "Download, read captions, and make short videos."),
  sw("Let plugins add their own views", "Pages, widgets and views from plugins you installed. Off until you choose: their code runs with your sign-in, so turn it on only for plugins you trust.", "gateway.controlUi.experimental.customPlugins", false),
  sw("Connector app views", "Small apps a connector can show inside a step. Off until you choose: they run pages the connector supplies.", "mcp.apps.enabled", false),
] };

/* ---------- the remaining plain sections ---------- */
const btnOff = (t: string, s: string, btn: string, off = NOSET): Spec => ({ t, s, kind: "btn", btn, off });
const HELPERS: SecSpec = { title: "Trunks", lv: 1, rows: [{ t: "Trunks’ model", draw: (c) => <HelpersModel c={c} /> }, no("Trunks get the connectors", "Off: Trunks get the Trunk’s tools minus connectors. They never get more than the Trunk.")] };
const TOOLS_TECH: SecSpec = { title: "Tools, technical", group: "Tools", lv: 2, rows: [
  no("Your own tools from files", "Loads tool files from the tools folder. Each one is checked before it’s offered."),
  no("Find tools with a command", "A command that prints more tools for this project.", "text"),
  no("Run connector programs on Branch’s own Node.js", "Off: the Node.js installed on this computer."),
  { t: "Python service", s: "Comes with Branch. Runs Python for tools that need it.", kind: "none", off: "The engine doesn’t report a Python service." },
] };
const HOOKS: SecSpec = { title: "Hooks", lv: 2, rows: ["Before a tool runs", "After a tool runs", "When a conversation starts", "When you send a message", "When a Trunk stops", "Before tidying up", "When it needs you", "When a task finishes", "When a session ends", "When settings change", "When a file changes"].map((t) => ({ t })), whole: (c) => <HooksSec c={c} /> };
const AUTO_MORE: SecSpec = { title: "Automations, more", group: "Automations", lv: 1, rows: [no("Run on GitHub Actions while this computer is off", "Schedules and their skills run on free GitHub runners; results and memory come back as commits. Off until you choose: your skills run on GitHub’s computers.")] };
const SHARING_MORE: SecSpec = { title: "Sharing, more", group: "Sharing", lv: 1, rows: [btnOff("Pages Trunks publish", "Pages and their comments.", "See them", "Needs the engine’s list of published pages.")] };
const TRUNKS_MORE: SecSpec = { title: "Trunks, more", group: "Trunks", lv: 1, rows: [
  no("Projects pick up matching work", "A message about a project goes to that project by itself."),
  no("Follow-up tasks", "A Trunk can leave itself a task for later, shown in the Board."),
  btnOff("Standing orders", "Named programmes a Trunk keeps running; ESCALATE pauses one and asks you.", "See them"),
  btnOff("“From now on” for a specialist", "A standing instruction kept by one specialist.", "Add one"),
  btnOff("Share a Trunk", "Through Git, as a skill bundle, or exported with memory details removed.", "Export…"),
  { t: "Custom modes", s: "Your own modes; one can hand the work back when it’s done.", kind: "none", off: "The engine has no custom modes." },
  btnOff("Agent marketplace", "Trunks others made, each with a fingerprint you can check.", "Browse"),
  no("Trunk packages", "Add, update and share Trunks as packages. Off as it ships: still experimental."),
] };
const LIBRARY_MORE: SecSpec = { title: "Library, more", group: "Library", lv: 1, rows: [
  no("Search documents by meaning", "Finds the lease clause about repairs when you ask “who fixes the boiler”."),
  no("A local index of mail, calendar and messages", "Built and kept on this computer, for faster answers."),
  no("Keep versions of what Trunks make", "Every file in Library › Activity keeps its versions and a checksum."),
  { t: "Rewrite short notes", draw: () => <Ctl title="Rewrite short notes" sub="Clearer, shorter, fixed or more formal."><Btn sm onClick={() => openPlace("library")}>Try it</Btn></Ctl> },
] };
const PINNED: SecSpec = { title: "Pinned skills", lv: 1, rows: [{ t: "Always read in full", s: "A pinned skill’s whole instructions go with every message, not only when it seems to fit.", kind: "seg", off: "The engine can’t pin a skill.", opts: [{ id: "none", label: "None" }] }] };
const WHAT: SecSpec = { title: "What it can do", lv: 1, hint: "Model tools. Each one is used only when a task needs it.", rows: [
  { t: "Read links you paste", s: "Opens the page and reads it, including PDFs and videos with captions.", k: "tools.links", w: "tools.links.enabled", kind: "sw", read: (v) => typeof v === "object" && v !== null && rec(v).enabled !== false },
  no("Deep research reports", "Many searches, then a brief with numbered sources."),
  no("Edit documents exactly", "Word, Excel and PowerPoint changes that leave everything else as it was."),
  no("Tables and charts from spreadsheets", "Read-only questions over CSV and Excel files, answered with a chart."),
  no("GitLab", "Issues and merge requests, like the GitHub connection. Turns on when a GitLab account is connected."),
  no("Smart home", "Lights, heating and sensors through Home Assistant. Turns on when Home Assistant is connected."),
  btnOff("Numbered sources you can check", "Each claim in a brief has a number that opens the passage it came from.", "See an example", "Needs the engine’s research briefs."),
] };
const CONVERSATIONS: SecSpec = { title: "Conversations", lv: 1, rows: [{ t: "All conversations", draw: (c) => <DialogRow t="All conversations" s="Every conversation, with its context used and status." btn="Open the table" open={(close) => <ConvDialog engine={c.engine} lv={c.lv} onClose={close} />} /> }] };
const MEMORY_MORE: SecSpec = { title: "Memory, more", group: "Memory", showHeading: false, lv: 1, rows: [
  { t: "Tidy by meaning each night", draw: (c) => <Ctl title="Tidy by meaning each night" sub="At 3 AM it merges facts that say the same thing in different words." help="At 3 AM it merges facts that say the same thing in different words. Every merge is listed."><Btn sm disabled={!c.openSettings} onClick={() => c.openSettings?.("seasons")}>Last night</Btn></Ctl> },
  btnOff("Project notes as files", "Each project keeps its memory as Markdown in its own folder, so you can read and edit it.", "Open"),
  btnOff("Follow-ups made whole", "A short follow-up like “and July?” becomes a full question before it searches.", "Show one"),
  btnOff("Scratch space for pasted text", "Long text you paste is used for that job, then let go. It never becomes memory.", "Show it"),
  btnOff("Knowledge cards", "A short card made from a conversation: the question, the answer and where it came from.", "See them"),
  btnOff("Notes it keeps for itself", "Short working notes a Trunk writes and rewrites, such as how a site behaves.", "Read them"),
] };
const MEMORY_TECH: SecSpec = { title: "Memory, technical", group: "Memory", showHeading: false, lv: 2, hint: "For every Trunk that has no memory setting of its own. Each Trunk’s own memory settings win.", rows: [
  sw("Search memory", "Turn off for replies that use no memory at all.", "memory.search.enabled", true),
  { t: "Also search past conversations", s: "Off until you choose: it reads every past conversation into the index.", k: "memory.search.sources", kind: "sw", read: (v) => (Array.isArray(v) ? v : ["memory"]).includes("sessions"), write: (on, saved) => { const base = (Array.isArray(saved) ? saved : ["memory"]).filter((x) => x !== "sessions"); return on ? [...base, "sessions"] : base; } },
  sw("Keep search results ready", "Faster re-indexing; uses a little disk.", "memory.search.cache.enabled", true),
  sw("Index in batches", "Faster for big indexes where the service allows it. Off, as the services’ batch requests are opt-in.", "memory.search.remote.batch.enabled", false),
  sw("Pictures and audio in extra folders", "Off until you choose: the files are uploaded to the meaning-search service.", "memory.search.multimodal.enabled", false),
  { t: "Extra folders to search", k: "memory.search.extraPaths", kind: "list", add: "Add a folder", ph: "D:\\Notes" },
  { t: "Show where a memory came from", s: "Auto shows it when it helps.", k: "memory.citations", kind: "seg", def: "auto", opts: [{ id: "auto", label: "Auto" }, { id: "on", label: "Always" }, { id: "off", label: "Never" }] },
  { t: "Every memory setting", draw: (c) => <EditRow c={c} t="Every memory setting" path="memory" /> },
] };
const SKILLS_TECH: SecSpec = { title: "Skills, technical", group: "Skills", showHeading: false, lv: 2, rows: [
  { t: "Extra skill folders", s: "Searched last, after Branch’s own and the project’s.", k: "skills.load.extraDirs", kind: "list", add: "Add a folder", ph: "D:\\Skills" },
  { t: "Built-in skills to offer", s: "All: every built-in skill is offered until you pick some.", k: "skills.allowBundled", kind: "list", ph: "a skill name" },
  sw("Pick up skill changes by themselves", "", "skills.load.watch", true),
  { t: "Install skills with", k: "skills.install.nodeManager", kind: "pick", def: "npm", opts: ["npm", "pnpm", "yarn", "bun"].map((x) => ({ id: x, label: x })) },
  { t: "Every skill setting", draw: (c) => <EditRow c={c} t="Every skill setting" path="skills" s="Proposals from Budding keep their own place under Customize › Tools › Skills." /> },
] };
const PLUGINS_TECH: SecSpec = { title: "Plugins, technical", group: "Plugins", lv: 2, hint: "Changes apply at the next gateway start.", rows: [
  sw("Load plugins", "Off loads no plugins at the next start.", "plugins.enabled", true),
  { t: "Only these plugins", s: "Empty means all.", k: "plugins.allow", kind: "list", ph: "plugin id" },
  { t: "Never these plugins", k: "plugins.deny", kind: "list", ph: "plugin id" },
  { t: "Extra plugin folders", k: "plugins.load.paths", kind: "list", ph: "D:\\Plugins" },
  { t: "Memory engine", draw: (c) => <MemoryEngine c={c} same /> },
  { t: "Context engine", draw: (c) => <ContextEngine c={c} /> },
] };
function UseProxy({ c }: { c: Ctx }) {
  const url = str(c.config.get("proxy.proxyUrl"));
  return (
    <Ctl title="Use the proxy" sub={url ? "Off ignores the address without deleting it." : "Turns on once an address is set."}>
      <Switch label="Use the proxy" checked={Boolean(url) && c.config.get("proxy.enabled") !== false} disabled={!url || c.config.loading} onChange={(on) => void c.config.set("proxy.enabled", on)} />
    </Ctl>
  );
}
const NETWORK: SecSpec = { title: "Network", lv: 2, rows: [
  { t: "Proxy address", s: "Send Branch’s outside traffic through your company proxy. Only used once you add an address.", k: "proxy.proxyUrl", kind: "text", mono: true, ph: "http:// or https://, empty for none" },
  { t: "Use the proxy", draw: (c) => <UseProxy c={c} /> },
  { t: "Proxy certificate", s: "For a private certificate authority: the path of its .pem file.", k: "proxy.tls.caFile", kind: "text", ph: "C:\\certs\\company-ca.pem" },
  { t: "Traffic to this computer", k: "proxy.loopbackMode", kind: "seg", def: "gateway-only", opts: [{ id: "gateway-only", label: "Skip the proxy" }, { id: "proxy", label: "Through the proxy" }, { id: "block", label: "Block" }] },
  { t: "Check it", draw: () => <CodeRow title="Check it" code="branch proxy validate" /> },
] };
const ELSE: SecSpec = { title: "Everything else", lv: 2, rows: ["Text to speech", "Attachments", "Messages", "Talk", "Web", "Media", "Find any setting"].map((t) => ({ t })), whole: (c) => <EverythingElse c={c} /> };
const HEALTH: SecSpec = { title: "Health", lv: 2, rows: [
  { t: "Health", draw: (c) => <DialogRow t="Health" s="Readouts only; nothing to set." btn="See readouts" open={(close) => <HealthDialog engine={c.engine} onClose={close} />} /> },
  btnOff("Errors that say how to fix them", "When a service refuses, the message says what to do, not only the code.", "Show one", "Built into the engine’s error messages; nothing to set."),
] };
const ALWAYS = "Always on in this engine; there is no switch for it.";
function LearnRow({ c }: { c: Ctx }) {
  const [open, setOpen] = useState(false);
  return (
    <Ctl title="Learn from other coding agents’ history on this computer" sub="Past coding conversations appear when they matter." help="Past sessions other coding tools left on disk come up when they matter. Off until you choose: it reads their files." off="The engine copies their memory in once instead of reading it as you go."
      after={<span className="s2advanced-after"><Btn sm disabled={!c.agent} onClick={() => setOpen(true)}>Bring their memory in…</Btn>{open ? <MigrateDialog engine={c.engine} agent={c.agent} onClose={() => setOpen(false)} /> : null}</span>}>
      <Switch label="Learn from other coding agents’ history on this computer" checked={false} onChange={() => undefined} />
    </Ctl>
  );
}
const RECALL: SecSpec = { title: "Recall and memory files", lv: 1, rows: [
  no("Bring up what it remembers, mid-task", "When something it knows matters to the step it’s on, it says so. Off until you choose: it can add a model call while it works."),
  no("Trunks and side conversations may", "What a Trunk or a /btw side question can do with memory.", "seg", { def: "rw", opts: [{ id: "read", label: "Read memory only" }, { id: "rw", label: "Read and write" }] }),
  sw("Save notes before tidying a conversation", "Before older messages fold away, the Trunk writes down what is worth keeping.", "agents.defaults.compaction.memoryFlush.enabled", true),
  btnOff("Notes about this computer", "Short files kept up to date in the background: this computer, its disks, the devices on your network and what you use most. Off until you choose.", "Read them"),
  no("Keep notes about this computer", "Off until you choose: it looks at your network, disks and recent activity."),
  { t: "Learn from other coding agents’ history on this computer", draw: (c) => <LearnRow c={c} /> },
  btnOff("Rings’ own instructions for this workspace", "Rings works the usual way. Make one to tell it what matters here.", "Make one"),
  { t: "Prefer recent notes", s: "Newer notes win ties; a note’s weight halves every 30 days.", lv: 2, kind: "sw", def: true, off: ALWAYS },
  { t: "Vary the results", s: "Leaves out near-repeats so a search brings back different things.", lv: 2, kind: "sw", def: true, off: ALWAYS },
  no("Pick up edits to memory files", "Your own edits to the Markdown files are read back in; a file it can’t read is set aside, never deleted.", "sw", { lv: 2 }),
  no("Score memories by whether they helped", "After each answer, the memories it used are marked helped or not, and rank that way. Off until you choose: it adds a model call.", "sw", { lv: 2 }),
  no("Also copy the history to", "A second Git address, such as a private repository. Empty: only on this computer. Needs Keep a history in Git.", "text", { lv: 2, ph: "git@github.com:you/memory.git" }),
] };
const seg2 = (...labels: string[]): Opt[] => labels.map((l) => ({ id: l, label: l }));
const DOCS: SecSpec = { title: "Documents it reads", lv: 1, rows: [
  no("Search documents by", "Meaning finds “bill” for “invoice”; words find exact names and numbers. Both is the usual.", "seg", { opts: seg2("Meaning and words", "Meaning", "Words") }),
  no("Re-order the best passages", "A second pass that puts the most useful passages first. A model service is used only if you have one set up for this.", "seg", { opts: seg2("Off", "On this computer", "A model service") }),
  no("How documents reach a Trunk", "Added: the best passages go with the message. Searches itself: the Trunk looks things up when it needs to.", "seg", { opts: seg2("Best passages are added", "It searches them itself") }),
  no("A file you attach", "Whole when it fits; otherwise only the parts that match.", "seg", { opts: seg2("Whole when it fits", "Searched") }),
  no("Read text in scans and pictures", "Off until you choose: scans may be sent to the reading service you pick."),
  no("Keep links from messages", "Links people send are saved with a title and a short summary, to find later. Off until you choose: it opens every link it sees."),
  no("Read long documents by their contents page", "For long PDFs: it reads the headings, then opens the right pages, and says which page each answer came from."),
  no("Index code folders", "Only changed files are read again. Ask with @codebase or @folder, or find a function by name."),
  no("Read files with", "Turns PDF, Word, Office and web pages into plain text.", "seg", { lv: 2, opts: seg2("Built in", "A document service") }),
  no("Split documents at", "Where long documents are cut into passages; headings stay with each passage.", "seg", { lv: 2, opts: seg2("Headings", "Sentences", "Meaning") }),
  no("Describe each passage before indexing", "A sentence on where each passage sits in its document. Off until you choose: one model call per passage.", "sw", { lv: 2 }),
  no("Follow links between passages", "Finds passages that connect to the best ones.", "sw", { lv: 2 }),
  no("Where the index lives", "This computer needs no server. A database server is for big or shared indexes.", "seg", { lv: 2, opts: seg2("This computer", "A database server") }),
  no("Database server address", "Vector or storage databases such as Postgres, Qdrant or Redis.", "text", { lv: 2, ph: "postgres://… or https://…" }),
] };
const HELPERS_AGENTS: SecSpec = { title: "Trunks and other agents", lv: 1, rows: [
  no("New Trunks start with", "A copy of the conversation gives a Trunk everything said so far.", "seg", { off: "Only Trunks tied to a chat thread have this choice in this engine.", opts: seg2("The task only", "A copy of the conversation") }),
  no("Trunks use", "Their own: the model set in each specialist.", "seg", { off: "Set in Trunks › Trunks’ model.", opts: seg2("The Trunk’s model", "Their own") }),
  no("Ask a stronger model on hard calls", "Off until you choose: it spends a call on a bigger model."),
  no("Plan first on long tasks", "Off until you choose: an extra planning call on long tasks."),
  no("Wait for my yes on the plan", "Off until you choose: it adds a wait for your go-ahead."),
  no("Check the answer before saying done", "A second look compares the answer with what was asked. Off until you choose: a reviewer call on every answer."),
  sw("Trunks message each other", "A Trunk can ask another and wait for the answer. A chain stops after three hops.", "tools.agentToAgent.enabled", true),
  { t: "Take work over the agent protocol", s: "Other agents can send Branch tasks. Off until you choose: an outside program hands Branch work.", plug: "a2a" },
  no("Who may call your Trunks from outside", "Careful and Strict ask you about strangers; Open answers anyone who signs their request.", "seg", { opts: seg2("Nobody", "Strict", "Careful", "Open") }),
  no("Tools lent by a connected program", "Off until you choose: an outside program lends tools."),
  no("Carry a conversation on somewhere else", "Hands a conversation, with its history, to another assistant. Off until you choose: it sends to others."),
  sw("Look after several assistants at once", "Off until you choose: it sends work to other assistants.", "acp.enabled", false),
  no("Other computers running Branch, side by side", "Off until you choose: it hands work to other computers."),
  no("Trunks on other computers", "Off until you choose: it talks to Trunks on other computers."),
  { t: "Trunks at once", s: "In each conversation; each conversation’s Trunks count on their own.", lv: 2, k: "agents.defaults.subagents.maxConcurrent", kind: "num", def: 8, min: 1 },
  no("When every Trunk slot is busy", "Wait in line keeps the request until a slot frees up.", "seg", { lv: 2, opts: seg2("Wait in line", "Say no") }),
  no("Waiting line", "Requests that can wait for a slot.", "num", { lv: 2 }),
  no("Wait at most", "Then the request is turned down.", "num", { lv: 2, unit: "seconds" }),
] };
const AUTO_STEPS: SecSpec = { title: "Automations, steps and nudges", lv: 1, rows: [
  no("Steps for other apps", "Lets a procedure send email, read an inbox and change spreadsheets. Off until you choose: steps send to outside apps."),
  no("Nudge a long task that stops early", "When a lead Trunk stops before its goal, it’s nudged on, or you’re asked if something really blocks it."),
] };
const SETUP: SecSpec = { title: "Setup", lv: 1, rows: [{ t: "Suggest tools during setup" }], whole: (c) => <SectionWrap title="Setup"><SetupSec c={c} /></SectionWrap> };
function SectionWrap({ title, children }: { title: string; children: ReactNode }) { return <Sec title={title}>{children}</Sec>; }

const SECTIONS: SecSpec[] = [SEEING, LOGS, SETUP, COMMANDS, DOCKER_SEC, FILES, WEB_MORE, SKILLS_MORE, HELPERS, TOOLS_TECH, HOOKS, AUTO_MORE, SHARING_MORE, MEMORY, AUTOMATIONS, TOOLS_SKILLS,
  TRUNKS_MORE, LIBRARY_MORE, PINNED, WHAT, TRY, CONVERSATIONS, MEMORY_MORE, MEMORY_TECH, SKILLS_TECH, PLUGINS_TECH, NETWORK, ELSE, HEALTH, RECALL, DOCS, HELPERS_AGENTS, AUTO_STEPS];

export const ROWS: RowEntry[] = rowsOf("advanced", SECTIONS);

export function AdvancedPage(props: SettingsPageProps) {
  const config = useConfig(props.engine);
  const agent = useScope() ?? props.engine.agentId ?? "";
  const plugins = useLive<RecordValue>(props.engine, "plugins.list", {}, ["plugins"]);
  const c: Ctx = { ...props, config, lv: lvOf(props.level), agent, plugins: list(rec(plugins.data).plugins) };
  return (
    <Page title={props.title} lede={LEDE}>
      {c.lv >= 1 ? <Tiles c={c} /> : null}
      {SECTIONS.map((s) => <Section key={s.title} spec={s} c={c} />)}
    </Page>
  );
}

/* ---------- the service tiles ---------- */
function Tile({ name, pill, tone, rows, children }: { name: string; pill: string; tone: "ok" | "warn" | "bad" | "idle"; rows: [string, ReactNode][]; children: ReactNode }) {
  return (
    <div className="s2advanced-tile" data-tile={name}>
      <div className="s2advanced-th"><b>{name}</b><span className={`pill ${tone} s2advanced-ml`}><i />{pill}</span></div>
      <Kv rows={rows} />
      <div className="acts">{children}</div>
    </div>
  );
}
function Tiles({ c }: { c: Ctx }) {
  const [logs, setLogs] = useState<{ name: string; filter: string } | null | undefined>(undefined);
  return (
    <>
      <ServiceTile c={c} onLogs={() => setLogs(null)} />
      <ModelTile c={c} onLogs={(f) => setLogs({ name: "The model on this computer", filter: f })} />
      <BrowserTile c={c} onLogs={() => setLogs({ name: "The browser", filter: "browser" })} />
      {logs !== undefined ? <LogsDialog engine={c.engine} source={logs ?? undefined} onClose={() => setLogs(undefined)} /> : null}
    </>
  );
}
function ServiceTile({ c, onLogs }: { c: Ctx; onLogs: () => void }) {
  const version = useBranchVersion(c.engine.gatewayUrl);
  const status = useLive<RecordValue>(c.engine, "status", {}, ["health"]);
  const health = useLive<RecordValue>(c.engine, "health", { probe: false }, ["health"]);
  const sys = useLive<RecordValue>(c.engine, "system.info", {}, []);
  const restart = useCall();
  const ok = rec(health.data).ok === true;
  const port = Number(c.config.get("gateway.port")) || Number(rec(sys.data).port) || DEFAULT_PORT;
  const go = () => void restart.run(() => c.engine.request<RecordValue>("gateway.restart.request", { reason: "settings" }), (r) => (rec(r).status === "deferred" ? "Restarting once the running work finishes." : "Restarting. The window reconnects by itself."));
  return (
    <Tile name="Branch service" pill={health.error ? "Not answering" : ok ? "Running" : "Checking"} tone={health.error ? "bad" : ok ? "ok" : "idle"}
      rows={[["Version", version ? versionParts(version).detail : "Unavailable"], ["Address", `127.0.0.1:${port}`], ["Process", str(rec(status.data).pid) || str(rec(sys.data).pid)]]}>
      <Btn sm disabled={restart.busy} onClick={go}>Restart</Btn><Btn sm ghost onClick={onLogs}>Open logs</Btn>
      <CallLine call={restart} />
    </Tile>
  );
}
function ModelTile({ c, onLogs }: { c: Ctx; onLogs: (filter: string) => void }) {
  const models = useLive<RecordValue>(c.engine, "models.list", { includeDetails: true, preparedOnly: true }, []);
  const m = list(rec(models.data).models).find((x) => x.local === true);
  const pill = !m ? (models.error ? "Not answering" : "None set up") : m.available === true ? "Ready" : m.available === false ? "Unavailable" : "Not checked";
  const room = Number(m?.contextWindow);
  return (
    <Tile name="Model on this computer" pill={pill} tone={m?.available === true ? "ok" : m?.available === false ? "warn" : "idle"}
      rows={m ? [["Model", str(m.name) || str(m.id)], ["Context", room ? `${Math.round(room / 1000)}K-token context` : ""], ["Size", bytes(m.sizeBytes)]] : [["Model", "No model runs on this computer yet."]]}>
      <Btn sm disabled title="The engine can’t restart a model on this computer.">Restart</Btn>
      <Btn sm ghost disabled={!m} onClick={() => onLogs(str(m?.provider))}>Open logs</Btn>
    </Tile>
  );
}
function BrowserTile({ c, onLogs }: { c: Ctx; onLogs: () => void }) {
  const st = useLive<RecordValue>(c.engine, "browser.request", { method: "GET", path: "/" }, []);
  const tabs = useLive<RecordValue>(c.engine, "browser.request", { method: "GET", path: "/tabs" }, []);
  const restart = useCall();
  const d = rec(st.data);
  const go = () => void restart.run(async () => { await c.engine.request("browser.request", { method: "POST", path: "/stop" }); await c.engine.request("browser.request", { method: "POST", path: "/start" }); void st.reload(); void tabs.reload(); }, () => "Restarted.");
  const pill = st.error ? "Not available" : d.enabled === false ? "Off" : d.running === true ? "Running" : st.data ? "Ready" : "Checking";
  return (
    <Tile name="Browser" pill={pill} tone={st.error ? "bad" : d.running === true || (st.data && d.enabled !== false) ? "ok" : "idle"}
      rows={[["Profile", str(d.profile)], ["Windows open", tabs.data ? String(list(rec(tabs.data).tabs).length) : ""], ["Problem", st.error ?? ""]]}>
      <Btn sm disabled={restart.busy || Boolean(st.error)} onClick={go}>Restart</Btn><Btn sm ghost onClick={onLogs}>Open logs</Btn>
      <CallLine call={restart} />
    </Tile>
  );
}
