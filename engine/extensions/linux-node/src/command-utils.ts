import type { BranchPluginNodeHostCommandAvailabilityContext } from "branch/plugin-sdk/plugin-entry";
import type { CommandOptions, SpawnResult } from "branch/plugin-sdk/process-runtime";
import { asNonArrayRecord } from "branch/plugin-sdk/string-coerce-runtime";
import { safeParseJson, truncateUtf16Safe } from "branch/plugin-sdk/text-utility-runtime";
import {
  resolveLinuxNodePluginConfigFromHost,
  type ResolvedLinuxNodePluginConfig,
} from "./config.js";

export type RunCommand = (argv: string[], options: CommandOptions) => Promise<SpawnResult>;

export function parseParams(paramsJSON: string | null | undefined): Record<string, unknown> {
  return asNonArrayRecord(safeParseJson(paramsJSON ?? ""));
}

export function formatToolError(result: SpawnResult): string {
  const detail = result.stderr.trim() || result.stdout.trim();
  return detail
    ? truncateUtf16Safe(detail.replaceAll(/\s+/gu, " "), 300)
    : `exit ${result.code ?? "unknown"}`;
}

export function assertToolResult(result: SpawnResult, code: string): void {
  if (result.termination === "timeout" || result.termination === "no-output-timeout") {
    throw new Error(`${code}: command timed out`);
  }
  if (result.code !== 0) {
    throw new Error(`${code}: ${formatToolError(result)}`);
  }
}

export function isCapabilityEnabledForHost(
  context: BranchPluginNodeHostCommandAvailabilityContext,
  capability: keyof ResolvedLinuxNodePluginConfig,
): boolean {
  return resolveLinuxNodePluginConfigFromHost(context.config)?.[capability].enabled === true;
}
