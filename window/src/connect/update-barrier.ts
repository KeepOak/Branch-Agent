import { useSyncExternalStore } from "react";

let blocked = false;
const listeners = new Set<() => void>();
const volatileInputs = new Set<() => boolean>();
export function registerVolatileInput(check: () => boolean): () => void {
  volatileInputs.add(check);
  return () => { volatileInputs.delete(check); };
}
export const hasVolatileInputs = () => [...volatileInputs].some((check) => check());
const checkpoints = new Set<() => Promise<void> | void>();
export function setUpdateBarrier(next: boolean): void {
  blocked = next;
  for (const notify of listeners) notify();
}
export const updateBlocked = () => blocked;
export function useUpdateBarrier(): boolean {
  return useSyncExternalStore((notify) => { listeners.add(notify); return () => { listeners.delete(notify); }; }, updateBlocked);
}
export function registerInputCheckpoint(checkpoint: () => Promise<void> | void): () => void {
  checkpoints.add(checkpoint);
  return () => { checkpoints.delete(checkpoint); };
}
/** Called before asking the engine to stop. A failed save prevents the restart. */
export async function checkpointInputs(): Promise<void> {
  if (hasVolatileInputs()) throw new Error("Temporary messages stay in this window. Branch will wait before updating.");
  await Promise.all([...checkpoints].map((save) => save()));
}
