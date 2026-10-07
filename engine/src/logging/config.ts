import fs from "node:fs";
import { isRecord as isObjectRecord } from "@branch/normalization-core/record-coerce";
import { resolveConfigEnvVars } from "../config/env-substitution.js";
import { resolveConfigIncludes, resolveConfigIncludesForTopLevelKey } from "../config/includes.js";
import { resolveConfigPath, resolveIncludeRoots } from "../config/paths.js";
import type { BranchConfig } from "../config/types.branch.js";
import { tryProcessCwd } from "../infra/safe-cwd.js";
import { parseJsonWithJson5Fallback } from "../utils/parse-json-compat.js";
import { APPLIED_LOGGING_CONFIG_UNOWNED, loggingState } from "./state.js";

// Lightweight logging-config reader used before the full config runtime is safe to load.
type LoggingConfig = NonNullable<BranchConfig["logging"]>;

let cachedLoggingConfig:
  | {
      selector: string;
      logging: LoggingConfig | undefined;
    }
  | undefined;

export function invalidateLoggingConfigCache(): void {
  cachedLoggingConfig = undefined;
}

function resolveLoggingConfigSelector(): string {
  const env = process.env;
  return [
    env.BRANCH_CONFIG_PATH,
    env.BRANCH_STATE_DIR,
    env.BRANCH_HOME,
    env.BRANCH_PROFILE,
    env.HOME,
    env.USERPROFILE,
    env.HOMEDRIVE,
    env.HOMEPATH,
    env.PREFIX,
    env.ANDROID_DATA,
    env.BRANCH_TEST_FAST,
    tryProcessCwd() ?? "",
  ]
    .map((value) => value ?? "")
    .join("\0");
}

function resolvePartialDiagnosticLoggingConfig(logging: unknown): LoggingConfig | undefined {
  if (!isObjectRecord(logging)) {
    return undefined;
  }
  const partial: Record<string, unknown> = {};
  if (typeof logging.consoleStyle === "string") {
    try {
      const resolved = resolveConfigEnvVars({ consoleStyle: logging.consoleStyle });
      if (
        isObjectRecord(resolved) &&
        (resolved.consoleStyle === "pretty" ||
          resolved.consoleStyle === "compact" ||
          resolved.consoleStyle === "json")
      ) {
        partial.consoleStyle = resolved.consoleStyle;
      }
    } catch {
      // Keep resolving independent diagnostic fields.
    }
  }
  if (Array.isArray(logging.redactPatterns)) {
    try {
      const resolved = resolveConfigEnvVars({ redactPatterns: logging.redactPatterns });
      if (
        isObjectRecord(resolved) &&
        Array.isArray(resolved.redactPatterns) &&
        resolved.redactPatterns.every((entry) => typeof entry === "string")
      ) {
        partial.redactPatterns = resolved.redactPatterns;
      }
    } catch {
      // A missing variable in one pattern must not hide a separately resolvable style.
    }
  }
  return Object.keys(partial).length > 0 ? (partial as LoggingConfig) : undefined;
}

/** Reads the logging block from config, caching by resolved config path. */
export function readLoggingConfig(): LoggingConfig | undefined {
  try {
    if (loggingState.appliedConfig !== APPLIED_LOGGING_CONFIG_UNOWNED) {
      return loggingState.appliedConfig;
    }
    const selector = resolveLoggingConfigSelector();
    if (cachedLoggingConfig?.selector === selector) {
      return cachedLoggingConfig.logging;
    }
    const configPath = resolveConfigPath();
    if (!fs.existsSync(configPath)) {
      cachedLoggingConfig = { selector, logging: undefined };
      return undefined;
    }
    const parsed = parseJsonWithJson5Fallback(fs.readFileSync(configPath, "utf8"));
    const allowedRoots = resolveIncludeRoots();
    let includedConfig: unknown;
    try {
      includedConfig = resolveConfigIncludesForTopLevelKey(
        parsed,
        configPath,
        "logging",
        undefined,
        { allowedRoots },
      );
    } catch {
      // Validation commands still need a directly-authored logging style when an unrelated
      // root include is malformed. Resolve only that subtree through the same canonical rules.
      const directLogging = isObjectRecord(parsed) ? parsed.logging : undefined;
      if (directLogging === undefined) {
        return undefined;
      }
      try {
        includedConfig = resolveConfigIncludes({ logging: directLogging }, configPath, undefined, {
          allowedRoots,
        });
      } catch {
        return resolvePartialDiagnosticLoggingConfig(directLogging);
      }
    }
    let resolvedConfig: unknown;
    try {
      resolvedConfig = resolveConfigEnvVars(includedConfig);
    } catch {
      const includedLogging = isObjectRecord(includedConfig) ? includedConfig.logging : undefined;
      return resolvePartialDiagnosticLoggingConfig(includedLogging);
    }
    const logging = isObjectRecord(resolvedConfig) ? resolvedConfig.logging : undefined;
    const resolvedLogging = isObjectRecord(logging) ? (logging as LoggingConfig) : undefined;
    cachedLoggingConfig = {
      selector,
      logging: resolvedLogging,
    };
    return resolvedLogging;
  } catch {
    return undefined;
  }
}

/** Capture before dispatch; the returned guard never refreshes configuration or reads files. */
export function captureLoggingRedactionPatternGuard(
  explicitPatterns?: readonly string[],
): () => boolean {
  const captured = (explicitPatterns ?? readLoggingConfig()?.redactPatterns)?.slice();
  return () => {
    let current = explicitPatterns;
    if (current === undefined) {
      if (loggingState.appliedConfig !== APPLIED_LOGGING_CONFIG_UNOWNED) {
        current = loggingState.appliedConfig?.redactPatterns;
      } else {
        if (
          !cachedLoggingConfig ||
          cachedLoggingConfig.selector !== resolveLoggingConfigSelector()
        ) {
          return false;
        }
        current = cachedLoggingConfig.logging?.redactPatterns;
      }
    }
    return (
      current?.length === captured?.length &&
      !current?.some((pattern, index) => pattern !== captured?.[index])
    );
  };
}
