import { normalizeLowercaseStringOrEmpty } from "@branch/normalization-core/string-coerce";
import { normalizeUniqueStringEntriesLower } from "@branch/normalization-core/string-normalization";
import type { BranchConfig } from "../config/types.branch.js";
import { parseDiagnosticEnvFlags } from "./diagnostic-flags-env.js";

const DIAGNOSTICS_ENV = "BRANCH_DIAGNOSTICS";

/** Resolves enabled diagnostic flags from config plus `BRANCH_DIAGNOSTICS` overrides. */
function resolveDiagnosticFlags(
  cfg?: BranchConfig,
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const configFlags = Array.isArray(cfg?.diagnostics?.flags) ? cfg?.diagnostics?.flags : [];
  const envFlags = parseDiagnosticEnvFlags(env[DIAGNOSTICS_ENV]);
  if (envFlags.disablesAll) {
    return [];
  }
  return normalizeUniqueStringEntriesLower([...configFlags, ...envFlags.flags]);
}

/** Returns whether a diagnostic flag is enabled after config/env resolution. */
export function isDiagnosticFlagEnabled(
  flag: string,
  cfg?: BranchConfig,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const enabledFlags = resolveDiagnosticFlags(cfg, env);
  const target = normalizeLowercaseStringOrEmpty(flag);
  if (!target) {
    return false;
  }
  for (const enabled of enabledFlags) {
    if (enabled === "*" || enabled === "all") {
      return true;
    }
    if (enabled.endsWith(".*")) {
      const prefix = enabled.slice(0, -2);
      if (target === prefix || target.startsWith(`${prefix}.`)) {
        return true;
      }
    }
    if (enabled.endsWith("*")) {
      const prefix = enabled.slice(0, -1);
      if (target.startsWith(prefix)) {
        return true;
      }
    }
    if (enabled === target) {
      return true;
    }
  }
  return false;
}
