// People › Signing in (§4.6.5.9): how people sign in from their own devices, the Devices list, and from Advanced
// the engine's pairing rules (gateway.nodes.pairing.sshVerify / autoApproveCidrs) and a shared team Branch's web
// address (gateway.publicOrigin), saved with config.patch against the read revision.
import { useEffect, useState } from "react";
import { Dialog } from "../../shell/Dialog";
import type { WindowEngine } from "../../connect/engine";
import { shows, type Level } from "../../places-nav/level";
import { useOperation, useResource } from "../library/data";
import { rec, str, strs, type Rec } from "./data";
import { Devices } from "./devices";
import { PIN_OFF } from "./person";
import { Ctl, Section, Seg, Status, Sw } from "./ui";

export const OWN_DEVICE_OFF = "Needs the engine's own-device sign-in setting.";
export const PROVE_OFF = "Needs the engine's sign-in methods for people.";
export const STAY_OFF = "Needs the engine's sign-in lifetime setting.";
export const DEFAULT_ROLE_OFF = "Needs the engine's default role for new people.";
export const ADMIN_OFF = "Needs an Admin's sign-in.";
const CIDR = /^(\d{1,3}(\.\d{1,3}){3}(\/\d{1,2})?|[0-9a-f:]+(\/\d{1,3})?)$/i;
const ORIGIN = /^https:\/\/[^/\s?#]+$|^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

/** A config change saved against the revision it was read at (config.patch baseHash). */
function patchOf(path: string[], value: unknown): Rec { return path.reduceRight<unknown>((v, k) => ({ [k]: v }), value) as Rec; }

export function SigninTab({ engine, level, openSettings }: { engine: WindowEngine; level: Level; openSettings?: (page: string) => void }) {
  return <>
    <Ctl title="Let people sign in from their own device" line="They open this Branch’s address on their phone or computer. The sign-in page opens only once you have allowed someone to use their own device; otherwise it stays shut."><Seg label="Let people sign in from their own device" value={null} options={[{ id: "off", name: "Off" }, { id: "when-needed", name: "When needed" }, { id: "on", name: "On" }]} off={OWN_DEVICE_OFF} /></Ctl>
    <Ctl title="How they prove it’s them" line="Everyone passes this check."><Seg label="How they prove it’s them" value={null} options={[{ id: "pin", name: "PIN" }, { id: "passkey", name: "Passkey" }, { id: "identity", name: "An identity service" }]} off={PROVE_OFF} /></Ctl>
    <Ctl title="Stay signed in for" line="After this, they sign in again."><Seg label="Stay signed in for" value={null} options={[{ id: "1h", name: "1 hour" }, { id: "8h", name: "8 hours" }, { id: "week", name: "A week" }, { id: "out", name: "Until they sign out" }]} off={STAY_OFF} /></Ctl>
    <Ctl title="Wrong PINs" line="After five wrong PINs in a row, Branch messages the owner; the profile stays locked until the right PIN." off={PIN_OFF}>{openSettings && <button type="button" className="link" onClick={() => openSettings("permissions")}>Where to tell me</button>}</Ctl>
    <Ctl title="Ask for my PIN when switching back to me" line="Asks for your PIN when someone switches back to you."><Sw label="Ask for my PIN when switching back to me" on={false} off={PIN_OFF} /></Ctl>
    <Devices engine={engine} level={level} />
    {shows(level, "advanced") && <PairingRules engine={engine} />}
  </>;
}

function PairingRules({ engine }: { engine: WindowEngine }) {
  const config = useResource<unknown>(engine, "config.get");
  const op = useOperation(engine);
  const snap = rec(config.data), gateway = rec(rec(snap.config).gateway), pairing = rec(rec(gateway.nodes).pairing);
  const admin = engine.scopes.includes("operator.admin");
  const off = !admin ? ADMIN_OFF : !str(snap.hash) ? "The engine did not give a configuration revision." : op.busy ? "Saving…" : undefined;
  const save = (path: string[], value: unknown) => void op.run("config.patch", { raw: JSON.stringify(patchOf(path, value)), baseHash: str(snap.hash) }, config.reload);
  const ssh = pairing.sshVerify !== false;
  return <>
    <Status {...config} />
    <Ctl title="Approve a computer I can reach over SSH" line="When Branch can check a new computer’s key over SSH, it is approved without waiting." off={!admin ? ADMIN_OFF : undefined}><Sw label="Approve a computer I can reach over SSH" on={ssh} off={off} onChange={on => save(["gateway", "nodes", "pairing", "sshVerify"], on)} /></Ctl>
    <TextRow title="Approve computers from these addresses" line="Only for computers that lend their tools, never for people’s browsers or upgrades." placeholder="192.168.1.0/24" value={strs(pairing.autoApproveCidrs).join(", ")} off={off}
      check={v => v.split(/[\s,]+/).filter(Boolean).every(x => CIDR.test(x))} save={v => save(["gateway", "nodes", "pairing", "autoApproveCidrs"], v.split(/[\s,]+/).filter(Boolean))} />
    <Section title="A shared team Branch">
      <p className="pp-hint" style={{ margin: "0 0 8px" }}>Run one Branch your team reaches from their own browsers and chat apps.</p>
      <TextRow title="Its web address" line="Off until you choose: it opens this Branch to people on other computers." placeholder="https://branch.example" value={str(gateway.publicOrigin)} off={off} confirm
        check={v => !v || ORIGIN.test(v)} save={v => save(["gateway", "publicOrigin"], v || null)} />
      <Ctl title="New people start as" line="Admin is never a good default."><Seg label="New people start as" value={null} options={[{ id: "viewer", name: "Viewer" }, { id: "operator", name: "Operator" }, { id: "admin", name: "Admin" }]} off={str(gateway.publicOrigin) ? DEFAULT_ROLE_OFF : "Set its web address first."} /></Ctl>
    </Section>
    {op.error && <p role="alert" className="pp-error">{op.error}</p>}
  </>;
}

type TextRowProps = { title: string; line: string; placeholder: string; value: string; off?: string; confirm?: boolean; check: (v: string) => boolean; save: (v: string) => void };
function TextRow({ title, line, placeholder, value, off, confirm, check, save }: TextRowProps) {
  const [draft, setDraft] = useState(value);
  const [asking, setAsking] = useState(false);
  useEffect(() => setDraft(value), [value]);
  const v = draft.trim(), ok = check(v), changed = v !== value;
  return <Ctl title={title} line={line}>
    <input className="inp" aria-label={title} placeholder={placeholder} value={draft} disabled={!!off} aria-invalid={!ok} onChange={e => setDraft(e.target.value)} />
    {changed && <button type="button" className="btn sm" disabled={!ok || !!off} title={off} onClick={() => confirm && v ? setAsking(true) : save(v)}>Save</button>}
    {asking && <Dialog title="Open this Branch to other computers?" onClose={() => setAsking(false)} footer={<><button type="button" className="btn ghost" onClick={() => setAsking(false)}>Cancel</button><button type="button" className="btn pri" onClick={() => { setAsking(false); save(v); }}>Open it</button></>}>
      <p style={{ margin: 0 }}>People on other computers can reach this Branch at {v}.</p></Dialog>}
  </Ctl>;
}
