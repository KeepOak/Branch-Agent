// Settings › About Branch (DESIGN-SPEC §4.7.16): how it runs (health, status, system.info), restarting the engine
// (gateway.restart.request), updating itself (update.auto.enabled, update.checkOnStart), every change to its setup
// (branch.changes.list), who is connected (system-presence, users.list), conversation storage (sessions.storage.* and
// session.maintenance.coldStorage.*) and the settings file. The rest needs engine settings that don't exist yet, so
// those rows are greyed with the reason.
// TODO(engine-lane): the greyed reasons in this file say what is still missing; shownWhy (shell/shown-why.ts) keeps them out of sight.
import { useState, type ReactNode } from "react";
import { shownWhy } from "../../../shell/shown-why";
import type { SettingsPageProps } from "../index";
import { Acts, Btn, Ctl, Empty, Num, Page, Pick, Sec, Seg, Status, Switch, Val, useConfig, type RowEntry } from "../kit";
import { list } from "../adapter";
import { Dialog } from "../../../shell/Dialog";
import { useBranchVersion, versionParts } from "../../../connect/branch-version";
import { CallLine, CodeRow, Kv, bytes, lvOf, rec, span, str, useCall, useLive, when, type RecordValue } from "./common";
import { Icon } from "../../../shell/icons";
import { DesktopCtl } from "../desktop-ctl";
import "./self.css";

const LEDE = "What Branch may change about itself, how it stays running, and every change it made, each one reversible.";
const NO_SELF = "Needs the engine’s self-change policy.";
const NO_LEARN = "Needs the engine’s learning loop.";
const COSTS_NOTE = "Needs the engine to count what each skill, connector and agent costs.";
const NO_ROLLBACK = "Rolling back a change needs the engine’s roll back.";
const NO_SETTING = "Needs an engine setting for it.";
const APP = "Runs in the Branch app on your computer.";
const SOURCE: Record<string, string> = { "system-agent": "Branch", doctor: "Check and fix", "config-rpc": "Settings", cli: "The terminal", "plugin-install": "A plugin install", external: "Edited outside Branch", unknown: "" };

/** A greyed switch row: title, sub-line, the reason, and the level it shows from. */
type Off = [title: string, sub: string, why: string, lv?: number];
const LEARNING: Off[] = [
  ["Look back after each task", "A short review saves what to remember and which skills to improve.", NO_LEARN],
  ["Model for looking back", "", NO_LEARN], ["Wait until the computer is idle", "For a model on this computer: reviews wait their turn.", NO_LEARN],
  ["Tell me what it learned", "A short line after each review.", NO_LEARN],
  ["Fix a skill as soon as it’s found wrong", "A small, exact change, in the same task.", NO_LEARN],
  ["Learn from your reactions and corrections", "", NO_LEARN],
  ["Think again after a thumbs-down", "Saves what to do differently.", NO_LEARN],
  ["Remember what worked", "What was tried, how it went and the lesson, for similar tasks.", NO_LEARN],
  ["Turn repeated instructions into rules", "When you say the same thing three times, it offers a rule, then checks it helped.", NO_LEARN],
  ["Make a rule from a mistake", "Say what went wrong; it becomes a rule that warns or stops it next time.", NO_LEARN],
  ["A Trunk may edit its own persona", "Each change is listed below and can be undone.", NO_LEARN],
];
const LEARNING_MORE: Off[] = [
  ["Compare two models blind", "Now and then, two models answer and you pick one without knowing which.", NO_LEARN],
  ["Turn a run that worked into a script", "Next time the script runs; the model steps in only where it fails.", NO_LEARN],
  ["Learn from a recording of you doing it", "A screen recording becomes a plan it can follow.", NO_LEARN],
  ["Ideas for you", "A feed of ideas drawn from your history, with its own prompt.", NO_LEARN],
  ["Write like me", "Learns how you write, from what you send.", NO_LEARN],
  ["Learn from your other coding assistants", "Reads their history on this computer, finds repeated failures and fixes the instruction files.", NO_LEARN],
  ["Coaching on your prompts", "Tips on prompts and sessions, from rules you can read.", NO_LEARN],
  ["Notice when it changes how it works", "Flags when the same kind of task is suddenly done differently.", NO_LEARN],
  ["Learn from the team’s runs", "Repeated steps across the team become skills after a check.", NO_LEARN],
  ["Tune how memory is searched", "A new way of searching is kept only if replaying past questions shows it does better.", NO_LEARN],
  ["Make tests from runs you approved", "Approved runs, with private details taken out, become test cases.", NO_LEARN],
  ["Teach the model on this computer from your feedback", "For a model on this computer only.", NO_LEARN],
  ["A tester that uses Branch like you", "On a separate copy: it never deletes, sends, spends or changes safety settings.", NO_LEARN],
];
const RUNS_SWITCHES: Off[] = [
  ["If memory stays high", "Lets go of cached conversations first, then restarts cleanly.", "Needs the engine’s memory watch."],
  ["Let idle conversations rest", "Ones nobody is watching leave memory and come back when opened.", NO_SETTING],
  ["Pause suggestions on battery", "Typing suggestions stop while this computer runs on battery.", "Needs typing suggestions in the engine."],
];
const RUNS_LATER: Off[] = [
  ["Check and fix with real calls", "Sends one small request to each account and address to prove it works. Off until you choose: each check is a real call.", NO_SETTING],
  ["Put back settings that broke it", "After a change, if health checks keep failing, the last settings that worked come back.", NO_SETTING],
  ["Run the approved settings", "Trunks load settings and skills from a checked release, not from a copy they are editing. Off until you choose: changes wait for a release.", NO_SETTING],
  ["Send files to your other computers", "Encrypted; straight across when it can, through your Gateway when it can’t.", "Needs the engine’s file sending between computers."],
  ["Let other computers take a job", "Hand a task to another computer with its folder, model and permissions; it reports back here.", "Needs the engine to hand a task to another computer."],
];

const rows = (sec: string, lv: number, titles: string[]): [string, string, number][] => titles.map((t) => [t, sec, lv]);
export const ROWS: RowEntry[] = [
  ["Set up the Gateway again", "", 0],
  ...rows("What Branch may change about itself", 0, ["Its own settings", "Loosening what it may do", "The gateway’s timings", "Restarting its own engine", "Its own program and your saved work", "Work on its own code in a separate copy"]),
  ["Type branch in any terminal", "", 1],
  ["Let agents use this window", "", 1],
  ...rows("Learning", 0, LEARNING.map(([t]) => t)), ...rows("Learning", 1, [...LEARNING_MORE.map(([t]) => t), "What it adopts", "Learn overnight on"]),
  ...rows("Working on its own code", 1, ["Pull requests", "Reaching the app", "Build a missing setting when you ask", "Ask for a change"]),
  ["Export a copy without secrets", "A copy of your setup", 0],
  ["Runs as", "How the engine runs", 1], ...rows("How the engine runs", 2, ["Start, stop and status", "Control socket", "Status files", "Process names"]),
  ...rows("How the engine runs", 1, ["Connected now", "People on this engine", "If it freezes", ...RUNS_SWITCHES.map(([t]) => t), "Tasks at once", "Old temporary files", ...RUNS_LATER.map(([t]) => t)]),
  ["Only through allowed actions", "What it may fix by itself", 1], ["Extras on this computer", "Extras fetched when first used", 1],
  ...rows("Your settings", 1, ["Export", "Import", "From a preset address", "Where conversations are stored", "Where files are kept", "Where your data lives", "Put Branch on a USB stick"]),
  ...rows("Settings you can talk to", 1, ["Change settings by talking", "Suggestions made on this computer"]),
  ...rows("Conversation storage", 1, ["Archive older conversations", "Archive after", "Tidy now"]), ...rows("Conversation storage", 2, ["Shrink the shared database", "Conversation databases"]),
  ...rows("Database, technical", 2, ["Check a copied database", "Who writes the database", "Hand writing to a supervisor"]),
].map(([title, sec, lv]) => ({ page: "self", title: String(title), ...(sec ? { sec: String(sec) } : {}), group: ({ "Working on its own code": "What it may change", "What it may fix by itself": "What it may change", "Database, technical": "Database" } as Record<string, string>)[String(sec)] ?? String(sec || "About Branch"), lv: Number(lv) as 0 | 1 | 2 }));

type Ctx = SettingsPageProps & { config: ReturnType<typeof useConfig>; lv: number };

export function SelfPage(props: SettingsPageProps) {
  const ctx: Ctx = { ...props, config: useConfig(props.engine), lv: lvOf(props.level) };
  const lv = ctx.lv;
  return (
    <Page title={props.title} lede={LEDE}>
      <Running {...ctx} />
      <MayChange />
      {lv >= 1 ? <Sec title=""><DesktopCtl title="Type branch in any terminal" sub="Adds the branch command for terminal views and scripts." help="Adds the branch command, so the terminal view and scripts work anywhere." name="branchOnPath" /><DesktopCtl title="Let agents use this window" sub="Connected agents may see and click this window." help="Connected coding agents (Settings › Connected agents) may see and click this window. A bar with Stop shows while one does. Takes effect the next time Branch starts." name="agentControl" /></Sec> : null}
      <NeverDies />
      <Changes {...ctx} />
      <Learning lv={lv} />
      {lv >= 1 ? <OwnCode /> : null}
      <Sec title="A copy of your setup"><Ctl title="Export a copy without secrets" sub="Exports your setup without keys or sign-ins." help="Skills, memory, personas, automations, plugins, settings and theme, with every key and sign-in taken out." off="Needs the engine’s setup export; Your settings › Export saves the settings alone."><Btn sm disabled>Export…</Btn></Ctl></Sec>
      {lv >= 1 ? <HowItRuns {...ctx} /> : null}
      {lv >= 1 ? <Sec title="What it may fix by itself" showHeading={false} group="What it may change"><Ctl title="Only through allowed actions" sub="Restarts parts, reloads settings or reconnects chat apps." help="It can restart a part, reload settings, clear a cache, roll back settings or reconnect a chat app. Anything else asks you." off={NO_SELF}><Switch label="Only through allowed actions" checked={false} onChange={() => undefined} /></Ctl></Sec> : null}
      {lv >= 1 ? <Sec title="Extras fetched when first used"><Ctl title="Extras on this computer" sub="Speech, office files and connector kits fetched on first use." help="Speech, office files and connector kits Branch fetched the first time they were used." off="Needs the engine’s list of fetched extras." /></Sec> : null}
      {lv >= 1 ? <YourSettings {...ctx} /> : null}
      {lv >= 1 ? <TalkTo /> : null}
      {lv >= 1 ? <Storage {...ctx} /> : null}
      {lv >= 2 ? <DatabaseTechnical /> : null}
    </Page>
  );
}

/** Greyed switch rows from a table. */
function OffSwitches({ items }: { items: Off[] }) {
  return <>{items.map(([title, sub, why]) => <Ctl key={title} title={title} sub={sub || undefined} off={why}><Switch label={title} checked={false} onChange={() => undefined} /></Ctl>)}</>;
}

/** The running status and its actions. Reload is this window's own reload; nothing running stops. */
function Running({ engine, lv }: Ctx) {
  const version = useBranchVersion(engine.gatewayUrl);
  const health = useLive<RecordValue>(engine, "health", { probe: false }, ["health"]);
  const sys = rec(useLive<RecordValue>(engine, "system.info", {}, []).data);
  const restart = useCall();
  const [check, setCheck] = useState<"" | "fix" | "only">("");
  const up = span(sys.uptimeMs);
  const facts = lv >= 2 ? [version ? `Branch ${versionParts(version).detail}` : "", sys.pid ? `process ${str(sys.pid)}` : "", rec(sys.processMemory).rssBytes ? bytes(rec(sys.processMemory).rssBytes) : ""].filter(Boolean) : [];
  return (
    <>
      {health.error ? <Status tone="bad" title="The engine isn’t answering">{health.error}</Status>
        : health.data ? <Status title={`Running${up ? ` · up ${up}` : ""}`}>{facts.length ? `${facts.join(" · ")}. ` : ""}The gateway watches the engine and starts it again if it stops.</Status> : null}
      <Acts>
        <Btn onClick={() => setCheck("fix")}><Icon name="check" small />Check and fix</Btn>
        {lv >= 1 ? <Btn ghost onClick={() => setCheck("only")}>Check only</Btn> : null}
        <Btn disabled={restart.busy} onClick={() => void restart.run(() => engine.request<RecordValue>("gateway.restart.request", { reason: "settings" }), () => "Restarting. The window reconnects by itself.")}><Icon name="retry" small />Restart the engine</Btn>
        <Btn ghost onClick={() => window.location.reload()}>Reload without dropping work</Btn>
      </Acts>
      <CallLine call={restart} />
      <Ctl title="Set up the Gateway again" sub="Install or reconfigure the Gateway on this computer." help="Install or reconfigure the Gateway on this computer. Your conversations and settings stay." off="Runs in the Branch app’s setup."><Btn sm>Open setup</Btn></Ctl>
      {check ? <CheckDialog engine={engine} only={check === "only"} onClose={() => setCheck("")} /> : null}
    </>
  );
}

/** Check and fix: the checks the engine answers from here (health with probes, memory), and the doctor command. Check only leaves out --fix. */
function CheckDialog({ engine, only, onClose }: Pick<SettingsPageProps, "engine"> & { only: boolean; onClose: () => void }) {
  // No probes: sending a real request to each account waits for "Check and fix with real calls".
  const health = useLive<RecordValue>(engine, "health", { probe: false }, []);
  const memory = useLive<RecordValue>(engine, "doctor.memory.status", {}, []);
  const h = rec(health.data);
  const channels = Object.entries(rec(h.channels)).map(([id, v]) => [str(rec(h.channelLabels)[id]) || id, rec(v)] as const);
  const embed = rec(rec(memory.data).embedding);
  return (
    <Dialog title={only ? "Check only" : "Check and fix"} wide onClose={onClose}>
      {health.loading && !health.data ? <p>Checking…</p> : null}
      <ol className="s2-tl">
        <li className={health.error ? "bad" : "ok"}><span>The engine<small>{health.error ?? (typeof h.durationMs === "number" ? `Answered in ${h.durationMs} ms` : "Answered")}</small></span></li>
        {channels.map(([name, c]) => <li key={name} className={c.lastError ? "bad" : "ok"}><span>{name}<small>{c.lastError ? str(c.lastError) : c.connected === true ? "Working" : c.configured === false ? "Not set up" : "Not connected"}</small></span></li>)}
        {memory.data ? <li className={embed.ok === false ? "bad" : "ok"}><span>Memory search<small>{embed.ok === false ? str(embed.error) : "Working"}</small></span></li> : null}
      </ol>
      <p className="hint">{only ? "The full check runs on the Gateway’s computer and changes nothing:" : "The full check, with fixes, runs on the Gateway’s computer:"}</p>
      {only ? <CodeRow title="Check everything" code="branch doctor" /> : <CodeRow title="Check and fix everything" code="branch doctor --fix" />}
    </Dialog>
  );
}

function MayChange() {
  return (
    <Sec title="What Branch may change about itself">
      <Ctl title="Its own settings" sub="Full access changes it at once; other modes show you the change first." help="Full access changes it at once; other modes show you the change first. Each change is tried on a throwaway copy." off={NO_SELF}>
        <Seg label="Its own settings" value="mode" onChange={() => undefined} options={[{ id: "mode", label: "Follows the mode" }, { id: "ask", label: "Ask me first" }, { id: "never", label: "Never" }]} />
      </Ctl>
      <Ctl title="Loosening what it may do" sub="May request more access when its current mode allows." help="On: it may loosen what it may do as the mode allows; where the mode asks, it asks every time and the answer is never kept. Off: it never asks." off={NO_SELF}><Switch label="Loosening what it may do" checked={false} onChange={() => undefined} /></Ctl>
      <Ctl title="The gateway’s timings" sub="Full access changes them at once; other modes ask you first." off={NO_SELF}>
        <Seg label="The gateway’s timings" value="mode" onChange={() => undefined} options={[{ id: "mode", label: "Follows the mode" }, { id: "never", label: "Never" }]} />
      </Ctl>
      <Ctl title="Restarting its own engine" sub="Fixes stuck work under the current Access setting." help="When it’s stuck: at once in Full access, after your yes in other modes. Safe steps carry on after." off={NO_SELF}>
        <Seg label="Restarting its own engine" value="mode" onChange={() => undefined} options={[{ id: "mode", label: "Follows the mode" }, { id: "ask", label: "Ask me first" }]} />
      </Ctl>
      <Ctl title="Its own program and your saved work" sub="Program files change only through an update." help="Its program changes only through an update, never by editing its files. This one can’t be switched on."><span className="pill idle">Never, by itself</span></Ctl>
      <Ctl title="Work on its own code in a separate copy" sub="A private copy of Branch’s source." help="A private copy of Branch’s source. The installed app is never touched. Every change asks you first." off={NO_SELF}><Switch label="Work on its own code in a separate copy" checked={false} onChange={() => undefined} /></Ctl>
    </Sec>
  );
}

/** Never dies: what the engine does when it stops or keeps crashing. */
function NeverDies() {
  return (
    <Sec title="Never dies">
      <Kv rows={[
        ["If the engine stops", "The gateway starts it again"],
        ["If it keeps crashing", "After 3 unclean starts in 5 minutes it starts without its chat apps, so it stays up"],
        ["Interrupted work", shownWhy("Needs the engine’s record of interrupted work")],
        ["Last good settings", "Kept automatically"],
      ]} />
    </Sec>
  );
}

/** Every change: the engine's record of changes to its setup (branch.changes.list), newest first. */
function Changes({ engine }: Ctx) {
  const changes = useLive<RecordValue>(engine, "branch.changes.list", { limit: 50 }, ["config"]);
  const entries = list(rec(changes.data).entries);
  return (
    <Sec title="Every change">
      {changes.error ? <p className="hint s2-err" role="alert">{changes.error}</p> : null}
      {changes.data && !entries.length ? <Empty>No changes yet.</Empty> : null}
      {entries.length ? (
        <ol className="s2-tl s2-season">
          {entries.map((e) => (
            <li key={str(e.id)} className={e.invalid === true ? "bad" : "ok"}>
              <span>{[SOURCE[str(e.source)], str(e.summary)].filter(Boolean).join(": ")}<small>{when(e.at)}{Array.isArray(e.changedPaths) && e.changedPaths.length ? ` · ${e.changedPaths.map(String).slice(0, 3).join(", ")}` : ""}</small></span>
              {e.kind === "config-write" ? <span className="acts"><Btn sm ghost disabled title={NO_ROLLBACK}>Roll back</Btn></span> : null}
            </li>
          ))}
        </ol>
      ) : null}
    </Sec>
  );
}

function SubHead({ children }: { children: ReactNode }) {
  return <p className="hint self-subhead">{children}</p>;
}

/** Learning: the preview's loop, greyed until the engine has one. The model choice and the list keep their own kinds. */
function Learning({ lv }: { lv: number }) {
  const [first, ...rest] = LEARNING;
  const [model, idle, ...after] = rest;
  return (
    <Sec title="Learning">
      <OffSwitches items={[first]} />
      <Ctl title={model[0]} sub="A cheaper model keeps the cost down." off={NO_LEARN}><Pick label={model[0]} value="" onChange={() => undefined} options={[{ id: "", label: "Same as the Trunk" }]} /></Ctl>
      <OffSwitches items={[idle, ...after]} />
      <SubHead>What it learned</SubHead>
      {shownWhy(NO_LEARN) ? <div className="rows"><Empty>{shownWhy(NO_LEARN)}</Empty></div> : null}
      {lv >= 1 ? (
        <>
          <OffSwitches items={LEARNING_MORE} />
          <Ctl title="What it adopts" sub="Keeps changes only when tests show an improvement." help="A change is kept only if the tests show it does better, not because a model says so."><Val>Decided by tests</Val></Ctl>
          <Ctl title="Learn overnight on" sub="Never on a paid-per-use key." off={NO_LEARN}>
            <Pick label="Learn overnight on" value="both" onChange={() => undefined} options={[{ id: "local", label: "Models on this computer" }, { id: "plans", label: "Your plans" }, { id: "both", label: "Models on this computer, then your plans" }]} />
          </Ctl>
          <SubHead>Unused, and what each costs</SubHead>
          {shownWhy(COSTS_NOTE) ? <div className="rows"><Empty>{shownWhy(COSTS_NOTE)}</Empty></div> : null}
        </>
      ) : null}
    </Sec>
  );
}

function OwnCode() {
  return (
    <Sec title="Working on its own code" group="What it may change">
      <Ctl title="Pull requests" sub="Proposes draft pull requests with evidence for each change." help="Changes go to branch/… lines as draft pull requests with “Why merge” and evidence; merged only after every check passes on that exact commit."><Val>Drafts, merged after checks</Val></Ctl>
      <Ctl title="Reaching the app" sub="Tests a new build on a copy of your data before keeping it." help="A new build must pass a self-test on a copy of your data; if it doesn’t stay up, it rolls back by itself."><Val>Only through a tested build</Val></Ctl>
      <Ctl title="Build a missing setting when you ask" sub="Proposes a setting when one is missing." help="“There’s no setting for X” becomes a change that adds one, for your review." off={NO_SELF}><Switch label="Build a missing setting when you ask" checked={false} onChange={() => undefined} /></Ctl>
      <Ctl title="Ask for a change" sub="From any conversation or chat app." off="Needs the engine’s /improve command."><Btn sm>/improve</Btn></Ctl>
    </Sec>
  );
}

function HowItRuns({ engine, config, lv }: Ctx) {
  const sys = rec(useLive<RecordValue>(engine, "system.info", {}, []).data);
  const max = config.get("agents.defaults.maxConcurrent");
  return (
    <Sec title="How the engine runs">
      <Ctl title="Runs as" sub="Uses the system’s service manager to stay running." help="The same way on every system: systemd on Linux, launchd on a Mac, a task on Windows." off="Needs the engine to report how it was started." />
      {lv >= 2 ? (
        <>
          <CodeRow title="Start, stop and status" code="branch gateway status --json" sub="Start, stop and restart the Gateway from a terminal." help="Also: branch gateway start, branch gateway stop, branch gateway restart." />
          <Ctl title="Control socket" sub="Only programs on this computer can use it." off="Needs the engine to report its control socket." />
          <Ctl title="Status files" sub="Other programs read these to tell whether Branch runs." off="Needs the engine to report its status files." />
          <Ctl title="Process names" sub="How they show in Task Manager and ps."><Val code>{sys.pid ? `node · process ${str(sys.pid)}` : ""}</Val></Ctl>
        </>
      ) : null}
      <Connected engine={engine} />
      <Ctl title="If it freezes" sub="A watchdog notices a frozen or stuck engine." help="A watchdog outside the engine notices a stuck start, a frozen loop or a hung shutdown." off="Needs the engine’s outside watchdog." />
      <OffSwitches items={RUNS_SWITCHES} />
      <Ctl title="Tasks at once" sub="Branch adds no cap of its own; a service’s own limits still apply."><Val>{typeof max === "number" ? `Up to ${max}` : "As many as this computer allows"}</Val></Ctl>
      <Ctl title="Old temporary files" sub="Downloads, logs and caches past this are cleared in a quiet moment." off={NO_SETTING}>
        <Pick label="Old temporary files" value="7" onChange={() => undefined} options={[{ id: "7", label: "7 days" }, { id: "30", label: "30 days" }, { id: "never", label: "Until I clear them" }]} />
      </Ctl>
      <OffSwitches items={RUNS_LATER} />
    </Sec>
  );
}

function clientName(p: RecordValue): string {
  return str(p.host) || str(rec(p.user).name) || str(p.mode) || str(p.clientId) || "A client";
}

/** Connected now (system-presence) and the people the engine serves (users.list). */
function Connected({ engine }: Pick<SettingsPageProps, "engine">) {
  const presence = useLive<unknown>(engine, "system-presence", {}, ["presence"]);
  const users = useLive<RecordValue>(engine, "users.list", {}, []);
  const [open, setOpen] = useState(false);
  const clients = list(presence.data);
  const people = list(rec(users.data).profiles).filter((p) => !p.mergedInto).map((p) => str(p.displayName)).filter(Boolean);
  const names = [...new Set(clients.map(clientName))];
  return (
    <>
      <Ctl title="Connected now" sub={clients.length ? `${clients.length} on one engine: ${names.join(", ")}.` : "Windows, terminals, phones and chat apps on this engine."}><Btn sm disabled={!presence.data} onClick={() => setOpen(true)}>See them</Btn></Ctl>
      <Ctl title="People on this engine" sub="One engine serves all profiles independently." help="One engine serves everyone’s profile; each starts and stops on its own."><Val>{people.join(", ")}</Val></Ctl>
      {open ? (
        <Dialog title="Connected now" onClose={() => setOpen(false)}>
          {clients.length ? <div className="rows">{clients.map((p, i) => <div className="prow" key={str(p.connectionId) || i}><span className="grow"><b>{clientName(p)}</b><small>{[str(p.platform), str(p.version), p.lastInputSeconds !== undefined ? `active ${span(Number(p.lastInputSeconds) * 1000) || "now"} ago` : ""].filter(Boolean).join(" · ")}</small></span></div>)}</div> : <p className="hint">Nothing else is connected.</p>}
        </Dialog>
      ) : null}
    </>
  );
}

/** Your settings: export every setting as a file (keys stay hidden by the engine), import shows each change first. */
function YourSettings({ engine, config }: Ctx) {
  const [incoming, setIncoming] = useState<{ name: string; raw: string } | null>(null);
  const sys = rec(useLive<RecordValue>(engine, "system.info", {}, []).data);
  const exportFile = () => {
    const blob = new Blob([JSON.stringify(config.cfg, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "branch-settings.json";
    a.click();
    URL.revokeObjectURL(a.href);
  };
  return (
    <Sec title="Your settings">
      <Ctl title="Export" sub="Every setting as one file. Keys and passwords are left out."><Btn sm disabled={config.loading} onClick={exportFile}>Export</Btn></Ctl>
      <Ctl title="Import" sub="Shows each change before anything is applied.">
        <label className="btn sm s2-file">Choose a file<input type="file" accept=".json,application/json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void f.text().then((raw) => setIncoming({ name: f.name, raw })); }} /></label>
      </Ctl>
      <Ctl title="From a preset address" sub="A preset can update itself each time Branch starts." off="Fetching a preset from the web needs the Branch app."><input className="inp" aria-label="Preset address" placeholder="https://…/branch-preset.json" disabled /><Btn sm disabled>Fetch</Btn></Ctl>
      <Ctl title="Where conversations are stored" sub="PostgreSQL for a shared server. Changing it copies them across." off="Needs the engine’s PostgreSQL store.">
        <Pick label="Where conversations are stored" value="local" onChange={() => undefined} options={[{ id: "local", label: "This computer" }, { id: "pg", label: "PostgreSQL" }]} />
      </Ctl>
      <Ctl title="Where files are kept" sub="Attachments and what Trunks make." off="Needs the engine to keep files somewhere else.">
        <Pick label="Where files are kept" value="local" onChange={() => undefined} options={[{ id: "local", label: "This computer" }, { id: "s3", label: "Amazon S3" }, { id: "gcs", label: "Google Cloud Storage" }, { id: "azure", label: "Azure Blob" }]} />
      </Ctl>
      <Ctl title="Where your data lives" sub="Moves conversations, memory and settings together." help="Moves conversations, memory and settings together. Portable mode (Developer) keeps them beside the program.">
        {str(sys.diskPath) ? <code className="s2-code">{str(sys.diskPath)}</code> : null}<Btn sm disabled title={APP}>Move…</Btn>
      </Ctl>
      <Ctl title="Put Branch on a USB stick" sub="Runs on Mac, Windows or Linux from the stick." off="Writing a copy to a USB stick needs the Branch app."><Btn sm disabled>Make one</Btn></Ctl>
      {incoming ? <ImportDialog engine={engine} config={config} file={incoming} onClose={() => setIncoming(null)} /> : null}
    </Sec>
  );
}

function flat(value: unknown, path = ""): [string, string][] {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return [[path, JSON.stringify(value)]];
  return Object.entries(value as RecordValue).flatMap(([k, v]) => flat(v, path ? `${path}.${k}` : k));
}

/** Import: every top-level key that differs is listed; applying patches only those keys against the loaded revision. */
function ImportDialog({ config, file, onClose }: Pick<SettingsPageProps, "engine"> & { config: ReturnType<typeof useConfig>; file: { name: string; raw: string }; onClose: () => void }) {
  const call = useCall();
  let parsed: RecordValue | null = null;
  try { parsed = rec(JSON.parse(file.raw)); } catch (e) { parsed = null; void e; }
  const now = new Map(flat(config.cfg));
  const diff = parsed ? flat(parsed).filter(([p, v]) => now.get(p) !== v && !v.includes("__BRANCH_REDACTED__")) : [];
  const apply = () => void call.run(async () => {
    for (const [p, v] of diff) { const ok = await config.set(p, JSON.parse(v)); if (!ok) throw new Error(`The engine didn’t take ${p}. See the line at the top.`); }
    onClose();
  });
  return (
    <Dialog title={`Import ${file.name}`} wide onClose={onClose} footer={<><Btn ghost onClick={onClose}>Cancel</Btn><Btn pri disabled={!diff.length || call.busy} onClick={apply}>Apply {diff.length} {diff.length === 1 ? "change" : "changes"}</Btn></>}>
      {!parsed ? <p className="s2-err">This file isn’t a settings file.</p> : !diff.length ? <p>Nothing in it differs from your settings.</p> : (
        <div className="rows">{diff.map(([p, v]) => <div className="prow" key={p}><span className="grow"><b><code>{p}</code></b><small>{now.has(p) ? `${now.get(p)} → ${v}` : `new: ${v}`}</small></span></div>)}</div>
      )}
      <CallLine call={call} />
    </Dialog>
  );
}

function TalkTo() {
  return (
    <Sec title="Settings you can talk to">
      <Ctl title="Change settings by talking" sub="Ask Branch to explain or change a Trunk’s Access." help="Ask “why does a Trunk ask before every email?” or “let it book without asking” in any conversation." off="Needs the engine’s settings tool for conversations."><Btn sm>Show an example</Btn></Ctl>
      <Ctl title="Suggestions made on this computer" sub="Suggests small improvements without a model call." help="Small suggestions from what you do, worked out here without asking a model." off="Needs the engine’s suggestions from what you do."><Btn sm>See them</Btn></Ctl>
    </Sec>
  );
}

/** Conversation storage: sessions.storage.status, cold storage in session.maintenance.coldStorage, Tidy now on sessions.storage.run. */
function Storage({ engine, config, lv }: Ctx) {
  const status = useLive<RecordValue>(engine, "sessions.storage.status", {}, []);
  const run = useCall();
  const [byTrunk, setByTrunk] = useState(false);
  const s = rec(status.data);
  const agents = list(s.agents);
  const sum = (k: string) => agents.reduce((n, a) => n + (Number(a[k]) || 0), 0);
  const m = rec(s.maintenance);
  const on = config.get("session.maintenance.coldStorage.enabled") === true;
  const after = config.get("session.maintenance.coldStorage.afterDays");
  const tidy = m.running === true ? "Running" : <>Idle<small className="self-kvsub">{m.lastCompletedAt ? `Last ran ${when(m.lastCompletedAt)}.` : "Not run since the Gateway started."}</small></>;
  return (
    <Sec title="Conversation storage">
      {status.error ? <p className="hint s2-err">{status.error}</p> : null}
      {status.data ? <Kv rows={[["Conversations", `${sum("hotTranscripts")} ready · ${sum("coldTranscripts")} archived`], ["Databases", `${bytes(sum("databaseBytes"))} · write-ahead logs ${bytes(sum("walBytes"))}`], ["Archive files", bytes(sum("archiveBytes"))], ["By Trunk", agents.length ? <button type="button" className="link-k" onClick={() => setByTrunk(true)}>See all</button> : ""], ["Background tidy", tidy], ["Last problem", str(m.lastError)]]} /> : null}
      <Ctl title="Archive older conversations" sub="Moves inactive conversations into compressed files." help="Moves inactive conversations into compressed files. Off until you choose: the archive files must then be in every backup.">
        <Switch label="Archive older conversations" checked={on} disabled={config.loading} onChange={(v) => void config.set("session.maintenance.coldStorage.enabled", v)} />
      </Ctl>
      <Ctl title="Archive after" sub="Since the conversation last changed."><Num label="Archive after" unit="days" value={typeof after === "number" ? after : undefined} min={1} onCommit={(v) => void config.set("session.maintenance.coldStorage.afterDays", v)} /></Ctl>
      <Ctl title="Tidy now" sub={on ? run.note ?? run.error ?? "Archives what’s due now." : "Turns on with “Archive older conversations”."}>
        <Btn sm disabled={!on || run.busy} onClick={() => void run.run(() => engine.request("sessions.storage.run", {}), () => { void status.reload(); return "Tidying. The figures above update when it’s done."; })}>Run now</Btn>
      </Ctl>
      {lv >= 2 ? <CodeRow title="Shrink the shared database" code="branch doctor --state-sqlite compact" sub="Shrinks the database after a checked backup." help="Shrinks the shared database after a checked backup. It refuses while Branch is running." /> : null}
      {lv >= 2 ? <CodeRow title="Conversation databases" code="branch doctor --session-sqlite inspect|dry-run|import|compact|recover|restore" sub="Look at, move, shrink or recover conversation databases." /> : null}
      {byTrunk ? <ByTrunkDialog agents={agents} onClose={() => setByTrunk(false)} /> : null}
    </Sec>
  );
}

function ByTrunkDialog({ agents, onClose }: { agents: RecordValue[]; onClose: () => void }) {
  return (
    <Dialog title="Conversation storage by Trunk" onClose={onClose}>
      <div className="rows">{agents.map((a) => <div className="prow" key={str(a.agentId)}><span className="grow"><b>{str(a.agentId)}</b><small>{`${str(a.hotTranscripts) || "0"} ready · ${str(a.coldTranscripts) || "0"} archived · ${bytes(Number(a.databaseBytes) || 0)}`}</small></span></div>)}</div>
    </Dialog>
  );
}

function DatabaseTechnical() {
  return (
    <Sec title="Database, technical" group="Database">
      <CodeRow title="Check a copied database" code="branch database preflight <file>" sub="Says whether a copied database fits this version." />
      <CodeRow title="Who writes the database" code="branch database ownership status" />
      <CodeRow title="Hand writing to a supervisor" code="branch database ownership claim" sub="For a service manager that runs the Gateway." />
    </Sec>
  );
}
