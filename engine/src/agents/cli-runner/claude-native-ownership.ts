import fs from "node:fs";
import path from "node:path";
import type { CliSessionBinding } from "../../config/sessions/types.js";
import type { BranchConfig } from "../../config/types.branch.js";

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function configDir(value: unknown): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    /[\r\n\0]/u.test(value) ||
    !path.isAbsolute(value.trim()) ||
    (process.platform !== "win32" && /^[A-Za-z]:[\\/]/u.test(value))
  ) {
    throw new Error(
      "Native Claude config directories must be absolute paths on the executing host",
    );
  }
  const normalized = path.normalize(value.trim());
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

/** Resolve explicit ownership before inspecting auth, reading history, or launching a native turn. */
export function selectClaudeNativeConfigDir(params: {
  config?: BranchConfig;
  binding?: CliSessionBinding;
  cliSessionId?: string;
  execHost?: string;
  authProfileId?: string;
  backendAuthProfileId?: string;
  backendEnv?: Record<string, string>;
  assertDirectory?: (directory: string) => void;
}): string | undefined {
  const owner = params.binding?.nativeConfigDir;
  const registry: unknown = params.config?.plugins?.entries?.anthropic?.config?.nativeAccounts;
  if (registry === undefined && owner === undefined) {
    return undefined;
  }
  if (!record(registry) || !Array.isArray(registry.configDirs) || !registry.configDirs.length) {
    throw new Error(
      "Native Claude account registry is missing or invalid; explicit migration is required",
    );
  }
  // A local config path is never authority to select a paired node's native account.
  if (params.execHost && params.execHost !== "gateway") {
    throw new Error("Native Claude account registry does not support remote execution");
  }
  if (params.authProfileId?.trim() || params.backendAuthProfileId?.trim()) {
    throw new Error("Native Claude accounts cannot use Branch auth profile overrides");
  }
  const dirs = registry.configDirs.map(configDir);
  if (new Set(dirs).size !== dirs.length) {
    throw new Error("Native Claude account config directories must be unique");
  }
  const defaultDir = configDir(registry.defaultConfigDir);
  if (!dirs.includes(defaultDir)) {
    throw new Error("Native Claude default config directory is not registered");
  }
  const hasBinding = Boolean(params.binding?.sessionId?.trim() || params.cliSessionId?.trim());
  if (hasBinding && !owner) {
    throw new Error("Native Claude session has no account owner; explicit migration is required");
  }
  const selected = owner === undefined ? defaultDir : configDir(owner);
  if (!dirs.includes(selected)) {
    throw new Error(
      "Native Claude session owner is no longer registered; explicit migration is required",
    );
  }
  if (
    params.backendEnv?.CLAUDE_CONFIG_DIR &&
    configDir(params.backendEnv.CLAUDE_CONFIG_DIR) !== selected
  ) {
    throw new Error("Native Claude backend config directory conflicts with the session owner");
  }
  (params.assertDirectory ?? assertClaudeNativeConfigDirectory)(selected);
  return selected;
}

/** Metadata only: never read or import CLI-owned credentials. */
export function assertClaudeNativeConfigDirectory(directory: string): void {
  if (!fs.statSync(directory).isDirectory()) {
    throw new Error("Native Claude account config directory is unavailable");
  }
}
