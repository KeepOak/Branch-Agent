import { useId, useRef, useState } from "react";
import type { WindowEngine } from "../connect/engine";
import { createTrunk, loadRoster, makeDefault } from "../places/trunk/api";
import { SetupShell } from "./SetupShell";

/** A confirmed contact is required before leaving onboarding, even when a technical owner exists. */
export function FirstTrunk({ engine, onCreated }: { engine: WindowEngine; onCreated: (id: string, name: string) => void }) {
  const formId = useId();
  const submitting = useRef(false);
  const [name, setName] = useState("");
  const [created, setCreated] = useState<{ id: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const create = async () => {
    if (submitting.current || (!created && !name.trim())) return;
    submitting.current = true;
    setBusy(true); setError("");
    try {
      const contact = created ?? { id: await createTrunk(engine, name.trim()), name: name.trim() };
      setCreated(contact);
      await makeDefault(engine, await loadRoster(engine), contact.id);
      onCreated(contact.id, contact.name);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };
  return <SetupShell step={4} reach={0} done={(i) => i === 0} onStep={() => {}} onSkip={null}
    title="Create your first Trunk" lede="Your Trunk is a contact with one ongoing conversation. New chats go here until you choose another default."
    footer={<><span className="grow" /><button type="submit" form={formId} className="btn pri" data-testid="first-trunk-create" disabled={busy || !name.trim()}>{busy ? "Creating…" : created ? "Continue" : "Create Trunk"}</button></>}>
    <form id={formId} aria-busy={busy} onSubmit={e => { e.preventDefault(); void create(); }}>
    <label className="fld"><span>Name your Trunk</span><input className="inp" value={name} disabled={busy || !!created} onChange={e => setName(e.target.value)} autoComplete="off" /></label>
    {error ? <p role="alert">{error}</p> : null}
    </form>
  </SetupShell>;
}
