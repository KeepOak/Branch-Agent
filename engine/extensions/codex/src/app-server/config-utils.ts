import { createHmac, randomBytes } from "node:crypto";
import { resolveGlobalSingleton } from "branch/plugin-sdk/global-singleton";
import { splitCommandArgs } from "branch/plugin-sdk/process-runtime";
import { normalizeResolvedSecretInputString } from "branch/plugin-sdk/secret-input";
import {
  asOptionalRecord as readRecord,
  normalizeOptionalString as readNonEmptyString,
  normalizeTrimmedStringList,
} from "branch/plugin-sdk/string-coerce-runtime";
import type { BranchExecAsk, BranchExecSecurity } from "./config-contracts.shared.js";
import { normalizeCodexServiceTier } from "./service-tier-normalization.js";

export { normalizeCodexServiceTier } from "./service-tier-normalization.js";

const START_OPTIONS_KEY_SECRET = resolveGlobalSingleton(
  Symbol.for("branch.codexAppServerStartOptionsKeySecret"),
  () => randomBytes(32),
);
const PLAIN_DECIMAL_NUMBER_RE = /^[+-]?(?:(?:\d+\.?\d*)|(?:\.\d+))$/;

export { readNonEmptyString, readRecord };

export function isCodexFastServiceTier(value: unknown): boolean {
  return normalizeCodexServiceTier(value) === "priority";
}

export function normalizeHeaders(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value)
      .map(
        ([key, child]) =>
          [
            key.trim(),
            normalizeResolvedSecretInputString({
              value: child,
              path: `plugins.entries.codex.config.appServer.headers.${key}`,
            }),
          ] as const,
      )
      .filter((entry): entry is readonly [string, string] => Boolean(entry[0] && entry[1])),
  );
}

export function readExecSecurity(value: unknown): BranchExecSecurity | undefined {
  return value === "deny" || value === "allowlist" || value === "full" ? value : undefined;
}

export function readExecAsk(value: unknown): BranchExecAsk | undefined {
  return value === "off" || value === "on-miss" || value === "always" ? value : undefined;
}

export function readNumberEnv(value: string | undefined): number | undefined {
  const trimmed = value?.trim();
  if (!trimmed || !PLAIN_DECIMAL_NUMBER_RE.test(trimmed)) {
    return undefined;
  }
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function resolveArgs(configArgs: unknown, envArgs: string | undefined): string[] {
  if (Array.isArray(configArgs)) {
    return normalizeTrimmedStringList(configArgs);
  }
  // v2026.9.1 string overrides preserve backslashes and accept unfinished quotes;
  // applying shell escaping or strict quote validation would change existing argv.
  return splitCommandArgs(typeof configArgs === "string" ? configArgs : (envArgs ?? ""), {
    allowUnclosedQuotes: true,
  });
}

export function hashSecretForKey(value: string | undefined, label: string): string | null {
  if (!value) {
    return null;
  }
  return createHmac("sha256", START_OPTIONS_KEY_SECRET)
    .update(label)
    .update("\0")
    .update(value)
    .digest("hex");
}
