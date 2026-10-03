// People › Signing in › Devices (§4.6.5.9 line 66): devices waiting for approval and paired devices, wired to
// device.pair.list / approve / reject / rename / remove and, at Technical, device.token.rotate / revoke.
import { useEffect, useState, type MouseEvent } from "react";
import { Dialog } from "../../shell/Dialog";
import { Icon } from "../../shell/icons";
import { Menu, type MenuAnchor, type MenuItem } from "../../shell/Menu";
import type { WindowEngine } from "../../connect/engine";
import { shows, type Level } from "../../places-nav/level";
import { useOperation, useResource } from "../library/data";
import { ago, num, rec, recs, str, strs, type Rec } from "./data";
import { Empty, Glyph, Section, Status } from "./ui";

const KIND: Record<string, string> = { mobile: "Phone", phone: "Phone", ios: "Phone", android: "Phone", desktop: "Desktop app", browser: "Browser", web: "Browser", cli: "Terminal", node: "Computer" };
const kindOf = (d: Rec) => KIND[str(d.deviceFamily).toLowerCase()] || KIND[str(d.clientMode).toLowerCase()] || (str(d.browserOrigin) ? "Browser" : "") || str(d.platform) || "Device";
const nameOf = (d: Rec) => str(d.operatorLabel) || str(d.displayName) || str(d.platform) || str(d.deviceId).slice(0, 12);
const roleOf = (d: Rec) => str(d.role) || strs(d.roles)[0] || "operator";
const wants = (d: Rec) => { const s = strs(d.scopes).map(x => x.replace(/^operator\./, "")); return s.length ? s.join(", ") : roleOf(d); };
const glyph = (d: Rec) => kindOf(d) === "Phone" ? <Glyph name="phone" /> : kindOf(d) === "Browser" ? <Icon name="globe" small /> : <Glyph name="desktop" />;

type Confirm = { title: string; text: string; go: string; run: () => void };
export function Devices({ engine, level }: { engine: WindowEngine; level: Level }) {
  const list = useResource<unknown>(engine, "device.pair.list");
  const op = useOperation(engine);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [rename, setRename] = useState<Rec | null>(null);
  const [menu, setMenu] = useState<{ at: MenuAnchor; d: Rec } | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const { reload } = list;
  useEffect(() => engine.onEvent(({ event }) => { if (event.startsWith("device.pair")) reload(); }), [engine, reload]);
  const pending = recs(rec(list.data).pending), paired = recs(rec(list.data).paired);
  const act = (method: string, params: Rec, done?: (r: unknown) => void) => void op.run<unknown>(method, params, r => { done?.(r); reload(); });
  const clearAll = async () => { for (const p of pending) await engine.request("device.pair.reject", { requestId: str(p.requestId) }); reload(); };
  const items = (d: Rec): MenuItem[] => [
    { label: "Rename…", run: () => setRename(d) },
    { label: "Remove…", danger: true, run: () => setConfirm({ title: `Remove ${nameOf(d)}?`, text: "It stops reaching this Branch. To come back it asks for approval again.", go: "Remove", run: () => act("device.pair.remove", { deviceId: str(d.deviceId) }) }) },
    ...(shows(level, "technical") ? [
      { label: "Make a new key", run: () => act("device.token.rotate", { deviceId: str(d.deviceId), role: roleOf(d) }, r => setNote(str(rec(r).token) ? `New key, shown once: ${str(rec(r).token)}` : "A new key is made; the engine gives it only to that device.")) },
      { label: "Stop its operator key…", danger: true, run: () => setConfirm({ title: `Stop ${nameOf(d)}’s operator key?`, text: "It can’t act on this Branch until it is paired again.", go: "Stop the key", run: () => act("device.token.revoke", { deviceId: str(d.deviceId), role: roleOf(d) }) }) },
    ] satisfies MenuItem[] : []),
  ];
  return <Section title="Devices">
    <Status {...list} />
    {pending.length > 0 && <><div className="pp-sub"><b>Waiting for approval ({pending.length})</b><button type="button" className="btn ghost sm" onClick={() => setConfirm({ title: "Clear all waiting?", text: "Every device waiting for approval is turned down.", go: "Clear all", run: () => { void clearAll().catch(e => setNote(String(e))); } })}>Clear all waiting…</button></div>
      <div className="pp-rows flat">{pending.map(p => <div key={str(p.requestId)} className="pp-prow"><span className="pp-tile">{glyph(p)}</span>
        <span className="grow"><b>{nameOf(p)}</b><small>{kindOf(p)} · {p.isRepair ? "Wants more" : "Wants"}: {wants(p)}{str(p.remoteIp) && ` · ${str(p.remoteIp)}`}</small></span>
        <button type="button" className="btn pri sm" disabled={op.busy} onClick={() => act("device.pair.approve", { requestId: str(p.requestId) })}>Approve</button>
        <button type="button" className="btn ghost sm" disabled={op.busy} onClick={() => setConfirm({ title: `Turn down ${nameOf(p)}?`, text: "It can ask again later.", go: "Don’t allow", run: () => act("device.pair.reject", { requestId: str(p.requestId) }) })}>Don’t</button></div>)}</div></>}
    <div className="pp-sub"><b>Paired</b></div>
    {list.data != null && !paired.length && <Empty>No paired devices.</Empty>}
    <div className="pp-rows flat">{paired.map(d => <div key={str(d.deviceId)} className="pp-prow"><span className="pp-tile">{glyph(d)}</span>
      <span className="grow"><b>{nameOf(d)}</b><small>{[kindOf(d), d.connected === true ? "here now" : num(d.lastSeenAtMs) ? `last seen ${ago(num(d.lastSeenAtMs))}` : ""].filter(Boolean).join(" · ")}</small></span>
      <button type="button" className="ib" aria-haspopup="menu" aria-label={`More for ${nameOf(d)}`} onClick={(e: MouseEvent<HTMLButtonElement>) => { const r = e.currentTarget.getBoundingClientRect(); setMenu({ at: { x: r.left, y: r.bottom + 4 }, d }); }}><Icon name="more" /></button></div>)}</div>
    {op.error && <p role="alert" className="pp-error">{op.error}</p>}{note && <p role="status" className="pp-hint">{note}</p>}
    {menu && <Menu at={menu.at} label={`More for ${nameOf(menu.d)}`} items={items(menu.d)} onClose={() => setMenu(null)} />}
    {confirm && <Dialog title={confirm.title} onClose={() => setConfirm(null)} footer={<><button type="button" className="btn ghost" onClick={() => setConfirm(null)}>Cancel</button><button type="button" className="btn pri" onClick={() => { confirm.run(); setConfirm(null); }}>{confirm.go}</button></>}><p style={{ margin: 0 }}>{confirm.text}</p></Dialog>}
    {rename && <RenameDialog device={rename} onClose={() => setRename(null)} save={label => act("device.pair.rename", { deviceId: str(rename.deviceId), label }, () => setRename(null))} busy={op.busy} />}
  </Section>;
}

function RenameDialog({ device, onClose, save, busy }: { device: Rec; onClose: () => void; save: (label: string) => void; busy: boolean }) {
  const [label, setLabel] = useState(nameOf(device));
  const ok = label.trim().length > 0 && label.trim().length <= 64;
  return <Dialog title={`Rename ${nameOf(device)}`} onClose={onClose} footer={<><button type="button" className="btn ghost" onClick={onClose}>Cancel</button><button type="button" className="btn pri" disabled={!ok || busy} onClick={() => save(label.trim())}>Rename</button></>}>
    <label className="fld ppl-dlg" style={{ display: "grid", gap: 6 }}><span>Name, up to 64 characters</span><input className="inp" value={label} maxLength={64} aria-invalid={!ok} onChange={e => setLabel(e.target.value)} /></label>
  </Dialog>;
}
