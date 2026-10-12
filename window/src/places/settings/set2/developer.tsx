// Settings › Developer (DESIGN-SPEC §4.7.20, Technical only): the local address and its sign-in (gateway.port,
// gateway.auth.*, gateway.identity.get), the HTTP doors (gateway.http.endpoints.*, the admin-http-rpc and
// diagnostics-prometheus plugins, /tools/invoke), traces (diagnostics.otel.*, audit.list), diagnostics
// (diagnostics.*, diagnostics.stability, profiles), discovery, widgets, working copies, the settings file
// (config.get / config.apply) and copyable commands that exist in the branch command. Rows the engine has no
// setting or method for are greyed with why; the dialogs are in developer-more.tsx.
// TODO(engine-lane): the greyed reasons in this file say what is still missing; shownWhy (shell/shown-why.ts) keeps them out of sight.
import { useEffect, useState } from "react";
import { shownWhy } from "../../../shell/shown-why";
import type { SettingsPageProps } from "../index";
import { Acts, Btn, Ctl, Field, Num, Page, Pick, Pill, Plist, Prow, Sec, Seg, Switch, useConfig, type RowEntry } from "../kit";
import { Dialog } from "../../../shell/Dialog";
import { CodeRow, CopyBtn, Tile, rec, str, useLive, type RecordValue } from "./common";
import { Ico } from "./icons";
import {
  APP, CallDialog, DEFAULT_PORT, EditorDialog, EventsDialog, Greyed, PlaygroundDialog, RunsTraces, SEC_ROWS, Troubleshooting, TroubleMore,
  failedLine, ne, rowsOf, type Ctx, type OffRow,
} from "./developer-more";
import "./developer.css";

const LEDE = "For people building on Branch.";
const titles = (rows: OffRow[]) => rows.map((r) => r[0]);

const LINKS: OffRow[] = [["Link key", "Your own scripts add it to a branch:// link so it runs without asking first.", "branch:// links are opened by the Branch app.", "btn:Copy"]];
const BUILD_OFF: OffRow[] = [
  ["REST API", "Conversations, documents, Trunks and admin, with the reference.", ne("REST reference"), "btn:Open the reference"],
  ["Outside programs join Trunk-to-Trunk messages", "", ne("Trunk-to-Trunk message bridge"), "sw"],
  ["Start a new plugin or connector", "Templates for a connector, commands, hooks, skills and themes; then check it and link it for testing.", "From a terminal: Start a plugin, below.", "btn:Choose a template"],
];
const EDITORS: OffRow[] = [
  ["Editor extension", "Shares your open files, cursor and selection; shows edits as diffs to accept or reject. /ide checks it.", ne("editor extension"), "chips:VS Code|JetBrains|On its own"],
  ["Install it", "From the extension you can also install the branch command.", ne("editor extension"), "btn:Open in VS Code"],
  ["Show edits as diffs to accept", "Off: edits apply and show in the thread.", ne("editor extension"), "sw"],
  ["Read the file open in the editor", "", ne("editor extension"), "sw"],
  ["Share the editor’s git branch and changes", "", ne("editor extension"), "sw"],
  ["Share the debugger’s variables and stack", "While you’re stopped at a breakpoint.", ne("editor extension"), "sw"],
  ["Let other extensions start tasks", "Through the extension’s public interface.", ne("editor extension"), "sw"],
  ["Fix a terminal command: prompt", "Used by the editor’s terminal menu. Explain uses its own.", ne("editor extension"), "in"],
];
const EDITORS_MORE: OffRow[] = [
  ["Rich tool steps for editors", "Kinds, file places, groups and diffs.", ne("agent protocol tool-step setting"), "sw"],
  ["Tidy each turn’s messages for the editor", "", ne("agent protocol message setting"), "sw"],
];
const ASSISTANTS: OffRow[] = [
  ["Branch as a connector", "Other assistants see your conversations, Trunks and folders as tools.", "Other assistants start it themselves with branch graft (Settings › Connected agents).", "sw"],
  ["Share your skills as a connector", "Other assistants can find and add your skills.", ne("skills connector"), "sw"],
  ["Share Branch’s browser", "Other assistants get Branch’s browser tools, sign-ins and saved steps.", ne("browser connector"), "sw"],
  ["Share skills, plugins and connectors with any assistant", "One address gives them what you assign, with your Google and Microsoft sign-ins kept here.", ne("shared connector address"), "sw"],
  ["One address for all your connectors", "Each assistant sees only the connectors it’s allowed; their sign-ins refresh here.", ne("shared connector address")],
  ["Share a connector over the web", "A connector that runs on this computer, reachable at a web address.", ne("connector web bridge"), "sw"],
  ["Add Branch to another assistant", "Writes its connector settings, and can add Branch’s skills to its skills folder.", ne("assistant installer"), "btn:Choose an assistant"],
  ["Keep other assistants in step", "One file lists skills, commands, connectors and instructions; a lock file keeps every assistant on the same versions.", ne("assistant lock file"), "btn:Choose the file"],
  ["Drive Branch from another coding assistant", "A skill that lets it use a running Branch over its local address.", ne("skill for other assistants"), "btn:Add the skill"],
  ["Your Trunk reacts to coding assistant events", "Its face reacts as another coding assistant works.", APP, "sw"],
  ["Remote control for the terminal", "Other tools can fill in and send the terminal’s message, open its dialogs and run commands.", APP, "sw"],
  ["Sign in to other apps with Branch", "Branch acts as a sign-in provider for your own apps.", ne("sign-in provider"), "pill:Off"],
  ["Sign in through your identity provider", "For assistants that expect to register themselves: GitHub, Google, Azure, Auth0.", ne("client registration"), "btn:Set up"],
  ["Sign in from GitHub Actions without a stored key", "GitHub’s own token is swapped for a short-lived one.", ne("token exchange"), "btn:Set up"],
  ["Example connectors", "A starting point to copy, and Branch’s docs as a connector for coding assistants.", ne("connector template"), "btn:Copy"],
];
const CODE_MORE: OffRow[] = [
  ["Index code folders", "For finding code by meaning. Rebuilt when files change.", ne("code index")],
  ["Ask before indexing a folder", "A new folder waits for your yes.", ne("code index"), "sw"],
  ["Warn when too many tools are on", "", ne("tool count warning"), "sw"],
];
const MORE_LINKS: OffRow[] = [["Open a video in a new chat", "Starts a conversation with that video’s page and captions loaded.", "branch:// links are opened by the Branch app.", "codecopy:branch://watch?v=<video id>"]];
const AUTO_TECH: OffRow[] = [
  ["Flow search", "Tries four versions of a flow on examples and keeps the best. Off until you choose: it runs four versions, four times the cost.", ne("flow search"), "sw"],
  ["Loop a prompt", "Or /heartbeat for the check-in list.", ne("/loop command"), "code:/loop 10m check the build"],
];
const SCRIPTS: OffRow[] = [
  ["Search over HTTP", "Ranked passages for a question, with the same sign-in as the local address.", ne("search address")],
  ["Share memory with other coding agents", "Point another coding agent at Branch and it gets the same memory. Off until you choose: it reads what they send.", ne("memory proxy"), "sw"],
  ["Automations from files", "Reads .branch/automations/*.md and keeps them in step; only the fields a file names are changed.", ne("automation files"), "sw"],
  ["Fire a trigger from a script", "A named trigger runs once, even if Branch was busy.", ne("trigger command")],
];

rowsOf("Local address", ["Local address", "Session key", "Sign-in", "Sign in with Tailscale", "Failed sign-ins", "Point the page at another Gateway", "Device ID", "Public key", "Settings over HTTP"]);
rowsOf("Help with code", ["Use language servers", "Use a debugger", "Where working copies go", "Faster working copies"]);
rowsOf("branch:// links", titles(LINKS));
rowsOf("Build on Branch", ["TypeScript", "Python", "Java", "Gateway client", "KeepOak cloud", "Tools lent by apps", ...titles(BUILD_OFF)]);
rowsOf("Editors and other apps", [...titles(EDITORS), "Agent Client Protocol", ...titles(EDITORS_MORE), "Browser extension"]);
rowsOf("Let other assistants use Branch", titles(ASSISTANTS));
rowsOf("Help with code, more", titles(CODE_MORE));
rowsOf("More branch:// links", titles(MORE_LINKS));
rowsOf("Automations, technical", titles(AUTO_TECH));
rowsOf("Memory and automations, for scripts", titles(SCRIPTS));

export function DeveloperPage(props: SettingsPageProps) {
  const config = useConfig(props.engine);
  const sys = useLive<RecordValue>(props.engine, "system.info", {}, []);
  const s = rec(sys.data);
  const port = Number(config.get("gateway.port")) || Number(s.port) || DEFAULT_PORT;
  const scheme = config.get("gateway.tls.enabled") === true ? "https" : "http";
  const ctx: Ctx = { ...props, config, sys: s, port, base: `${scheme}://127.0.0.1:${port}` };
  return (
    <Page title={props.title} lede={LEDE}>
      <LocalAddress {...ctx} />
      <HelpWithCode {...ctx} />
      <Sec title="branch:// links"><Greyed rows={LINKS} /></Sec>
      <BuildOnBranch {...ctx} />
      <Editors {...ctx} />
      <Sec title="Let other assistants use Branch"><Greyed rows={ASSISTANTS} /></Sec>
      <RunsTraces {...ctx} />
      <TroubleMore {...ctx} />
      <Sec title="Help with code, more" showHeading={false} group="Help with code"><Greyed rows={CODE_MORE} /></Sec>
      <Sec title="More branch:// links"><Greyed rows={MORE_LINKS} /></Sec>
      <RunWithout {...ctx} />
      <ToolsTech {...ctx} />
      <Sec title="Automations, technical" group="Automations"><Greyed rows={AUTO_TECH} /></Sec>
      <SystemSec {...ctx} />
      <BuildMore {...ctx} />
      <FromTerminal />
      <SettingsFileSec {...ctx} />
      <Troubleshooting {...ctx} />
      <Widgets {...ctx} />
      <Sec title="Memory and automations, for scripts"><Greyed rows={SCRIPTS} /></Sec>
      <OtherPrograms {...ctx} />
    </Page>
  );
}

const AUTH = [{ id: "token", label: "Session key" }, { id: "password", label: "Password" }, { id: "trusted-proxy", label: "Trusted proxy" }, { id: "none", label: "None" }];
/** The browser page's path under the local address (gateway.controlUi.basePath), without a trailing slash. */
function pagePath(config: Ctx["config"]): string {
  const p = str(config.get("gateway.controlUi.basePath")).trim().replace(/^\/+|\/+$/g, "");
  return p ? `/${p}` : "";
}

function reachLine(config: Ctx["config"]): string {
  const bind = str(config.get("gateway.bind")) || "loopback";
  const mode = str(config.get("gateway.auth.mode")) || "token";
  const who = bind === "loopback" ? "Only this computer can reach it." : "Other devices on your network can reach it too.";
  return `${who} ${mode === "none" ? "Requests need no sign-in." : "Requests need your sign-in."}`;
}

/** Copy for the address row: a plain button, as the preview draws it. */
function AddrCopy({ text }: { text: string }) {
  const [done, setDone] = useState("");
  useEffect(() => { if (!done) return; const t = setTimeout(() => setDone(""), 1600); return () => clearTimeout(t); }, [done]);
  return <Btn sm onClick={() => void navigator.clipboard.writeText(text).then(() => setDone("Copied"), () => setDone("Couldn’t copy"))}>{done || "Copy"}</Btn>;
}
const PAIR = "How other computers and phones know this one when they pair.";
/** The device's identity: the value with Copy once the engine answers. */
function IdRow({ title, code }: { title: string; code: string }) {
  return code ? <CodeRow title={title} code={code} sub={PAIR} /> : <Ctl title={title} sub={PAIR} />;
}

function LocalAddress({ engine, config, port, base }: Ctx) {
  const id = useLive<RecordValue>(engine, "gateway.identity.get", {}, []);
  const ident = rec(id.data);
  const mode = str(config.get("gateway.auth.mode")) || "token";
  const ts = str(config.get("gateway.tailscale.mode")) || "off";
  const allowTs = config.get("gateway.auth.allowTailscale");
  const tsOn = typeof allowTs === "boolean" ? allowTs : ts === "serve" && mode !== "password" && mode !== "trusted-proxy";
  const rpc = config.get("plugins.entries.admin-http-rpc.enabled") === true;
  const addr = `127.0.0.1:${port}`;
  return (
    <Sec title="Local address">
      <Ctl title={<>{addr}</>} id="Local address" sub={reachLine(config)}><AddrCopy text={addr} /></Ctl>
      <Ctl title="Session key" sub="Never shown in full here." off="Making a new key needs the engine’s key rotation.">
        {mode === "token" && config.get("gateway.auth.token") ? <span className="s2developer-dots">••••••••••••</span> : null}<Btn sm>Make a new one</Btn>
      </Ctl>
      <Ctl title="Sign-in" sub="What a program must show to use the local address.">
        <Seg label="Sign-in" value={mode} disabled={config.loading} onChange={(v) => void config.set("gateway.auth.mode", v)} options={AUTH} />
      </Ctl>
      <Ctl title="Sign in with Tailscale" sub="Tailnet users sign in as themselves; scripts need a key." help="People on your tailnet sign in to the window as themselves; scripts still need the key or password. On while Tailscale Serve is used.">
        <Switch label="Sign in with Tailscale" checked={tsOn} disabled={config.loading} onChange={(on) => void config.set("gateway.auth.allowTailscale", on)} />
      </Ctl>
      <Ctl title="Failed sign-ins" sub={failedLine(config)} />
      <CodeRow title="Point the page at another Gateway" code={`${base}${pagePath(config)}/?gatewayUrl=wss://‹host›:‹port›#token=‹key›`} sub="For building the browser page. It asks before switching." />
      {id.error ? <Ctl title="Device ID" off={id.error} /> : <IdRow title="Device ID" code={str(ident.deviceId)} />}
      {id.error ? null : <IdRow title="Public key" code={str(ident.publicKey)} />}
      <Ctl title="Settings over HTTP" sub={`Selected gateway actions over HTTP at ${base}/api/v1/admin/rpc, for scripts. Same sign-in as the local address. Off until you choose: anything holding the key could change Branch this way.`}>
        <Switch label="Settings over HTTP" checked={rpc} disabled={config.loading} onChange={(on) => void config.set("plugins.entries.admin-http-rpc.enabled", on)} />
      </Ctl>
    </Sec>
  );
}

function HelpWithCode({ config }: Ctx) {
  const root = str(config.get("worktreeRoot"));
  const [edit, setEdit] = useState(false);
  return (
    <Sec title="Help with code">
      <Ctl title="Use language servers" sub="Programs you already installed, one per line." help="Programs you already installed, one per line. Nothing downloads. Off until you choose: uses a lot of processor." off={ne("language server setting")}><Switch label="Use language servers" checked={false} onChange={() => undefined} /></Ctl>
      <Ctl title="Use a debugger" sub="On only while a debugging session is in use. Nothing downloads." off={ne("debugger setting")}><Switch label="Use a debugger" checked={false} onChange={() => undefined} /></Ctl>
      <Ctl title="Where working copies go" sub="New working copies for “Try ideas on a branch” are made here." help="New working copies for “Try ideas on a branch” are made here. Existing ones stay where they are.">
        {edit ? <Field label="Where working copies go" value={root} placeholder="~/branch-worktrees" wide onCommit={(v) => { setEdit(false); void config.set("worktreeRoot", v.trim() || null); }} />
          : <code className="s2-code">{root || "Branch’s folder › worktrees"}</code>}
        <Btn sm ghost onClick={() => setEdit(!edit)}>{edit ? "Cancel" : "Change"}</Btn>
        <Btn sm ghost disabled={!root} onClick={() => void config.set("worktreeRoot", null)}>Reset</Btn>
      </Ctl>
      <Ctl title="Faster working copies" sub="Uses the file system’s quick copy for new working copies where it can." help="Uses the file system’s quick copy for new working copies where it can. Off uses a normal Git checkout and file copy. Applies to new working copies only.">
        <Switch label="Faster working copies" checked={config.get("worktreeAcceleration") !== false} disabled={config.loading} onChange={(on) => void config.set("worktreeAcceleration", on)} />
      </Ctl>
    </Sec>
  );
}

/** Kits: the gateway client package is in the engine; the rest have no package yet. */
const KITS: [string, string, string, string?][] = [
  ["TypeScript", "Run a Trunk with live events, permission callbacks, your own tools and resume.", "", "The TypeScript kit isn’t published yet."],
  ["Python", "The same, sync or async.", "", "There is no Python kit yet."],
  ["Java", "A client for the agent protocol and the Gateway.", "", "There is no Java kit yet."],
  ["Gateway client", "Live updates, device sign-in and reconnecting. In the engine’s source as @branch/gateway-client.", "engine/packages/gateway-client"],
  ["KeepOak cloud", "Your Trunks on keepoak.com, from your own code.", "", "There is no KeepOak kit yet."],
];

function BuildOnBranch({ config }: Ctx) {
  return (
    <Sec title="Build on Branch">
      <Plist>
        {KITS.map(([t, sub, code, off]) => (
          <Prow key={t} icon={<Tile><Ico name="term" /></Tile>} title={t} sub={<>{sub}{code ? <small><code>{code}</code></small> : <small className="s2developer-why">{shownWhy(off)}</small>}</>}>
            {code ? <CopyBtn text={code} /> : null}
          </Prow>
        ))}
      </Plist>
      <Greyed rows={BUILD_OFF.slice(0, 1)} />
      <Ctl title="Tools lent by apps" sub="Connected apps add tools for Trunks to use." help="An app connected to Branch adds its own tools; when a Trunk calls one, the app runs it.">
        <Switch label="Tools lent by apps" checked={config.get("gateway.nodes.pluginTools.enabled") !== false} disabled={config.loading} onChange={(on) => void config.set("gateway.nodes.pluginTools.enabled", on)} />
      </Ctl>
      <Greyed rows={BUILD_OFF.slice(1)} />
    </Sec>
  );
}

function Editors({ config }: Ctx) {
  const acp = config.get("acp.enabled") !== false;
  return (
    <Sec title="Editors and other apps">
      <Greyed rows={EDITORS} />
      <Ctl title="Agent Client Protocol" sub="Editors such as Zed start Branch as their agent with branch acp." help="Editors such as Zed start Branch as their agent with branch acp. Branch’s own requests (models, schedules, skills, Trunks) come along.">
        <Pill tone={acp ? "ok" : "idle"}>{acp ? "On" : "Off"}</Pill>
      </Ctl>
      <Greyed rows={EDITORS_MORE} />
      <Ctl title="Browser extension" sub="Sends browser pages to Branch and shares browser tools." help="Sends pages from your browser into Branch, and lends Branch’s browser tools to it." off={ne("browser extension keys")} />
      <Acts><Btn sm disabled title={ne("browser extension keys")}>Make a key</Btn></Acts>
    </Sec>
  );
}

/** Run without the window: builds a real `branch agent exec` line from the flags that command has. */
type RunOpts = { msg: string; model: string; cwd: string; stdin: boolean };
export function execLine(o: RunOpts): string {
  const q = (s: string) => `"${s.replace(/(["\\$`])/g, "\\$1")}"`;
  const parts = ["branch agent exec"];
  parts.push(o.stdin ? "--message-file -" : q(o.msg || "‹message›"));
  if (o.model.trim()) parts.push(`--model ${o.model.trim()}`);
  if (o.cwd.trim()) parts.push(`--cwd ${q(o.cwd.trim())}`);
  return parts.join(" ");
}
const CHKS: [keyof RunOpts | "", string, string, string?][] = [
  ["", "Every step as JSON lines", "For scripts that follow along.", "agent exec prints one JSON result at the end (--json), not each step."],
  ["", "Answer in this shape", "A JSON Schema file the final answer must match.", "agent exec has no answer-shape flag."],
  ["", "Write the answer to a file", "For CI artefacts.", "agent exec has no output-file flag."],
  ["stdin", "Read the message from piped input", "What you pipe in becomes the message."],
  ["", "Run outside a Git folder", "It refuses by default, so changes can be undone.", "agent exec has no Git-folder flag."],
  ["", "Stop if a connector doesn’t start", "Fail the run instead of carrying on without it.", "agent exec has no connector flag."],
  ["", "Only check it starts", "Does all the start-up work, then exits.", "agent exec has no start-only flag."],
];
const RUN_OFF: OffRow[] = [
  ["Open it elsewhere", "Each run without the window prints this link, so you can watch it in the window or on your phone.", ne("run links")],
  ["List commands, modes and models", "", "The branch command has no commands list yet."],
  ["Try a command in the sandbox", "Runs it the way a Trunk would, to test the sandbox rules.", "The branch command has no sandbox run yet."],
  ["Start something new", "A folder with a Trunk, a skill and a schedule to fill in.", "The branch command has no project starter yet."],
  ["Settings file schema for your editor", "Point your editor at it for checks and completion.", "No schema address; branch config schema prints it."],
  ["A simple web page for it", "A Gradio page on this computer to try a Trunk.", "The branch command has no web page server yet."],
];
rowsOf("Run without the window", ["Message", "Carry on", "Model", "Mode", "Folder", "Change one setting for this run", ...CHKS.map((c) => c[1]), ...titles(RUN_OFF), "Use Branch from an editor that speaks ACP", "Answer like the OpenAI Responses API", "Read other coding tools’ settings files"]);

function RunWithout({ config, base }: Ctx) {
  const [o, setO] = useState<RunOpts>({ msg: "", model: "", cwd: "", stdin: false });
  const line = execLine(o);
  const set = (p: Partial<RunOpts>) => setO({ ...o, ...p });
  const responses = config.get("gateway.http.endpoints.responses.enabled") === true;
  return (
    <Sec title="Run without the window" hint="One message, start to finish, from a script or CI." help="One message, start to finish, from a script or CI. Pick what you need; the line below follows.">
      <Ctl title="Message"><input className="inp" aria-label="Message" value={o.msg} placeholder="Summarise today’s inbox" disabled={o.stdin} onChange={(e) => set({ msg: e.target.value })} /></Ctl>
      <Ctl title="Carry on"><Seg label="Carry on" value="new" onChange={() => undefined} options={[{ id: "new", label: "New" }, { id: "last", label: "Last conversation", off: "agent exec always starts fresh." }, { id: "copy", label: "A copy of the last", off: "agent exec always starts fresh." }]} /></Ctl>
      <Ctl title="Model"><input className="inp" aria-label="Model" value={o.model} placeholder="As set" onChange={(e) => set({ model: e.target.value })} /></Ctl>
      <Ctl title="Mode" off="agent exec has no mode flag; it runs with your settings."><Seg label="Mode" value="As set" onChange={() => undefined} options={["As set", "Read only", "Ask first", "Full access"].map((l) => ({ id: l, label: l }))} /></Ctl>
      <Ctl title="Folder"><input className="inp" aria-label="Folder" value={o.cwd} placeholder="This folder" onChange={(e) => set({ cwd: e.target.value })} /></Ctl>
      <Ctl title="Change one setting for this run" sub="Any setting, for this run only." off="agent exec takes a whole settings file (--config), not one setting."><input className="inp" aria-label="Change one setting for this run" placeholder="key=value" /></Ctl>
      <div className="s2developer-chks">
        {CHKS.map(([k, t, sub, off]) => (
          <label key={t} className="s2developer-chk" title={shownWhy(off)} aria-disabled={off ? true : undefined}>
            <input type="checkbox" disabled={Boolean(off)} checked={k ? Boolean(o[k]) : false} onChange={(e) => k && set({ [k]: e.target.checked })} />
            <span><b>{t}</b><small>{sub}</small>{shownWhy(off) ? <small className="s2developer-why">{shownWhy(off)}</small> : null}</span>
          </label>
        ))}
      </div>
      <div className="s2developer-cmd"><code>{line}</code><CopyBtn text={line} /></div>
      <Greyed rows={RUN_OFF.slice(0, 1)} />
      <Greyed rows={RUN_OFF.slice(1, 5)} />
      <CodeRow title="Use Branch from an editor that speaks ACP" code="branch acp" sub="The editor starts it and talks to it over standard input." />
      <Greyed rows={RUN_OFF.slice(5)} />
      <Ctl title="Answer like the OpenAI Responses API" sub={`At ${base}/v1/responses, for programs built for that. Off until you choose: another door into Branch.`}>
        <Switch label="Answer like the OpenAI Responses API" checked={responses} disabled={config.loading} onChange={(on) => void config.set("gateway.http.endpoints.responses.enabled", on)} />
      </Ctl>
      <Ctl title="Read other coding tools’ settings files" sub="Uses the project’s instructions and command files." help="Uses their instruction and command files in a project, as well as Branch’s own." off={ne("project file import setting")}><Switch label="Read other coding tools’ settings files" checked={false} onChange={() => undefined} /></Ctl>
      <h3 className="s2-h3">Kits</h3>
      <p className="hint">TypeScript, Python, Go, React, C and inside your own server: none of these kits is published yet. The gateway client is in Build on Branch, above.</p>
      <h3 className="s2-h3">Other agent programs on this computer</h3>
      <p className="hint">Branch checks the usual places (programs, npm, pip, Homebrew) and can hand work to them as Trunks.</p>
      {shownWhy(ne("agent program finder")) ? <p className="hint s2developer-why">{shownWhy(ne("agent program finder"))}</p> : null}
    </Sec>
  );
}

/** Copy rows for commands that exist in the branch command; the last two have no command yet. */
const TERM: [string, string, string?][] = [
  ["Call any gateway action", "branch gateway call <action> --params {} --json", "The same actions as Call the gateway, for scripts."],
  ["Read a setting", "branch config get <key>"], ["Change a setting", "branch config set <key> <value>"], ["Remove a setting", "branch config unset <key>"],
  ["Apply a patch", "branch config patch --file changes.json5"],
  ["Where the file is", "branch config file", "Add --dry-run to see the change first. Add --expect-current-json to change a setting only if it still holds that value."],
  ["Follow a conversation’s steps", "branch sessions tail --follow", "Short progress lines, newest at the bottom; message text and tool contents are left out. Add --session-key to pick one, --tail to show more. Starts with the last 80 steps, then new ones."],
  ["What each Connector is doing", "branch mcp status --verbose"], ["Check each one answers", "branch mcp doctor --probe"], ["Sign in to one", "branch mcp login <name>"], ["Load changes", "branch mcp reload"],
  ["Set up without questions", "branch onboard --non-interactive --accept-risk", "For scripts and new machines: pass keys, the gateway sign-in and the plugins it needs as flags. --accept-risk says you know Trunks can act on this computer; it does not approve plugins."],
  ["One answer from a model", "branch infer model run --prompt \"…\" --json", "One answer from a model, outside any Trunk; add --file for pictures. The same family has image, audio, speech, video, web and embedding commands."],
  ["Which services it can use", "branch infer model providers"], ["Meaning search from a terminal", "branch infer embedding create --text \"…\""],
  ["A separate Branch", "BRANCH_PROFILE=work branch", "Its own folder, port and keychain entries, for testing. Updates and starting at sign-in are off in a profile."],
];
const TERM_OFF: OffRow[] = [
  ["Look at a project’s code", "Symbols and what calls what, from a terminal.", "The branch command has no code map yet."],
  ["Language helpers", "Status, install, restart and which one serves a file.", "The branch command has no language helper commands yet."],
];
rowsOf("From a terminal", [...TERM.map((t) => t[0]), ...titles(TERM_OFF)]);

function FromTerminal() {
  return (
    <Sec title="From a terminal" hint="Copy a command; each prints JSON with --json.">
      {TERM.map(([t, code, sub]) => <CodeRow key={t} title={t} code={code} sub={sub} />)}
      <Greyed rows={TERM_OFF} />
    </Sec>
  );
}

/* ───────────── Tools, technical ───────────── */

const TOOLS_OFF: OffRow[] = [
  ["Turn an OpenAPI file into tools", "", "Turning a file into tools runs in the Branch app.", "btn:Choose a file"],
  ["Tool scripts and WebAssembly", "Sandboxed JavaScript and .wasm add-ons. Off until you choose: developer plumbing.", ne("tool script runtime"), "sw"],
];
const TOOLS_OFF2: OffRow[] = [
  ["Tools that join over a WebSocket", "Off until you choose: developer plumbing.", ne("tool socket"), "sw"],
  ["Hardware adapters", "Off until you choose: developer plumbing.", ne("hardware adapters"), "seg:Off|Serial|GPIO|I2C|SPI"],
];
rowsOf("Tools, technical", [...titles(TOOLS_OFF), "Run code mode in", ...titles(TOOLS_OFF2), "Load tools only when needed", "Playground", "Run one tool over HTTP", "Call the gateway", "App view sandbox"]);

/** tools.codeMode may be a boolean, "auto" or an object; choosing the runner keeps whether it is on. */
export function codeModeWith(cur: unknown, executor: string): unknown {
  if (cur && typeof cur === "object" && !Array.isArray(cur)) return { ...(cur as Record<string, unknown>), executor };
  return { enabled: cur === undefined ? "auto" : cur, executor };
}
/** tools.toolSearch: absent or true is on; an object is on when enabled says so or it sets anything else. */
export function toolSearchOn(v: unknown): boolean {
  if (v === undefined || v === true) return true;
  if (v === false || !v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return typeof o.enabled === "boolean" ? o.enabled : Object.keys(o).some((k) => k !== "enabled");
}

function ToolsTech({ engine, config, base }: Ctx) {
  const [dlg, setDlg] = useState<"" | "play" | "call">("");
  const cm = config.get("tools.codeMode");
  const exec = cm && typeof cm === "object" ? str((cm as Record<string, unknown>).executor) || "node" : "node";
  const ts = config.get("tools.toolSearch");
  return (
    <Sec title="Tools, technical" group="Tools">
      <Greyed rows={TOOLS_OFF} />
      <Ctl title="Run code mode in" sub="Node.js is for code you trust; it is not a sandbox." help="Node.js is for code you trust; it is not a sandbox. QuickJS runs each script in its own WebAssembly box. Either way, tools keep their own permissions. Applies to new tasks; a Trunk’s own choice wins.">
        <Pick label="Run code mode in" value={exec} disabled={config.loading} onChange={(v) => void config.set("tools.codeMode", codeModeWith(cm, v))} options={[{ id: "node", label: "Node.js" }, { id: "quickjs", label: "QuickJS (isolated)" }]} />
      </Ctl>
      <Greyed rows={TOOLS_OFF2} />
      <Ctl title="Load tools only when needed" sub="Thousands of tools at the cost of dozens.">
        <Switch label="Load tools only when needed" checked={toolSearchOn(ts)} disabled={config.loading} onChange={(on) => void config.set(ts && typeof ts === "object" ? "tools.toolSearch.enabled" : "tools.toolSearch", on)} />
      </Ctl>
      <Ctl title="Playground" sub="Try any tool through a form."><Btn sm onClick={() => setDlg("play")}>Open</Btn></Ctl>
      <CodeRow title="Run one tool over HTTP" code={`POST ${base}/tools/invoke`} sub="Uses local sign-in and tool rules for HTTP calls." help="Same sign-in as the local address and the same tool rules. Running commands, changing or deleting files, starting Trunks, automations, the gateway and other computers are refused here unless the settings file allows them. Up to 2 MB per request." />
      <Ctl title="Call the gateway" sub="Send one gateway action with JSON values."><Btn sm onClick={() => setDlg("call")}>Open</Btn></Ctl>
      <Ctl title="App view sandbox" sub="Must differ from Branch’s own address." help="Must differ from Branch’s own address. Nothing else should be served there." off={ne("separate app view address")}><Btn sm ghost>Change…</Btn></Ctl>
      {dlg === "play" ? <PlaygroundDialog engine={engine} onClose={() => setDlg("")} /> : null}
      {dlg === "call" ? <CallDialog engine={engine} onClose={() => setDlg("")} /> : null}
    </Sec>
  );
}

/* ───────────── System ───────────── */

const SYS_OFF: OffRow[] = [["Portable mode", "Data beside the program, for a USB stick. Off until you choose: developer plumbing.", APP, "sw"]];
const SYS_OFF2: OffRow[] = [["Status line", "", APP, "seg:Default|Minimal|My script"]];
const SYS_OFF3: OffRow[] = [
  ["Is Branch keeping up", "Warns when the engine stalls for a second or more.", ne("stall warning"), "sw"],
  ["Save task trajectories", "Every step as JSON Lines, for analysis. Off until you choose: it uses disk.", ne("trajectory switch; branch sessions export-trajectory exports a conversation’s steps"), "sw"],
];
rowsOf("System", [...titles(SYS_OFF), "Send metrics with OpenTelemetry", "Detailed logs for", "Cache trace", "Diagnostics", ...titles(SYS_OFF2), "Find Branch on other computers nearby", "What it tells the network", "Find it across networks", "Plan finding it across networks", "Set up finding it across networks", ...titles(SYS_OFF3)]);

function Flags({ config }: Ctx) {
  const raw = config.get("diagnostics.flags");
  const flags = Array.isArray(raw) ? raw.map(String) : [];
  const [draft, setDraft] = useState("");
  const add = () => { const v = draft.trim(); if (v && !flags.includes(v)) void config.set("diagnostics.flags", [...flags, v]); setDraft(""); };
  const remove = (f: string) => { const rest = flags.filter((x) => x !== f); void config.set("diagnostics.flags", rest.length ? rest : null); };
  return (
    <Ctl title="Detailed logs for" sub="Flags such as telegram.*" after={
      <div className="s2developer-lst">
        {flags.length ? flags.map((f) => <span key={f} className="chip6">{f}<button type="button" className="s2-x" aria-label={`Remove ${f}`} onClick={() => remove(f)}>×</button></span>) : <span className="hint">Nothing here yet.</span>}
        <span className="s2developer-add"><input className="inp s2developer-mono" aria-label="Detailed logs for: new item" placeholder="telegram.*" value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") add(); }} /><Btn sm disabled={config.loading} onClick={add}>Add</Btn></span>
      </div>
    } />
  );
}

function SystemSec(ctx: Ctx) {
  const { config } = ctx;
  const otel = rec(config.get("diagnostics.otel"));
  const mdns = str(config.get("discovery.mdns.mode")) || "minimal";
  const domain = str(config.get("discovery.wideArea.domain"));
  return (
    <Sec title="System">
      <Greyed rows={SYS_OFF} />
      <Ctl title="Send metrics with OpenTelemetry" sub={`${str(otel.endpoint) || "No address set yet"}. Off until you choose: it sends data outside Branch.`}>
        <Switch label="Send metrics with OpenTelemetry" checked={otel.enabled === true} disabled={config.loading} onChange={(on) => { void config.set("diagnostics.otel.enabled", on); if (on) void config.set("plugins.entries.diagnostics-otel.enabled", true); }} />
      </Ctl>
      <Flags {...ctx} />
      <Ctl title="Cache trace" sub="Records cache decisions; turn it off when done."><Switch label="Cache trace" checked={config.get("diagnostics.cacheTrace.enabled") === true} disabled={config.loading} onChange={(on) => void config.set("diagnostics.cacheTrace.enabled", on)} /></Ctl>
      <Ctl title="Diagnostics" sub="Turn off only where every bit of disk and processor counts."><Switch label="Diagnostics" checked={config.get("diagnostics.enabled") !== false} disabled={config.loading} onChange={(on) => void config.set("diagnostics.enabled", on)} /></Ctl>
      <Greyed rows={SYS_OFF2} />
      <Ctl title="Find Branch on other computers nearby" sub="Tools and models on your network."><Switch label="Find Branch on other computers nearby" checked={mdns !== "off"} disabled={config.loading} onChange={(on) => void config.set("discovery.mdns.mode", on ? null : "off")} /></Ctl>
      <Ctl title="What it tells the network" sub="Name only is enough for most homes." help="Name only is enough for most homes. Turning the switch above off stops it telling the network anything.">
        <Seg label="What it tells the network" value={mdns === "full" ? "full" : "minimal"} disabled={config.loading || mdns === "off"} onChange={(v) => void config.set("discovery.mdns.mode", v === "minimal" ? null : v)} options={[{ id: "minimal", label: "Name only" }, { id: "full", label: "Name, command path and SSH port" }]} />
      </Ctl>
      <Ctl title="Find it across networks" sub="Lets your other computers find this Branch over Tailscale." help="Lets your other computers find this Branch over Tailscale. Empty for nearby only.">
        <span className="s2developer-txt"><Field label="Find it across networks" value={domain} placeholder="branch.internal" onCommit={(v) => void config.set("discovery.wideArea.domain", v.trim() || null)} /></span>
      </Ctl>
      <CodeRow title="Plan finding it across networks" code={`branch dns setup --domain ${domain || "branch.internal"}`} sub="Shows the plan." />
      <CodeRow title="Set up finding it across networks" code="branch dns setup --apply" sub="Applies it. Mac only, with Homebrew CoreDNS; asks for your password." />
      <Greyed rows={SYS_OFF3} />
    </Sec>
  );
}

/* ───────────── Build on Branch (second) ───────────── */

/** Scrolls to a section or row of this page. */
function jump(sel: string): void {
  document.querySelector(sel)?.scrollIntoView({ block: "start", behavior: "smooth" });
}
/** [title, sub, button, where it jumps] */
const BUILD2_JUMP: [string, string, string, string][] = [
  ["Build on Branch", "Kits for JavaScript and Python, an OpenAPI description, and a mode without the window.", "See them", '[data-sec="Build on Branch"]'],
  ["The branch command", "Everything in the window from a terminal, with JSON output for scripts.", "See examples", '[data-sec="From a terminal"]'],
];
const BUILD2_OFF2: OffRow[] = [
  ["Keys for scripts and phones", "Short-lived keys that can only do what you tick.", ne("scoped keys"), "btn:Make a key"],
];
const BUILD2_OFF2B: OffRow[] = [
  ["Studies", "Run the same tasks again later and compare, with a journal of what changed.", ne("studies"), "btn:See the last"],
  ["What went with the last request", "What travelled with the last message to the model, and how much room each part took.", ne("request breakdown"), "btn:Show it"],
];
const BUILD2_OFF3: OffRow[] = [
  ["Live panels and app blocks", "Tools can show a live panel in a conversation, and other runtimes can plug in.", ne("live panel list"), "btn:See them"],
  ["Test live panel", "A test page in the live panel, to check panels draw.", ne("test panel"), "btns:Show it|Hide it|Copy its address"],
  ["Procedures as text", "Any procedure can be read and edited as YAML, and checked before it runs.", ne("procedure files"), "btn:Show one"],
  ["Wake word for scripts", "A small helper that listens for a wake word on a Mac and runs your own command, and turns audio files into subtitles. It never uses the network.", ne("wake word helper"), "btn:See how"],
];
const PLUGIN_CMDS: [string, string, string?][] = [
  ["Start a plugin", "branch plugins init <id> --name \"‹name›\"", "Starts a plugin; add --type provider for a model service."],
  ["Describe it from the code", "branch plugins build", "Writes its description from the built code; --check fails when it is out of date."],
  ["Check it", "branch plugins validate"], ["Pack it", "branch plugins pack"],
];
rowsOf("Build on Branch", [...BUILD2_JUMP.map((r) => r[0]), "Events for your programs", ...titles(BUILD2_OFF2), "Send traces elsewhere", ...titles(BUILD2_OFF2B), "Watch model traffic", "Pages from plugins", ...titles(BUILD2_OFF3), ...PLUGIN_CMDS.map((c) => c[0])]);

function BuildMore({ engine, config }: Ctx) {
  const [events, setEvents] = useState(false);
  const [traffic, setTraffic] = useState(false);
  return (
    <Sec title="Build on Branch" showHeading={false} id="build-more">
      {BUILD2_JUMP.map(([t, sub, btn, sel]) => <Ctl key={t} title={t} sub={sub}><Btn sm onClick={() => jump(sel)}>{btn}</Btn></Ctl>)}
      <Ctl title="Events for your programs" sub="A stream of what happens in Branch that your own programs can follow."><Btn sm onClick={() => setEvents(true)}>Show the stream</Btn></Ctl>
      <Greyed rows={BUILD2_OFF2} />
      <Ctl title="Send traces elsewhere" sub="Sends run traces to your chosen tracing service." help="Every round and tool as a trace, sent to OpenTelemetry, Langfuse, LangSmith or Prometheus."><Btn sm onClick={() => jump('[data-row="Where traces go"]')}>Choose</Btn></Ctl>
      <Greyed rows={BUILD2_OFF2B} />
      <Ctl title="Watch model traffic" sub="Records Branch’s model requests and replies locally." help="A proxy on this computer that records what Branch sends and gets back, to find doubled or failing requests."><Btn sm onClick={() => setTraffic(true)}>See how</Btn></Ctl>
      <Ctl title="Pages from plugins" sub="Plugins you installed can add pages, widgets and views." help="Plugins you installed can add pages, widgets and views. Off until you choose: their code runs with your permissions, so use it only for plugins you trust. Plugins that come with Branch keep their views either way.">
        <Switch label="Pages from plugins" checked={config.get("gateway.controlUi.experimental.customPlugins") === true} disabled={config.loading} onChange={(on) => void config.set("gateway.controlUi.experimental.customPlugins", on)} />
      </Ctl>
      <Greyed rows={BUILD2_OFF3} />
      {PLUGIN_CMDS.map(([t, code, sub]) => <CodeRow key={t} title={t} code={code} sub={sub} />)}
      {events ? <EventsDialog engine={engine} onClose={() => setEvents(false)} /> : null}
      {traffic ? <TrafficDialog onClose={() => setTraffic(false)} /> : null}
    </Sec>
  );
}

/** Watch model traffic: the branch proxy commands. */
const PROXY_CMDS: [string, string, string?][] = [
  ["Start it", "branch proxy start"], ["Run one command through it", "branch proxy run -- <command>"], ["Recordings", "branch proxy sessions"],
  ["Look for a problem", "branch proxy query --preset <check>", "Checks: double-sends, retry-storms, cache-busting, ws-duplicate-frames, missing-ack, error-bursts."],
  ["One recorded body", "branch proxy blob --id <id>"], ["Delete recordings", "branch proxy purge", "Deletes every recording."],
];
function TrafficDialog({ onClose }: { onClose: () => void }) {
  return (
    <Dialog title="Watch model traffic" onClose={onClose}>
      <p className="hint">A proxy on this computer that records what Branch sends and gets back.</p>
      {PROXY_CMDS.map(([t, code, sub]) => <CodeRow key={t} title={t} code={code} sub={sub} />)}
    </Dialog>
  );
}

/* ───────────── Settings file, Widgets, Other programs ───────────── */

rowsOf("Settings file", ["Settings file", "Load variables from your shell", "Give up after", "Last written by", "Upgrades already made to the file", "Settings from a conversation", "Temporary overrides from a conversation"]);

function SettingsFileSec({ engine, config }: Ctx) {
  const [open, setOpen] = useState(false);
  const t = config.get("env.shellEnv.timeoutMs");
  const shell = config.get("env.shellEnv.enabled") === true;
  const meta = rec(config.get("meta"));
  const ver = str(meta.lastTouchedVersion);
  const ups = Object.keys(rec(meta.migrations)).join(", ");
  return (
    <Sec title="Settings file">
      <Ctl title="Settings file" sub="Every setting Branch keeps, including the ones no page shows."><Btn sm onClick={() => setOpen(true)}>Open the editor</Btn></Ctl>
      <p className="hint">{"Branch also reads keys from .env in its folder. Any text setting can use ${NAME} to take a launch variable, and a file can pull in another with $include."}</p>
      <Ctl title="Load variables from your shell" sub="Imports missing keys from your login shell at startup." help="At start, Branch runs your login shell once and takes only the keys it is missing. Off until you choose: it runs your shell profile each time Branch starts.">
        <Switch label="Load variables from your shell" checked={shell} disabled={config.loading} onChange={(on) => void config.set("env.shellEnv.enabled", on)} />
      </Ctl>
      <Ctl title="Give up after"><Num label="Give up after" unit="s" value={typeof t === "number" ? t / 1000 : undefined} placeholder="15" min={0} disabled={!shell} onCommit={(v) => void config.set("env.shellEnv.timeoutMs", v === null ? null : Math.round(v * 1000))} /></Ctl>
      {ver ? <CodeRow title="Last written by" code={`Branch ${ver}`} sub="Lets an older Branch refuse a file it can’t read safely." /> : <Ctl title="Last written by" sub="Not recorded in the file yet." help="Not recorded in the file yet. Lets an older Branch refuse a file it can’t read safely." />}
      {ups ? <CodeRow title="Upgrades already made to the file" code={ups} /> : <Ctl title="Upgrades already made to the file" sub="None recorded." />}
      <Ctl title="Settings from a conversation" sub="Lets /config read and change settings from a conversation." help="Lets /config read and change settings from a conversation. Off until you choose: a message could change how Branch runs.">
        <Switch label="Settings from a conversation" checked={config.get("commands.config") === true} disabled={config.loading} onChange={(on) => void config.set("commands.config", on)} />
      </Ctl>
      <Ctl title="Temporary overrides from a conversation" sub="Lets /debug change settings until the next restart." help="Lets /debug change settings until the next restart; nothing is written to the file. Off until you choose: a message could change how Branch runs.">
        <Switch label="Temporary overrides from a conversation" checked={config.get("commands.debug") === true} disabled={config.loading} onChange={(on) => void config.set("commands.debug", on)} />
      </Ctl>
      {open ? <EditorDialog engine={engine} config={config} onClose={() => setOpen(false)} /> : null}
    </Sec>
  );
}

rowsOf("Widgets", ["What widgets may run", "Widgets may load outside pages"]);
function Widgets({ config }: Ctx) {
  const mode = str(config.get("gateway.controlUi.embedSandbox")) || "scripts";
  return (
    <Sec title="Widgets">
      <Ctl title="What widgets may run" sub="Choose what a widget’s sealed frame may access." help="Widgets run their own buttons in a sealed frame that can’t reach this page. Nothing: no scripts, drawing only. Trusted: also same-site privileges, for pages that need them.">
        <Seg label="What widgets may run" value={mode} disabled={config.loading} onChange={(v) => void config.set("gateway.controlUi.embedSandbox", v === "scripts" ? null : v)} options={[{ id: "strict", label: "Nothing" }, { id: "scripts", label: "Their own scripts" }, { id: "trusted", label: "Trusted" }]} />
      </Ctl>
      <Ctl title="Widgets may load outside pages" sub="Lets a widget frame show any outside http or https page." help="Lets a widget frame show any outside http or https page. Off until you choose: a widget could show any website inside Branch.">
        <Switch label="Widgets may load outside pages" checked={config.get("gateway.controlUi.allowExternalEmbedUrls") === true} disabled={config.loading} onChange={(on) => void config.set("gateway.controlUi.allowExternalEmbedUrls", on)} />
      </Ctl>
    </Sec>
  );
}

const OTHER_OFF: OffRow[] = [
  ["Share tools with other assistants", "Only the tools you pick are listed or callable, as a tool server or to other agents. Off until you choose: nothing is shared.", ne("shared tool list"), "sw"],
  ["Share a skill without showing it", "Others get its name, its form and its answers, never its instructions; trust tiers decide who, and a misuse revokes it.", ne("sealed skill sharing"), "sw"],
  ["Approvals show in the app that called", "When another app uses Branch’s tools, a risky step asks there.", ne("approval forwarding"), "sw"],
];
rowsOf("Other programs and assistants", ["A chat address other apps understand", "Its address", ...titles(OTHER_OFF)]);
function OtherPrograms({ config, base }: Ctx) {
  const on = config.get("gateway.http.endpoints.chatCompletions.enabled") === true;
  return (
    <Sec title="Other programs and assistants">
      <Ctl title="A chat address other apps understand" sub="Apps that speak OpenAI’s chat shape can talk to your Trunks." help="Apps that speak OpenAI’s chat shape can talk to your Trunks. Same sign-in as the local address. Off until you choose: other programs could use your accounts.">
        <Switch label="A chat address other apps understand" checked={on} disabled={config.loading} onChange={(v) => void config.set("gateway.http.endpoints.chatCompletions.enabled", v)} />
      </Ctl>
      <CodeRow title="Its address" code={`${base}/v1/chat/completions`} sub={`${on ? "" : "Answers once the switch above is on. "}${base}/v1/models lists the Trunks.`} />
      <Greyed rows={OTHER_OFF} />
    </Sec>
  );
}

export const ROWS: RowEntry[] = [...SEC_ROWS.values()].flatMap(([sec, ts]) => ts.map((title) => ({ page: "developer", title, sec, group: sec === "More branch:// links" ? "branch:// links" : sec.replace(/, (more|technical|in depth)$/, ""), lv: 2 as const })));
