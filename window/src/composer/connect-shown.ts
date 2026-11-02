import { useSyncExternalStore } from "react";

// Classic conversations whose composer shows Connect a model right now (a held send's reason). The empty state
// (thread/EmptyState) leaves its own copy out then, so the person sees the notice once after Send.
const shown = new Set<string>();
const listeners = new Set<() => void>();

export function markComposerConnect(sessionKey: string, on: boolean): void {
  if (on === shown.has(sessionKey)) return;
  if (on) shown.add(sessionKey);
  else shown.delete(sessionKey);
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** True while this conversation's Classic composer shows the Connect a model notice for a held send. */
export function useComposerShowsConnect(sessionKey: string | null | undefined): boolean {
  return useSyncExternalStore(
    subscribe,
    () => Boolean(sessionKey) && shown.has(sessionKey ?? ""),
    () => false,
  );
}
