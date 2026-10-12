// Adapted from elizaOS/eliza@3f38e54495ba5518f84bcf9cc1e84e0dc3d60bbf
// packages/core/src/streaming-context.ts. Native authority remains caller-owned.
import { AsyncLocalStorage } from "node:async_hooks";
import { resolveGlobalSingleton } from "../shared/global-singleton.js";
import type { TurnBudgetSnapshot } from "./source-turn-budget.js";

export interface StreamingContext {
  messageId?: string;
  abortSignal?: AbortSignal;
  turnBudget?: TurnBudgetSnapshot;
  onStreamChunk?: (chunk: { text?: string }) => boolean | void | Promise<boolean | void>;
  onStreamEnd?: () => void;
  onAgentEvent?: (event: { stream: string; data: Record<string, unknown> }) => void | Promise<void>;
  reportError?: (scope: string, error: unknown, context?: Record<string, unknown>) => void;
}

export interface StreamingContextManager {
  run<T>(context: StreamingContext | undefined, fn: () => T): T;
  active(): StreamingContext | undefined;
}

const managerKey = Symbol.for("branch.sourceStreamingContextManager");
const deliveryDepthKey = Symbol.for("branch.sourceModelStreamChunkDeliveryDepth");

export function getStreamingContextManager(): StreamingContextManager {
  return resolveGlobalSingleton(managerKey, () => {
    const storage = new AsyncLocalStorage<StreamingContext | undefined>();
    return { run: <T>(context: StreamingContext | undefined, fn: () => T) => storage.run(context, fn),
      active: () => storage.getStore() };
  });
}

export function setStreamingContextManager(manager: StreamingContextManager): void {
  (globalThis as Record<PropertyKey, unknown>)[managerKey] = manager;
}

export function getStreamingContext(): StreamingContext | undefined {
  return getStreamingContextManager().active();
}

export function runWithStreamingContext<T>(context: StreamingContext | undefined, fn: () => T): T {
  return getStreamingContextManager().run(context, fn);
}

export function runWithSuppressedModelStream<T>(fn: () => T): T {
  const active = getStreamingContext();
  return active?.onStreamChunk
    ? runWithStreamingContext({ ...active, onStreamChunk: async () => undefined }, fn)
    : fn();
}

function deliveryDepthStorage(): AsyncLocalStorage<number> {
  return resolveGlobalSingleton(deliveryDepthKey, () => new AsyncLocalStorage<number>());
}

export function getModelStreamChunkDeliveryDepth(): number {
  return deliveryDepthStorage().getStore() ?? 0;
}

export function runInsideModelStreamChunkDelivery<T>(fn: () => T): T {
  return deliveryDepthStorage().run(getModelStreamChunkDeliveryDepth() + 1, fn);
}

export async function emitStreamingEvent(
  context: StreamingContext | undefined,
  event: { stream: string; data: Record<string, unknown> },
): Promise<void> {
  try {
    await context?.onAgentEvent?.(event);
  } catch (error) {
    context?.reportError?.("StreamingContext.emitHook", error, { hook: "onAgentEvent" });
  }
}
