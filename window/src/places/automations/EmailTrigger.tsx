// Automations › When an email arrives. The mailbox is one already connected through the credential store.
// Saving writes the IMAP plugin's folder, filter and Trunk. It never sends a password.
import { Failure } from "./Failure";
import { useState } from "react";
import type { WindowEngine } from "../../connect/engine";
import { useAct } from "./act";
import { patchConfig } from "./data";
import { Glyph } from "./glyphs";
import { connectedMailboxes, imapTriggerPatch, triggerSummary, validateImapTrigger, type MailboxChoice } from "./imap-trigger";
import { Field, type Trunk } from "./Proposal";
import { errorText, usePlaceData } from "./runtime";
import { Section, ToolRow } from "./Sections";

const loadMailboxes = async (engine: WindowEngine) => connectedMailboxes(await engine.request("config.get", {}));
const EMPTY: MailboxChoice[] = [];

type Draft = { accountId: string; folder: string; filter: string; agentId: string };

export function EmailTrigger({ engine, trunks, canWrite }: { engine: WindowEngine; trunks: Trunk[]; canWrite: boolean }) {
  const state = usePlaceData(engine, loadMailboxes);
  const { busy, run } = useAct(state.refresh);
  const mailboxes = state.data ?? EMPTY;
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState("");
  const stored = mailboxes.find(box => box.id === draft?.accountId) ?? mailboxes.find(box => box.agentId) ?? mailboxes[0];
  const accountId = draft?.accountId && mailboxes.some(box => box.id === draft.accountId) ? draft.accountId : stored?.id ?? "";
  const selected = mailboxes.find(box => box.id === accountId);
  const folder = draft && draft.accountId === accountId ? draft.folder : selected?.folder || "INBOX";
  const filter = draft && draft.accountId === accountId ? draft.filter : selected?.filter ?? "";
  const agentId = draft && draft.accountId === accountId ? draft.agentId : selected?.agentId || trunks[0]?.id || "";
  const edit = (patch: Partial<Draft>) => {
    setError("");
    setDraft({ accountId, folder, filter, agentId, ...patch });
  };
  const pick = (id: string) => {
    const box = mailboxes.find(item => item.id === id);
    setError("");
    setDraft({
      accountId: id,
      folder: box?.folder || "INBOX",
      filter: box?.filter ?? "",
      agentId: box?.agentId || trunks[0]?.id || "",
    });
  };
  const save = () => {
    let trigger;
    try {
      setError("");
      trigger = validateImapTrigger({ accountId, folder, filter, agentId }, mailboxes);
    } catch (cause) {
      setError(errorText(cause));
      return;
    }
    void run(() => patchConfig(engine, imapTriggerPatch(trigger)), "Email trigger saved.");
  };
  return <Section title="Email" hint="When an email arrives in a mailbox you already connected, a Trunk starts with that email as its context.">
    {state.error && <div className="au-error" role="alert"><Failure error={state.error} /></div>}
    {!state.loading && !mailboxes.length && !state.error && <ToolRow icon="mail" title="When an email arrives in..." sub="A Trunk starts with that email as its context." button="Turn on" reason="Connect a mailbox first." />}
    {mailboxes.length > 0 && <section className="au-prop" aria-label="When an email arrives">
      <div className="au-prop-h"><Glyph name="mail" /><b>When an email arrives in...</b></div>
      <Field label="Mailbox">
        <select className="inp" aria-label="Mailbox" value={accountId} onChange={e => pick(e.target.value)}>
          {mailboxes.map(box => <option key={box.id} value={box.id}>{box.label}</option>)}
        </select>
      </Field>
      <Field label="Folder" hint="The folder to watch, such as INBOX.">
        <input className="inp" aria-label="Folder" value={folder} onChange={e => edit({ folder: e.target.value })} />
      </Field>
      <Field label="Filter" hint="Optional. Matches when the sender or the subject contains this text.">
        <input className="inp" aria-label="Filter" placeholder="Sender or subject contains" value={filter} onChange={e => edit({ filter: e.target.value })} />
      </Field>
      <Field label="Who does it">
        <select className="inp" aria-label="Who does it" value={agentId} onChange={e => edit({ agentId: e.target.value })}>
          {!agentId && <option value="">Choose a Trunk</option>}
          {trunks.map(trunk => <option key={trunk.id} value={trunk.id}>{trunk.name}</option>)}
          {agentId && !trunks.some(trunk => trunk.id === agentId) && <option value={agentId}>{agentId}</option>}
        </select>
      </Field>
      {selected && selected.allowedSenders === 0 && <p className="au-hint">This mailbox has no allowed senders yet, so new mail does not start a Trunk.</p>}
      {error && <div className="au-error" role="alert"><Failure error={error} /></div>}
      <div className="au-actions">
        <button type="button" className="btn pri sm" disabled={!canWrite || busy} title={canWrite ? undefined : "Needs an owner"} onClick={save}>Save trigger</button>
      </div>
    </section>}
    {mailboxes.filter(box => box.agentId).map(box => <Saved key={box.id} box={box} />)}
  </Section>;
}

function Saved({ box }: { box: MailboxChoice }) {
  return <div className="au-tool">
    <span className="au-tile"><Glyph name="mail" /></span>
    <span className="au-grow"><b>When an email arrives in {box.label}</b><small>{triggerSummary(box)}</small></span>
  </div>;
}
