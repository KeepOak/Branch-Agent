// "Remove <Name>?" (preview 31-trunksp ACTS.remove): agents.delete moves the Trunk's conversations and files to the
// Trash. The engine can't bring a removed Trunk back, so this is a confirm dialog with no Undo.
import { useState } from "react";
import type { WindowEngine } from "../../connect/engine";
import { Dialog } from "../../shell/Dialog";
import { notify } from "../../shell/notify";
import { removeTrunk } from "./api";
import { canWrite, WRITE_WHY } from "./data";
import { errorText } from "./model";
import { Layer } from "./layer";
import "./trunk.css";

export type RemoveTrunkProps = { engine: WindowEngine; agentId: string; name: string; onClose: () => void; onRemoved?: () => void };

export function RemoveTrunkDialog({ engine, agentId, name, onClose, onRemoved }: RemoveTrunkProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const write = canWrite(engine);
  const go = async () => {
    setBusy(true); setError(null);
    try {
      const stuck = await removeTrunk(engine, agentId);
      if (stuck) notify(`${name} is removed, but ${stuck === 1 ? "one of its files" : `${stuck} of its files`} couldn’t move to the Trash.`, { tone: "bad", keep: true });
      else notify(`Removed. ${name}’s conversations and files are in the Trash.`);
      onRemoved?.(); onClose();
    }
    catch (e) { setError(errorText(e)); }
    finally { setBusy(false); }
  };
  const footer = <>
    <button type="button" className="btn ghost" onClick={onClose}>Keep {name}</button>
    <button type="button" className="btn bad" disabled={busy || !write} title={write ? undefined : WRITE_WHY} onClick={() => void go()}>{busy ? "Removing…" : "Remove"}</button>
  </>;
  return (
    <Layer><Dialog title={`Remove ${name}?`} onClose={onClose} footer={footer} testid="trunk-remove">
      <p className="tk-hint tk-plain">{name}’s conversations and files move to the Trash; nothing is deleted for good. Its automations stop.</p>
      {error && <p className="tk-error" role="alert">{error}</p>}
    </Dialog></Layer>
  );
}
