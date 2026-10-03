import { uniqueStrings } from "@branch/normalization-core/string-normalization";
import { listKnownChannelEnvVarNames } from "../secrets/channel-env-vars.js";
import { listKnownProviderAuthEnvVarNamesCore } from "../secrets/provider-env-vars.js";
import type { BranchConfig } from "./types.branch.js";

const CORE_SHELL_ENV_EXPECTED_KEYS = ["BRANCH_GATEWAY_TOKEN", "BRANCH_GATEWAY_PASSWORD"];

/** Includes configured plugin paths when selecting keys for login-shell import. */
export function resolveShellEnvExpectedKeys(
  env: NodeJS.ProcessEnv,
  config?: BranchConfig,
): string[] {
  return uniqueStrings([
    ...listKnownProviderAuthEnvVarNamesCore({ config, env }),
    ...listKnownChannelEnvVarNames({ config, env }),
    ...CORE_SHELL_ENV_EXPECTED_KEYS,
  ]);
}
