import { useId, useRef, useState } from "react";
import type { WindowEngine } from "../connect/engine";
import { createTrunk, loadRoster, makeDefault } from "../places/trunk/api";
import { creationProblem } from "../places/trunk/model";
import { SetupShell } from "./SetupShell";

// Match the engine's normalizeAgentIdStrict when locating an existing Trunk by its ID.
const idForName = (value: string) => value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64);
/** A usable default Trunk is required before leaving onboarding, even when a technical owner exists. */
export function FirstTrunk({ engine, onCreated, onBack, onSkip }: { engine: WindowEngine; onCreated: (id: string, name: string) => void; onBack: (step: number) => void; onSkip: () => void }) {
  const formId = useId();
  const nameId = useId();
  const submitting = useRef(false);
  const [name, setName] = useState("");
  const [created, setCreated] = useState<{ id: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [existing, setExisting] = useState<{ id: string; name: string } | null>(null);
  const save = async (useDefault = false, useExisting = false) => {
    if (submitting.current || (!useDefault && !useExisting && !created && !name.trim())) return;
    submitting.current = true;
    setBusy(true); setError("");
    try {
      setProgress(created || useExisting ? "Saving your default Trunk…" : "Creating your Trunk…");
      let contact = created ?? (useExisting ? existing : null);
      if (!contact) {
        const chosenName = useDefault ? "Branch Agent" : name.trim();
        try {
          contact = { id: await createTrunk(engine, chosenName), name: chosenName };
        } catch (e) {
          if (/already exists/i.test(e instanceof Error ? e.message : String(e))) {
            const roster = await loadRoster(engine);
            const match = roster.agents.find((agent) => agent.id === idForName(chosenName));
            if (useDefault && match) {
              contact = { id: match.id, name: match.name };
            } else {
              if (match) setExisting({ id: match.id, name: match.name });
              setError(match ? `A Trunk named ${match.name} already exists. Use that Trunk or choose another name.` : "That Trunk name is already taken. Choose another name.");
              return;
            }
          } else {
            setError(creationProblem(e));
            return;
          }
        }
      }
      if (!contact) return;
      setCreated(contact);
      setProgress("Saving your default Trunk…");
      await makeDefault(engine, await loadRoster(engine), contact.id);
      onCreated(contact.id, contact.name);
      if (useDefault) onSkip();
    } catch (e) {
      setError("Couldn’t save your default Trunk. Try again.");
    } finally {
      submitting.current = false;
      setBusy(false);
      setProgress("");
    }
  };
  return <SetupShell step={4} reach={busy ? 0 : 4} done={(i) => i < 4} onStep={(i) => { if (!busy && i < 4) onBack(i); }} onSkip={busy ? null : () => void save(true)}
    title="Create your first Trunk" lede="Your Trunk is a contact with one ongoing conversation. New chats go here until you choose another default."
    footer={<><button type="button" className="btn ghost" disabled={busy} onClick={() => onBack(3)}>Back</button><span className="grow" /><button type="submit" form={formId} className="btn pri" data-testid="first-trunk-create" disabled={busy || (!created && !name.trim())}>{busy ? "Working…" : created ? "Continue" : "Create Trunk"}</button></>}>
    <form id={formId} aria-busy={busy} onSubmit={e => { e.preventDefault(); void save(); }}>
    <label className="fld" htmlFor={nameId}><span>Name your Trunk</span><input id={nameId} className="inp" value={name} disabled={busy || !!created} onChange={e => { setName(e.target.value); setExisting(null); setError(""); }} autoComplete="off" /></label>
    {progress ? <p role="status">{progress}</p> : null}
    {error ? <p role="alert">{error}</p> : null}
    {existing ? <button type="button" className="btn" disabled={busy} onClick={() => void save(false, true)}>Use existing {existing.name} Trunk</button> : null}
    </form>
  </SetupShell>;
}
