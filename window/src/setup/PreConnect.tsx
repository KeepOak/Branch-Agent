// The plain pre-connect screens (WINDOW-GAPS 8a): before the window talks to a Branch, setup's first-run Welcome
// runs here — "Hi, I'm Branch." — with Where Branch runs behind Change, and the address, key, approval wait and
// connect problems in plain words (DESIGN-SPEC §4.8.1.1–2, "Can't connect: reason and fix steps").
import { useState } from "react";
import { notify } from "../shell/notify";
import { connectProblem } from "./connect-problems";
import { isLocalTarget, readPreConnect, readTargetName, savePreConnect } from "./pre-connect-state";
import { SetupShell } from "./SetupShell";
import { WelcomeHero } from "./SetupBrand";
import { RemoteForm, SETUP_LATER_TOAST, WELCOME_LEDE, WelcomeBody, WhereSheet } from "./steps-early";
import { FIRST_RUN_STEP_NAMES, SETUP_LATER_KEY, SETUP_TALK_KEY, type Where } from "./setup-model";

export type PreConnectState =
  | { kind: "address" }
  | { kind: "key" }
  | { kind: "pairing"; requestId?: string }
  | { kind: "failed"; code?: string; message: string };

/** `local`: this computer's gateway address (the desktop app's, the build's, or the engine's default). */
type Props = { local: string; address: string | null; state: PreConnectState; busy: boolean; startAtWhere?: boolean; onConnect: (url: string, key: string) => void; onRetry: () => void };

function Pairing({ host, address, onRetry }: { host: string; address: string; onRetry: () => void }) {
  return (
    <div className="ob-status-box" data-testid="setup-pairing">
      <span className="sdot warn" />
      <div>
        <b>Allow this window</b>
        <p>This window passed sign-in at {host}, but that computer hasn't seen it before. Allow it once there.</p>
        <ol className="ob-steps">
          <li>On that computer, open Branch and go to Settings › Computer &amp; browser.</li>
          <li>Under Waiting for your yes, choose Allow for this window.</li>
        </ol>
        <p className="hint">Waiting for approval… this connects by itself once approved.</p>
        <details className="ob-raw"><summary>Details</summary><code>{address}</code></details>
        <button type="button" className="btn sm" onClick={onRetry}>
          Check now
        </button>
      </div>
    </div>
  );
}

function Failed({ host, address, code, message }: { host: string; address: string; code?: string; message: string }) {
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
          <summary>Details</summary>
          <code>{address}</code><br /><code>{message}</code>
        </details>
      </div>
    </div>
  );
}

function markLater(): void {
  try {
    sessionStorage.setItem(SETUP_LATER_KEY, "1");
  } catch {
    // session blocked: setup may open again after connect
  }
}

export function PreConnect({ local, address, state, busy, startAtWhere, onConnect, onRetry }: Props) {
  const target = address ?? local;
  const host = isLocalTarget(target) ? "This computer" : readTargetName(target) ?? "That computer";
  const saved = readPreConnect();
  const [where, setWhere] = useState<Where>(saved?.where ?? (address && address !== local ? "remote" : "this"));
  const [choosing, setChoosing] = useState(Boolean(startAtWhere));
  const remember = (patch: { where?: Where }) => savePreConnect({ promise: true, where, ...patch });
  const remote = where === "remote" || where === "keepoak";
  const url = remote ? (address && address !== local ? address : "") : local;
  const connect = (to: string, key: string) => (remember({}), onConnect(to, key));
  /** App set a local address but startKey found no preload or stored token — ask for the key on this card. */
  const askKey = !remote && state.kind === "key";
  const later = () => {
    remember({ where: "this" });
    markLater();
    notify(SETUP_LATER_TOAST);
    onConnect(local, "");
  };
  /** Set up by talking: connect to this computer as Get started does; setup then opens the talking conversation. */
  const talk = () => {
    try {
      sessionStorage.setItem(SETUP_TALK_KEY, "1");
    } catch {
      // session blocked: setup opens at its Welcome instead
    }
    start();
  };
  const start = () => {
    remember({});
    if (remote) return;
    onConnect(local, "");
  };
  return (
    <SetupShell
        variant="card"
        steps={FIRST_RUN_STEP_NAMES}
        step={0}
        reach={0}
        reachReason="Connect to a Branch first."
        done={() => false}
        onStep={() => undefined}
        onSkip={later}
        sheet={choosing}
        overlay={
          choosing ? (
            <WhereSheet
              where={where}
              onPick={(w) => {
                setWhere(w);
                remember({ where: w });
                setChoosing(false);
              }}
              onClose={() => setChoosing(false)}
            />
          ) : null
        }
        title="Hi, I’m Branch."
        lede={WELCOME_LEDE}
        hero={<WelcomeHero />}
        later={
          <>
            <button type="button" className="link" data-testid="setup-talk-welcome" disabled={busy} onClick={talk}>
              Set up by talking
            </button>
            <span aria-hidden="true">·</span>
            <button type="button" className="link" data-testid="setup-skip" onClick={later}>
              Set up later
            </button>
          </>
        }
        footer={
          remote || askKey ? (
            <>
              <span />
              <button type="submit" form="setup-remote" className="btn pri ob-go" data-testid="setup-next" disabled={busy}>
                {busy ? "Connecting…" : "Get started"}
              </button>
            </>
          ) : (
            <>
              <span />
              <button type="button" className="btn pri ob-go" data-testid="setup-next" onClick={start}>
                Get started
              </button>
            </>
          )
        }
      >
        <WelcomeBody where={where} onChangeWhere={() => setChoosing(true)} />
        {state.kind === "pairing" ? <Pairing host={host} address={target} onRetry={onRetry} /> : null}
        {state.kind === "failed" ? <Failed host={host} address={target} code={state.code} message={state.message} /> : null}
        {askKey ? <RemoteForm formId="setup-remote" hideSubmit hideAddress address={local} busy={busy} problem={null} onConnect={connect} /> : null}
        {remote && state.kind !== "pairing" ? <RemoteForm key={where} formId="setup-remote" hideSubmit address={url} busy={busy} problem={null} onConnect={connect} /> : null}
    </SetupShell>
  );
}
