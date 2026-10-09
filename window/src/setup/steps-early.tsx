// Setup steps 1–3 (DESIGN-SPEC §4.8.1.1–§4.8.1.3): Welcome, Where Branch runs and Models. Welcome and Where also
// run before the window is connected (the plain pre-connect screens); Models needs the engine.
import { useState, type ReactNode } from "react";
import { brandOf, Logo } from "../places/settings/set1/service";
import { Icon, type IconName } from "../shell/icons";
import type { Candidate, Detected, TestResult, Where } from "./setup-model";
import { shownWhy } from "../shell/shown-why";

export function WelcomeBody({ promise, onPromise }: { promise: boolean; onPromise: (v: boolean) => void }) {
  return (
    <div className="ob-trust">
      <b>How Branch stays safe</b>
      <ul className="may6">
        {["It asks before it sends, deletes, spends or installs anything.", "Your conversations and keys stay on your computers.", "You can take over, stop it, or roll back any change."].map((line) => (
          <li key={line}>
            <span className="i">
              <Icon name="check" size={13} />
            </span>
            {line}
          </li>
        ))}
      </ul>
      <label className="chk">
        <input type="checkbox" data-testid="setup-promise" checked={promise} onChange={(e) => onPromise(e.target.checked)} /> I understand Branch can act on this computer when I allow it
      </label>
    </div>
  );
}

const WHERE: { id: Where; icon: IconName; name: string; line: string; off?: string }[] = [
  { id: "this", icon: "monitor", name: "This computer", line: "Recommended. Private, free, fast." },
  { id: "remote", icon: "key", name: "Another computer", line: "Over Tailscale or SSH: a home server or a desk PC." },
  { id: "keepoak", icon: "globe", name: "A KeepOak computer", line: "In the cloud, always on. Needs a keepoak.com account.", off: "Needs a keepoak.com account." },
  { id: "later", icon: "clock", name: "Decide later", line: "Start here and move it any time." },
];

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
export function RemoteForm({ address, onConnect, busy, problem }: { address: string; onConnect: (url: string, key: string) => void; busy: boolean; problem: string | null }) {
  const [url, setUrl] = useState(address);
  const [key, setKey] = useState("");
  const valid = /^wss?:\/\/\S+$/.test(url.trim());
  return (
    <form className="ob-remote" onSubmit={(e) => (e.preventDefault(), valid && onConnect(url.trim(), key))}>
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
      <button type="submit" className="btn pri sm" data-testid="setup-connect" disabled={!valid || busy}>
        {busy ? "Connecting…" : "Connect"}
      </button>
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
function logoId(c: Candidate): string {
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
          Nothing found on this computer yet. Add an account, or{" "}
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
