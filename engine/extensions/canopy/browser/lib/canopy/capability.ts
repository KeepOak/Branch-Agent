import { setCanopyCards } from "./card-state.ts";
import {
  getCanopyState,
  resetCanopyConnectionState,
  stopCanopyLiveRefresh,
} from "./runtime.ts";
import type { CanopyUiState } from "./types.ts";

export type CanopyCapability = {
  readonly state: CanopyUiState;
  readonly boardsReady: boolean;
  notify: () => void;
  setBoardsReady: (ready: boolean) => void;
  clearCatalog: () => void;
  subscribe: (listener: () => void) => () => void;
  dispose: () => void;
};

export function createCanopyCapability(): CanopyCapability {
  const listeners = new Set<() => void>();
  let disposed = false;
  let boardsReady = false;
  const capability: CanopyCapability = {
    get state() {
      return getCanopyState(capability);
    },
    get boardsReady() {
      return boardsReady;
    },
    notify() {
      if (disposed) {
        return;
      }
      for (const listener of listeners) {
        listener();
      }
    },
    setBoardsReady(ready) {
      boardsReady = ready;
    },
    clearCatalog() {
      const hadRows = capability.state.boards.length > 0 || capability.state.cards.length > 0;
      const wasReady = boardsReady;
      boardsReady = false;
      capability.state.boards = [];
      setCanopyCards(capability.state, []);
      capability.state.loaded = false;
      capability.state.loadAttempted = false;
      if (hadRows || wasReady) {
        capability.notify();
      }
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose() {
      disposed = true;
      stopCanopyLiveRefresh(capability);
      resetCanopyConnectionState(capability);
      listeners.clear();
    },
  };
  return capability;
}
