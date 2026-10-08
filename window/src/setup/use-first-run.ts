// Setup opens by itself on first run (DESIGN-SPEC §4.8.1 "When it opens"): 700 ms after the window is ready, when the
// engine's config has no setup record (wizard.lastRunAt) and nothing else is on top. A completed setup with no
// usable Trunks also reopens at the first-Trunk step so the window cannot strand a person without a contact.
import { useEffect, useRef, useState } from "react";
import type { SaplingSession } from "../connect/session";
import { needsFirstContact, RUN_SETUP_AGAIN, setupDone } from "./setup-model";

/** The step setup is open at, or null; `open(step)` reopens it by hand (Guide › Set up Branch, Replay the first run). */
export function useFirstRun(session: SaplingSession, ready: boolean, busy: () => boolean, usableTrunks: number | null = null, inSettings = false) {
  const [step, setStep] = useState<number | null>(null);
  const [requiresContact, setRequiresContact] = useState(true);
  const [isFirstRun, setIsFirstRun] = useState(false);
  const closed = useRef(false);
  const returningFromLocalModel = useRef(false);
  useEffect(() => { closed.current = false; returningFromLocalModel.current = false; }, [session]);
  useEffect(() => {
    if (!returningFromLocalModel.current || inSettings || usableTrunks === null) return;
    returningFromLocalModel.current = false;
    if (usableTrunks === 0) {
      closed.current = false;
      setStep(4);
    }
  }, [inSettings, usableTrunks]);
  useEffect(() => {
    if (!ready) {
      return;
    }
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    session.request("config.get", {}).then(
      (config) => {
        if (live) { setRequiresContact(needsFirstContact(config)); setIsFirstRun(!setupDone(config)); }
        if (live && (setupDone(config) ? usableTrunks === 0 : true)) {
          const retryOverlay = setupDone(config);
          const target = retryOverlay ? 4 : 0;
          const openWhenClear = () => {
            if (!live || closed.current) return;
            if (busy()) {
              if (retryOverlay) timer = setTimeout(openWhenClear, 700);
              return;
            }
            setStep((current) => current ?? target);
          };
          timer = setTimeout(openWhenClear, 700);
        }
      },
      (error: unknown) => console.warn("config.get failed", error),
    );
    return () => {
      live = false;
      clearTimeout(timer);
    };
    // Once per connection; `busy` is read when the timer fires.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, ready, usableTrunks]);
  useEffect(() => {
    const on = () => { returningFromLocalModel.current = false; closed.current = false; setStep(0); };
    window.addEventListener(RUN_SETUP_AGAIN, on);
    return () => window.removeEventListener(RUN_SETUP_AGAIN, on);
  }, []);
  return { step, requiresContact, isFirstRun, contactCreated: () => setRequiresContact(false), open: (at = 0) => { returningFromLocalModel.current = false; closed.current = false; setStep(at); }, close: () => { returningFromLocalModel.current = false; closed.current = true; setStep(null); }, leaveForLocalModel: () => { returningFromLocalModel.current = true; closed.current = true; setStep(null); } };
}
