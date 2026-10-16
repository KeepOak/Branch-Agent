// Permissions, the custom rows: This PC (the computer's own permissions, which only the desktop app can read), the
// mode box and "Mode everywhere" (tools.exec.mode, the same engine key behind the composer's modes), Work style,
// Lockdown, who may run commands outside the sandbox (tools.elevated.allowFrom) and connectors.
// TODO(engine-lane): the greyed reasons in this file say what is still missing; shownWhy (shell/shown-why.ts) keeps them out of sight.
import { useState, type ReactNode } from "react";
import type { WindowEngine } from "../../../connect/engine";
import { Dialog } from "../../../shell/Dialog";
import { Icon } from "../../../shell/icons";
import { useLockdown } from "../../../shell/use-lockdown";
import { notify } from "../../../shell/notify";
import { MODE_ROWS, blockedReason, isEngineMode, type EngineMode } from "../../../composer/mode";
import { platformName } from "../../../setup/steps-later";
import { useOsPermissions, useWindowMic, type MicNote, type OsPermission, type OsPermissionStatus } from "../../../connect/os-permissions";
import { record, text, visible, type RecordValue } from "../adapter";
import { Btn, Ctl, Empty, Hint, Pick, Pill, Plist, Prow, Sec, Seg } from "../kit";
import { WHY, deadControl, type Cfg, type Ctx } from "./permissions-rows";

/** Wording and the open-settings label for This computer, from the real platform. Linux has no one settings app. */
function thisPcCopy(os = platformName()) {
  if (os === "macOS") {
    return {
      hint: "macOS asks for very little. Branch asks before taking over.",
      open: "Open System Settings",
      install: "macOS asks for an administrator yes each time. Branch asks you first.",
      why: "System Settings › Privacy & Security opens from the Branch app on your computer.",
      locationHelp: "Lets a Trunk ask where this computer is when a tool needs it. On macOS it asks the first time a Trunk needs it.",
    };
  }
  if (os === "Linux") {
    return {
      hint: "Linux uses the desktop portal for microphone, camera and notifications. Branch asks before taking over.",
      open: null,
      install: "Linux asks for an administrator yes each time. Branch asks you first.",
      why: "Microphone and camera use PipeWire or the desktop portal. Notifications use this desktop. They open from the Branch app on your computer.",
      locationHelp: "Lets a Trunk ask where this computer is when a tool needs it. On Linux it asks the first time a Trunk needs it.",
    };
  }
  return {
    hint: "Windows asks for very little. Branch asks before taking over.",
    open: "Open Windows Settings",
    install: "Windows asks for an administrator yes each time. Branch asks you first.",
    why: WHY.os,
    locationHelp: "Lets a Trunk ask where this computer is when a tool needs it. On Windows it asks the first time a Trunk needs it.",
  };
}

const svg = (d: ReactNode) => <svg className="i s" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{d}</svg>;
const MIC = svg(<><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" /></>);
const CAM = svg(<><path d="M4 7.5h3l1.5-2h7l1.5 2h3v11H4z" /><circle cx="12" cy="13" r="3.2" /></>);
const TOOL = svg(<path d="M14.5 6.5a4 4 0 0 0-5.3 5.3L4 17l3 3 5.2-5.2a4 4 0 0 0 5.3-5.3l-2.4 2.4-2.6-.6-.6-2.6z" />);

/** The computer's own permissions: only the Branch app on the computer can read or open them. */
export const THIS_PC_ROWS: [string, ReactNode, string, boolean][] = [
  ["Microphone", MIC, "Talking to Branch and the wake word", true],
  ["Camera", CAM, "Photos and scanning a code", true],
  ["Location", <Icon key="pin" name="pin" small />, "Where this computer is, when a Trunk asks.", true],
  ["Notifications", <Icon key="bell" name="bell" small />, "Telling you when a Trunk needs you", true],
  ["Installing tools", TOOL, "Windows asks for an administrator yes each time. Branch asks you first.", false],
];

/** What each system answer reads as on its row (preview pill16: Granted / Turned off / Not yet). "unknown" shows no
 *  pill: the app can't read it, so it doesn't guess. */
export const STATUS_PILL: Record<Exclude<OsPermissionStatus, "unknown">, { label: string; tone: "ok" | "bad" | "idle" }> = {
  allowed: { label: "Granted", tone: "ok" },
  denied: { label: "Turned off", tone: "bad" },
  "not-asked": { label: "Not yet", tone: "idle" },
};

/** The right side of one permission row: its status, then one action (Allow when the system can still ask, else open settings). */
function PermissionState({ name, status, openLabel, busy, onAllow, onOpen }: {
  name: OsPermission; status: OsPermissionStatus; openLabel: string | null; busy: boolean; onAllow: () => void; onOpen: () => void;
}) {
  const pill = status === "unknown" ? null : STATUS_PILL[status];
  // Only macOS shows an app's own prompt, and only before it has asked once.
  const canAsk = status === "not-asked" && (name === "microphone" || name === "camera") && platformName() === "macOS";
  return (
    <>
      {pill ? <Pill tone={pill.tone}>{pill.label}</Pill> : null}
      {canAsk ? <Btn sm disabled={busy} onClick={onAllow}>Allow…</Btn>
        : status !== "allowed" && openLabel ? <Btn sm onClick={onOpen}>{openLabel}</Btn>
        : null}
    </>
  );
}

/** A failed read, Allow or open: one plain line, the system's own words folded away (preview "What went wrong"). */
function WentWrong({ error }: { error: string }) {
  return <div className="hint" role="status"><p>Something went wrong while loading it.</p><details><summary>What went wrong</summary><p>{error}</p></details></div>;
}

/** The Microphone row's line when the window itself asks (Linux, a browser) and can't go on: plain words, what to do. */
function micLine(status: OsPermissionStatus | null, note: MicNote | null, inApp: boolean): string | null {
  if (note === "no-browser-mic" || status === null) return "This browser can’t use the microphone.";
  if (note === "no-device") return "No microphone found. Plug one in, then try again.";
  if (status === "denied") return inApp ? "Microphone access is off for Branch. Allow it in this computer’s sound settings, then try again." : "Microphone access is off for Branch. Allow it for this site in the browser’s settings, then reload.";
  return null;
}

const OS_NAME: Record<string, OsPermission> = { Microphone: "microphone", Camera: "camera", Location: "location", Notifications: "notifications" };

export function ThisPc() {
  const copy = thisPcCopy();
  const perms = useOsPermissions();
  // Where the app can't read the microphone from the system (Linux, or no Branch app), the window asks for it itself.
  const mic = useWindowMic(!perms.bridge || perms.state?.microphone === "unknown");
  const micState = mic.active && (mic.status !== null || mic.note) ? mic.status : undefined;
  const error = perms.error ?? mic.error;
  return (
    <Sec title="This computer" hint={copy.hint}>
      <Plist>
        {THIS_PC_ROWS.map(([t, icon, sub, open]) => {
          const name = OS_NAME[t];
          if (name === "microphone" && micState !== undefined) {
            const line = micLine(micState, mic.note, Boolean(perms.bridge));
            const pill = micState && micState !== "unknown" ? STATUS_PILL[micState] : null;
            return (
              <Prow key={t} icon={<span className="pm-tile">{icon}</span>} title={t} sub={line ?? sub}>
                {pill ? <Pill tone={pill.tone}>{pill.label}</Pill> : null}
                {micState === "not-asked" && mic.note !== "no-device" ? <Btn sm disabled={mic.busy} onClick={() => void mic.request()}>Allow…</Btn> : null}
              </Prow>
            );
          }
          const status = name && perms.state ? perms.state[name] : undefined;
          return (
            <Prow key={t} icon={<span className="pm-tile">{icon}</span>} title={t} sub={t === "Installing tools" ? copy.install : t === "Location" ? copy.locationHelp : sub}>
              {name && status ? (
                <PermissionState name={name} status={status} openLabel={copy.open} busy={perms.busy === name} onAllow={() => void perms.request(name)} onOpen={() => void perms.open(name)} />
              ) : open && copy.open ? <Btn sm disabled title={copy.why}>{copy.open}</Btn> : null}
            </Prow>
          );
        })}
      </Plist>
      {error ? <WentWrong error={error} /> : perms.state ? null : <Hint>{copy.why}</Hint>}
    </Sec>
  );
}

/** The engine's exec mode for each composer mode (session permissionMode → tools.exec.mode). */
const EXEC_OF: Record<EngineMode, string> = { workspace: "auto", guarded: "ask", "read-only": "deny", full: "full" };

/** The default Trunk's mode as the engine resolves it (agents.list defaultPermissionMode). */
function defaultMode(agents: RecordValue | undefined): EngineMode | null {
  const rows = Array.isArray(agents?.agents) ? (agents.agents as RecordValue[]) : [];
  const def = rows.find((a) => a.id === agents?.defaultId) ?? rows[0];
  return isEngineMode(def?.defaultPermissionMode) ? def.defaultPermissionMode : null;
}

/** The exec mode in force: the configured tools.exec.mode, or what the engine resolves without one. */
function execMode(cfg: Cfg, agents: RecordValue | undefined): string {
  const set = cfg.get("tools.exec.mode");
  if (typeof set === "string") return set;
  const m = defaultMode(agents);
  return m ? EXEC_OF[m] : "";
}

/** Saves tools.exec.mode; the engine refuses mode beside the older security/ask keys, so those go. */
async function saveMode(cfg: Cfg, mode: string, after: () => Promise<unknown>) {
  if (await cfg.set("tools.exec", { mode, security: null, ask: null })) await after();
}

const MODE_OPTS = MODE_ROWS.filter((r) => !r.gap).map((r) => ({ id: r.engine ? EXEC_OF[r.engine] : "plan", label: r.name, off: blockedReason(r, true) ?? undefined }));
export function ModeEverywhere({ cfg, agents, reload }: { cfg: Cfg; agents?: RecordValue; reload: () => Promise<unknown> }) {
  const selected = execMode(cfg, agents);
  const lockdown = cfg.get("security.lockdown") === true;
  return (
    <Sec title="Access" hint="Every conversation starts here. A conversation can change its own.">
      <div data-row="Access"><Seg layout="radio" label="Access" value={selected} options={MODE_OPTS} disabled={cfg.loading || lockdown} onChange={(mode) => void saveMode(cfg, mode, reload)} /></div>
    </Sec>
  );
}

/** The page's status box while locked (preview index.html:8494 statusBox markup, copy at :8540 and :30785). */
export function LockdownStatus({ cfg }: { cfg: Cfg }) {
  if (cfg.get("security.lockdown") !== true) return null;
  return (
    <div className="status" data-row="Lockdown status">
      <span className="sdot bad" />
      <div>
        <b>Lockdown is on</b>
        <p>Nothing leaves this computer and nothing is changed until you turn it off.</p>
      </div>
    </div>
  );
}

export function Lockdown({ engine }: { engine: WindowEngine }) {
  const lockdown = useLockdown(engine, true);
  const toggleLockdown = () => void lockdown.toggle().catch((error: unknown) => notify(`Couldn't change Lockdown: ${error instanceof Error ? error.message : String(error)}`, { tone: "bad" }));
  return (
    <div className="pm-danger" data-row="Lockdown">
      <div><b>Lockdown</b><p>One switch that stops every Trunk from sending, changing or spending anything.</p></div>
      {/* Preview spec-v23 index.html:8553: danger-filled only while off; "Turn Lockdown off" is the plain button. */}
      <Btn className={lockdown.on ? undefined : "bad"} disabled={!lockdown.loaded || !lockdown.supported} title={lockdown.supported ? undefined : "This engine has no Lockdown switch yet."} onClick={toggleLockdown}>{lockdown.on ? "Turn Lockdown off" : "Turn Lockdown on"}</Btn>
      {lockdown.confirmation}
    </div>
  );
}

export function ApprovalsRow({ x }: { x: Ctx }) {
  return <Ctl title="Approvals" sub="Shows recent requests and standing automation permissions." help="Every yes and no from the last 30 days, and the standing permissions automations hold."><Btn sm onClick={x.openApprovals}>Open</Btn></Ctl>;
}

/** tools.elevated.allowFrom: { provider: [sender ids] }. */
const allowFrom = (cfg: Cfg): Record<string, string[]> => {
  const raw = record(cfg.get("tools.elevated.allowFrom"));
  return Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, Array.isArray(v) ? v.map(String) : []]));
};
export function WhoMay({ x }: { x: Ctx }) {
  const [open, setOpen] = useState(false);
  const who = Object.entries(allowFrom(x.cfg)).flatMap(([p, ids]) => ids.map((id) => `${visible(p)} · ${visible(id)}`));
  return (
    <Ctl title="Who may" sub={who.length ? who.join(", ") : "No one yet"}>
      <Btn sm onClick={() => setOpen(true)}>Choose…</Btn>
      {open ? <WhoDialog cfg={x.cfg} onClose={() => setOpen(false)} /> : null}
    </Ctl>
  );
}

function WhoDialog({ cfg, onClose }: { cfg: Cfg; onClose: () => void }) {
  const all = allowFrom(cfg);
  const apps = [...new Set([...Object.keys(record(cfg.get("channels"))), ...Object.keys(all)])].filter((k) => k !== "defaults");
  const [app, setApp] = useState(apps[0] ?? "");
  const [id, setId] = useState("");
  const put = (p: string, ids: string[]) => cfg.set(`tools.elevated.allowFrom.${p}`, ids.length ? ids : null);
  const add = async () => { if (app && id.trim() && await put(app, [...(all[app] ?? []), id.trim()])) setId(""); };
  const rows = Object.entries(all).flatMap(([p, ids]) => ids.map((s) => ({ p, s })));
  return (
    <Dialog title="Who may run commands outside the safe box" onClose={onClose} footer={<button type="button" className="btn pri" onClick={onClose}>Done</button>}>
      {rows.length ? <div className="rows">{rows.map(({ p, s }) => <Prow key={`${p}/${s}`} title={visible(s)} sub={visible(p)}><Btn sm ghost onClick={() => void put(p, all[p].filter((v) => v !== s))}>Remove</Btn></Prow>)}</div> : <p className="hint">No one yet.</p>}
      {apps.length ? (
        <div className="prow pm-add">
          <Pick label="Chat app" value={app} options={apps.map((a) => ({ id: a, label: visible(a) }))} onChange={setApp} />
          <input className="inp" placeholder="Their id in that app" aria-label="Their id in that app" value={id} onChange={(e) => setId(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void add()} />
          <Btn sm disabled={!id.trim()} onClick={() => void add()}>Add</Btn>
        </div>
      ) : <p className="hint">Connect a chat app first; people are added by their id in it.</p>}
    </Dialog>
  );
}

/** What each connector may do: the engine's connectors (mcp.servers), with the per-connector reach greyed. */
export function Connectors({ x }: { x: Ctx }) {
  const names = Object.keys(record(x.cfg.get("mcp.servers")));
  const mark = "What each connector may do";
  if (!names.length) return <Empty data-row={mark}>No connectors yet.</Empty>;
  return <><p className="pm-anchor" data-row={mark} aria-hidden="true" />{names.map((n) => <Ctl key={n} id={n} title={visible(n)} off="The engine can’t limit a connector to reading yet.">{deadControl({ seg: ["Nothing", "Read", "Read and write"], v: "" }, `What ${text(n)} may do`)}</Ctl>)}</>;
}
