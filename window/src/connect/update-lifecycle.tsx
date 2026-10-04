import { useEffect, useState } from "react";
import type { SaplingSession } from "./session";
import { checkpointInputs, hasVolatileInputs, setUpdateBarrier } from "./update-barrier";
import { setInputPrivacy } from "../composer/drafts";
import "./update-lifecycle.css";

export type RestartReceipt = { id: string; sessionKey: string; expectedSessionId: string; lifecycleGeneration: string; targetBuild: string };
export type IdleUpdateBinding = { status: "idle"; lifecycleGeneration: string; targetBuild: string };
export type DeferredUpdateBinding = { status: "deferred"; lifecycleGeneration: string; targetBuild: string };
export type RestartPreparation = RestartReceipt | IdleUpdateBinding | DeferredUpdateBinding;
export type UpdateLifecycleEvent = { operationId: string; phase: "preparing" | "updating" | "reconnecting" | "waiting" | "recovered" | "complete" | "failed"; outcome?: "rolled-back" | "cancelled" | "session-changed" | "deferred" | "done" | "failed" | "killed" | "timeout" | "interrupted" };
export type UpdateBridge = {
  onUpdateLifecycle?: (handler: (event: UpdateLifecycleEvent) => void) => () => void;
  onVerifyUpdate?: (handler: (input: Record<string, never>) => Promise<unknown>) => () => void;
  onPrepareUpdate?: (handler: (input: { operationId: string; targetBuild: string }) => Promise<RestartPreparation>) => () => void;
  onObserveUpdate?: (handler: (input: { receipt: RestartReceipt }) => Promise<unknown>) => () => void;
  requestUpdateReconciliation?: (operationId: string) => void | Promise<unknown>;
  onResumeUpdate?: (handler: (input: { receipt: RestartReceipt }) => Promise<unknown>) => () => void;
  onCancelUpdate?: (handler: (input: { receipt: RestartReceipt | Pick<RestartReceipt, "lifecycleGeneration" | "targetBuild"> }) => Promise<string>) => () => void;
  onUpdatePolicy?: (handler: () => Promise<boolean>) => () => void;
};
const rec = (v: unknown): Record<string, unknown> => v && typeof v === "object" ? v as Record<string, unknown> : {};

/** Wait for the fresh authenticated connection and canonical history bootstrap after a restart. */
export function whenConnected(session: SaplingSession): Promise<void> {
  if (session.getSnapshot().status.phase === "connected") return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { unsubscribe(); reject(new Error("Branch hasn't reconnected yet. Your messages are kept here.")); }, 120_000);
    const unsubscribe = session.subscribe(() => {
      if (session.getSnapshot().status.phase === "connected") { clearTimeout(timer); unsubscribe(); resolve(); }
    });
  });
}

export function bindUpdateLifecycle(session: SaplingSession, bridge: UpdateBridge, show: (event: UpdateLifecycleEvent) => void): () => void {
  let operation: string | null = null;
  let watching: { receipt: RestartReceipt; runId?: string } | null = null;
  let phase = bridge.requestUpdateReconciliation ? session.getSnapshot().status.phase : "connecting";
  const track = (receipt: RestartReceipt) => {
    if (operation && operation !== receipt.lifecycleGeneration) return;
    operation = receipt.lifecycleGeneration;
    if (watching?.receipt.id !== receipt.id) watching = { receipt };
  };
  const hint = () => {
    if (!watching || watching.receipt.lifecycleGeneration !== operation) return;
    try {
      const sent = bridge.requestUpdateReconciliation?.(watching.receipt.lifecycleGeneration);
      if (sent) void Promise.resolve(sent).catch(() => {});
    } catch { /* A later real producer/reconnect event can retry the read-only hint. */ }
  };
  const subscriptions: Array<(() => void) | undefined> = [];
  subscriptions.push(bridge.onUpdateLifecycle?.((event) => {
    if (event.phase === "preparing") {
      if (operation !== event.operationId) watching = null;
      operation = event.operationId;
    }
    if (operation && event.operationId !== operation) return;
    operation = event.operationId;
    if (event.phase === "complete" || event.phase === "failed") watching = null;
    setUpdateBarrier(event.phase !== "complete" && event.phase !== "failed" && event.phase !== "recovered");
    show(event);
  }));
  subscriptions.push(bridge.onPrepareUpdate?.(async ({ operationId, targetBuild }) => {
    operation = operationId;
    setUpdateBarrier(true);
    await whenConnected(session);
    const sessionKey = session.getSnapshot().sessionKey;
    const described = sessionKey ? rec(await session.request("sessions.describe", { key: sessionKey })) : {};
    const row = rec(described.session);
    const expectedSessionId = row.sessionId;
    if (session.getSnapshot().sessionKey !== sessionKey) throw new Error("The conversation changed. Branch will wait before updating.");
    const binding = { lifecycleGeneration: operationId, targetBuild };
    if (sessionKey) setInputPrivacy(sessionKey, row.incognito === true ? "private" : "ordinary");
    // Check privacy before any disk checkpoint. Private and unclassified input stays in this window.
    if (row.incognito === true || hasVolatileInputs()) {
      setUpdateBarrier(false);
      show({ operationId, phase: "failed", outcome: "deferred" });
      return { status: "deferred", ...binding };
    }
    await checkpointInputs();
    if (session.getSnapshot().sessionKey !== sessionKey || hasVolatileInputs()) {
      setUpdateBarrier(false);
      show({ operationId, phase: "failed", outcome: "deferred" });
      return { status: "deferred", ...binding };
    }
    // Only the engine may admit an idle update. A missing local row never grants permission to stop.
    if (!sessionKey || typeof expectedSessionId !== "string" || !expectedSessionId) {
      const result = await session.request<RestartPreparation>("desktop.restart.prepare", binding);
      if ("status" in result && result.status === "deferred") { setUpdateBarrier(false); show({ operationId, phase: "failed", outcome: "deferred" }); }
      return result;
    }
    // The engine retains the transcript and task. This instruction adds no new objective or authority.
    const result = await session.request<RestartPreparation>("desktop.restart.prepare", {
      sessionKey, expectedSessionId, lifecycleGeneration: operationId, targetBuild,
      checkpoint: "Continue the existing task in this conversation from its saved transcript after Branch reconnects.",
      message: "Branch has updated. Continue the existing task from where it stopped. Preserve the user's current instructions.",
    });
    if ("status" in result && result.status === "deferred") { setUpdateBarrier(false); show({ operationId, phase: "failed", outcome: "deferred" }); }
    return result;
  }));
  subscriptions.push(bridge.onVerifyUpdate?.(async () => {
    await whenConnected(session);
    return session.request("desktop.restart.identity", {});
  }));
  subscriptions.push(bridge.onResumeUpdate?.(async ({ receipt }) => {
    track(receipt);
    setUpdateBarrier(true);
    await whenConnected(session);
    const result = await session.request("desktop.restart.resume", { ...receipt });
    const runId = rec(result).runId;
    if (watching?.receipt.id === receipt.id && typeof runId === "string") watching.runId = runId;
    return result;
  }));
  subscriptions.push(bridge.onObserveUpdate?.(async ({ receipt }) => {
    track(receipt);
    await whenConnected(session);
    const result = await session.request("desktop.restart.observe", { ...receipt });
    const observed = rec(result);
    if (watching?.receipt.id === receipt.id) {
      if (typeof observed.runId === "string") watching.runId = observed.runId;
      if (observed.status === "completed" || observed.status === "cancelled" || observed.status === "session-changed") watching = null;
    }
    // Only main's validated lifecycle event can change the delivery barrier.
    return result;
  }));
  if (bridge.requestUpdateReconciliation) {
    subscriptions.push(session.onGatewayEvent((event, payload) => {
      if (!watching) return;
      const p = rec(payload);
      const keys = Array.isArray(p.sessions) ? p.sessions.map((row) => rec(row).key) : [];
      const matches = p.sessionKey === watching.receipt.sessionKey || p.key === watching.receipt.sessionKey || keys.includes(watching.receipt.sessionKey) || (watching.runId !== undefined && p.runId === watching.runId);
      if (!matches) return;
      const chatTerminal = event === "chat" && (p.state === "final" || p.state === "error" || p.state === "aborted");
      if ((event === "agent" && p.stream === "lifecycle") || chatTerminal || event === "session.message" || event === "sessions.changed") hint();
    }));
    subscriptions.push(session.subscribe(() => {
      const next = session.getSnapshot().status.phase;
      const reconnected = phase !== "connected" && next === "connected";
      phase = next;
      if (reconnected) hint();
    }));
  }
  subscriptions.push(bridge.onCancelUpdate?.(async ({ receipt }) => {
    await whenConnected(session);
    const params = "id" in receipt ? { ...receipt } : { lifecycleGeneration: receipt.lifecycleGeneration, targetBuild: receipt.targetBuild };
    const result = rec(await session.request("desktop.restart.cancel", params));
    return typeof result.status === "string" ? result.status : "uncertain";
  }));
  subscriptions.push(bridge.onUpdatePolicy?.(async () => {
    await whenConnected(session);
    const result = rec(await session.request("config.get", {}));
    return rec(rec(rec(result.config).update).auto).enabled === true;
  }));
  return () => { for (const unsubscribe of subscriptions) unsubscribe?.(); };
}

export function UpdateLifecycle({ session, bridge }: { session: SaplingSession; bridge: UpdateBridge | undefined }) {
  const [event, setEvent] = useState<UpdateLifecycleEvent | null>(null);
  useEffect(() => bridge ? bindUpdateLifecycle(session, bridge, setEvent) : undefined, [session, bridge]);
  if (!event) return null;
  const stopped = event.outcome === "failed" ? "Your task couldn't finish." : event.outcome === "killed" ? "Your task was stopped." : event.outcome === "timeout" ? "Your task ran out of time." : event.outcome === "interrupted" ? "Your task was interrupted." : null;
  const text = event.phase === "waiting" ? "Branch is back online. Waiting to confirm your task. Your messages are kept here."
    : event.phase === "recovered" ? "Back online. Your task is continuing."
    : event.phase === "complete" ? stopped ? `Branch is back online. ${stopped} Your messages are kept here.` : event.outcome === "done" ? "Your task finished. Branch is up to date." : "Back online. Right where you left off."
    : event.phase === "failed" ? event.outcome === "deferred" ? "Branch will update after the current work. Your messages are kept here." : event.outcome === "rolled-back" ? "The update couldn't finish. Branch kept the previous version and your messages." : "Branch is back online. Your messages are kept here."
    : event.phase === "reconnecting" ? "Coming back online. Your messages are kept here." : "Updating Branch. Your messages are kept here.";
  return <div className="branch-update-status" role="status" aria-live="polite" data-update-phase={event.phase}>{text}</div>;
}
