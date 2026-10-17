// The first-run access choice: the same tools.exec.mode Settings › Permissions and the composer chip read.
// Ask first is the recommended default. Full access is never written here. An access already in the profile is left
// alone unless this run picked a mode (Continue on the mode step always writes).
import type { WindowEngine } from "../../connect/engine";
import { configStore } from "../../places/settings/config-store";
import { MODES, type ModeId } from "./model";

/** tools.exec.mode for the onboarding choice. Plan first has no engine mode yet. */
export function execOf(mode: ModeId): string | null {
  return MODES.find((row) => row.id === mode)?.exec ?? null;
}

/** The configured tools.exec.mode, or undefined when the profile has not chosen one yet. */
export function execModeOf(config: unknown): string | undefined {
  const tools = config && typeof config === "object" && !Array.isArray(config) ? (config as { tools?: unknown }).tools : undefined;
  const exec = tools && typeof tools === "object" && !Array.isArray(tools) ? (tools as { exec?: unknown }).exec : undefined;
  const mode = exec && typeof exec === "object" && !Array.isArray(exec) ? (exec as { mode?: unknown }).mode : undefined;
  return typeof mode === "string" && mode ? mode : undefined;
}

/** The recommended first-run access when the person has not picked another. */
export const FIRST_RUN_ACCESS: ModeId = "ask";

/** Reads the profile's tools.exec.mode. Undefined means first run: the engine still resolves Full access. */
export async function existingExecMode(engine: WindowEngine): Promise<string | undefined> {
  const store = configStore(engine);
  if (!store.snap) await store.load();
  return execModeOf(store.snap?.config);
}

/** Saves the choice the way Settings › Permissions does. The engine refuses mode beside the older security/ask keys.
 *  Set up later, Meet them and Set up by talking pass onlyIfUnset so an existing choice is kept; Continue does not. */
export async function saveOnboardingAccess(
  engine: WindowEngine,
  mode: ModeId = FIRST_RUN_ACCESS,
  opts?: { onlyIfUnset?: boolean },
): Promise<void> {
  const exec = execOf(mode);
  if (!exec) return;
  if (opts?.onlyIfUnset && (await existingExecMode(engine))) return;
  await configStore(engine).set("tools.exec", { mode: exec, security: null, ask: null });
}
