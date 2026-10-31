// The first-run access choice: the same tools.exec.mode Settings › Permissions and the composer chip read.
// Ask first is the recommended default. Full access is never written here. An access already in the profile — including
// an older security/ask pair — is left alone unless this run picked a mode (Continue on the mode step always writes).
import type { WindowEngine } from "../../connect/engine";
import { configStore } from "../../places/settings/config-store";
import { MODES, type ModeId } from "./model";

type ExecRecord = { mode?: unknown; security?: unknown; ask?: unknown };

function execRecordOf(config: unknown): ExecRecord | undefined {
  const tools = config && typeof config === "object" && !Array.isArray(config) ? (config as { tools?: unknown }).tools : undefined;
  const exec = tools && typeof tools === "object" && !Array.isArray(tools) ? (tools as { exec?: unknown }).exec : undefined;
  return exec && typeof exec === "object" && !Array.isArray(exec) ? (exec as ExecRecord) : undefined;
}

/** Exact tools.exec.mode for an older security/ask pair (engine resolveExactExecModeFromPolicy). */
function exactModeFromPolicy(security: unknown, ask: unknown): string | undefined {
  if (security !== "deny" && security !== "allowlist" && security !== "full") return undefined;
  if (ask !== "off" && ask !== "on-miss" && ask !== "always") return undefined;
  if (ask === "always" || (security === "full" && ask === "on-miss")) return undefined;
  if (security === "deny") return "deny";
  if (security === "allowlist" && ask === "off") return "allowlist";
  if (security === "full") return "full";
  return "ask";
}

function savedExecMode(exec: ExecRecord | undefined): string | undefined {
  return typeof exec?.mode === "string" && exec.mode ? exec.mode : undefined;
}

/** True when the profile already has a current mode or an older security/ask choice. */
export function hasSavedAccess(config: unknown): boolean {
  const exec = execRecordOf(config);
  if (!exec) return false;
  if (savedExecMode(exec)) return true;
  if (exec.security === "deny" || exec.security === "allowlist" || exec.security === "full") return true;
  if (exec.ask === "off" || exec.ask === "on-miss" || exec.ask === "always") return true;
  return false;
}

/** tools.exec.mode for the onboarding choice. Plan first has no engine mode yet. */
export function execOf(mode: ModeId): string | null {
  return MODES.find((row) => row.id === mode)?.exec ?? null;
}

/** The configured tools.exec.mode, or the older security/ask pair moved to that mode. Undefined when nothing is saved. */
export function execModeOf(config: unknown): string | undefined {
  const exec = execRecordOf(config);
  if (!exec) return undefined;
  return savedExecMode(exec) ?? exactModeFromPolicy(exec.security, exec.ask);
}

/** The recommended first-run access when the person has not picked another. */
export const FIRST_RUN_ACCESS: ModeId = "ask";

/** Reads the profile's access. Undefined means first run: the engine resolves Ask first. */
export async function existingExecMode(engine: WindowEngine): Promise<string | undefined> {
  const store = configStore(engine);
  if (!store.snap) await store.load();
  return execModeOf(store.snap?.config);
}

async function writeExecMode(engine: WindowEngine, mode: string): Promise<void> {
  await configStore(engine).set("tools.exec", { mode, security: null, ask: null });
}

/** Saves the choice the way Settings › Permissions does. The engine refuses mode beside the older security/ask keys.
 *  Set up later, Meet them and Set up by talking pass onlyIfUnset so an existing choice is kept; Continue does not.
 *  An older security/ask pair is moved to tools.exec.mode instead of being overwritten with Ask first. */
export async function saveOnboardingAccess(
  engine: WindowEngine,
  mode: ModeId = FIRST_RUN_ACCESS,
  opts?: { onlyIfUnset?: boolean },
): Promise<void> {
  const exec = execOf(mode);
  if (!exec) return;
  if (opts?.onlyIfUnset) {
    const store = configStore(engine);
    if (!store.snap) await store.load();
    const config = store.snap?.config;
    if (savedExecMode(execRecordOf(config))) return;
    const migrated = execModeOf(config);
    if (migrated) {
      await writeExecMode(engine, migrated);
      return;
    }
    if (hasSavedAccess(config)) return;
  }
  await writeExecMode(engine, exec);
}
