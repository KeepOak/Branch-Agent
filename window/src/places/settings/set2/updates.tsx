// Settings › Updates & about (DESIGN-SPEC §4.7.17): the waiting version, installing it on update.run (waiting for
// running tasks, or stopping them first), the update schedule in config `update.*`, history from update.runs.*,
// failure reports through update.report, and the parts that only the Branch app can do, greyed with why.
// TODO(engine-lane): the greyed reasons in this file say what is still missing; shownWhy (shell/shown-why.ts) keeps them out of sight.
import { useEffect, useState } from "react";
import type { SettingsPageProps } from "../index";
import { Acts, Btn, Ctl, Empty, Hint, Page, Pill, Plist, Prow, Sec, Seg, Status, Switch, useConfig, type RowEntry } from "../kit";
import { list } from "../adapter";
import { Dialog } from "../../../shell/Dialog";
import { CallLine, CodeRow, Kv, Tile, day, lvOf, openPlace, rec, str, useCall, useLive, when, type RecordValue } from "./common";
import { Ico } from "./icons";
import { componentDesktop } from "../../../connect/desktop-component-updates";
import { DesktopUpdatesPage } from "./desktop-updates";
import { useBranchVersion, versionParts } from "../../../connect/branch-version";
import { KeeperMark } from "../../../brand/KeeperMark";
import "./updates.css";

const UPDATE_EVENTS = ["update"];
const OS: Record<string, string> = { win32: "Windows", darwin: "macOS", linux: "Linux" };
const APP_ONLY = "Runs in the Branch app on your computer.";
const STORE_WHY = "Opens the store in your browser, from the Branch app.";
const APK_WHY = "Downloads run in the Branch app on your computer.";
const NO_SKIP = "Skipping a version needs the engine to keep a skip list.";
const NO_UNDO = "Undoing an update needs the engine's roll back.";
const NO_DEADLINE = "The engine’s wait is fixed at 15 minutes; changing it needs an engine setting.";
const PHASE: Record<string, string> = {
  requested: "Getting ready", staging: "Downloading", validating: "Checking it", repairing: "Repairing",
  activating: "Installing", restarting: "Restarting", verifying: "Checking settings and data", finished: "Finished",
};
const STEP_PILL: Record<string, "ok" | "bad" | "idle" | "work" | "warn"> = { succeeded: "ok", failed: "bad", "rolled-back": "warn", skipped: "idle", running: "work" };
const STATUS_WORD: Record<string, string> = { succeeded: "Installed", failed: "Failed", "rolled-back": "Put back", skipped: "Skipped", running: "Running" };
const TRIGGER: Record<string, string> = { chat: "From a chat", "control-ui": "You", cli: "From a terminal", campaign: "By itself", "mac-app": "From the Mac app", api: "From a program" };

export const ROWS: RowEntry[] = [
  ["Install updates", "Updating", 0], ["Check for updates", "Updating", 0], ["Which updates", "Updating", 0],
  ["If tasks are still running after", "Updating", 1], ["Undo the last update", "Updating", 0],
  ["Already have the app?", "Branch on your other devices", 0], ["Add more to Branch", "Branch on your other devices", 0], ["Open-source licences", "About", 0],
  ["Keep my conversations and settings", "Remove Branch", 0], ["Type Branch to confirm", "Remove Branch", 0],
  ["Send crash and update reports to KeepOak", "Reports", 0], ["What was sent", "Reports", 0],
  ["See the plan", "Before you install", 0], ["Window fixes without reinstalling", "Before you install", 0], ["Window changes", "Before you install", 0],
  ["Update work stays out of the way", "Before you install", 0], ["Privacy notice", "Privacy", 0],
  ["VS Code", "In your editors and notes", 1], ["JetBrains", "In your editors and notes", 1], ["Emacs", "In your editors and notes", 1], ["Obsidian", "In your editors and notes", 1],
  ["Folders to keep in sync", "In your editors and notes", 1], ["Search with Branch from your browser", "In your editors and notes", 1], ["Install from a terminal", "In your editors and notes", 1],
  ["The handbook", "Help and updates, more", 1], ["If an update fails", "Help and updates, more", 1],
  ["Update history", "Help and updates, more", 1], ["The engine", "Help and updates, more", 1],
  ["Update status for scripts", "Help and updates, more", 2],
].map(([title, sec, lv]) => ({ page: "updates", title: String(title), sec: String(sec), group: ({ "In your editors and notes": "Branch on your other devices", "Help and updates, more": "Updating", Technical: "Updating" } as Record<string, string>)[String(sec)] ?? String(sec), lv: lv as 0 | 1 | 2 }));

type Data = { status: RecordValue; info: RecordValue; sys: RecordValue; reload: () => void };

export function UpdatesPage(props: SettingsPageProps) {
  return componentDesktop(props.engine.gatewayUrl) ? <DesktopUpdatesPage {...props} /> : <GatewayUpdatesPage {...props} />;
}

function GatewayUpdatesPage(props: SettingsPageProps) {
  const status = useLive<RecordValue>(props.engine, "update.status", {}, UPDATE_EVENTS);
  const info = useLive<RecordValue>(props.engine, "status", {}, []);
  const sys = useLive<RecordValue>(props.engine, "system.info", {}, []);
  const version = useBranchVersion(props.engine.gatewayUrl);
  const os = OS[str(rec(sys.data).platform)] ?? str(rec(sys.data).osLabel);
  const lede = version ? `Branch ${versionParts(version).short}${os ? ` on ${os}` : ""}.` : props.title;
  const data: Data = { status: rec(status.data), info: rec(info.data), sys: rec(sys.data), reload: () => void status.reload() };
  return (
    <Page title={props.title} lede={lede}>
      {status.error ? <Status tone="bad" title="Branch couldn’t read its update status">{status.error}</Status> : null}
      {status.loading && !status.data ? <Hint>Checking for updates…</Hint> : null}
      {status.data ? <Waiting {...props} data={data} version={version} /> : null}
      {status.data ? <Updating {...props} data={data} /> : null}
      <Devices lv={lvOf(props.level)} />
      <About />
      <RemoveBranch />
      <Reports />
      <BeforeInstall />
      {lvOf(props.level) >= 1 ? <Editors gatewayUrl={props.engine.gatewayUrl} /> : null}
      <Privacy openSettings={props.openSettings} />
      {lvOf(props.level) >= 1 ? <HelpMore {...props} data={data} version={version} /> : null}
      {lvOf(props.level) >= 2 ? <Technical data={data} version={version} /> : null}
    </Page>
  );
}

/** The waiting version: its status box, Install, What's new and Skip; an active run's step; a failed run's report. */
/** The line for an update the engine started by itself (schedule.campaign), in the preview's words. */
export function campaignLine(campaign: RecordValue, now: number): string {
  const min = (at: unknown) => Math.max(1, Math.ceil((Number(at) - now) / 60_000));
  if (campaign.state === "applying") return "Installing";
  if (Number(campaign.holdUntilMs) > now) return `Held · resumes in ${min(campaign.holdUntilMs)} min`;
  if (campaign.state === "countdown" && Number(campaign.applyAtMs) > now) {
    const left = Math.ceil((Number(campaign.applyAtMs) - now) / 1000);
    return `Updating in ${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;
  }
  if (campaign.state === "waiting-for-idle") return `Waiting for running tasks${Number(campaign.forceAtMs) > now ? ` · updates anyway in ${min(campaign.forceAtMs)} min` : ""}`;
  return "Updating now";
}

/** The current time, ticking every second while `on`. */
function useNow(on: boolean): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { if (!on) return; const id = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(id); }, [on]);
  return now;
}

function Waiting({ engine, data, version }: SettingsPageProps & { data: Data; version: string }) {
  const [dialog, setDialog] = useState<"" | "notes" | "report">("");
  const call = useCall();
  const hold = useCall();
  const available = rec(data.status.updateAvailable);
  const schedule = rec(data.status.schedule);
  const campaign = rec(schedule.campaign);
  const started = Boolean(str(campaign.id));
  const now = useNow(started);
  const latest = str(available.latestVersion) || str(rec(schedule.target).version);
  const holdIt = () => void hold.run(() => engine.request<RecordValue>("update.hold", {}), (r) => {
    data.reload();
    const until = rec(rec(rec(r).schedule).campaign).holdUntilMs;
    return rec(r).ok === true ? `Held${until ? ` until ${when(until)}` : ""}.` : "The engine didn’t hold it: it is already held or already installing.";
  });
  const active = rec(data.status.activeRun);
  const last = rec(data.status.lastRun);
  const failed = !str(active.runId) && (last.status === "failed" || last.status === "rolled-back");
  const install = () => void call.run(async () => {
    const result = rec(await engine.request("update.run", {}));
    if (result.ok !== true) throw new Error(str(result.message) || str(rec(result.result).reason) || "The engine didn’t start the update.");
    return result;
  }, () => "Installing. You can keep working.");
  return (
    <>
      {latest ? (
        <div className="s2-rn">
          <Ico name="doc" />
          <span className="grow">{version ? `You have Branch ${versionParts(version).short}. See what the update adds.` : "Checking Branch’s version. See what the update adds."}</span>
          <Btn sm onClick={() => setDialog("notes")}>What’s new</Btn>
        </div>
      ) : null}
      {str(active.runId) ? (
        <Status tone="warn" title="Installing a Branch update">{PHASE[str(active.phase)] ?? "Working on it"}. Branch restarts by itself when it’s done; you can keep working.</Status>
      ) : failed ? (
        <Status tone="bad" title="Branch update didn’t install">{str(last.reason) || "The update stopped before it finished."} {version ? `Branch ${versionParts(version).short}` : "Your current Branch version"} keeps running.</Status>
      ) : started ? (
        <Status tone={campaign.state === "applying" ? "warn" : "ok"} title="A Branch update is installing by itself">{campaignLine(campaign, now)}.</Status>
      ) : latest ? (
        <Status title="A Branch update is ready">It waits for running tasks, up to the update deadline, and keeps a safety copy first.</Status>
      ) : (
        <Status title="Branch is up to date.">{version ? `You have Branch ${versionParts(version).detail}.` : "You have the newest version."}</Status>
      )}
      {latest && !str(active.runId) ? (
        <Acts>
          <Btn pri disabled={call.busy} onClick={install}>{failed ? "Try again" : "Install update"}</Btn>
          {started && campaign.state !== "applying" && !(Number(campaign.holdUntilMs) > now) ? <Btn ghost disabled={hold.busy} onClick={holdIt}>Hold for an hour</Btn> : null}
          {failed ? <Btn ghost onClick={() => setDialog("report")}>Report the failure</Btn> : <Btn ghost disabled title={NO_SKIP}>Skip this version</Btn>}
        </Acts>
      ) : null}
      <CallLine call={call} />
      <CallLine call={hold} />
      {dialog === "notes" ? <NotesDialog available={available} version={version} onClose={() => setDialog("")} onInstall={() => { setDialog(""); install(); }} /> : null}
      {dialog === "report" ? <ReportDialog engine={engine} run={last} onClose={() => setDialog("")} /> : null}
    </>
  );
}

/** What's new: the changes the engine reports for the waiting version (git installs list their commits). */
function NotesDialog({ available, version, onClose, onInstall }: { available: RecordValue; version: string; onClose: () => void; onInstall: () => void }) {
  const commits = list(available.commits);
  const behind = typeof available.commitsBehind === "number" ? available.commitsBehind : undefined;
  return (
    <Dialog title="What’s new" wide onClose={onClose} footer={<><Btn ghost disabled title={NO_SKIP}>Skip this version</Btn><Btn pri onClick={onInstall}>Install update</Btn></>}>
      <p className="hint">{version ? `What this update changes from Branch ${versionParts(version).detail}.` : "What this Branch update changes."}</p>
      {commits.length ? (
        <div className="rows">{commits.map((c) => <Prow key={str(c.sha)} title={str(c.subject)} sub={str(c.sha).slice(0, 7)} />)}</div>
      ) : <p className="hint">The engine has no release notes for this version yet.</p>}
      {behind !== undefined && behind > commits.length ? <p className="hint">And {behind - commits.length} more changes.</p> : null}
    </Dialog>
  );
}

/** Report this update failure: update.report previews the report with private details removed, then submits it. */
function ReportDialog({ engine, run, onClose }: Pick<SettingsPageProps, "engine"> & { run: RecordValue; onClose: () => void }) {
  const preview = useLive<RecordValue>(engine, "update.report", { action: "preview", attemptId: str(run.runId) }, []);
  const call = useCall();
  const [sent, setSent] = useState<RecordValue | null>(null);
  const ready = rec(preview.data);
  const submit = () => void call.run(async () => setSent(rec(await engine.request("update.report", { action: "submit", attemptId: str(run.runId), previewDigest: str(ready.previewDigest) }))));
  const link = str(sent?.url) || str(sent?.fallbackUrl);
  return (
    <Dialog title="Report this update failure" onClose={onClose} footer={sent ? null : <><Btn ghost onClick={onClose}>Cancel</Btn><Btn pri disabled={ready.status !== "ready" || call.busy} onClick={submit}>Continue</Btn></>}>
      {preview.error ? <p className="s2-err" role="alert">{preview.error}</p> : null}
      {preview.loading ? <p>Preparing the report…</p> : null}
      {ready.status === "ready" && !sent ? <><p>Here is the report with private details removed. Check it before it’s sent.</p><pre className="s2-pre">{str(ready.body)}</pre></> : null}
      {ready.status && ready.status !== "ready" ? <p>{str(ready.message)}</p> : null}
      {sent ? <p>{str(sent.message) || "Sent."}{link ? <> <a href={link} target="_blank" rel="noreferrer">Open it</a></> : null}</p> : null}
      <CallLine call={call} />
    </Dialog>
  );
}

/** Updating: by itself (update.auto.enabled), Check now (update.status refreshCheckout), Stable or Beta (update.channel). */
function Updating({ engine, level, data }: SettingsPageProps & { data: Data }) {
  const config = useConfig(engine);
  const schedule = rec(data.status.schedule);
  const [checked, setChecked] = useState<number | null>(null);
  const call = useCall();
  const autoSaved = config.get("update.auto.enabled");
  const auto = typeof autoSaved === "boolean" ? autoSaved : schedule.autoEnabled === true;
  const checkOnStart = config.get("update.checkOnStart") !== false;
  const install = auto ? "automatic" : checkOnStart ? "ask" : "never";
  const setInstall = (value: string) => void (async () => {
    if (!(await config.set("update.auto.enabled", value === "automatic"))) return;
    if (value === "never") await config.set("update.checkOnStart", false);
    else if (!checkOnStart) await config.set("update.checkOnStart", null);
  })();
  const channelSaved = str(config.get("update.channel")) || str(data.status.effectiveChannel) || str(schedule.channel);
  const channel = channelSaved === "beta" || channelSaved === "dev" ? "beta" : "stable";
  const check = () => void call.run(async () => { await engine.request("update.status", { refreshCheckout: true }); setChecked(Date.now()); data.reload(); });
  const lastRun = rec(data.status.lastRun);
  return (
    <Sec title="Updating">
      <Ctl title="Install updates" sub="With a safety copy; running work gets until the update deadline.">
        <Seg label="Install updates" value={install} disabled={config.loading} onChange={setInstall} options={[{ id: "automatic", label: "Automatically" }, { id: "ask", label: "Ask me first" }, { id: "never", label: "Never" }]} />
      </Ctl>
      <Ctl title="Check for updates" sub={call.error}>
        {checked ? <span className="val-k">Last checked {when(checked)}</span> : null}
        <Btn sm disabled={call.busy} onClick={check}>{call.busy ? "Checking…" : "Check now"}</Btn>
      </Ctl>
      <Ctl title="Which updates" sub="Stable is tested longer." help="Stable is tested longer. Beta gets new things first and may have rough edges.">
        <Seg label="Which updates" value={channel} options={[{ id: "stable", label: "Stable" }, { id: "beta", label: "Beta" }]} disabled={config.loading} onChange={(id) => void config.set("update.channel", id)} />
      </Ctl>
      {lvOf(level) >= 1 ? (
        <Ctl title="If tasks are still running after" sub="After 15 minutes it updates anyway, and offers back what it stopped." off={NO_DEADLINE}>
          <Seg label="If tasks are still running after" value="15" options={[{ id: "15", label: "15 minutes" }, { id: "never", label: "Never" }]} onChange={() => undefined} />
        </Ctl>
      ) : null}
      <Ctl title="Undo the last update" sub={lastRun.status === "succeeded" ? `Branch update installed ${day(lastRun.updatedAtMs)}.` : undefined} off={NO_UNDO}>
        <Btn sm disabled>Undo</Btn>
      </Ctl>
    </Sec>
  );
}

const DEVICES: [string, string, string, string][] = [
  ["phone", "iPhone", "Chat, talk, approve and share into Branch.", "App Store"],
  ["android", "Android", "Chat, camera and live progress.", "Google Play"],
  ["clock", "Apple Watch", "Comes with the iPhone app.", ""],
  ["clock", "Wear OS", "Comes with the Android app.", ""],
  ["monitor", "Mac and Windows", "", "Download"],
  ["globe", "Browser extension", "Send pages to a Trunk.", "Chrome Web Store"],
];

/** One device row. At Advanced the Android row adds the APK line, greyed until the Branch app can download it. */
function DeviceRow({ icon, title, sub, store, apk }: { icon: string; title: string; sub: string; store: string; apk: boolean }) {
  return (
    <div className="prow" data-row={title}>
      <Tile><Ico name={icon} s /></Tile>
      <span className="grow">
        <b>{title}</b>
        {sub ? <small>{sub}</small> : null}
        {apk ? (
          <small className="up-apk">
            <button type="button" className="link-k" disabled title={APK_WHY}>Download the APK</button> · <button type="button" className="link-k" disabled title={APK_WHY}>Checksum</button> · Not every release includes the APK. Check the checksum before installing.
          </small>
        ) : null}
      </span>
      {store ? <Btn sm ghost disabled title={store === "Download" ? APP_ONLY : STORE_WHY}>{store}</Btn> : null}
    </div>
  );
}

function Devices({ lv }: { lv: number }) {
  return (
    <Sec title="Branch on your other devices">
      <Plist>
        {DEVICES.map(([icon, title, sub, store]) => <DeviceRow key={title} icon={icon} title={title} sub={sub} store={store} apk={title === "Android" && lv >= 1} />)}
      </Plist>
      <Ctl title="Already have the app?" off="Pairing a phone needs the Branch phone app."><Btn sm>Pair your phone</Btn></Ctl>
      <Ctl title="Add more to Branch"><Btn sm onClick={() => openPlace("customize", "Plugins")}>Open Plugins</Btn><Btn sm ghost onClick={() => openPlace("customize", "Skills")}>Browse the skill library</Btn></Ctl>
    </Sec>
  );
}

export function About() {
  return (
    <Sec title="About">
      <KeeperMark />
      <Ctl title="Open-source licences" sub="The software Branch is built on, with each licence." off="The list comes with the Branch app on your computer."><Btn sm disabled>Show</Btn></Ctl>
      <small className="about-credit">Based on OpenClaw</small>
    </Sec>
  );
}

const NOT_PUBLISHED = "The Branch add-on for it isn’t published yet.";
/** In your editors and notes (Advanced): add-ons that aren't published yet, greyed with why. */
function Editors({ gatewayUrl }: { gatewayUrl?: string }) {
  const origin = gatewayUrl ? gatewayUrl.replace(/^ws/, "http").replace(/\/+$/, "") : "";
  const rows: [string, string, string][] = [
    ["VS Code", "Marketplace", "Send the selection or files to a Trunk; Quick edit with Ctrl Shift I."],
    ["JetBrains", "Marketplace", "A Branch tool window with its own settings and editor tabs."],
    ["Emacs", "MELPA", "branch.el starts a local server; search, chat and find similar."],
    ["Obsidian", "Community plugins", "Chat beside a note; search by meaning; similar notes."],
  ];
  return (
    <Sec title="In your editors and notes" group="Branch on your other devices">
      {rows.map(([title, store, sub]) => <Ctl key={title} title={title} sub={sub} off={NOT_PUBLISHED}><Btn sm disabled>{store}</Btn></Ctl>)}
      <Ctl title="Folders to keep in sync" sub="Obsidian folders the Trunks read, refreshed as they change." off="Needs the Obsidian add-on."><input className="inp" aria-label="Folders to keep in sync" disabled /></Ctl>
      <Ctl title="Search with Branch from your browser" sub="Add it as a search engine; what you type opens a new conversation." off="Opening a conversation from a browser search needs the Branch app."><code className="s2-code">{`${origin}/?q=%s`}</code></Ctl>
      <Ctl title="Install from a terminal" off="The Branch installer isn’t published yet." />
    </Sec>
  );
}

function RemoveBranch() {
  const parts: [string, string][] = [["The app", ""], ["Programs it downloaded to run models", ""], ["Models on this computer", ""], ["The Gateway’s Linux system (WSL)", "Its WSL system, disk image and start-up entry."]];
  return (
    <div className="sec s2-danger" data-sec="Remove Branch">
      <h2>Remove Branch</h2>
      <div className="rows">
        {parts.map(([t, s]) => <Prow key={t} title={t} sub={s || undefined}><span className="s2-meta">Removed</span></Prow>)}
        <Ctl title="Keep my conversations and settings" sub="Branch finds them again if you install it later." off="The uninstaller asks."><Switch label="Keep my conversations and settings" checked onChange={() => undefined} /></Ctl>
      </div>
      <Ctl title="Type Branch to confirm" sub="It is there so a misclick can’t remove Branch." off="Removing Branch runs in the Branch app’s uninstaller."><input className="inp" style={{ width: 180 }} aria-label="Type Branch to confirm" disabled /></Ctl>
      <Acts><Btn className="s2-dz" disabled title="Removing Branch runs in the Branch app’s uninstaller.">Remove Branch and everything it installed</Btn></Acts>
    </div>
  );
}

function Reports() {
  return (
    <Sec title="Reports">
      <Ctl title="Send crash and update reports to KeepOak" off="Needs your keepoak.com account connected."><Switch label="Send crash and update reports to KeepOak" checked={false} disabled onChange={() => undefined} /></Ctl>
      <Ctl title="What was sent"><span>Nothing yet</span></Ctl>
    </Sec>
  );
}

/** Before you install: the plan (what this engine's update.run does, in order). */
function BeforeInstall() {
  const [open, setOpen] = useState(false);
  return (
    <Sec title="Before you install">
      <Ctl title="See the plan" sub="What a Branch update changes and how each part restarts."><Btn sm onClick={() => setOpen(true)}>See the plan</Btn></Ctl>
      <Ctl title="Window fixes without reinstalling" sub="Small window fixes arrive automatically." help="Small fixes to the window arrive on their own, checked like any update." off="Small window fixes arrive with the Branch app’s updater."><Switch label="Window fixes without reinstalling" checked={false} onChange={() => undefined} /></Ctl>
      <Ctl title="Window changes" sub="Replaces the window while preserving your draft and place." help="The new window takes the old one’s place while you aren’t typing or reading a reply; your draft, place and replies carry over." off="Swapping the window in place is done by the Branch app.">
        <Seg label="Window changes" value="idle" options={[{ id: "idle", label: "When I’m not typing" }, { id: "ask", label: "Ask me" }]} onChange={() => undefined} />
      </Ctl>
      <Ctl title="Update work stays out of the way" sub="Downloads and verifies updates in the background." help="Downloads and checks run in the background, pause while you type or a task works, and never build anything on this computer."><span className="val-k">Low priority</span></Ctl>
      {open ? (
        <Dialog title="The plan for a Branch update" onClose={() => setOpen(false)}>
          <p className="hint">Nothing changes until you install. This is what would happen.</p>
          <ol className="s2-ol">
            <li><b>One update at a time.</b> Another updater (the terminal’s or the window’s) waits for this one.</li>
            <li><b>Wait for running tasks</b>, up to the update deadline (5 minutes).</li>
            <li><b>Keep a safety copy</b> of settings and the conversation store.</li>
            <li><b>Install, then check it.</b> The new version checks its settings and data before it takes over.</li>
            <li><b>Restart what changed:</b> the engine (restart), the window (reloads where you were), chat apps (reconnect).</li>
          </ol>
        </Dialog>
      ) : null}
    </Sec>
  );
}

function Privacy({ openSettings }: Pick<SettingsPageProps, "openSettings">) {
  const [open, setOpen] = useState(false);
  return (
    <Sec title="Privacy">
      <Ctl title="Privacy notice" sub="What Branch keeps, what it sends, and your choices."><Btn sm onClick={() => setOpen(true)}>Show</Btn></Ctl>
      {open ? (
        <Dialog title="Privacy notice" onClose={() => setOpen(false)}>
          <p>Branch runs on your computer. Your conversations, memory and files stay here unless you send them somewhere.</p>
          <ul className="s2-ul">
            <li>Models you connect get what each request carries.</li>
            <li>Crash reports and feature counts are off until you turn them on (Advanced › Seeing more).</li>
            <li>Traces go only to destinations you turn on (Developer).</li>
            <li>keepoak.com sees only what you pair with it.</li>
          </ul>
          {openSettings ? <Acts><Btn sm onClick={() => { setOpen(false); openSettings("advanced"); }}>Your choices</Btn></Acts> : null}
        </Dialog>
      ) : null}
    </Sec>
  );
}

/** Help and updates, more (Advanced): the last attempt, every update (update.runs.list) and the engine's version. */
function HelpMore({ engine, level, data, version }: SettingsPageProps & { data: Data; version: string }) {
  const [history, setHistory] = useState(false);
  const last = rec(data.status.lastRun);
  const kind = str(rec(rec(data.status.schedule).install).kind);
  return (
    <Sec title="Help and updates, more" group="Updating">
      <Ctl title="The handbook" sub="Answers to “how do I…” questions, found by what you ask." off="Needs the handbook skill in the engine."><Btn sm>Ask it</Btn></Ctl>
      <Ctl title="If an update fails" sub="A Trunk reads what went wrong, tries the fix on a copy and tells you." off="Needs the Trunk that looks after updates, in the engine."><Btn sm>Show an example</Btn></Ctl>
      <h3 className="s2-h3">Last update attempt</h3>
      {str(last.runId) ? (
        <Kv rows={[
          ["When", when(last.createdAtMs)], ["From", str(rec(last.before).version)],
          ["To", last.status === "succeeded" ? str(rec(last.after).version) || str(rec(last.target).version) : "Didn’t change"],
          ["Install type", INSTALL[kind] ?? ""], ["What failed", last.status === "failed" ? str(last.reason) : ""],
          ...(lvOf(level) >= 2 ? [["Reason code", str(last.reason) || "none"] as [string, string]] : []),
        ]} />
      ) : <Empty>No update has been tried yet.</Empty>}
      <Ctl title="Update history" sub="Every update, who started it and how it went."><Btn sm onClick={() => setHistory(true)}>See all</Btn></Ctl>
      <Ctl title="The engine" sub={version ? "The engine is installed and answering." : undefined}>
        <span className="val-k">{version ? `Installed ${version}` : ""}</span>
        <Btn sm disabled title={APP_ONLY}>Repair</Btn>
        <Btn sm ghost onClick={data.reload}>Check again</Btn>
      </Ctl>
      {lvOf(level) >= 2 ? <CodeRow title="Update status for scripts" code="branch update status --json" /> : null}
      {history ? <HistoryDialog engine={engine} onClose={() => setHistory(false)} /> : null}
    </Sec>
  );
}

const INSTALL: Record<string, string> = { package: "Installer", git: "From source", unknown: "" };

/** Update history: every run, then one run's steps. */
function HistoryDialog({ engine, onClose }: Pick<SettingsPageProps, "engine"> & { onClose: () => void }) {
  const runs = useLive<RecordValue>(engine, "update.runs.list", { limit: 50 }, UPDATE_EVENTS);
  const [open, setOpen] = useState<RecordValue | null>(null);
  const rows = list(rec(runs.data).runs);
  const title = (r: RecordValue) => `${str(rec(r.before).version) || "?"} → ${str(rec(r.after).version) || str(rec(r.target).version) || "?"}`;
  return (
    <Dialog title="Update history" wide onClose={onClose}>
      {runs.error ? <p className="s2-err" role="alert">{runs.error}</p> : null}
      {runs.loading ? <p>Loading…</p> : null}
      {open ? (
        <div>
          <button type="button" className="link-k" onClick={() => setOpen(null)}>Every update</button>
          <h3 className="s2-h3">{title(open)} · {when(open.createdAtMs)}</h3>
          {list(open.steps).length ? (
            <ol className="s2-tl">{list(open.steps).map((s, i) => <li key={i} className={s.status === "failed" ? "bad" : s.status === "completed" ? "ok" : ""}><span>{str(s.step)}<small>{when(s.startedAtMs)}{s.status === "failed" ? " · failed" : ""}{str(s.detail) ? ` · ${str(s.detail)}` : ""}</small></span></li>)}</ol>
          ) : <p className="hint">Nothing was installed.</p>}
        </div>
      ) : runs.data && !rows.length ? <p className="hint">No updates yet.</p> : (
        <div className="rows">
          {rows.map((r) => (
            <button key={str(r.runId)} type="button" className="prow s2-prowbtn" onClick={() => { setOpen(r); void engine.request<RecordValue>("update.runs.get", { runId: str(r.runId) }).then((got) => { const run = rec(rec(got).run); if (str(run.runId)) setOpen(run); }, () => undefined); }}>
              <span className="grow"><b>{title(r)}</b><small>{when(r.createdAtMs)} · {TRIGGER[str(r.trigger)] ?? str(r.trigger)}</small></span>
              <Pill tone={STEP_PILL[str(r.status)] ?? "idle"}>{STATUS_WORD[str(r.status)] ?? str(r.status)}</Pill>
            </button>
          ))}
        </div>
      )}
    </Dialog>
  );
}

/** Technical: the running build, and the terminal fallback. */
function Technical({ data, version }: { data: Data; version: string }) {
  const [cli, setCli] = useState(false);
  const install = rec(rec(data.status.schedule).install);
  const git = rec(install.git);
  return (
    <Sec title="Technical" group="Updating" showHeading={false}>
      <Kv rows={[
        ["Version", version], ["Engine version", version], ["Commit", str(git.currentSha).slice(0, 9)],
        ["Installed", day(git.installedAtMs)], ["Last commit", day(git.commitAtMs)], ["Install type", INSTALL[str(install.kind)] ?? ""],
        ["Channel", str(data.status.effectiveChannel)],
      ]} />
      {cli ? (
        <>
          <CodeRow title="Update" code="branch update" sub="Run these on the computer that runs the Gateway." />
          <CodeRow title="Its status" code="branch update status" sub="Run these on the computer that runs the Gateway." />
          <CodeRow title="Repair a stuck update" code="branch update repair" sub="Run these on the computer that runs the Gateway." />
        </>
      ) : <Acts><Btn sm ghost onClick={() => setCli(true)}>Show terminal commands</Btn></Acts>}
    </Sec>
  );
}
