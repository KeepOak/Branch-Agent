// A standby engine holds its loopback port with a placeholder listener from the moment it has warmed until the real
// gateway binds that port, in the same process, so nothing else can take it in between (bootstrap, lock, activate).
import { resolveGlobalSingleton } from "../shared/global-singleton.js";

type Placeholder = { port: number; close: () => Promise<void> };

const held = resolveGlobalSingleton(Symbol.for("branch.standbyPortPlaceholder"), () => ({
  placeholder: undefined as Placeholder | undefined,
}));

/** The standby hands its placeholder over to be closed right before the real bind. */
export function holdStandbyPortPlaceholder(placeholder: Placeholder): void {
  held.placeholder = placeholder;
}

/** Closes the placeholder on `port`, if this process holds one, so the real gateway can bind it now. */
export async function releaseStandbyPortPlaceholder(port: number): Promise<void> {
  const placeholder = held.placeholder;
  if (!placeholder || placeholder.port !== port) return;
  held.placeholder = undefined;
  await placeholder.close();
}

/** True while this process holds a standby placeholder on `port`. */
export function isStandbyPortPlaceholderHeld(port: number): boolean {
  return held.placeholder?.port === port;
}
