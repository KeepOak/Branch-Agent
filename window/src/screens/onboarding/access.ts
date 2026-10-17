// The first-run access choice: the same tools.exec.mode Settings › Permissions and the composer chip read.
// Ask first is the recommended default. Full access is never written here.
import type { WindowEngine } from "../../connect/engine";
import { configStore } from "../../places/settings/config-store";
import { MODES, type ModeId } from "./model";

/** tools.exec.mode for the onboarding choice. Plan first has no engine mode yet. */
export function execOf(mode: ModeId): string | null {
  return MODES.find((row) => row.id === mode)?.exec ?? null;
}

/** The recommended first-run access when the person has not picked another. */
export const FIRST_RUN_ACCESS: ModeId = "ask";

/** Saves the choice the way Settings › Permissions does. The engine refuses mode beside the older security/ask keys. */
export async function saveOnboardingAccess(engine: WindowEngine, mode: ModeId = FIRST_RUN_ACCESS): Promise<void> {
  const exec = execOf(mode);
  if (!exec) return;
  await configStore(engine).set("tools.exec", { mode: exec, security: null, ask: null });
}
