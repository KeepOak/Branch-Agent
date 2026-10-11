// One engine wizard session (models.authLogin, branch.setup.activate.start …) driven step by step over wizard.next.
// Adapted from engine/ui/src/components/wizard-login-controller.ts: sign-in notes open their link once; an OAuth
// paste step also finishes through the browser callback, so it is read again once a second while it shows.
import { useEffect, useRef, useState, type RefObject } from "react";
import type { WindowEngine } from "../../connect/engine";
import { errorText } from "./adapter";
import { advance, safeSignInUrl, type WizardAnswer, type WizardResult, type WizardStep } from "./account-login";
export type { WizardStep } from "./account-login";

export type WizardView = { phase: "starting" } | { phase: "step"; step: WizardStep; waiting: boolean } | { phase: "done" } | { phase: "error"; message: string };
/** `secret` answers one text step once (a pasted token): kept out of the start params and never logged. A step the
 *  engine shows again (it rejected the value) is left for the owner, with the engine's words. */
export type WizardStart = { method: string; params: Record<string, unknown>; secret?: { match: (step: WizardStep) => boolean; value: string } };

export function useWizard(engine: WindowEngine, start: WizardStart) {
  const [view, setView] = useState<WizardView>({ phase: "starting" });
  const [value, setValue] = useState<unknown>(undefined);
  const [busy, setBusy] = useState(true);
  const session = useRef({ id: crypto.randomUUID(), notes: [] as string[], opened: new Set<string>(), answered: new Set<string>(), live: true, done: false, generation: 0 });
  const show = (step: WizardStep, waiting: boolean) => {
    if (!session.current.live) return;
    const url = safeSignInUrl(step.externalUrl);
    if (url && !session.current.opened.has(url)) {
      session.current.opened.add(url);
      window.open(url, "_blank", "noopener");
    }
    setView({ phase: "step", step, waiting });
  };
  const apply = (result: WizardResult) => {
    if (!session.current.live) return;
    session.current.done = result.done;
    const secret = start.secret;
    if (!result.done && result.step && secret && result.step.type === "text" && !session.current.answered.has(result.step.id) && secret.match(result.step)) {
      session.current.answered.add(result.step.id);
      next({ stepId: result.step.id, value: secret.value });
      return;
    }
    setBusy(false);
    if (!result.done && result.step) {
      setValue(result.step.initialValue ?? (result.step.type === "multiselect" ? [] : ""));
      show(result.step, false);
    } else if (result.status === "done") {
      setView({ phase: "done" });
    } else {
      setView({ phase: "error", message: [result.error || (result.status === "cancelled" ? "Sign-in was cancelled." : "Sign-in did not finish."), ...session.current.notes].join("\n\n") });
    }
  };
  const fail = (error: unknown) => { if (session.current.live) { setBusy(false); setView({ phase: "error", message: errorText(error) }); } };
  const next = (answer: WizardAnswer | undefined) => {
    if (!session.current.live) return;
    session.current.generation += 1;
    setBusy(true);
    advance(engine.request.bind(engine), session.current.id, answer, (s) => show(s, true), session.current.notes).then(apply, fail);
  };
  useEffect(() => {
    const s = session.current;
    s.live = true;
    const close = () => {
      s.live = false;
      s.generation += 1;
      if (!s.done) void engine.request("wizard.cancel", { sessionId: s.id, closeInput: true }).catch(() => undefined);
    };
    engine.request(start.method, { ...start.params, sessionId: s.id }).then(() => {
      // Closing can race admission: cancel again after start acknowledges the session.
      if (!s.live) close();
      else next(undefined);
    }, fail);
    window.addEventListener("pagehide", close);
    return () => { window.removeEventListener("pagehide", close); close(); };
    // The session starts once per mount; the start request never changes while it runs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const waitingForStart = view.phase === "starting" || (view.phase === "step" && view.step.type === "progress" && !view.step.externalUrl && !view.step.deviceCode);
  useEffect(() => {
    if (start.method !== "models.authLogin" || !waitingForStart) return;
    const seconds = String(start.params.authChoice).includes("device-code") ? 5 : 30;
    const timer = setTimeout(() => {
      fail(new Error(`Sign-in did not start within ${seconds} seconds. Close this dialog and try again.`));
      session.current.live = false;
      void engine.request("wizard.cancel", { sessionId: session.current.id, closeInput: true }).catch(() => undefined);
    }, seconds * 1000);
    return () => clearTimeout(timer);
    // The deadline covers admission and the first wizard step, not the user's sign-in time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waitingForStart]);
  usePastePolling(engine, view, busy, session, show, apply, fail, setView);
  const answer = (v?: unknown) => { if (view.phase === "step") next(v === undefined ? { stepId: view.step.id } : { stepId: view.step.id, value: v }); };
  const cancel = () => {
    session.current.live = false;
    void engine.request("wizard.cancel", { sessionId: session.current.id, closeInput: true }).catch(() => undefined);
  };
  const cancelAll = async () => {
    setBusy(true);
    try {
      await engine.request("wizard.cancel", { all: true });
      setView({ phase: "error", message: "Setup cancelled. Close this dialog and try signing in again." });
    } catch (error) { setView({ phase: "error", message: errorText(error) }); }
    finally { setBusy(false); }
  };
  return { view, value, setValue, busy, answer, cancel, cancelAll };
}

type Session = RefObject<{ id: string; notes: string[]; generation: number }>;
function usePastePolling(
  engine: WindowEngine, view: WizardView, busy: boolean, session: Session,
  show: (s: WizardStep, waiting: boolean) => void, apply: (r: WizardResult) => void, fail: (e: unknown) => void,
  setView: (fn: (v: WizardView) => WizardView) => void,
) {
  const pasteStep = view.phase === "step" && !view.waiting && !busy && view.step.type === "text" && Boolean(view.step.externalUrl) ? view.step.id : null;
  useEffect(() => {
    if (!pasteStep) return;
    const generation = session.current.generation;
    const current = () => generation === session.current.generation;
    const timer = setTimeout(() => {
      advance(engine.request.bind(engine), session.current.id, undefined, (s) => { if (current()) show(s, true); }, session.current.notes).then(
        (r) => { if (current()) { if (r.done || r.step?.id !== pasteStep) apply(r); else setView((v) => ({ ...v })); } },
        (e) => { if (current()) fail(e); },
      );
    }, 1000);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pasteStep, view]);
}
