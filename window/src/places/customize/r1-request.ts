// Asks Customize (R1) for a mode or a kind before it opens. The place may not be mounted yet, so the request also waits
// in memory for its mount to read it; a mounted place hears the window event at once. The mount clears what it read.
export type CustomizeMode = "personal" | "community";
/** `community`: the Seedbank kind Community opens on ("all" for every kind). */
export type CustomizeRequest = { mode?: CustomizeMode; kind?: string; community?: string };
/** Puts a command into the default Trunk's composer. `ready` is false while no default Trunk exists. */
export type PromptHandoff = { ready: boolean; use: (text: string) => void };

let pending: CustomizeRequest = {};
export const CUSTOMIZE_REQUEST_EVENT = "branch:customize-request";

/** Records the request and tells a mounted Customize. */
export function requestCustomize(request: CustomizeRequest): void {
  pending = { ...pending, ...request };
  window.dispatchEvent(new CustomEvent(CUSTOMIZE_REQUEST_EVENT, { detail: request }));
}

/** What is waiting for the mount, without clearing it. */
export function peekCustomizeRequest(): CustomizeRequest {
  return pending;
}

/** Clears what was waiting; a mount calls this once it has read it. */
export function takeCustomizeRequest(): CustomizeRequest {
  const request = pending;
  pending = {};
  return request;
}
