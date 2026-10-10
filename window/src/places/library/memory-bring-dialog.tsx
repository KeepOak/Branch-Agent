// Library › Memory › Bring in: preview “Move in from another assistant”. Plan, pick one, apply that fingerprint.
import { useEffect, useState } from "react";
import type { WindowEngine } from "../../connect/engine";
import { Dialog } from "../../shell/Dialog";
import { errorText } from "./data";
import {
  applyMemoryImport, readApplySummary, readProviders, summaryLine, whatComesIn,
  type ApplySummary, type ProviderPlan,
} from "./memory-import";
import { Row } from "./parts";
import "../../stage/stage.css";

/** Preview “Move in from another assistant”: plan, pick one, apply that fingerprint, then the summary. */
export function BringInDialog({
  engine, agentId, onClose, onApplied,
}: {
  engine: WindowEngine; agentId: string; onClose: () => void; onApplied?: () => void;
}) {
  const [providers, setProviders] = useState<ProviderPlan[] | null>(null);
  const [pick, setPick] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<ApplySummary | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    engine.request("migrations.memory.plan", { agentId }).then(
      (r) => { if (live) { setProviders(readProviders(r)); setError(null); } },
      (e: unknown) => { if (live) setError(errorText(e)); },
    );
    return () => { live = false; };
  }, [engine, agentId]);
  const chosen = providers?.find((p) => p.providerId === pick);
  const canApply = Boolean(chosen?.found && chosen.fingerprint && chosen.plannedIds.length);
  const bring = async () => {
    if (!chosen || !canApply || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await applyMemoryImport(engine, agentId, { providerId: chosen.providerId, fingerprint: chosen.fingerprint, items: chosen.plannedIds });
      setDone(readApplySummary(result));
      onApplied?.();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  if (done) {
    return (
      <Dialog title="Move-in complete" onClose={onClose} footer={<button type="button" className="btn" onClick={onClose}>Close</button>} testid="bring-in-dialog">
        <p role="status">{summaryLine(done)}</p>
      </Dialog>
    );
  }
  const foundAny = Boolean(providers?.some((p) => p.found && p.plannedIds.length));
  return (
    <Dialog
      title="Move in from another assistant"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn ghost" onClick={onClose}>Not now</button>
          <button type="button" className="btn pri" disabled={!canApply || busy} onClick={() => void bring()}>
            {busy ? "Bringing it in…" : "Bring it in"}
          </button>
        </>
      }
      testid="bring-in-dialog"
    >
      <p className="lib-hint">Branch looked on this computer. Everything comes in as a copy; the other assistant keeps working.</p>
      {providers === null && !error ? <p className="lib-hint" role="status">Looking…</p> : null}
      {providers && !providers.length ? <p className="lib-hint" role="status">Branch found no other assistant's memory on this computer.</p> : null}
      {providers && providers.length && !foundAny ? <p className="lib-hint" role="status">Branch found no other assistant's memory on this computer.</p> : null}
      {providers && providers.length ? (
        <div className="lib-tools" role="radiogroup" aria-label="Assistants on this computer">
          {providers.map((p) => (
            <button
              key={p.providerId}
              type="button"
              className="lib-tool prov-st"
              role="radio"
              aria-checked={pick === p.providerId}
              disabled={!p.found}
              onClick={() => setPick(p.providerId)}
            >
              <span className="lib-grow">
                <b>{p.label} {pick === p.providerId ? <span className="lib-pill work" aria-hidden="true">✓</span> : null}</b>
                <small>{whatComesIn(p)}</small>
              </span>
            </button>
          ))}
        </div>
      ) : null}
      {chosen ? (
        <div className="lib-rows">
          {chosen.items.filter((i) => i.status === "planned").map((i) => (
            <Row key={i.id} title={i.target || i.id} line={[i.source, i.message].filter(Boolean).join(" · ") || undefined}>
              <span className="lib-pill ok">Comes in</span>
            </Row>
          ))}
          {chosen.conflicts ? <Row title="Clashes" line={`${chosen.conflicts} already here. Confirming leaves them unless the engine replaces them.`} /> : null}
          {chosen.warnings.map((w) => <Row key={w} title="Warning" line={w} />)}
          <Row title="Keys and passwords" line="Never copied; you sign in again where needed"><span className="lib-pill">Left out</span></Row>
        </div>
      ) : providers?.length ? <p className="lib-hint">Pick one to see what comes in.</p> : null}
      {error ? <p className="lib-bad" role="alert">{error}</p> : null}
    </Dialog>
  );
}
