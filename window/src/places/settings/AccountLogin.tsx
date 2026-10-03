// The steps of an engine sign-in wizard (models.authLogin, branch.setup.*): the question, its link or code, and the
// footer buttons. Adapted from engine/ui/src/components/wizard-login-controller.ts and pages/model-setup/wizard-runner.ts.
import type { WindowEngine } from "../../connect/engine";
import { Dialog } from "../../shell/Dialog";
import { safeSignInUrl, type LoginStart, type WizardStep } from "./account-login";
import { useWizard, type WizardView } from "./use-wizard";
import "./set1/set1.css";

type View = WizardView;

export function StepBody({ step, value, onValue, onAnswer, busy }: { step: WizardStep; value: unknown; onValue: (v: unknown) => void; onAnswer: (v?: unknown) => void; busy: boolean }) {
  const url = safeSignInUrl(step.externalUrl);
  const picked = Array.isArray(value) ? value : [];
  return (
    <>
      {step.title ? <b>{step.title}</b> : null}
      {step.message ? <p className="login-message">{step.message}</p> : null}
      {step.deviceCode ? <p className="login-code" aria-label="Sign-in code"><code>{step.deviceCode.code}</code>{step.deviceCode.message ? <small>{step.deviceCode.message}</small> : null}</p> : null}
      {url ? <a href={url} target="_blank" rel="noopener noreferrer">Open the sign-in page</a> : null}
      {step.type === "select" ? (step.options ?? []).map((o, i) => <button key={i} type="button" className="btn" disabled={busy} onClick={() => onAnswer(o.value)}>{o.label}{o.hint ? <small> {o.hint}</small> : null}</button>) : null}
      {step.type === "multiselect" ? (step.options ?? []).map((o, i) => (
        <label key={i}><input type="checkbox" checked={picked.includes(o.value)} onChange={(e) => onValue(e.target.checked ? [...picked, o.value] : picked.filter((x) => x !== o.value))} /> {o.label}</label>
      )) : null}
      {step.type === "text" ? <input aria-label={step.title || "Answer"} type={step.sensitive ? "password" : "text"} placeholder={step.placeholder} value={typeof value === "string" ? value : ""} autoFocus onChange={(e) => onValue(e.target.value)} onKeyDown={(e) => e.key === "Enter" && onAnswer(value)} /> : null}
    </>
  );
}

export function Footer({ view, value, busy, onAnswer, onCancel, onClose }: { view: View; value: unknown; busy: boolean; onAnswer: (v?: unknown) => void; onCancel: () => void; onClose: () => void }) {
  if (view.phase === "done" || view.phase === "error") {
    return <button type="button" className="btn primary" onClick={onClose}>Close</button>;
  }
  const step = view.phase === "step" && !view.waiting ? view.step : null;
  return (
    <>
      <button type="button" className="btn" onClick={onCancel}>Cancel</button>
      {step?.type === "confirm" ? <><button type="button" className="btn" disabled={busy} onClick={() => onAnswer(false)}>No</button><button type="button" className="btn primary" disabled={busy} onClick={() => onAnswer(true)}>Yes</button></> : null}
      {step && step.type !== "confirm" && step.type !== "select" ? <button type="button" className="btn primary" disabled={busy} onClick={() => onAnswer(step.type === "text" || step.type === "multiselect" ? value : undefined)}>Continue</button> : null}
    </>
  );
}

/** The live steps of a wizard session: the question, its sign-in link or code, and the waiting line. */
export function WizardBody({ wizard: w, doneText }: { wizard: ReturnType<typeof useWizard>; doneText: string }) {
  return (
    <div className="account-login" aria-live="polite">
      {w.view.phase === "starting" ? <p>Starting sign-in…</p> : null}
      {w.view.phase === "step" ? <StepBody step={w.view.step} value={w.value} onValue={w.setValue} onAnswer={w.answer} busy={w.busy || w.view.waiting} /> : null}
      {w.view.phase === "step" && w.view.waiting ? <p className="login-wait">Waiting for the sign-in to finish in your browser…</p> : null}
      {w.view.phase === "done" ? <p>{doneText}</p> : null}
      {w.view.phase === "error" ? <p className="bs-error" role="alert">{w.view.message}</p> : null}
    </div>
  );
}

/** A provider sign-in in its own dialog (models.authLogin), for the setup flow; onClose says whether it signed in. */
export function AccountLoginDialog({ engine, start, onClose }: { engine: WindowEngine; start: LoginStart; onClose: (signedIn: boolean) => void }) {
  const w = useWizard(engine, { method: "models.authLogin", params: { agentId: start.agentId, authChoice: start.choiceId } });
  const cancel = () => {
    w.cancel();
    onClose(false);
  };
  const close = () => (w.view.phase === "done" || w.view.phase === "error" ? onClose(w.view.phase === "done") : cancel());
  return (
    <Dialog title={`Sign in to ${start.provider}`} onClose={close} testid="account-login" footer={<Footer view={w.view} value={w.value} busy={w.busy} onAnswer={w.answer} onCancel={cancel} onClose={close} />}>
      <WizardBody wizard={w} doneText="Signed in. The account is saved for this Trunk." />
    </Dialog>
  );
}
