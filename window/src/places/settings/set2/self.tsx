// Settings › Branch itself (DESIGN-SPEC §4.7.16): how it runs (health, system.info), restarting the engine
// (gateway.restart.request), every change to its setup (branch.changes.list), conversation storage
// (sessions.storage.* and session.maintenance.coldStorage.*) and the settings file. What Branch may change about
// itself and the learning loop need engine settings that don't exist yet, so those rows say so.
import { useState } from "react";
import type { SettingsPageProps } from "../index";
import { Acts, Btn, Ctl, Empty, Num, Page, Pick, Sec, Seg, Status, Switch, Val, useConfig, type RowEntry } from "../kit";
import { list } from "../adapter";
import { Dialog } from "../../../shell/Dialog";
import { CallLine, CodeRow, Kv, bytes, lvOf, rec, span, str, useCall, useLive, when, type RecordValue } from "./common";
import { Icon } from "../../../shell/icons";

const LEDE = "What Branch may change about itself, how it stays running, and every change it made, each one reversible.";
const NO_SELF = "Needs the engine’s self-change policy.";
const NO_LEARN = "Needs the engine’s learning loop.";
const NO_ROLLBACK = "Rolling back a change needs the engine’s roll back.";
const SOURCE: Record<string, string> = { "system-agent": "Branch", doctor: "Check and fix", "config-rpc": "Settings", cli: "The terminal", "plugin-install": "A plugin install", external: "Edited outside Branch", unknown: "" };

const LEARNING: [string, string][] = [
  ["Look back after each task", "A short review saves what to remember and which skills to improve."],
  ["Tell me what it learned", "A short line after each review."],
  ["Fix a skill as soon as it’s found wrong", "A small, exact change, in the same task."],
  ["Learn from your reactions and corrections", ""],
  ["Think again after a thumbs-down", "Saves what to do differently."],
  ["Remember what worked", "What was tried, how it went and the lesson, for similar tasks."],
  ["Turn repeated instructions into rules", "When you say the same thing three times, it offers a rule, then checks it helped."],
  ["Make a rule from a mistake", "Say what went wrong; it becomes a rule that warns or stops it next time."],
  ["A Trunk may edit its own persona", "Each change is listed below and can be undone."],
  ["Compare two models blind", "Now and then, two models answer and you pick one without knowing which."],
  ["Turn a run that worked into a script", "Next time the script runs; the model steps in only where it fails."],
  ["Learn from a recording of you doing it", "A screen recording becomes a plan it can follow."],
  ["Ideas for you", "A feed of ideas drawn from your history, with its own prompt."],
  ["Write like me", "Learns how you write, from what you send."],
  ["Learn from your other coding assistants", "Reads their history on this computer, finds repeated failures and fixes the instruction files."],
  ["Coaching on your prompts", "Tips on prompts and sessions, from rules you can read."],
  ["Notice when it changes how it works", "Flags when the same kind of task is suddenly done differently."],
  ["Learn from the team’s runs", "Repeated steps across the team become skills after a check."],
  ["Tune how memory is searched", "A new way of searching is kept only if replaying past questions shows it does better."],
  ["Make tests from runs you approved", "Approved runs, with private details taken out, become test cases."],
  ["Teach the model on this computer from your feedback", "For a model on this computer only."],
  ["A tester that uses Branch like you", "On a separate copy: it never deletes, sends, spends or changes safety settings."],
];

export const ROWS: RowEntry[] = [
  ["Set up the Gateway again", "", 1], ["Its own settings", "What Branch may change about itself", 0], ["Loosening what it may do", "What Branch may change about itself", 0],
  ["The gateway’s timings", "What Branch may change about itself", 0], ["Restarting its own engine", "What Branch may change about itself", 0], ["Updating itself", "What Branch may change about itself", 0],
  ["Its own program and your saved work", "What Branch may change about itself", 0], ["Work on its own code in a separate copy", "What Branch may change about itself", 0],
  ["Type branch in any terminal", "", 1], ...LEARNING.map(([t]) => [t, "Learning", 1] as [string, string, number]),
  ["Export a copy without secrets", "A copy of your setup", 1], ["Start, stop and status", "How the engine runs", 1], ["Tasks at once", "How the engine runs", 1],
  ["Only through allowed actions", "What it may fix by itself", 1], ["Change settings by talking", "Settings you can talk to", 1], ["Export", "Your settings", 1], ["Import", "Your settings", 1], ["Archive older conversations", "Conversation storage", 1], ["Archive after", "Conversation storage", 1], ["Tidy now", "Conversation storage", 1],
].map(([title, sec, lv]) => ({ page: "self", title: String(title), ...(sec ? { sec: String(sec) } : {}), lv: Number(lv) as 0 | 1 | 2 }));

type Ctx = SettingsPageProps & { config: ReturnType<typeof useConfig>; lv: number };

export function SelfPage(props: SettingsPageProps) {
  const ctx: Ctx = { ...props, config: useConfig(props.engine), lv: lvOf(props.level) };
  return (
    <Page title={props.title} lede={LEDE}>
      <Running {...ctx} />
      <MayChange {...ctx} />
      {ctx.lv >= 1 ? <Sec title="In any terminal"><Ctl title="Type branch in any terminal" sub="Adds the branch command, so the terminal view and scripts work anywhere." off="The Branch app’s installer adds it." ><Switch label="Type branch in any terminal" checked={false} onChange={() => undefined} /></Ctl></Sec> : null}
      <Changes {...ctx} />
      {ctx.lv >= 1 ? <Learning /> : null}
      {ctx.lv >= 1 ? <OwnCode /> : null}
      {ctx.lv >= 1 ? <Sec title="A copy of your setup"><Ctl title="Export a copy without secrets" sub="Skills, memory, personas, routines, plugins, settings and theme, with every key and sign-in taken out." off="Needs the engine’s setup export; Your settings › Export saves the settings alone."><Btn sm>Export…</Btn></Ctl></Sec> : null}
      {ctx.lv >= 1 ? <HowItRuns {...ctx} /> : null}
      {ctx.lv >= 1 ? <Sec title="What it may fix by itself"><Ctl title="Only through allowed actions" sub="It can restart a part, reload settings, clear a cache, roll back settings or reconnect a chat app. Anything else asks you." off={NO_SELF}><Switch label="Only through allowed actions" checked onChange={() => undefined} /></Ctl></Sec> : null}
      {ctx.lv >= 1 ? <Sec title="Extras fetched when first used"><Ctl title="Extras on this computer" sub="Speech, office files and connector kits Branch fetched the first time they were used." off="Needs the engine’s list of fetched extras." /></Sec> : null}
      {ctx.lv >= 1 ? <YourSettings {...ctx} /> : null}
      {ctx.lv >= 1 ? <Sec title="Settings you can talk to"><Ctl title="Change settings by talking" sub="Ask “why does a Trunk ask before every email?” or “let it book without asking” in any conversation." off="Needs the engine’s settings tool for conversations."><Btn sm>Show an example</Btn></Ctl></Sec> : null}
      {ctx.lv >= 1 ? <Storage {...ctx} /> : null}
      {ctx.lv >= 2 ? <DatabaseTechnical /> : null}
    </Page>
  );
}

/** The running status and the four actions. Reload is this window's own reload; nothing running stops. */
function Running({ engine, lv }: Ctx) {
  const health = useLive<RecordValue>(engine, "health", { probe: false }, ["health"]);
  const sys = useLive<RecordValue>(engine, "system.info", {}, []);
  const restart = useCall();
  const [check, setCheck] = useState(false);
  const up = span(rec(sys.data).uptimeMs);
  return (
    <>
      {health.error ? <Status tone="bad" title="The engine isn’t answering">{health.error}</Status>
        : health.data ? <Status title={`Running${up ? ` · up ${up}` : ""}`}>The gateway watches the engine and starts it again if it stops.</Status> : null}
      <Acts>
        <Btn onClick={() => setCheck(true)}><Icon name="check" small />Check and fix</Btn>
        <Btn disabled={restart.busy} onClick={() => void restart.run(() => engine.request<RecordValue>("gateway.restart.request", { reason: "settings" }), () => "Restarting. The window reconnects by itself.")}><Icon name="retry" small />Restart the engine</Btn>
        <Btn ghost onClick={() => window.location.reload()}>Reload without dropping work</Btn>
      </Acts>
      <CallLine call={restart} />
      {lv >= 1 ? <Ctl title="Set up the Gateway again" sub="Install or reconfigure the Gateway on this computer. Your conversations and settings stay." off="Runs in the Branch app’s setup."><Btn sm>Open setup</Btn></Ctl> : null}
      {check ? <CheckDialog engine={engine} onClose={() => setCheck(false)} /> : null}
    </>
  );
}

/** Check and fix: the checks the engine answers from here (health with probes, memory), and the full doctor command. */
function CheckDialog({ engine, onClose }: Pick<SettingsPageProps, "engine"> & { onClose: () => void }) {
  const health = useLive<RecordValue>(engine, "health", { probe: true }, []);
  const memory = useLive<RecordValue>(engine, "doctor.memory.status", {}, []);
  const h = rec(health.data);
  const channels = Object.entries(rec(h.channels)).map(([id, v]) => [str(rec(h.channelLabels)[id]) || id, rec(v)] as const);
  const embed = rec(rec(memory.data).embedding);
  return (
    <Dialog title="Check and fix" wide onClose={onClose} footer={<Btn onClick={onClose}>Close</Btn>}>
      {health.loading && !health.data ? <p>Checking…</p> : null}
      <ol className="s2-tl">
        <li className={health.error ? "bad" : "ok"}><span>The engine<small>{health.error ?? (typeof h.durationMs === "number" ? `Answered in ${h.durationMs} ms` : "Answered")}</small></span></li>
        {channels.map(([name, c]) => <li key={name} className={c.lastError ? "bad" : "ok"}><span>{name}<small>{c.lastError ? str(c.lastError) : c.connected === true ? "Working" : c.configured === false ? "Not set up" : "Not connected"}</small></span></li>)}
        {memory.data ? <li className={embed.ok === false ? "bad" : "ok"}><span>Memory search<small>{embed.ok === false ? str(embed.error) : "Working"}</small></span></li> : null}
      </ol>
      <p className="hint">The full check, with fixes, runs on the Gateway’s computer:</p>
      <CodeRow title="Check and fix everything" code="branch doctor --fix" />
    </Dialog>
  );
}

function MayChange({ lv }: Ctx) {
  return (
    <Sec title="What Branch may change about itself">
      <Ctl title="Its own settings" sub="Full access changes it at once; other modes show you the change first. Each change is tried on a throwaway copy." off={NO_SELF}>
        <Seg label="Its own settings" value="mode" onChange={() => undefined} options={[{ id: "mode", label: "Follows the mode" }, { id: "ask", label: "Ask me first" }, { id: "never", label: "Never" }]} />
      </Ctl>
      {lv >= 1 ? <Ctl title="Loosening what it may do" sub="On: it may loosen what it may do as the mode allows; where the mode asks, it asks every time and the answer is never kept. Off: it never asks." off={NO_SELF}><Switch label="Loosening what it may do" checked onChange={() => undefined} /></Ctl> : null}
      <Ctl title="The gateway’s timings" sub="Full access changes them at once; other modes ask you first." off={NO_SELF}>
        <Seg label="The gateway’s timings" value="mode" onChange={() => undefined} options={[{ id: "mode", label: "Follows the mode" }, { id: "never", label: "Never" }]} />
      </Ctl>
      <Ctl title="Restarting its own engine" sub="When it’s stuck: at once in Full access, after your yes in other modes. Safe steps carry on after." off={NO_SELF}>
        <Seg label="Restarting its own engine" value="mode" onChange={() => undefined} options={[{ id: "mode", label: "Follows the mode" }, { id: "ask", label: "Ask me first" }]} />
      </Ctl>
      <Ctl title="Updating itself" sub="With a safety copy. Running work gets until the update deadline." off="Set in Updates & about (Keep Branch up to date by itself).">
        <Seg label="Updating itself" value="ask" onChange={() => undefined} options={[{ id: "allowed", label: "Allowed" }, { id: "ask", label: "Ask me first" }, { id: "never", label: "Never" }]} />
      </Ctl>
      <Ctl title="Its own program and your saved work" sub="Its program changes only through an update, never by editing its files. This one can’t be switched on."><span className="pill idle"><i />Never, by itself</span></Ctl>
      <Ctl title="Work on its own code in a separate copy" sub="A private copy of Branch’s source. The installed app is never touched. Every change asks you first." off={NO_SELF}><Switch label="Work on its own code in a separate copy" checked={false} onChange={() => undefined} /></Ctl>
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

function Learning() {
  return (
    <Sec title="Learning">
      {LEARNING.map(([title, sub]) => <Ctl key={title} title={title} sub={sub || undefined} off={NO_LEARN}><Switch label={title} checked={false} onChange={() => undefined} /></Ctl>)}
      <Ctl title="Model for looking back" sub="A cheaper model keeps the cost down." off={NO_LEARN}><Pick label="Model for looking back" value="" onChange={() => undefined} options={[{ id: "", label: "Same as the Trunk" }]} /></Ctl>
      <Ctl title="What it adopts" sub="A change is kept only if the tests show it does better, not because a model says so."><Val>Decided by tests</Val></Ctl>
    </Sec>
  );
}

function OwnCode() {
  return (
    <Sec title="Working on its own code">
      <Ctl title="Pull requests" sub="Changes go to branch/… lines as draft pull requests with “Why merge” and evidence; merged only after every check passes on that exact commit."><Val>Drafts, merged after checks</Val></Ctl>
      <Ctl title="Build a missing setting when you ask" sub="“There’s no setting for X” becomes a change that adds one, for your review." off={NO_SELF}><Switch label="Build a missing setting when you ask" checked={false} onChange={() => undefined} /></Ctl>
    </Sec>
  );
}

function HowItRuns({ engine, config }: Ctx) {
  const sys = useLive<RecordValue>(engine, "system.info", {}, []);
  const s = rec(sys.data);
  const max = config.get("agents.defaults.maxConcurrent");
  return (
    <Sec title="How the engine runs">
      <CodeRow title="Start, stop and status" code="branch gateway status --json" sub="Also: branch gateway start, branch gateway stop, branch gateway restart." />
      <Ctl title="Process" sub="How it shows in Task Manager and ps."><Val code>{s.pid ? `node · process ${str(s.pid)}` : ""}</Val></Ctl>
      <Ctl title="Tasks at once" sub="Branch adds no cap of its own; a service’s own limits still apply.">
        <Num label="Tasks at once" value={typeof max === "number" ? max : undefined} placeholder="As many as allowed" min={1} onCommit={(v) => void config.set("agents.defaults.maxConcurrent", v)} />
      </Ctl>
    </Sec>
  );
}

/** Your settings: export every setting as a file (keys stay hidden by the engine), import shows each change first. */
function YourSettings({ engine, config }: Ctx) {
  const [incoming, setIncoming] = useState<{ name: string; raw: string } | null>(null);
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
        <label className="btn sm s2-file">Choose a file<input type="file" accept=".json,application/json" onChange={(e) => { const f = e.target.files?.[0]; if (f) void f.text().then((raw) => setIncoming({ name: f.name, raw })); }} /></label>
      </Ctl>
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

/** Conversation storage: sessions.storage.status, cold storage in session.maintenance.coldStorage, Tidy now on sessions.storage.run. */
function Storage({ engine, config }: Ctx) {
  const status = useLive<RecordValue>(engine, "sessions.storage.status", {}, []);
  const run = useCall();
  const s = rec(status.data);
  const agents = list(s.agents);
  const sum = (k: string) => agents.reduce((n, a) => n + (Number(a[k]) || 0), 0);
  const m = rec(s.maintenance);
  const on = config.get("session.maintenance.coldStorage.enabled") === true;
  const after = config.get("session.maintenance.coldStorage.afterDays");
  return (
    <Sec title="Conversation storage">
      {status.error ? <p className="hint s2-err">{status.error}</p> : null}
      {status.data ? <Kv rows={[["Conversations", `${sum("hotTranscripts")} ready · ${sum("coldTranscripts")} archived`], ["Databases", `${bytes(sum("databaseBytes"))} · write-ahead logs ${bytes(sum("walBytes"))}`], ["Archive files", bytes(sum("archiveBytes"))], ["Background tidy", m.running === true ? "Running" : m.lastCompletedAt ? `Idle · last ran ${when(m.lastCompletedAt)}` : "Idle · not run since the Gateway started"], ["Last problem", str(m.lastError)]]} /> : null}
      <Ctl title="Archive older conversations" sub="Moves inactive conversations into compressed files. Off until you choose: the archive files must then be in every backup.">
        <Switch label="Archive older conversations" checked={on} disabled={config.loading} onChange={(v) => void config.set("session.maintenance.coldStorage.enabled", v)} />
      </Ctl>
      <Ctl title="Archive after" sub="Since the conversation last changed."><Num label="Archive after" unit="days" value={typeof after === "number" ? after : undefined} min={1} disabled={!on} onCommit={(v) => void config.set("session.maintenance.coldStorage.afterDays", v)} /></Ctl>
      <Ctl title="Tidy now" sub={on ? run.note ?? run.error ?? "Archives what’s due now." : "Turns on with “Archive older conversations”."}>
        <Btn sm disabled={!on || run.busy} onClick={() => void run.run(() => engine.request("sessions.storage.run", {}), () => { void status.reload(); return "Tidying. The figures above update when it’s done."; })}>Run now</Btn>
      </Ctl>
      <CodeRow title="Shrink the shared database" code="branch doctor --state-sqlite compact" sub="Shrinks the shared database. Stop the Gateway and make a checked backup first; it refuses while the Gateway runs." />
      <CodeRow title="Conversation databases" code="branch doctor --session-sqlite inspect|dry-run|import|compact|recover|restore" sub="Look at, move, shrink or recover conversation databases." />
    </Sec>
  );
}

function DatabaseTechnical() {
  return (
    <Sec title="Database, technical">
      <CodeRow title="Check a copied database" code="branch database preflight <file>" sub="Says whether a copied database fits this version." />
      <CodeRow title="Who writes the database" code="branch database ownership status" />
      <CodeRow title="Hand writing to a supervisor" code="branch database ownership claim" sub="For a service manager that runs the Gateway." />
    </Sec>
  );
}
