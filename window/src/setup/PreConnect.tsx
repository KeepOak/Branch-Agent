// The plain pre-connect screens (WINDOW-GAPS 8a): before the window talks to a Branch, setup's first two steps run
// here, "Hi, I'm Branch." then "Where should Branch run?", with the address and key, the approval wait and the
// connect problems in plain words (DESIGN-SPEC §4.8.1.1–2, "Can't connect: reason and fix steps").
import { useState } from "react";
import { connectProblem, hostOf } from "./connect-problems";
import { readPreConnect, savePreConnect } from "./pre-connect-state";
import { SetupShell } from "./SetupShell";
import { WelcomeHero } from "./SetupBrand";
import { RemoteForm, WelcomeBody, WhereBody } from "./steps-early";
import type { Where } from "./setup-model";

export type PreConnectState =
  | { kind: "address" }
  | { kind: "key" }
  | { kind: "pairing"; requestId?: string }
  | { kind: "failed"; code?: string; message: string };

/** `local`: this computer's gateway address (the desktop app's, the build's, or the engine's default). */
type Props = { local: string; address: string | null; state: PreConnectState; busy: boolean; startAtWhere?: boolean; onConnect: (url: string, key: string) => void; onRetry: () => void };

function Pairing({ host, onRetry }: { host: string; onRetry: () => void }) {
  return (
    <div className="ob-status-box" data-testid="setup-pairing">
      <span className="sdot warn" />
      <div>
        <b>Approve this window</b>
        <p>This window passed sign-in at {host}, but that computer hasn't seen it before. Approve it once there.</p>
        <ol className="ob-steps">
          <li>Prefer a link? Run `branch dashboard` there and open its link here.</li>
          <li>That command also prints the approve command for the newest request.</li>
          <li>Once approved, choose Connect.</li>
        </ol>
        <p className="hint">Waiting for approval… this connects by itself once approved.</p>
        <button type="button" className="btn sm" onClick={onRetry}>
          Check now
        </button>
      </div>
    </div>
  );
}

function Failed({ host, code, message }: { host: string; code?: string; message: string }) {
  const p = connectProblem(code, host);
  return (
    <div className="ob-status-box" data-testid="setup-problem">
      <span className="sdot bad" />
      <div>
        <b>{p.title}</b>
        <p>{p.line}</p>
        <ol className="ob-steps">
          {p.steps.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ol>
        <details className="ob-raw">
          <summary>Raw error</summary>
          <code>{message}</code>
        </details>
      </div>
    </div>
  );
}

export function PreConnect({ local, address, state, busy, startAtWhere, onConnect, onRetry }: Props) {
  const saved = readPreConnect();
  const [promise, setPromise] = useState(saved?.promise ?? false);
  const [where, setWhere] = useState<Where>(startAtWhere ? "remote" : (saved?.where ?? (address && address !== local ? "remote" : "this")));
  const [step, setStep] = useState(saved?.promise || startAtWhere ? 1 : 0);
  const remember = (patch: { promise?: boolean; where?: Where }) => savePreConnect({ promise: promise || Boolean(startAtWhere), where, ...patch });
  const url = where === "remote" ? (address && address !== local ? address : "") : local;
  const connect = (to: string, key: string) => (remember({}), onConnect(to, key));
  const form = <RemoteForm key={where} address={url} busy={busy} problem={null} onConnect={connect} />;
  return (
    <SetupShell
      step={step}
      reach={promise ? 1 : 0}
      reachReason={promise ? "Connect to a Branch first." : "Tick the promise on Welcome first."}
      done={(i) => i < step}
      onStep={(i) => i <= 1 && setStep(i)}
      onSkip={null}
      title={step === 0 ? "Hi, I’m Branch." : "Where should Branch run?"}
      lede={step === 0 ? "An assistant that lives on this computer, with Trunks that each take one job. This takes about three minutes; you can change everything later." : "The engine and the gateway live here. You can talk to it from anywhere."}
      hero={step === 0 ? <WelcomeHero /> : undefined}
      footer={
        step === 0 ? (
          <>
            <span className="grow" />
            <button type="button" className="btn pri" data-testid="setup-next" disabled={!promise} onClick={() => (remember({}), setStep(1))}>
              Start
            </button>
          </>
        ) : (
          <>
            <button type="button" className="btn ghost" onClick={() => setStep(0)}>
              Back
            </button>
            <span className="grow" />
          </>
        )
      }
    >
      {step === 0 ? (
        <WelcomeBody promise={promise} onPromise={(v) => (setPromise(v), remember({ promise: v }))} />
      ) : (
        <>
          <WhereBody where={where} onWhere={(w) => (setWhere(w), remember({ where: w }))} />
          {state.kind === "pairing" ? <Pairing host={hostOf(address ?? local)} onRetry={onRetry} /> : null}
          {state.kind === "failed" ? <Failed host={hostOf(address ?? local)} code={state.code} message={state.message} /> : null}
          {state.kind !== "pairing" ? form : null}
        </>
      )}
    </SetupShell>
  );
}
