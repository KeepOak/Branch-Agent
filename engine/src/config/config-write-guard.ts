import { resolveIsConfigReadOnly, resolveIsNixMode } from "./paths.js";

/** Agent-first Nix install docs shown when runtime config writes are blocked. */
const NIX_BRANCH_AGENT_FIRST_URL = "https://github.com/openclaw/nix-openclaw#quick-start";
/** Public Branch Agent Nix overview shown with immutable-config errors. */
const NIX_OVERVIEW_URL = "https://github.com/KeepOak/Branch-Agent/tree/main/engine/docs/install/nix";

/** Error thrown when external management disables config mutation. */
export class ConfigReadOnlyError extends Error {
  readonly code = "BRANCH_CONFIG_READONLY";

  constructor(params: { configPath?: string } = {}) {
    super(
      [
        "Config is externally managed (`BRANCH_CONFIG_READONLY=1`), so Branch Agent treats branch.json as immutable.",
        ...(params.configPath ? [`Config path: ${params.configPath}`] : []),
        "Edit the config in your external deployment source, then redeploy or restart Branch Agent as needed.",
      ].join("\n"),
    );
    this.name = "ConfigReadOnlyError";
  }
}

/** Error thrown when a mutating config path is attempted while Nix owns config state. */
export class NixModeConfigMutationError extends Error {
  readonly code = "BRANCH_NIX_MODE_CONFIG_IMMUTABLE";

  constructor(params: { configPath?: string } = {}) {
    super(
      [
        "Config is managed by Nix (`BRANCH_NIX_MODE=1`), so Branch Agent treats branch.json as immutable.",
        "This usually means nix-branch, the first-party Nix distribution, or another Nix-managed package set this mode.",
        ...(params.configPath ? [`Config path: ${params.configPath}`] : []),
        "Do not run setup, onboarding, branch update, plugin install/update/uninstall/enable, doctor repair/token-generation, or config set against this file.",
        "Edit the Nix source for this install instead. For nix-branch, edit `programs.branch.config` or `instances.<name>.config`, then rebuild with Home Manager or NixOS.",
        `Agent-first Nix setup: ${NIX_BRANCH_AGENT_FIRST_URL}`,
        `Branch Agent Nix overview: ${NIX_OVERVIEW_URL}`,
      ].join("\n"),
    );
    this.name = "NixModeConfigMutationError";
  }
}

/** Throw before side effects when the environment marks config as immutable. */
export function assertConfigWriteAllowedInCurrentMode(
  params: {
    configPath?: string;
    env?: NodeJS.ProcessEnv;
  } = {},
): void {
  if (!resolveIsConfigReadOnly(params.env)) {
    return;
  }
  throw createConfigMutationError(params);
}

/** Select deployment-specific guidance without enabling deployment-specific behavior. */
export function createConfigMutationError(
  params: { configPath?: string; env?: NodeJS.ProcessEnv } = {},
): Error {
  return resolveIsNixMode(params.env)
    ? new NixModeConfigMutationError(params)
    : new ConfigReadOnlyError(params);
}
