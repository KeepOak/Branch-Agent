// What waits for a yes, kept live: the three pending lists (exec.approval.list, plugin.approval.list, question.list),
// then the engine's `*.requested` and `*.resolved` events. Answers go out through the call each kind needs. A failed
// answer leaves the request open with the engine's words, so it can be tried again; a request answered somewhere else
// collapses to "Answered elsewhere". Lockdown lets only No through (thread/approval-guard lockdownAllowsAnswer).
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { availability, requestOrComing } from "../../connect/capabilities";
import type { WindowEngine } from "../../connect/engine";
import { configStore } from "../../places/settings/config-store";
import { lockdownAllowsAnswer } from "../../thread/approval-guard";
import { callFor, KINDS, LIST_OF, listItems, readAsk, settledBy, settledFromEvent, type Ask, type AskKind, type Reply, type Settled } from "./model";

export type AskState = {
  ask: Ask;
  status: "waiting" | "sending" | "settled";
  settled?: Settled;
  /** Arrived as a live event (not from the first list read): only these raise a banner. */
  live?: boolean;
  error?: string;
};

/** config security.lockdown, read the way shell/control-tower-data readLocked reads it (that module pulls in the
 *  whole overview, so the one line is repeated here). */
export const readLockdown = (snap: unknown): boolean => {
  const security = (snap as { config?: { security?: { lockdown?: unknown } } } | null | undefined)?.config?.security;
  return security?.lockdown === true;
};
const listen = (engine: WindowEngine, fn: Parameters<WindowEngine["onEvent"]>[0]) => (typeof engine.onEvent === "function" ? engine.onEvent(fn) : () => undefined);
const errorText = (e: unknown) => (e instanceof Error ? e.message : typeof e === "string" ? e : "The engine didn’t take the answer.");
const EVENT_KIND = new Map<string, [AskKind, "requested" | "resolved"]>(
  KINDS.flatMap((kind) => {
    const base = kind === "question" ? "question" : `${kind}.approval`;
    return [[`${base}.requested`, [kind, "requested"]], [`${base}.resolved`, [kind, "resolved"]]] as [string, [AskKind, "requested" | "resolved"]][];
  }),
);
const idOf = (payload: unknown) => (payload && typeof payload === "object" && typeof (payload as { id?: unknown }).id === "string" ? (payload as { id: string }).id : "");

export function useAsks(engine: WindowEngine | null | undefined, lockdown = false) {
  const [asks, setAsks] = useState<Map<string, AskState>>(() => new Map());
  const latest = useRef(asks);
  latest.current = asks;
  useEffect(() => {
    if (!engine) return;
    let live = true;
    const put = (ask: Ask | null, fromEvent: boolean) => ask && setAsks((m) => {
      const old = m.get(ask.id);
      if (old && old.status === "settled") return m;
      return new Map(m).set(ask.id, { ...old, ask, status: old?.status ?? "waiting", ...(fromEvent || old?.live ? { live: true } : {}) });
    });
    const off = listen(engine, ({ event, payload }) => {
      const hit = EVENT_KIND.get(event);
      if (!hit) return;
      const [kind, phase] = hit;
      if (phase === "requested") { put(readAsk(kind, payload), true); return; }
      const id = idOf(payload);
      setAsks((m) => {
        const old = m.get(id);
        if (!old || old.status === "settled") return m;
        // Our own answer can come back as an event before the request returns: it settles the way we answered.
        return new Map(m).set(id, { ...old, status: "settled", settled: old.status === "sending" && old.settled ? old.settled : settledFromEvent(kind, payload), error: undefined });
      });
    });
    for (const kind of KINDS) {
      const method = LIST_OF[kind];
      if (availability(engine, method) === "no") continue;
      requestOrComing(engine, method, {}).then(
        (result) => { if (live) listItems(result).forEach((item) => put(readAsk(kind, item), false)); },
        () => undefined, // An engine without the list still sends the events; the Coming state covers the rest.
      );
    }
    return () => { live = false; off(); };
  }, [engine]);

  const answer = useCallback(async (id: string, reply: Reply) => {
    const state = latest.current.get(id);
    if (!engine || !state || state.status !== "waiting") return;
    if (typeof reply === "string" && reply !== "skip" && !lockdownAllowsAnswer(lockdown, reply)) return;
    const call = callFor(state.ask, reply);
    if (!call || availability(engine, call.method) === "no") return;
    const settled = settledBy(reply);
    setAsks((m) => new Map(m).set(id, { ...state, status: "sending", settled, error: undefined }));
    try {
      await requestOrComing(engine, call.method, call.params);
      setAsks((m) => { const now = m.get(id); return now && now.status !== "settled" ? new Map(m).set(id, { ...now, status: "settled", settled }) : m; });
    } catch (e) {
      setAsks((m) => { const now = m.get(id); return now && now.status === "sending" ? new Map(m).set(id, { ...now, status: "waiting", settled: undefined, error: errorText(e) }) : m; });
    }
  }, [engine, lockdown]);

  const list = [...asks.values()];
  return { asks: list, waiting: list.filter((s) => s.status !== "settled"), answer };
}

/** Lockdown, as config security.lockdown says, refreshed on config.changed. */
export function useLockdown(engine: WindowEngine | null | undefined, ready = true): { on: boolean; turnOff: () => Promise<void> } {
  const store = engine ? configStore(engine) : null;
  const on = useSyncExternalStore(
    useCallback((fn: () => void) => store?.subscribe(fn) ?? (() => undefined), [store]),
    () => readLockdown(store?.snap),
  );
  useEffect(() => {
    if (!engine || !store || !ready || availability(engine, "config.get") === "no") return;
    if (!store.snap) void store.load();
    return listen(engine, ({ event }) => { if (event === "config.changed") void store.load(); });
  }, [engine, store, ready]);
  const turnOff = useCallback(async () => { await store?.set("security.lockdown", false); }, [store]);
  return { on, turnOff };
}
