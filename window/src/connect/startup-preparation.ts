// A Trunk the engine is still getting ready: what its startup preparation is doing (agents.list's
// admissionRefusal.preparation) and the Retry that starts it again from scratch (agents.retryStartup).
import { useCallback, useEffect, useRef, useState } from "react";
import type { WindowEngine } from "./engine";

export type StartupPreparationState = "preparing" | "retrying" | "needs-attention";

export type StartupPreparation = {
  state: StartupPreparationState;
  /** A Retry is on its way to the engine. */
  busy: boolean;
  error: string | null;
  retry: () => void;
};

const POLL_MS = 3_000;

/** agents.retryStartup answered `retrying: false`: the engine had no preparation of this Trunk to start again. */
export const RETRY_NOT_PREPARING = "the engine isn't getting this Trunk ready any more";

const rec = (value: unknown): Record<string, unknown> => (value && typeof value === "object" ? value as Record<string, unknown> : {});

/** The Trunk a conversation belongs to: the engine handle's own, else the session key's `agent:<id>:…`. */
export function startupAgentId(engine: WindowEngine | undefined): string | null {
  if (engine?.agentId) return engine.agentId;
  const match = /^agent:([^:]+):/.exec(engine?.sessionKey ?? "");
  return match ? match[1] : null;
}

/** Reads one Trunk's startup state from an agents.list result; null once nothing holds it back. */
export function readStartupPreparation(list: unknown, agentId: string): StartupPreparationState | null {
  const agents = Array.isArray(rec(list).agents) ? rec(list).agents as unknown[] : [];
  const refusal = rec(rec(agents.find((agent) => rec(agent).id === agentId)).admissionRefusal);
  if (refusal.code !== "agent-database-inspection-pending") return null;
  const state = rec(refusal.preparation).state;
  return state === "retrying" || state === "needs-attention" ? state : "preparing";
}

/**
 * While `active` (the conversation is waiting for its Trunk to get ready), follows that Trunk's startup
 * preparation. When the engine stops holding the Trunk back after it did, or after the window gave up
 * re-reading (`stalled`), `onReady` reads the conversation again.
 */
export function useStartupPreparation(engine: WindowEngine | undefined, active: boolean, stalled: boolean, onReady?: () => void): StartupPreparation {
  const agentId = startupAgentId(engine);
  const [state, setState] = useState<StartupPreparationState>("preparing");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const ready = useRef(onReady);
  useEffect(() => {
    ready.current = onReady;
  }, [onReady]);
  /** The engine held this Trunk back at the last read (kept across a Retry's re-read). */
  const held = useRef(false);
  useEffect(() => {
    if (!active || !engine || !agentId) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const read = () => void engine.request("agents.list", {}).then((list) => {
      if (!live) return;
      const next = readStartupPreparation(list, agentId);
      if (next) {
        held.current = true;
        setState(next);
      } else if (held.current || stalled) {
        held.current = false;
        ready.current?.();
      }
    }, () => undefined).finally(() => {
      if (live) timer = setTimeout(read, POLL_MS);
    });
    read();
    return () => {
      live = false;
      if (timer) clearTimeout(timer);
    };
  }, [engine, agentId, active, stalled, tick]);
  const retry = useCallback(() => {
    if (!engine || !agentId) return;
    setBusy(true);
    setError(null);
    void engine.request("agents.retryStartup", { agentId }).then(
      (result: unknown) => {
        // Not preparing any more (ready, or failed for Doctor): say so, and re-read what it is now.
        if (rec(result).retrying !== true) setError(RETRY_NOT_PREPARING);
        setTick((n) => n + 1);
      },
      (reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)),
    ).finally(() => setBusy(false));
  }, [engine, agentId]);
  // A conversation that stopped waiting starts from the plain line next time.
  return { state: active ? state : "preparing", busy, error: active ? error : null, retry };
}
