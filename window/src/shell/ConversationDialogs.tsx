// The dialogs the conversation ⋯ menu opens (DESIGN-SPEC §4.2.7): Start over, About this conversation, Map of
// this conversation, Share, Remove Trunk. Each reads and writes through the engine method its row names.
import { useEffect, useState } from "react";
import type { WindowEngine } from "../connect/engine";
import { Dialog } from "./Dialog";

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const reason = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Runs an engine call from a dialog button: busy while it runs, its error under the body, closed when it works. */
function useRun(onDone: () => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = (work: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    work().then(onDone, (e: unknown) => {
      setBusy(false);
      setError(reason(e));
    });
  };
  return { busy, error, run };
}

export function StartOverDialog({ trunkName, onStart, onClose }: { trunkName: string; onStart: () => Promise<unknown>; onClose: () => void }) {
  const { busy, error, run } = useRun(onClose);
  const footer = (
    <>
      <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
      <button type="button" className="btn bad" disabled={busy} onClick={() => run(onStart)}>Start over</button>
    </>
  );
  return (
    <Dialog title="Start this conversation over?" onClose={onClose} footer={footer} testid="start-over">
      <p className="lede">{trunkName} starts fresh here with a new start: what was said before is cleared from this conversation. It stays in your list.</p>
      {error ? <p className="field-error" role="alert">{error}</p> : null}
    </Dialog>
  );
}

type Tip = { leafEntryId: string; headline: string; messageCount: number; active: boolean };

/** Map of this conversation: the paths it has taken (sessions.branches.list); picking one switches to it. */
export function MapDialog({ engine, sessionKey, agentId, onSwitched, onClose }: { engine: WindowEngine; sessionKey: string; agentId?: string; onSwitched: () => void; onClose: () => void }) {
  const [tips, setTips] = useState<Tip[] | null>(null);
  const { busy, error, run } = useRun(() => {
    onSwitched();
    onClose();
  });
  const [loadError, setLoadError] = useState<string | null>(null);
  const target = { sessionKey, ...(agentId ? { agentId } : {}) };
  useEffect(() => {
    engine.request("sessions.branches.list", { sessionKey, ...(agentId ? { agentId } : {}) }).then(
      (r) => setTips((Array.isArray(rec(r).branches) ? (rec(r).branches as unknown[]) : []).map(rec).map((b) => ({ leafEntryId: str(b.leafEntryId), headline: str(b.headline), messageCount: Number(b.messageCount) || 0, active: b.active === true }))),
      (e: unknown) => setLoadError(reason(e)),
    );
  }, [engine, sessionKey, agentId]);
  return (
    <Dialog title="Map of this conversation" wide onClose={onClose} footer={<button type="button" className="btn primary" onClick={onClose}>Close</button>} testid="conversation-map">
      {loadError ? <p className="field-error" role="alert">{loadError}</p> : null}
      {tips && tips.length < 2 ? <p className="hint">One path so far. Conversations branched off with “Branch from here” show here.</p> : null}
      {tips && tips.length > 1 ? (
        <ol className="conv-map">
          {tips.map((t) => (
            <li key={t.leafEntryId}>
              <button type="button" className={t.active ? "conv-map-row on" : "conv-map-row"} aria-current={t.active} disabled={busy || t.active}
                onClick={() => run(() => engine.request("sessions.branches.switch", { ...target, leafEntryId: t.leafEntryId }))}>
                <span>{t.headline || "Untitled path"}</span>
                <small>{t.active ? "Here now" : `${t.messageCount} messages`}</small>
              </button>
            </li>
          ))}
        </ol>
      ) : null}
      {error ? <p className="field-error" role="alert">{error}</p> : null}
    </Dialog>
  );
}
