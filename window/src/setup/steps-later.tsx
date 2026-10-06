// Setup steps 4–11 (DESIGN-SPEC §4.8.1.4–§4.8.1.11). Controls the engine can't back yet are greyed with their reason.
import { useEffect, useState, type ReactNode } from "react";
import type { WindowEngine } from "../connect/engine";
import { KeeperMark } from "../brand/KeeperMark";
import { shownWhy } from "../shell/shown-why";
import { Icon as ModeIcon } from "../composer/icons";
import { MODE_ROWS } from "../composer/mode";
import { Icon, type IconName } from "../shell/icons";
import { ChatLogo } from "../places/settings/set1/chatapps-logo";
import { ChoiceCards } from "./steps-early";
import { ToolLogo, type ToolMark } from "./tool-logos";
import { JOBS, type Check, type Look } from "./setup-model";
import { useDesktopControls } from "../connect/desktop-controls";

export function platformName(): string {
  const platform = typeof navigator === "undefined" ? "" : navigator.platform.toLowerCase();
  return platform.includes("mac") ? "macOS" : platform.includes("linux") ? "Linux" : platform.includes("win") ? "Windows" : "this computer";
}
export function matchPlatformLabel(): string {
  const platform = platformName();
  return platform === "macOS" ? "Match this Mac" : platform === "Windows" ? "Match Windows" : "Match this computer";
}
const LOOKS: { id: Look; name: string }[] = [
  { id: "system", name: "" },
  { id: "light", name: "Light" },
  { id: "dark", name: "Dark" },
];
const MODE_GAP = "A starting mode for every conversation isn't an engine setting yet; each conversation's mode chip sets its own.";

export function YoursBody({ look, onLook }: { look: Look; onLook: (l: Look) => void }) {
  return (
    <>
      <div className="ob-q15">
        <b>How it looks</b>
        <div className="ob-pick15">
          {LOOKS.map((l) => (
            <button key={l.id} type="button" className={`ob-card15 look-${l.id}`} aria-pressed={look === l.id} data-testid={`setup-look-${l.id}`} onClick={() => onLook(l.id)}>
              <span className="ob-sw15">
                <i />
                <i />
                <i />
              </span>
              {l.id === "system" ? matchPlatformLabel() : l.name}
            </button>
          ))}
        </div>
      </div>
      <div className="ob-q15">
        <b>Access</b>
        <div className="ob-pick15 col15x">
          {MODE_ROWS.map((m) => (
            <button key={m.name} type="button" className="ob-row15" aria-pressed={m.engine === "full"} aria-disabled={m.engine === "full" ? undefined : true} title={m.engine === "full" ? undefined : m.gap ?? MODE_GAP}>
              <span className="ico-tile">
                <ModeIcon name={m.icon} size={15} />
              </span>
              <span>
                <b>{m.name}</b>
                <small>{m.line}</small>
              </span>
            </button>
          ))}
        </div>
        <p className="hint">You start on Full access. Other people start on Ask first.</p>
      </div>
    </>
  );
}

function DefaultTrunkCard({ engine, id, initialName }: { engine: WindowEngine; id: string; initialName: string }) {
  const [name, setName] = useState(initialName);
  const [draft, setDraft] = useState(initialName);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { setName(initialName); setDraft(initialName); }, [initialName]);
  const save = async () => {
    if (!draft.trim() || busy) return;
    setBusy(true); setError("");
    try {
      if (draft.trim() !== name) {
        const result = await engine.request<{ ok?: boolean; error?: string }>("agents.update", { agentId: id, name: draft.trim() });
        if (result.ok === false) throw new Error(result.error || "Couldn’t rename this Trunk.");
        setName(draft.trim());
      }
      setEditing(false);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  return <div className="ob-default-trunk">
    <KeeperMark size={36} />
    <span className="grow">
      {editing ? <label className="fld"><span>Name your Trunk</span><input className="inp" value={draft} onChange={(e) => setDraft(e.target.value)} disabled={busy} /></label> : <b>{name} <small>default Trunk · Chief of Staff</small></b>}
      <small>Answers anything not sent to another Trunk and routes jobs.</small>
      {error ? <small role="alert">{error}</small> : null}
    </span>
    {editing ? <span className="acts"><button type="button" className="btn sm" disabled={busy} onClick={() => { setDraft(name); setEditing(false); setError(""); }}>Cancel</button><button type="button" className="btn pri sm" disabled={!draft.trim() || busy} onClick={() => void save()}>{busy ? "Saving…" : "Save"}</button></span> : <button type="button" className="btn sm" onClick={() => setEditing(true)}>Edit</button>}
  </div>;
}

export function TrunksBody({ jobs, onJob, propose, proposeOff, engine, defaultAgentId, defaultName }: { jobs: number[]; onJob: (i: number) => void; propose: ReactNode; proposeOff: string; engine: WindowEngine; defaultAgentId: string | null; defaultName: string }) {
  return (
    <>
      {defaultAgentId ? <DefaultTrunkCard engine={engine} id={defaultAgentId} initialName={defaultName} /> : null}
      <div className="ob-tr">
        {JOBS.map((j, i) => (
          <button key={j.name} type="button" className="ob-tpl" aria-pressed={jobs.includes(i)} data-testid={`setup-job-${i}`} onClick={() => onJob(i)}>
            <span className="ob-dot" style={{ background: j.colour }} />
            <b>{j.name}</b>
            <small>{j.line}</small>
          </button>
        ))}
      </div>
      <label className="fld ob-life">
        <span>Or describe what you do</span>
        <textarea className="inp" rows={2} disabled title={proposeOff} placeholder="I’m a finance student with a part-time job. I travel a lot." />
      </label>
      {propose}
    </>
  );
}

export type ChatApp = { id: string; label: string; connected: boolean };

/** How many chat apps Reach shows; the rest are in Settings › Chat apps (the preview's "popular ones"). */
export const REACH_SHOWN = 9;

/** Reach (§4.8.1.6): the chat apps this Branch knows, connected ones first. A connected one is marked; any other opens
 *  the engine's own channel setup (wizard.start flow "channels"), and Your phone opens the pairing code
 *  (device.pair.setupCode). */
export function ReachBody({ apps, onConnect, onPhone }: { apps: ChatApp[] | null; onConnect: (app: ChatApp) => void; onPhone: () => void }) {
  const shown = [...(apps ?? [])].sort((x, y) => Number(y.connected) - Number(x.connected)).slice(0, REACH_SHOWN);
  return (
    <>
      {!apps ? <p className="hint">Reading the chat apps…</p> : null}
      {apps && !apps.length ? <p className="hint">No chat apps are available yet.</p> : null}
      <div className="ch-grid12 ob-ch12">
        {shown.map((a) => (
          <button key={a.id} type="button" className={a.connected ? "ch12 on12" : "ch12"} aria-pressed={a.connected} data-testid={`setup-app-${a.id}`} onClick={() => !a.connected && onConnect(a)}>
            <ChatLogo id={a.id} name={a.label} size={30} />
            <span>
              <b>{a.label}</b>
              <small>{a.connected ? "Connected" : "Set up"}</small>
            </span>
          </button>
        ))}
      </div>
      <div className="prow ob-phone">
        <span className="ico-tile">
          <Icon name="phone" small />
        </span>
        <span className="grow">
          <b>Your phone</b>
          <small>Scan the square code with the Branch app</small>
        </span>
        <button type="button" className="btn sm" data-testid="setup-phone" onClick={onPhone}>
          Show the code
        </button>
      </div>
    </>
  );
}

/** The Reach lede: how many chat apps there are, when Reach shows only some of them. */
export function reachLede(apps: ChatApp[] | null): string {
  const n = apps?.length ?? 0;
  return n > REACH_SHOWN ? `Message your Trunks from apps you already use. ${n} to choose from.` : "Message your Trunks from apps you already use.";
}

/** A row like the preview's settings rows (.ctl): title, its control, and the line under it. */
function Ctl({ title, sub, children }: { title: string; sub?: string; children: ReactNode }) {
  return (
    <div className="ctl">
      <b>{title}</b>
      {children}
      <small>{sub}</small>
    </div>
  );
}

/** A segmented choice the engine can't change yet: greyed, with its reason. */
function SegOf({ label, options, value, off }: { label: string; options: string[]; value: string; off: string }) {
  return (
    <span className="right">
      <span className="ob-seg" role="group" aria-label={label} aria-disabled="true" title={shownWhy(off)}>
        {options.map((o) => (
          <button key={o} type="button" aria-pressed={o === value} disabled>
            {o}
          </button>
        ))}
      </span>
    </span>
  );
}

function OffSwitchRow({ title, line, on, reason, logo, label }: { title: string; line: string; on: boolean; reason: string; logo?: ReactNode; label?: string }) {
  return (
    <div className="prow">
      {logo}
      <span className="grow">
        <b>{title}</b>
        <small>{line}</small>
      </span>
      <button type="button" role="switch" aria-checked={on} aria-label={label ?? title} className="switch" disabled title={shownWhy(reason)} />
    </div>
  );
}

const CONNECTORS: { id: ToolMark; name: string; line: string }[] = [
  { id: "outlook", name: "Outlook", line: "Mail and calendar · sign in on their site" },
  { id: "drive", name: "Google Drive", line: "Documents · sign in on their site" },
  { id: "github", name: "GitHub", line: "Code and issues · sign in on their site" },
];
// TODO(engine-lane): connector sign-in from setup (Outlook, Google Drive, GitHub) hooks in here once the engine has it.
const CONNECT_OFF = "Signing in to connectors from setup isn't in the engine yet; Customize › Tools has them.";
// TODO(engine-lane): the engine reports the command-line tools it found; draw them as the artifact's on switch.
const CLI_OFF = "Listing the command-line tools found needs the engine to report them.";
// TODO(engine-lane): "What Trunks may use on this computer" (Read only / Standard / Everything) as an engine setting.
const LEND_OFF = "What this computer lends to Trunks isn't an engine setting yet; Settings › Permissions has the rules.";

export function ToolsBody() {
  return (
    <>
      <div className="rows">
        {CONNECTORS.map((c) => (
          <OffSwitchRow key={c.name} logo={<ToolLogo id={c.id} size={28} />} title={c.name} line={c.line} on={false} reason={CONNECT_OFF} />
        ))}
        <OffSwitchRow
          logo={
            <span className="ico-tile">
              <Icon name="term" small />
            </span>
          }
          title="Command-line tools found"
          line="No command-line tools found yet"
          on={false}
          reason={CLI_OFF}
          label="Command-line tools"
        />
      </div>
      <div className="lendPF18">
        <Ctl title="Abilities on this computer">
          <SegOf label="Abilities on this computer" options={["Read only", "Standard", "Everything"]} value="" off={LEND_OFF} />
        </Ctl>
      </div>
    </>
  );
}

// TODO(desktop-lane): gateway mode needs the desktop app to run the engine's background service (branch gateway install);
// see RecBar.tsx for why it can't yet.
const DESKTOP = "The desktop app owns this; the window can’t change it yet.";

export function KeepBody({ autoUpdate, onAutoUpdate, boot = null, onBoot }: {
  autoUpdate: boolean; onAutoUpdate: (v: boolean) => void; boot?: boolean | null; onBoot?: (v: boolean) => void;
}) {
  const desk = useDesktopControls();
  const why = desk.off;
  const sw = (title: string, sub: string, name: "startWithWindows" | "branchOnPath") => (
    <Ctl title={title} sub={sub}>
      <button type="button" role="switch" aria-checked={desk.state?.[name] ?? false} aria-label={title} className="switch" disabled={why !== undefined || desk.busy !== null} title={shownWhy(why)} onClick={() => void desk.set(name, !(desk.state?.[name] ?? false))} />
    </Ctl>
  );
  return (
    <>
      <Ctl title="The gateway" sub="Keeps Telegram, your phone and automations working when the window is closed, and starts Branch again if it ever stops.">
        <SegOf label="The gateway" options={["Off", "When needed", "On"]} value="On" off={DESKTOP} />
      </Ctl>
      {onBoot ? (
        <Ctl title={`Start with ${platformName()}`} sub="Quietly, in the tray.">
          <button type="button" role="switch" aria-checked={why ? false : boot ?? desk.state?.startWithWindows ?? false} aria-label={`Start with ${platformName()}`} className="switch" disabled={why !== undefined} title={shownWhy(why)} onClick={() => onBoot(!(boot ?? desk.state?.startWithWindows ?? false))} />
        </Ctl>
      ) : sw(`Start with ${platformName()}`, "Quietly, in the tray.", "startWithWindows")}
      {sw("Type branch in any terminal", "Adds the branch command, so the terminal view and scripts work anywhere.", "branchOnPath")}
      <Ctl title="Keep Branch up to date by itself" sub="It waits until no task is working and keeps a safety copy.">
        <button type="button" role="switch" aria-checked={autoUpdate} aria-label="Keep Branch up to date by itself" className="switch" data-testid="setup-autoupdate" onClick={() => onAutoUpdate(!autoUpdate)} />
      </Ctl>
    </>
  );
}

const PEOPLE: { id: number; icon: IconName; name: string; line: string; off?: string }[] = [
  { id: 0, icon: "users", name: "Someone on this computer", line: "A household profile with its own PIN" },
  { id: 1, icon: "chat", name: "A teammate on their computer", line: "An invite link or an 8-character code" },
  { id: 2, icon: "globe", name: "Your keepoak.com team", line: "Everyone in your workspace", off: "Needs a keepoak.com account." },
];

export function PeopleBody({ people, onPeople }: { people: number | null; onPeople: (i: number) => void }) {
  return <ChoiceCards items={PEOPLE} value={people} onPick={onPeople} />;
}

/** "Getting this computer ready" (§4.8.1.11 parity add): the steps the Branch app runs to set this computer up, read
 *  from the same answers as the health check, since this window only exists once they ran. */
export function readySteps(checks: Check[]): { name: string; state: Check["state"]; line: string }[] {
  const of = (name: string) => checks.find((c) => c.name === name);
  const step = (name: string, from: Check | undefined) => ({ name, state: from?.state ?? "checking", line: !from || from.state === "checking" ? "checking…" : from.state === "ok" ? "Done" : from.line });
  const disk = of("Disk");
  const engine = of("The engine");
  const gateway = of("The gateway");
  return [step("Check this computer", disk), step("Set up the engine", engine), step("Prepare the gateway", gateway), step("Start the gateway", gateway)];
}

function CheckIcon({ state }: { state: Check["state"] }) {
  return state === "checking" ? <Icon name="spin" small /> : state === "ok" ? <Icon name="check" small /> : <Icon name="x" small />;
}

export function CheckBody({ checks, onFix }: { checks: Check[]; onFix: (step: number) => void }) {
  const ready = readySteps(checks);
  const engine = checks.find((c) => c.name === "The engine");
  return (
    <>
      <div className="readyPF18">
        <h3>Getting this computer ready</h3>
        <ol className="tl ob-checks" data-testid="setup-ready">
          {ready.map((r) => (
            <li key={r.name} className={r.state === "ok" ? "ok" : r.state === "bad" ? "badF18" : "waitPF18"}>
              <CheckIcon state={r.state} />
              <span>
                {r.name}
                <small>{r.line}</small>
              </span>
            </li>
          ))}
        </ol>
        <p className="hint ob-ready-hint">Runs in the Branch app on your computer.</p>
        <details className="foldPF18">
          <summary>Show what it’s doing</summary>
          <p className="hint ob-ready-hint">{engine?.state === "ok" ? `The engine is ${engine.line}; nothing else is running.` : "Nothing has answered yet."}</p>
        </details>
      </div>
      <h3 className="checks-hPF18">Health check</h3>
      {checks.some((c) => c.name === "The model" && c.state === "bad") ? <p role="status">Trunks can’t answer until a model is connected.</p> : null}
      <ol className="tl ob-checks" data-testid="setup-checks">
        {checks.map((c) => (
          <li key={c.name} className={c.state === "ok" ? "ok" : c.state === "bad" ? "badF18" : ""}>
            <CheckIcon state={c.state} />
            <span>
              {c.name}
              <small>
                {c.state === "checking" ? "checking…" : c.line}
                {c.state === "bad" && c.fix !== undefined ? (
                  <>
                    {" · "}
                    <button type="button" className="link" onClick={() => onFix(c.fix as number)}>
                      Fix it
                    </button>
                  </>
                ) : null}
              </small>
            </span>
          </li>
        ))}
      </ol>
    </>
  );
}
