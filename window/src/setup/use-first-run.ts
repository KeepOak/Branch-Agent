// Setup opens by itself on first run (DESIGN-SPEC §4.8.1 "When it opens"): 700 ms after the window is ready, when the
// engine's config has no setup record (wizard.lastRunAt) and nothing else is on top. Never again after that.
import { useEffect, useState } from "react";
import type { SaplingSession } from "../connect/session";
import { readPreConnect } from "./pre-connect-state";
import { needsFirstContact, setupDone } from "./setup-model";

/** The step setup is open at, or null; `open(step)` reopens it by hand (Guide › Set up Branch, Replay the first run). */
export function useFirstRun(session: SaplingSession, ready: boolean, busy: () => boolean) {
  const [step, setStep] = useState<number | null>(null);
  const [requiresContact, setRequiresContact] = useState(true);
  useEffect(() => {
    if (!ready) {
      return;
    }
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    session.request("config.get", {}).then(
      (config) => {
        if (live) setRequiresContact(needsFirstContact(config));
        if (live && !setupDone(config)) {
          // Welcome and Where already answered before connecting: carry on at Models.
          const openWhenFree = () => {
            if (!live) return;
            if (busy()) {
              timer = setTimeout(openWhenFree, 700);
              return;
            }
            setStep(readPreConnect()?.promise ? 2 : 0);
          };
          timer = setTimeout(openWhenFree, 700);
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
  }, [session, ready]);
  return { step, requiresContact, contactCreated: () => setRequiresContact(false), open: (at = 0) => setStep(at), close: () => setStep(null) };
}
