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
export const TRUNK_REMOVED_EVENT = "branch:trunk-removed";

export function RemoveTrunkDialog({ engine, agentId, name, onClose, onRemoved }: RemoveTrunkProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const write = canWrite(engine);
  const go = async () => {
    setBusy(true); setError(null);
    try {
      const { failed, purgeFailed } = await removeTrunk(engine, agentId);
      const problems = [...failed, ...(purgeFailed ? ["Some conversation records could not be cleared."] : [])];
      if (problems.length) notify(`Removed ${name}, but cleanup needs attention.`, { tone: "bad", keep: true, line: problems.join("\n") });
      else notify(`Removed ${name}. Its files moved to the Trash and its automations stopped.`);
      window.dispatchEvent(new CustomEvent(TRUNK_REMOVED_EVENT, { detail: { agentId } }));
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
      <p className="tk-hint tk-plain">{name} and its conversations will be removed. Its files move to the Trash on this computer, and its automations stop. Branch cannot undo this removal.</p>
      {error && <p className="tk-error" role="alert">{error}</p>}
    </Dialog></Layer>
  );
}
