import { useEffect, useState } from "react";
import type { SaplingSession } from "./session";
import { checkpointInputs, setUpdateBarrier } from "./update-barrier";
import "./update-lifecycle.css";

export type RestartReceipt = { id: string; sessionKey: string; expectedSessionId: string; lifecycleGeneration: string; targetBuild: string };
export type UpdateLifecycleEvent = { operationId: string; phase: "preparing" | "updating" | "reconnecting" | "complete" | "failed"; outcome?: "rolled-back" | "cancelled" | "session-changed" };
export type UpdateBridge = {
  onUpdateLifecycle?: (handler: (event: UpdateLifecycleEvent) => void) => () => void;
  onPrepareUpdate?: (handler: (input: { operationId: string; targetBuild: string }) => Promise<RestartReceipt | { status: "idle" }>) => () => void;
  onResumeUpdate?: (handler: (input: { receipt: RestartReceipt }) => Promise<string>) => () => void;
  onCancelUpdate?: (handler: (input: { receipt: RestartReceipt }) => Promise<string>) => () => void;
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
  const subscriptions: Array<(() => void) | undefined> = [];
  subscriptions.push(bridge.onUpdateLifecycle?.((event) => {
    if (event.phase === "preparing") operation = event.operationId;
    if (operation && event.operationId !== operation) return;
    operation = event.operationId;
    setUpdateBarrier(event.phase !== "complete" && event.phase !== "failed");
    show(event);
  }));
  subscriptions.push(bridge.onPrepareUpdate?.(async ({ operationId, targetBuild }) => {
    operation = operationId;
    setUpdateBarrier(true);
    await checkpointInputs();
    await whenConnected(session);
    const sessionKey = session.getSnapshot().sessionKey;
    if (!sessionKey) throw new Error("Open the conversation to keep working after this update.");
    const described = rec(await session.request("sessions.describe", { key: sessionKey }));
    const row = rec(described.session);
    const expectedSessionId = row.sessionId;
    if (typeof expectedSessionId !== "string" || !expectedSessionId || session.getSnapshot().sessionKey !== sessionKey) throw new Error("The conversation changed. Branch will wait before updating.");
    // The engine retains the transcript and task. This instruction adds no new objective or authority.
    return session.request<RestartReceipt | { status: "idle" }>("desktop.restart.prepare", {
      sessionKey, expectedSessionId, lifecycleGeneration: operationId, targetBuild,
      checkpoint: "Continue the existing task in this conversation from its saved transcript after Branch reconnects.",
      message: "Branch has updated. Continue the existing task from where it stopped. Preserve the user's current instructions.",
    });
  }));
  subscriptions.push(bridge.onResumeUpdate?.(async ({ receipt }) => {
    setUpdateBarrier(true);
    await whenConnected(session);
    const result = rec(await session.request("desktop.restart.resume", { ...receipt }));
    return typeof result.status === "string" ? result.status : "uncertain";
  }));
  subscriptions.push(bridge.onCancelUpdate?.(async ({ receipt }) => {
    await whenConnected(session);
    const result = rec(await session.request("desktop.restart.cancel", { ...receipt }));
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
  const text = event.phase === "complete" ? "Back online. Right where you left off." : event.phase === "failed" ? event.outcome === "rolled-back" ? "The update couldn't finish. Branch kept the previous version and your messages." : "Branch is back online. Your messages are kept here." : event.phase === "reconnecting" ? "Coming back online. Your messages are kept here." : "Updating Branch. Your messages are kept here.";
  return <div className="branch-update-status" role="status" aria-live="polite" data-update-phase={event.phase}>{text}</div>;
}
