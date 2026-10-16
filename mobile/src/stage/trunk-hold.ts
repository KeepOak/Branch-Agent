// Holding the Trunk while you drive its browser or computer, and letting it go when you hand back.
// Copied from window/src/stage/trunk-hold.ts (#1624) and wired to the phone's EngineLink.
//
// The engine has no per-run pause (see NO_PAUSE in ComputerStage). The one pause it has is the conversation's Goal:
// sessions.goal.update with action "pause" stops new work starting, and "resume" lets it carry on (the same calls as
// Canopy's Pause and Resume). So taking over pauses the Goal when the conversation has an active one, and handing
// back resumes only a Goal this hold paused. A desktop computer is also held by the Gateway itself: observing it
// with control (desktop.observe) refuses the Trunk's computer input until control is released.
import { useEffect, useRef, useState } from "react";
import type { EngineLink } from "../pairing/pairingSession";

export type Hold = { sessionKey: string; goalId: string; agentId?: string };

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
const str = (v: unknown) => (typeof v === "string" ? v : "");

function goalOp(hold: Hold, action: "pause" | "resume") {
  return {
    sessionKey: hold.sessionKey,
    ...(hold.agentId ? { agentId: hold.agentId } : {}),
    goalId: hold.goalId,
    operationId: crypto.randomUUID(),
    issuedAtMs: Date.now(),
    action,
    ...(action === "pause" ? { note: "You took over its browser or computer." } : {}),
  };
}

/** Pauses the conversation's active Goal. Null when there is none to pause (nothing is held, nothing to resume). */
export async function holdTrunk(link: EngineLink, sessionKey: string | null | undefined): Promise<Hold | null> {
  if (!sessionKey) return null;
  const row = rec(rec(await link.request("sessions.describe", { key: sessionKey })).session);
  const goal = rec(row.goal);
  const goalId = str(goal.id);
  if (!goalId || goal.status !== "active") return null;
  const agentId = str(row.agentId) || undefined;
  const hold: Hold = { sessionKey, goalId, ...(agentId ? { agentId } : {}) };
  await link.request("sessions.goal.update", goalOp(hold, "pause"));
  return hold;
}

/** Resumes a Goal that holdTrunk paused. */
export async function releaseTrunk(link: EngineLink, hold: Hold): Promise<void> {
  await link.request("sessions.goal.update", goalOp(hold, "resume"));
}

/**
 * Holds the Trunk while `control` is true and releases it when control ends, the conversation changes or the pane
 * closes. `paused` is true only once the engine confirmed the pause, so the pane never claims a pause that didn't happen.
 */
export function useTrunkHold(link: EngineLink, control: boolean, sessionKey: string | null): { paused: boolean; error: string } {
  const [state, setState] = useState<{ paused: boolean; error: string }>({ paused: false, error: "" });
  const live = useRef(0);
  useEffect(() => {
    if (!control) return;
    const turn = ++live.current;
    let pending: Promise<Hold | null> = holdTrunk(link, sessionKey).then(
      (hold) => {
        if (live.current === turn) setState({ paused: Boolean(hold), error: "" });
        return hold;
      },
      () => {
        if (live.current === turn) setState({ paused: false, error: "Couldn't pause it. It may keep working while you drive." });
        return null;
      },
    );
    return () => {
      if (live.current === turn) {
        live.current++;
        setState({ paused: false, error: "" });
      }
      pending = pending.then((hold) => {
        if (hold) void releaseTrunk(link, hold).catch(() => undefined);
        return null;
      });
    };
  }, [link, control, sessionKey]);
  return control ? state : { paused: false, error: "" };
}
