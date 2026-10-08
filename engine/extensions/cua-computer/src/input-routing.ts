/** Input backends the Linux/X11 computer route can name in tests and probes. */
export type ComputerInputBackend =
  | "xtest"
  | "xinput2"
  | "atspi"
  | "libei"
  | "accessibility"
  | "ui_automation";

const FOCUS_FREE_BACKENDS = new Set<string>([
  "xinput2",
  "atspi",
  "libei",
  "accessibility",
  "ui_automation",
]);

/** Plain words for the agent the first time focused input is the only route. */
export const FOCUSED_INPUT_NOTICE =
  "This computer has no focus-free input, so I will move windows and focus them while I work. Tell the user their screen will change.";

function normalizeBackend(backend: string): string {
  return backend.trim().toLowerCase();
}

/** True when at least one advertised backend can deliver without taking focus. */
export function hasFocusFreeInputBackend(backends: readonly string[]): boolean {
  return backends.some((backend) => FOCUS_FREE_BACKENDS.has(normalizeBackend(backend)));
}

/**
 * Skip background delivery only when the platform named backends and every
 * one of them is focus-bound (XTest). An empty list is unknown and keeps
 * today's background-first behaviour.
 */
export function mustUseFocusedInput(backends: readonly string[]): boolean {
  return backends.length > 0 && !hasFocusFreeInputBackend(backends);
}

export function detectComputerInputBackends(params: {
  platform: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
}): string[] {
  if (params.platform === "darwin") {
    return ["accessibility"];
  }
  if (params.platform === "win32") {
    return ["ui_automation"];
  }
  if (params.platform !== "linux") {
    return [];
  }
  const env = params.env ?? {};
  const wayland = Boolean(env.WAYLAND_DISPLAY) || env.XDG_SESSION_TYPE === "wayland";
  if (env.DISPLAY && !wayland) {
    return ["xtest"];
  }
  return [];
}

export function resolveWindowInputDelivery(params: {
  backends: readonly string[];
  requested?: "background" | "foreground";
}): { deliveryMode?: "background" | "foreground"; focusedBecauseNoFocusFree: boolean } {
  if (mustUseFocusedInput(params.backends)) {
    return { deliveryMode: "foreground", focusedBecauseNoFocusFree: true };
  }
  if (params.requested) {
    return { deliveryMode: params.requested, focusedBecauseNoFocusFree: false };
  }
  return { deliveryMode: undefined, focusedBecauseNoFocusFree: false };
}
