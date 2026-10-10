// "Remove <Name>?" (preview 31-trunksp ACTS.remove). Choosing Remove checks the Trunk, then starts a 5-second window with
// an Undo toast. agents.delete (it moves the Trunk's files to the Trash) runs only when the window ends. The schedule lives
// at module scope, so closing the dialog does not drop it; if the window closes first, nothing is removed.
import { useState } from "react";
import type { WindowEngine } from "../../connect/engine";
import { Dialog } from "../../shell/Dialog";
import { dismiss, notify } from "../../shell/notify";
import { checkRemovable, removeTrunk } from "./api";
import { canWrite, WRITE_WHY } from "./data";
import { errorText } from "./model";
import { Layer } from "./layer";
import "./trunk.css";

export type RemoveTrunkProps = { engine: WindowEngine; agentId: string; name: string; onClose: () => void; onRemoved?: () => void };
export const TRUNK_REMOVED_EVENT = "branch:trunk-removed";
export const REMOVE_DELAY_MS = 5000;

type Scheduled = { timer: ReturnType<typeof setTimeout>; toast: number };
const scheduled = new Map<string, Scheduled>();

function undoRemoval(agentId: string, name: string): void {
  const item = scheduled.get(agentId);
  if (!item) return;
  clearTimeout(item.timer);
  dismiss(item.toast);
  scheduled.delete(agentId);
  notify(`${name} is kept.`);
}

async function commitRemoval(engine: WindowEngine, agentId: string, name: string, toast: number): Promise<void> {
  scheduled.delete(agentId);
  dismiss(toast);
  try {
    const { failed, purgeFailed } = await removeTrunk(engine, agentId);
    const problems = [...failed, ...(purgeFailed ? ["Some conversation records could not be cleared."] : [])];
    if (problems.length) notify(`Removed ${name}, but cleanup needs attention.`, { tone: "bad", keep: true, line: problems.join("\n") });
    else notify(`Removed ${name}. Its files moved to the Trash and its automations stopped.`);
    window.dispatchEvent(new CustomEvent(TRUNK_REMOVED_EVENT, { detail: { agentId } }));
  } catch (cause) {
    notify(`Couldn’t remove ${name}.`, { tone: "bad", keep: true, line: errorText(cause) });
  }
}

/** Starts the removal window for a Trunk. A second call for the same Trunk while its window is open does nothing. */
export function scheduleRemoval(engine: WindowEngine, agentId: string, name: string, delay = REMOVE_DELAY_MS): void {
  if (scheduled.has(agentId)) return;
  const toast = notify(`${name} will be removed in ${Math.round(delay / 1000)} seconds.`, { action: { label: "Undo", run: () => undoRemoval(agentId, name) } });
  const timer = setTimeout(() => void commitRemoval(engine, agentId, name, toast), delay);
  scheduled.set(agentId, { timer, toast });
}

export function RemoveTrunkDialog({ engine, agentId, name, onClose, onRemoved }: RemoveTrunkProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const write = canWrite(engine);
  const go = async () => {
    setBusy(true); setError(null);
    try {
      await checkRemovable(engine, agentId);
      scheduleRemoval(engine, agentId, name);
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
      <p className="tk-hint tk-plain">{name} and its conversations will be removed. Its files move to the Trash on this computer, and its automations stop. You can undo for 5 seconds after you choose Remove.</p>
      {error && <p className="tk-error" role="alert">{error}</p>}
    </Dialog></Layer>
  );
}
