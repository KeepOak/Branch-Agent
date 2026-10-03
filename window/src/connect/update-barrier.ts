import { useSyncExternalStore } from "react";

let blocked = false;
const listeners = new Set<() => void>();
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
  await Promise.all([...checkpoints].map((save) => save()));
}
