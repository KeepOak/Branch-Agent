/**
 * BRANCH PORT: upstream built a WebSocket/postMessage transport at import time. In Branch the office is
 * mounted into the app (no server, no network), so every upstream module keeps importing `transport`
 * and talks to whichever in-memory BranchTransport the current mount installed
 * (src/branch/branchTransport.ts). One office mounts at a time (the Grove view); a second mount
 * replaces the first's transport until it is destroyed.
 */
import type { ClientMessage, ServerMessage } from '../../../core/src/messages.js';
import type { MessageTransport, TransportState } from './types.js';

let active: MessageTransport | null = null;

export function setActiveTransport(t: MessageTransport | null): void {
  active = t;
}

/** Singleton facade. Import this everywhere instead of vscodeApi. */
export const transport: MessageTransport = {
  send(msg: ClientMessage): void {
    active?.send(msg);
  },
  onMessage(handler: (msg: ServerMessage) => void): () => void {
    return active ? active.onMessage(handler) : () => {};
  },
  get ready(): Promise<void> {
    return active ? active.ready : Promise.resolve();
  },
  get state(): TransportState {
    return active ? active.state : 'connected';
  },
  onStateChange(handler: (state: TransportState) => void): () => void {
    return active ? active.onStateChange(handler) : () => {};
  },
  dispose(): void {
    active?.dispose();
  },
};
export type { MessageTransport } from './types.js';
