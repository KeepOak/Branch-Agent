import { useId, useRef, useState } from "react";
import type { WindowEngine } from "../connect/engine";
import { createTrunk, loadRoster, makeDefault } from "../places/trunk/api";
import { SetupShell } from "./SetupShell";

/** A confirmed contact is required before leaving onboarding, even when a technical owner exists. */
export function FirstTrunk({ engine, onCreated, onBack, onSkip }: { engine: WindowEngine; onCreated: (id: string, name: string) => void; onBack: (step: number) => void; onSkip: () => void }) {
  const formId = useId();
  const nameId = useId();
  const submitting = useRef(false);
  const [name, setName] = useState("");
  const [created, setCreated] = useState<{ id: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const create = async () => {
    if (submitting.current || (!created && !name.trim())) return;
    submitting.current = true;
    setBusy(true); setError("");
    try {
      setProgress(created ? "Saving your default Trunk…" : "Creating your Trunk…");
      const contact = created ?? { id: await createTrunk(engine, name.trim()), name: name.trim() };
      setCreated(contact);
      setProgress("Saving your default Trunk…");
      await makeDefault(engine, await loadRoster(engine), contact.id);
      onCreated(contact.id, contact.name);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      submitting.current = false;
      setBusy(false);
      setProgress("");
    }
  };
  return <SetupShell step={4} reach={busy ? 0 : 4} done={(i) => i < 4} onStep={(i) => { if (!busy && i < 4) onBack(i); }} onSkip={busy ? null : onSkip}
    title="Create your first Trunk" lede="Your Trunk is a contact with one ongoing conversation. New chats go here until you choose another default."
    footer={<><button type="button" className="btn ghost" disabled={busy} onClick={() => onBack(3)}>Back</button><span className="grow" /><button type="submit" form={formId} className="btn pri" data-testid="first-trunk-create" disabled={busy || !name.trim()}>{busy ? "Working…" : created ? "Continue" : "Create Trunk"}</button></>}>
    <form id={formId} aria-busy={busy} onSubmit={e => { e.preventDefault(); void create(); }}>
    <label className="fld" htmlFor={nameId}><span>Name your Trunk</span><input id={nameId} className="inp" value={name} disabled={busy || !!created} onChange={e => setName(e.target.value)} autoComplete="off" /></label>
    {progress ? <p role="status">{progress}</p> : null}
    {error ? <p role="alert">{error}</p> : null}
    </form>
  </SetupShell>;
}
