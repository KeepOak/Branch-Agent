// One engine change at a time, with the outcome as a toast (preview: every Automations change answers in a toast).
import { useRef, useState } from "react";
import { notify } from "../../shell/notify";
import { ActionGate, errorText, rec, str, type Row } from "./runtime";

/** cron.run answers ran:false with a reason when it could not start (engine cron/service run preparation). */
export const RUN_REASONS: Record<string, string> = {
  "not-due": "It isn’t due yet.", "already-running": "It’s already running.", stopped: "Still getting going after a restart.",
  "invalid-spec": "Its schedule or task is broken.", disabled: "Every automation is paused.", ownerless: "It couldn’t be started.",
};

export function runOutcome(result: Row): void {
  if (result.ran === false || result.enqueued === false) throw new Error(RUN_REASONS[str(result.reason)] ?? "It couldn’t be started.");
}

export function useAct(refresh: () => Promise<void>) {
  const gate = useRef(new ActionGate()), [busy, setBusy] = useState(false);
  const run = async (operation: () => Promise<unknown>, message: string | ((r: Row) => string)): Promise<boolean> => {
    try {
      const outcome = await gate.current.run(async () => {
        setBusy(true);
        try {
          const r = rec(await operation());
          if (r.ok === false || r.removed === false) throw new Error(str(r.reason) || str(r.error) || "The engine didn’t apply this change.");
          return r;
        } finally { setBusy(false); }
      });
      if (!outcome.accepted) return false;
      notify(typeof message === "function" ? message(outcome.value) : message);
      await refresh();
      return true;
    } catch (e) {
      notify(errorText(e), { tone: "bad" });
      return false;
    }
  };
  return { busy, run };
}
