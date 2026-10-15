// The Coming contract (R1-10): every control names the engine call it needs, and a control whose call this engine
// doesn't offer renders the Coming state instead of pretending. The engine announces its methods in its hello
// (HelloOk.features, engine/packages/gateway-protocol/src/schema/frames.ts); WindowEngine.features carries them.
// A listed method that answers "unknown method" (a plugin that is switched off, as places/canopy/CardsOff.tsx reads it)
// is remembered as missing too, until the next hello.
import { createContext, createElement, useContext, useSyncExternalStore, type ReactNode } from "react";
import type { EngineFeatures, WindowEngine } from "./engine";

/** "yes" when the engine offers the method, "no" when it doesn't, "unknown" before the first hello. */
export type Availability = "yes" | "no" | "unknown";

const methodSets = new WeakMap<EngineFeatures, Set<string>>();
const missingAtRuntime = new WeakMap<EngineFeatures, Set<string>>();
const listeners = new Set<() => void>();
let version = 0;

function methodsOf(features: EngineFeatures): Set<string> {
  let set = methodSets.get(features);
  if (!set) methodSets.set(features, (set = new Set(features.methods)));
  return set;
}

export function availability(engine: Pick<WindowEngine, "features"> | null | undefined, method: string): Availability {
  const features = engine?.features;
  if (!features) return "unknown";
  return methodsOf(features).has(method) && !missingAtRuntime.get(features)?.has(method) ? "yes" : "no";
}

/** True when the engine offers every one of the methods. */
export function canAll(engine: Pick<WindowEngine, "features"> | null | undefined, methods: readonly string[]): boolean {
  return methods.every((method) => availability(engine, method) === "yes");
}

/** The engine's own wording for a method it doesn't have (gateway server-methods: "unknown method: <name>"). */
export const isUnknownMethod = (error: unknown): boolean =>
  /unknown method/i.test(error instanceof Error ? error.message : typeof error === "string" ? error : "");

/** Remembers a method that answered "unknown method", so its controls turn to Coming. Returns whether it did. */
export function noteUnknownMethod(engine: Pick<WindowEngine, "features"> | null | undefined, method: string, error: unknown): boolean {
  const features = engine?.features;
  if (!features || !isUnknownMethod(error)) return false;
  let set = missingAtRuntime.get(features);
  if (!set) missingAtRuntime.set(features, (set = new Set()));
  if (set.has(method)) return true;
  set.add(method);
  version++;
  for (const listener of listeners) listener();
  return true;
}

/** engine.request that also turns the method's controls to Coming when the engine says it has no such method. */
export async function requestOrComing<T = unknown>(engine: WindowEngine, method: string, params?: unknown): Promise<T> {
  try {
    return await engine.request<T>(method, params);
  } catch (error) {
    noteUnknownMethod(engine, method, error);
    throw error;
  }
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};
const readVersion = () => version;

/** Re-renders when a method turns out to be missing at runtime. */
export function useCapabilityVersion(): number {
  return useSyncExternalStore(subscribe, readVersion, readVersion);
}

/** True when the engine offers the method (false before the first hello). */
export function useCan(engine: Pick<WindowEngine, "features"> | null | undefined, method: string): boolean {
  useCapabilityVersion();
  return availability(engine, method) === "yes";
}

const CapabilityContext = createContext<Pick<WindowEngine, "features"> | null>(null);

/** Gives every Coming control below it the engine to check against. The frame mounts it once. */
export function CapabilityProvider({ engine, children }: { engine: Pick<WindowEngine, "features"> | null; children?: ReactNode }) {
  return createElement(CapabilityContext.Provider, { value: engine }, children);
}

export function useCapabilityEngine(): Pick<WindowEngine, "features"> | null {
  return useContext(CapabilityContext);
}
