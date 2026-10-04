import { useEffect, useRef, useState } from "react";
import type { WindowEngine } from "../connect/engine";

export type RefreshState = "asking" | "updated" | "none" | "fail" | null;
type Refresh = { from: number; run: string; status: RefreshState };

/** A refresh run may finish before the RPC returns its id. Keep those events until it does. */
export function createPlanRefresh(engine: WindowEngine, publish: (status: RefreshState) => void) {
  let active = true;
  let current: Refresh | null = null;
  const ended = new Map<string, string>();
  const finish = (status: RefreshState) => {
    if (!active || current?.status !== "asking") return;
    current.status = status;
    ended.clear();
    publish(status);
  };
  const unsubscribe = engine.onEvent((event) => {
    const payload = event.payload as { runId?: string; state?: string } | undefined;
    if (current?.status !== "asking" || event.event !== "chat" || !payload?.runId || !["final", "error", "aborted"].includes(payload.state ?? "")) return;
    if (current.run === payload.runId) finish(payload.state === "error" ? "fail" : "none");
    else if (!current.run) ended.set(payload.runId, payload.state!);
  });
  const refresh = (revision: number) => {
    if (!active || !engine.sessionKey || current?.status === "asking") return;
    current = { from: revision, run: "", status: "asking" };
    const request = current;
    ended.clear();
    publish("asking");
    engine.request<{ runId?: string }>("progressCard.refresh", {
      sessionKey: engine.sessionKey,
      ...(engine.agentId ? { agentId: engine.agentId } : {}),
      idempotencyKey: crypto.randomUUID(),
    }).then((result) => {
      if (!active || current !== request || current.status !== "asking") return;
      current.run = result.runId ?? "";
      const terminal = ended.get(current.run);
      ended.clear();
      if (!current.run || terminal) finish(terminal === "error" ? "fail" : "none");
    }, () => { if (current === request) finish("fail"); });
  };
  return {
    refresh,
    revision: (revision: number) => { if (current && revision > current.from) finish("updated"); },
    dispose: () => { active = false; ended.clear(); unsubscribe(); },
  };
}

/** Refresh feedback belongs to the engine handle that started the run. */
export function usePlanRefresh(engine: WindowEngine, card: { revision: number } | null) {
  const [state, setState] = useState<{ owner: WindowEngine; status: RefreshState }>({ owner: engine, status: null });
  const controller = useRef<ReturnType<typeof createPlanRefresh> | null>(null);
  useEffect(() => {
    setState({ owner: engine, status: null });
    const next = createPlanRefresh(engine, (status) => setState({ owner: engine, status }));
    controller.current = next;
    return () => { next.dispose(); controller.current = null; };
  }, [engine]);
  useEffect(() => controller.current?.revision(card?.revision ?? 0), [engine, card?.revision]);
  return { status: state.owner === engine ? state.status : null, refresh: () => controller.current?.refresh(card?.revision ?? 0) };
}
