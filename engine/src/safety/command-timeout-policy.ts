// RooCodeInc/Roo-Code@b867ec9145750d0ae1ff7f02d35406e9bf2a0b16:src/core/tools/ExecuteCommandTool.ts (atlas SAFETY-0009)
// Long-running commands are killed after the configured timeout, except
// allow-listed prefixes such as dev servers. The result feeds the existing
// exec timeout (bash-tools.exec-run effectiveTimeout); it never adds a prompt.

/** Normalises a command the way the allowlist compares it: trimmed, single spaces. */
export function canonicalCommandForTimeout(command: string): string {
  return command.trim().replace(/\s+/gu, " ");
}

/** True when the command starts with any allow-listed prefix. */
export function isCommandTimeoutExempt(
  command: string,
  allowlist: readonly string[] | undefined,
): boolean {
  if (!allowlist || allowlist.length === 0) {
    return false;
  }
  const canonical = canonicalCommandForTimeout(command);
  return allowlist.some((entry) => {
    const prefix = canonicalCommandForTimeout(entry);
    if (!prefix) {
      return false;
    }
    return canonical === prefix || canonical.startsWith(prefix + " ");
  });
}

/**
 * Resolves the kill timeout in seconds for one command. Returns null (no kill
 * timer) for allow-listed commands; otherwise the requested timeout, falling
 * back to the configured default. Non-positive values mean "no timeout".
 */
export function resolveCommandKillTimeoutSec(params: {
  command: string;
  requestedSec?: number | null;
  defaultSec: number | null;
  allowlist?: readonly string[];
}): number | null {
  if (isCommandTimeoutExempt(params.command, params.allowlist)) {
    return null;
  }
  const value = typeof params.requestedSec === "number" ? params.requestedSec : params.defaultSec;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return null;
  }
  return value;
}

/** Agent-requested timeouts move a command to the background; they are not a kill timer. */
export function resolveAgentTimeoutMs(timeoutSeconds: number | null | undefined): number {
  return typeof timeoutSeconds === "number" && timeoutSeconds > 0 ? timeoutSeconds * 1000 : 0;
}
