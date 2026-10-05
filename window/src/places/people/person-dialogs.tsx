// People › People dialogs: role, one-time code (device.pair.setupCode), invite, link an email, merge two people.
// TODO(engine-lane): the greyed reasons in this file say what is still missing; shownWhy (shell/shown-why.ts) keeps them out of sight.
import { useState } from "react";
import { shownWhy } from "../../shell/shown-why";
import { Dialog } from "../../shell/Dialog";
import type { WindowEngine } from "../../connect/engine";
import { useOperation } from "../library/data";
import { firstName, nameOf, num, rec, str, type Profile } from "./data";
import { Seg, Tabs, copyText } from "./ui";

export const ROLES_OFF = "Needs roles set up in the engine first.";
export const ADD_HERE_OFF = "Needs the engine's add-a-person method.";
export const KEEPOAK_OFF = "Needs your keepoak.com team. Connect it above.";
const NO_ROLE = "__none";

/** The person's role, chosen from the roles the engine defines (users.setRole); none defined greys it. */
export function RoleSeg({ engine, person, roles, reload }: { engine: WindowEngine; person: Profile; roles: string[]; reload: () => void }) {
  const op = useOperation(engine);
  const options = [...roles.map(r => ({ id: r, name: r })), { id: NO_ROLE, name: "No role" }];
  const value = person.role && roles.includes(person.role) ? person.role : person.role ? null : NO_ROLE;
  return <>
    <Seg label={`${nameOf(person)}’s role`} value={value} options={options} off={roles.length ? (op.busy ? "Saving…" : undefined) : ROLES_OFF}
      onChange={role => void op.run("users.setRole", { profileId: person.id, role: role === NO_ROLE ? null : role }, reload)} />
    {op.error && <span role="alert" className="pp-error">{op.error}</span>}
  </>;
}

type Setup = { setupCode: string; qrDataUrl?: string; gatewayUrl: string; expiresAtMs?: number };
/** Makes a one-time code that lets a person's own device connect, with limited (non-admin) access. */
function useSetupCode(engine: WindowEngine) {
  const op = useOperation(engine);
  const [setup, setSetup] = useState<Setup | null>(null);
  const make = () => void op.run<unknown>("device.pair.setupCode", { bootstrapProfile: "limited" }, result => {
    const r = rec(result);
    setSetup({ setupCode: str(r.setupCode), qrDataUrl: str(r.qrDataUrl) || undefined, gatewayUrl: str(r.gatewayUrl), expiresAtMs: num(r.expiresAtMs) });
  });
  return { setup, make, busy: op.busy, error: op.error };
}

function CodeBody({ setup }: { setup: Setup }) {
  const [copied, setCopied] = useState<string | null>(null);
  const minutes = setup.expiresAtMs ? Math.max(1, Math.round((setup.expiresAtMs - Date.now()) / 60_000)) : null;
  return <>
    <p style={{ margin: 0 }}>On their phone or computer, they scan this or paste the code into Branch to reach <code>{setup.gatewayUrl}</code>.</p>
    {setup.qrDataUrl && <img src={setup.qrDataUrl} alt="One-time code as a QR code" width={180} height={180} style={{ justifySelf: "start" }} />}
    <code className="pp-code" style={{ fontSize: 13, overflowWrap: "anywhere", maxWidth: "100%" }}>{setup.setupCode}</code>
    <div className="pp-acts"><button type="button" className="btn sm" onClick={() => { void copyText(setup.setupCode).then(ok => setCopied(ok ? "Copied." : "Couldn’t copy.")); }}>Copy the code</button>{copied && <span role="status" className="pp-mut">{copied}</span>}</div>
    <p className="pp-hint" style={{ margin: 0 }}>{minutes ? `Works once, for ${minutes} minutes.` : "Works once."}</p>
  </>;
}

export function CodeDialog({ engine, title, onClose }: { engine: WindowEngine; title: string; onClose: () => void }) {
  const code = useSetupCode(engine);
  return <Dialog title={title} onClose={onClose} footer={<><button type="button" className="btn ghost" onClick={onClose}>Close</button>{!code.setup && <button type="button" className="btn pri" disabled={code.busy} onClick={code.make}>{code.busy ? "Making…" : "Make a one-time code"}</button>}</>}>
    <div className="ppl-dlg" style={{ display: "grid", gap: 12 }}>
      {code.setup ? <CodeBody setup={code.setup} /> : <p style={{ margin: 0 }}>A code their own phone or computer uses once to reach this Branch. It never gives them the owner’s rights.</p>}
      {code.error && <p role="alert" className="pp-error">{code.error}</p>}
    </div>
  </Dialog>;
}

type InviteTab = "this" | "device" | "keepoak";
export function InviteDialog({ engine, onClose }: { engine: WindowEngine; onClose: () => void }) {
  const [tab, setTab] = useState<InviteTab>("this");
  const code = useSetupCode(engine);
  const footer = <><button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
    {tab === "this" && <button type="button" className="btn pri" disabled title={shownWhy(ADD_HERE_OFF)}>Add them</button>}
    {tab === "keepoak" && <button type="button" className="btn pri" disabled title={KEEPOAK_OFF}>Invite</button>}
    {tab === "device" && !code.setup && <button type="button" className="btn pri" disabled={code.busy} onClick={code.make}>{code.busy ? "Making…" : "Make a one-time code"}</button>}</>;
  return <Dialog title="Invite someone" onClose={onClose} footer={footer}>
    <div className="ppl-dlg" style={{ display: "grid", gap: 12 }}>
      <Tabs label="How they use Branch" value={tab} onChange={setTab} tabs={[{ id: "this", name: "On this computer" }, { id: "device", name: "On their own device" }, { id: "keepoak", name: "From your keepoak.com team" }]} />
      {tab === "this" && <fieldset disabled title={shownWhy(ADD_HERE_OFF)} style={{ border: 0, padding: 0, margin: 0, display: "grid", gap: 12 }}>
        <label className="fld"><span>Name</span><input className="inp" placeholder="Their name" /></label>
        <div className="fld"><span>Role</span><Seg label="Role" value={null} options={[{ id: "adult", name: "Adult" }, { id: "child", name: "Child" }]} off={ADD_HERE_OFF} /></div>
        <label className="fld"><span>Their PIN, at least four digits</span><input className="inp" inputMode="numeric" /></label>
        {shownWhy(ADD_HERE_OFF) && <p className="pp-hint" style={{ margin: 0 }}>{shownWhy(ADD_HERE_OFF)}</p>}</fieldset>}
      {tab === "device" && (code.setup ? <CodeBody setup={code.setup} /> : <p style={{ margin: 0 }}>Make a one-time code. Their phone or computer uses it once to reach this Branch.</p>)}
      {tab === "keepoak" && <fieldset disabled title={KEEPOAK_OFF} style={{ border: 0, padding: 0, margin: 0, display: "grid", gap: 12 }}>
        <label className="fld"><span>Their email</span><input className="inp" type="email" placeholder="name@example.com" /></label>
        <div className="fld"><span>Role on keepoak.com</span><Seg label="Role on keepoak.com" value="operator" options={[{ id: "admin", name: "Admin" }, { id: "operator", name: "Operator" }, { id: "viewer", name: "Viewer" }]} off={KEEPOAK_OFF} /></div>
        <p className="pp-hint" style={{ margin: 0 }}>There’s nothing to accept: signing in to keepoak.com with that email joins your workspace. {KEEPOAK_OFF}</p></fieldset>}
      {code.error && <p role="alert" className="pp-error">{code.error}</p>}
    </div>
  </Dialog>;
}

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
export function LinkEmailDialog({ engine, person, onClose, onDone }: { engine: WindowEngine; person: Profile; onClose: () => void; onDone: () => void }) {
  const op = useOperation(engine);
  const [email, setEmail] = useState("");
  const [bad, setBad] = useState(false);
  const save = () => { if (!EMAIL.test(email.trim())) { setBad(true); return; }
    void op.run("users.linkEmail", { email: email.trim(), targetProfileId: person.id }, () => { onDone(); onClose(); }); };
  return <Dialog title={`Link an email to ${firstName(nameOf(person))}`} onClose={onClose} footer={<><button type="button" className="btn ghost" onClick={onClose}>Cancel</button><button type="button" className="btn pri" disabled={op.busy} onClick={save}>Link</button></>}>
    <div className="ppl-dlg" style={{ display: "grid", gap: 12 }}>
      <label className="fld"><span>Email</span><input className="inp" type="email" value={email} aria-invalid={bad} onChange={e => { setEmail(e.target.value); setBad(false); }} placeholder="name@example.com" /></label>
      <p className="pp-hint" style={{ margin: 0 }}>If the address belongs to someone else, it moves here; when it was their last address, they are merged into {firstName(nameOf(person))}.</p>
      {op.error && <p role="alert" className="pp-error">{op.error}</p>}
    </div>
  </Dialog>;
}

export function MergeDialog({ engine, person, others, onClose, onDone }: { engine: WindowEngine; person: Profile; others: Profile[]; onClose: () => void; onDone: () => void }) {
  const op = useOperation(engine);
  const [target, setTarget] = useState(others[0]?.id ?? "");
  const stays = others.find(p => p.id === target);
  return <Dialog title={`Merge ${firstName(nameOf(person))} into…`} onClose={onClose} footer={<><button type="button" className="btn ghost" onClick={onClose}>Cancel</button><button type="button" className="btn pri" disabled={!stays || op.busy} onClick={() => void op.run("users.merge", { sourceProfileId: person.id, targetProfileId: target }, () => { onDone(); onClose(); })}>Merge</button></>}>
    <div className="ppl-dlg" style={{ display: "grid", gap: 12 }}>
      {others.length ? <label className="fld"><span>Who stays</span><select className="inp" value={target} onChange={e => setTarget(e.target.value)}>{others.map(p => <option key={p.id} value={p.id}>{nameOf(p)}</option>)}</select></label> : <p style={{ margin: 0 }}>Nobody else to merge with.</p>}
      {stays && <p style={{ margin: 0 }}>Merge {nameOf(person)} into {nameOf(stays)}? Their emails, sign-ins and chat app accounts move to {nameOf(stays)}, and {nameOf(person)} leaves the list.</p>}
      {op.error && <p role="alert" className="pp-error">{op.error}</p>}
    </div>
  </Dialog>;
}
