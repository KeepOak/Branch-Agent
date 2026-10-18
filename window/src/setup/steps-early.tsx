// Setup steps 1–3 (DESIGN-SPEC §4.8.1.1–§4.8.1.3): Welcome, Where Branch runs and Models. Welcome and Where also
// run before the window is connected (the plain pre-connect screens); Models needs the engine.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { brandOf, Logo } from "../places/settings/set1/service";
import { Icon, type IconName } from "../shell/icons";
import { SETUP_LATER_TOAST, WHERE_PLACES, whereWord, type Candidate, type Detected, type TestResult, type Where } from "./setup-model";
import { shownWhy } from "../shell/shown-why";

export const WELCOME_LEDE = "Agents that work on your computer: Trunks that each take one job off your plate.";
export const WELCOME_LOCK = "It asks before it sends, deletes, spends or installs anything.";
export { SETUP_LATER_TOAST };

export function WelcomeBody({ where, onChangeWhere }: { where: Where; onChangeWhere: () => void }) {
  return (
    <>
      <p className="ob-promise">
        <Icon name="lock" size={15} />
        <span>{WELCOME_LOCK}</span>
      </p>
      <p className="ob-where">
        Runs on <b>{whereWord(where)}</b>
        {" · "}
        <button type="button" className="link" data-testid="setup-where-change" onClick={onChangeWhere}>
          Change
        </button>
      </p>
    </>
  );
}

/** "Where Branch runs": a small glass sheet over the card. */
export function WhereSheet({ where, onPick, onClose }: { where: Where; onPick: (w: Where) => void; onClose: () => void }) {
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    first.current?.focus({ preventScroll: true });
  }, []);
  return (
    <div
      className="ob-sheet-layer"
      data-testid="setup-where-sheet"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <div className="ob-sheet" role="dialog" aria-modal="true" aria-label="Where Branch runs">
        <h2>Where Branch runs</h2>
        <div className="ob-sheet-modes" role="radiogroup" aria-label="Where Branch runs">
          {WHERE_PLACES.map((w, i) => (
            <button key={w.id} type="button" ref={i === 0 ? first : undefined} className="ob-mode" role="radio" aria-checked={where === w.id} data-testid={`setup-pick-${w.id}`} onClick={() => onPick(w.id)}>
              <Icon name={w.icon} size={15} />
              <span>
                <b>{w.name}</b>
                <small>{w.line}</small>
              </span>
            </button>
          ))}
        </div>
        <p className="ob-hint">Restoring from a backup lives in Settings › History & backups.</p>
        <div className="ob-sheet-foot">
          <button type="button" className="btn pri" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

const WHERE: { id: Where; icon: IconName; name: string; line: string; off?: string }[] = WHERE_PLACES.map((w) => ({ id: w.id, icon: w.icon, name: w.name, line: w.line }));

/** Cards like §4.8.1.2: one pressed at a time; a card the engine can't back yet is greyed with its reason. */
export function ChoiceCards<T extends string | number>({ items, value, onPick }: { items: { id: T; icon: IconName; name: string; line: string; off?: string }[]; value: T | null; onPick: (v: T) => void }) {
  return (
    <div className="provs">
      {items.map((c) => (
        <button key={String(c.id)} type="button" className="prov" aria-pressed={c.id === value} aria-disabled={c.off ? true : undefined} title={shownWhy(c.off)} data-testid={`setup-pick-${String(c.id)}`} onClick={() => !c.off && onPick(c.id)}>
          <span className="ico-tile">
            <Icon name={c.icon} small />
          </span>
          <b>{c.name}</b>
          <small>{c.line}</small>
        </button>
      ))}
    </div>
  );
}

export function WhereBody({ where, onWhere, remote }: { where: Where; onWhere: (w: Where) => void; remote?: ReactNode }) {
  return (
    <>
      <ChoiceCards items={WHERE} value={where} onPick={onWhere} />
      {where === "remote" && remote ? remote : null}
    </>
  );
}

/** "Another computer: how to reach it" (§4.8.1.2 parity adds): its address and gateway key, then Connect. */
export function RemoteForm({ address, onConnect, busy, problem, formId, hideSubmit }: { address: string; onConnect: (url: string, key: string) => void; busy: boolean; problem: string | null; formId?: string; hideSubmit?: boolean }) {
  const [url, setUrl] = useState(address);
  const [key, setKey] = useState("");
  const valid = /^wss?:\/\/\S+$/.test(url.trim());
  return (
    <form id={formId} className="ob-remote" onSubmit={(e) => (e.preventDefault(), valid && onConnect(url.trim(), key))}>
      <label className="fld">
        <span>Its address</span>
        <input className="inp" data-testid="setup-address" value={url} placeholder="wss://desk-pc.tailnet.ts.net" onChange={(e) => setUrl(e.target.value)} />
        <small className="hint">Use wss:// when it sits behind HTTPS or Tailscale Serve.</small>
      </label>
      <label className="fld">
        <span>Its gateway key</span>
        <input className="inp" type="password" autoComplete="off" data-testid="setup-key" value={key} onChange={(e) => setKey(e.target.value)} />
      </label>
      {problem ? <p className="ob-problem" role="alert">{problem}</p> : null}
      {hideSubmit ? null : (
        <button type="submit" className="btn pri sm" data-testid="setup-connect" disabled={!valid || busy}>
          {busy ? "Connecting…" : "Connect"}
        </button>
      )}
    </form>
  );
}

type ModelsProps = {
  detected: Detected | null;
  /** The default model this Branch already uses, if any. */
  inUse: string | null;
  error: string | null;
  off: string[];
  onToggle: (key: string) => void;
  test: TestResult | "testing" | null;
  canTest: boolean;
  onTest: () => void;
  addAccount: ReactNode;
  onLocal: () => void;
};

/** The service a found connection belongs to: its kind when the logos know it, else its model's provider. */
/** A model on this computer shows its model family's logo (Qwen), as the preview does; an account shows its service's. */
export function logoId(c: Candidate): string {
  const [provider = "", model = ""] = c.modelRef.split("/");
  if (c.kind === "existing-model") return model.toLowerCase().match(/^[a-z]+/)?.[0] ?? provider;
  return brandOf(c.kind) !== c.kind.toLowerCase() ? c.kind : provider || c.kind;
}

function CandidateRow({ c, on, onToggle }: { c: Candidate; on: boolean; onToggle: () => void }) {
  return (
    <div className="prow">
      <Logo id={logoId(c)} name={c.label} size={30} />
      <span className="grow">
        <b>{c.label}</b>
        <small>{c.signedOut ? `${c.detail} · signed out` : c.detail}</small>
      </span>
      <button type="button" role="switch" aria-checked={on} aria-label={c.label} className="switch" onClick={onToggle} />
    </div>
  );
}

export function ModelsBody(p: ModelsProps) {
  const rows = p.detected?.candidates ?? [];
  return (
    <>
      {p.inUse ? (
        <div className="ob-status ob-inuse" data-testid="setup-inuse">
          <span className="sdot" />
          <span>
            <b>Already set up</b> · {p.inUse} answers by default. Change it here or leave it as it is.
          </span>
        </div>
      ) : null}
      {p.error ? <p className="ob-problem" role="alert">{p.error}</p> : null}
      {!p.detected && !p.error ? <p className="hint">Looking on this computer…</p> : null}
      <div className="rows">
        {rows.map((c) => (
          <CandidateRow key={c.key} c={c} on={!p.off.includes(c.key)} onToggle={() => p.onToggle(c.key)} />
        ))}
      </div>
      {p.detected && !rows.length ? (
        <p className="hint">
          Nothing found on this computer yet. Connect a model to get answers. Connecting an account makes answers smarter and faster. Or{" "}
          <button type="button" className="link" onClick={p.onLocal}>
            install a model on this computer
          </button>
          .
        </p>
      ) : null}
      <div className="acts ob-acts">
        {p.addAccount}
        <button type="button" className="btn sm" data-testid="setup-test" disabled={!p.canTest || p.test === "testing"} onClick={p.onTest}>
          {p.test === "testing" ? "Testing…" : "Say hello to test it"}
        </button>
      </div>
      {p.test && p.test !== "testing" ? (
        <div className="ob-status" data-ok={p.test.ok}>
          <span className={p.test.ok ? "sdot ok" : "sdot bad"} />
          {p.test.ok ? (
            <span>
              <b>It answered in {p.test.seconds} s</b> · {p.test.modelRef}
              {p.test.madeDefault ? " · now the default model" : ""}
            </span>
          ) : (
            <span>{p.test.error}</span>
          )}
        </div>
      ) : null}
    </>
  );
}
