// Permissions, the custom rows: This PC (the computer's own permissions, which only the desktop app can read), the
// mode box and "Mode everywhere" (tools.exec.mode, the same engine key behind the composer's modes), Work style,
// Lockdown, Pinned settings, who may run commands outside the sandbox (tools.elevated.allowFrom) and connectors.
// TODO(engine-lane): the greyed reasons in this file say what is still missing; shownWhy (shell/shown-why.ts) keeps them out of sight.
import { useState, type ReactNode } from "react";
import { Dialog } from "../../../shell/Dialog";
import { Icon } from "../../../shell/icons";
import { MODE_ROWS, blockedReason, modeName, isEngineMode, type EngineMode } from "../../../composer/mode";
import { record, text, visible, type RecordValue } from "../adapter";
import { Btn, Ctl, Empty, Hint, Pick, Plist, Prow, Sec, Seg, Status } from "../kit";
import { WHY, deadControl, type Cfg, type Ctx } from "./permissions-rows";
import { shownWhy } from "../../../shell/shown-why";

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
  return (
    <Sec title="This PC" hint="Windows asks for very little. Seeing the screen and using the mouse need nothing here; Branch still asks you before it takes over.">
      <Plist>
        {THIS_PC_ROWS.map(([t, icon, sub, open]) => (
          <Prow key={t} icon={<span className="pm-tile">{icon}</span>} title={t} sub={sub}>
            {open ? <Btn sm disabled title={WHY.os}>Open Windows Settings</Btn> : null}
          </Prow>
        ))}
      </Plist>
      <Hint>{WHY.os}</Hint>
      <div className="sec pm-loc">
        <Ctl title="Location access" sub="Lets a Trunk ask where this computer is when a tool needs it. On Windows it asks the first time a Trunk needs it." off={WHY.os}>{deadControl({ seg: ["Off", "While using", "Always"], v: "While using" }, "Location access")}</Ctl>
        <Ctl title="Precise location" sub="The exact spot, not just the area." off={WHY.os}>{deadControl({ sw: true }, "Precise location")}</Ctl>
      </div>
    </Sec>
  );
}

/** The engine's exec mode for each composer mode (session permissionMode → tools.exec.mode). */
export const EXEC_OF: Record<EngineMode, string> = { workspace: "auto", guarded: "ask", "read-only": "deny", full: "full" };
const MODE_OF: Record<string, EngineMode> = { auto: "workspace", ask: "guarded", deny: "read-only", full: "full" };
const LINE: Record<EngineMode, string> = {
  workspace: "A reviewer model decides on commands: it allows them, refuses them or asks you.",
  guarded: "Commands wait for your yes, unless they are on the allowed list.",
  "read-only": "Trunks never run commands.",
  full: "Does anything on this computer without asking: files, commands, the internet.",
};

/** The default Trunk's mode as the engine resolves it (agents.list defaultPermissionMode). */
export function defaultMode(agents: RecordValue | undefined): EngineMode | null {
  const rows = Array.isArray(agents?.agents) ? (agents.agents as RecordValue[]) : [];
  const def = rows.find((a) => a.id === agents?.defaultId) ?? rows[0];
  return isEngineMode(def?.defaultPermissionMode) ? def.defaultPermissionMode : null;
}

export function ModeStatus({ agents, loading, error }: { agents?: RecordValue; loading: boolean; error?: string }) {
  if (loading) return <Status tone="idle" title="Reading the mode…" />;
  if (error) return <Status tone="bad" title="Branch couldn’t read the mode">{visible(error)}</Status>;
  const m = defaultMode(agents);
  if (!m) return <Status tone="idle" title="Each conversation has its own mode">The sandbox or the command defaults below decide what each conversation may do.</Status>;
  return <Status title={`${modeName(m)} is on`}>{LINE[m]}</Status>;
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
  return (
    <div className="sec pm-mode">
      <Ctl title="Mode everywhere" sub="Every conversation starts here. Changing the mode in a conversation changes only that conversation.">
        <Seg label="Mode everywhere" value={execMode(cfg, agents)} options={MODE_OPTS} disabled={cfg.loading} onChange={(m) => void saveMode(cfg, m, reload)} />
      </Ctl>
    </div>
  );
}

const STYLE = [{ id: "full", label: "Hands-off" }, { id: "auto", label: "Balanced" }, { id: "ask", label: "Careful" }];
const STYLE_SUB: Record<string, string> = { full: "Full access everywhere: nothing asks.", auto: "Auto everywhere: only risky things ask.", ask: "Ask first everywhere: anything that changes something asks." };
export function WorkStyle({ x, agents, reload }: { x: Ctx; agents?: RecordValue; reload: () => Promise<void> }) {
  const m = execMode(x.cfg, agents);
  return (
    <Ctl title="How careful" sub={`${STYLE_SUB[m] ?? "Your own mix. Pick one to start from it."} Sets “Mode everywhere”.`}>
      <Seg label="How careful" value={m} options={STYLE} disabled={x.cfg.loading} onChange={(v) => void saveMode(x.cfg, v, reload)} />
    </Ctl>
  );
}
export const modeLabel = (exec: string) => modeName(MODE_OF[exec]);

export function Lockdown() {
  return (
    <div className="pm-danger" data-row="Lockdown" aria-disabled="true">
      <div><b>Lockdown</b><p>One switch that stops every Trunk from sending, changing or spending anything.</p>{shownWhy(WHY.lock) ? <small className="why-k">{shownWhy(WHY.lock)}</small> : null}</div>
      <Btn className="bad" disabled>Turn Lockdown on</Btn>
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
  return <Ctl title="Approvals" sub="Every yes and no from the last 30 days, and the standing permissions automations hold."><Btn sm onClick={x.openApprovals}>Open</Btn></Ctl>;
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
  if (!names.length) return <p className="empty" data-row={mark}>No connectors yet.</p>;
  return <><p className="pm-anchor" data-row={mark} aria-hidden="true" />{names.map((n) => <Ctl key={n} id={n} title={visible(n)} off="The engine can’t limit a connector to reading yet.">{deadControl({ seg: ["Nothing", "Read", "Read and write"], v: "" }, `What ${text(n)} may do`)}</Ctl>)}</>;
}
