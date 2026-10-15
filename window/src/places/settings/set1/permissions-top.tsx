// Permissions, the custom rows: This PC (the computer's own permissions, which only the desktop app can read), the
// mode box and "Mode everywhere" (tools.exec.mode, the same engine key behind the composer's modes), Work style,
// Lockdown, Pinned settings, who may run commands outside the sandbox (tools.elevated.allowFrom) and connectors.
// TODO(engine-lane): the greyed reasons in this file say what is still missing; shownWhy (shell/shown-why.ts) keeps them out of sight.
import { useState, type ReactNode } from "react";
import type { WindowEngine } from "../../../connect/engine";
import { Dialog } from "../../../shell/Dialog";
import { Icon } from "../../../shell/icons";
import { useLockdown } from "../../../shell/use-lockdown";
import { notify } from "../../../shell/notify";
import { MODE_ROWS, blockedReason, modeName, isEngineMode, type EngineMode } from "../../../composer/mode";
import { platformName } from "../../../setup/steps-later";
import { record, text, visible, type RecordValue } from "../adapter";
import { Btn, Ctl, Empty, Hint, Pick, Plist, Prow, Sec, Seg } from "../kit";
import { WHY, deadControl, type Cfg, type Ctx } from "./permissions-rows";

/** Wording and the open-settings label for This computer, from the real platform. Linux has no one settings app. */
export function thisPcCopy(os = platformName()) {
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

export function ThisPc() {
  const copy = thisPcCopy();
  return (
    <Sec title="This computer" hint={copy.hint}>
      <Plist>
        {THIS_PC_ROWS.map(([t, icon, sub, open]) => (
          <Prow key={t} icon={<span className="pm-tile">{icon}</span>} title={t} sub={t === "Installing tools" ? copy.install : t === "Location" ? copy.locationHelp : sub}>
            {open && copy.open ? <Btn sm disabled title={copy.why}>{copy.open}</Btn> : null}
          </Prow>
        ))}
      </Plist>
      <Hint>{copy.why}</Hint>
    </Sec>
  );
}

/** The engine's exec mode for each composer mode (session permissionMode → tools.exec.mode). */
export const EXEC_OF: Record<EngineMode, string> = { workspace: "auto", guarded: "ask", "read-only": "deny", full: "full" };
const MODE_OF: Record<string, EngineMode> = { auto: "workspace", ask: "guarded", deny: "read-only", full: "full" };

/** The default Trunk's mode as the engine resolves it (agents.list defaultPermissionMode). */
export function defaultMode(agents: RecordValue | undefined): EngineMode | null {
  const rows = Array.isArray(agents?.agents) ? (agents.agents as RecordValue[]) : [];
  const def = rows.find((a) => a.id === agents?.defaultId) ?? rows[0];
  return isEngineMode(def?.defaultPermissionMode) ? def.defaultPermissionMode : null;
}

/** The exec mode in force: the configured tools.exec.mode, or what the engine resolves without one. */
export function execMode(cfg: Cfg, agents: RecordValue | undefined): string {
  const set = cfg.get("tools.exec.mode");
  if (typeof set === "string") return set;
  const m = defaultMode(agents);
  return m ? EXEC_OF[m] : "";
}

/** Saves tools.exec.mode; the engine refuses mode beside the older security/ask keys, so those go. */
export async function saveMode(cfg: Cfg, mode: string, after: () => Promise<void>) {
  if (await cfg.set("tools.exec", { mode, security: null, ask: null })) await after();
}

const MODE_OPTS = MODE_ROWS.map((r) => ({ id: r.engine ? EXEC_OF[r.engine] : "plan", label: r.name, off: blockedReason(r, true) ?? undefined }));
export function ModeEverywhere({ cfg, agents, reload }: { cfg: Cfg; agents?: RecordValue; reload: () => Promise<void> }) {
  const selected = execMode(cfg, agents);
  const lockdown = cfg.get("security.lockdown") === true;
  return (
    <Sec title="Access" hint="Every conversation starts here. A conversation can change its own.">
      <div data-row="Access"><Seg layout="radio" label="Access" value={selected} options={MODE_OPTS} disabled={cfg.loading || lockdown} onChange={(mode) => void saveMode(cfg, mode, reload)} /></div>
    </Sec>
  );
}
export const modeLabel = (exec: string) => modeName(MODE_OF[exec]);

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

export function Pinned() {
  return (
    <>
      <Empty>Nothing is pinned.</Empty>
      <div className="acts" data-row="Pin a setting"><Btn sm disabled><Icon name="plus" small />Pin a setting</Btn><Hint>The engine can’t pin a setting yet.</Hint></div>
    </>
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
    <Dialog title="Who may run commands outside the sealed box" onClose={onClose} footer={<button type="button" className="btn pri" onClick={onClose}>Done</button>}>
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
