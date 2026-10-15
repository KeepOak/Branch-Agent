/**
 * Explains a guest `ReferenceError: X is not defined` by listing the globals
 * Code Mode does provide, so the model can fix the call instead of guessing.
 */

import { CODE_MODE_GLOBAL_NAMES } from "./code-mode-global-names.js";

const MISSING_GLOBAL = /^ReferenceError: ([A-Za-z_$][\w$]*) is not defined(?:\n|$)/u;

const MAX_LISTED_TOOL_GLOBALS = 40;

/** Returns the error with an availability hint appended, or the error unchanged. */
export function describeMissingCodeModeGlobal(
  error: string,
  toolGlobals: readonly string[],
): string {
  const name = MISSING_GLOBAL.exec(error)?.[1];
  if (!name) {
    return error;
  }
  const tools = [...new Set(toolGlobals)].toSorted((left, right) => left.localeCompare(right));
  const listed = tools.slice(0, MAX_LISTED_TOOL_GLOBALS);
  const more = tools.length - listed.length;
  const toolText =
    listed.length === 0 ? "none" : listed.join(", ") + (more > 0 ? ` (+${more} more)` : "");
  return [
    error,
    `\`${name}\` is not a Code Mode global.`,
    `Tool globals: ${toolText}. Find other tools with catalog.search(query).`,
    `Helpers: ${CODE_MODE_GLOBAL_NAMES.helpers.join(", ")}.`,
    `Swarm helpers (when enabled): ${CODE_MODE_GLOBAL_NAMES.swarm.join(", ")}.`,
    "Node globals and modules (require, process, Buffer, fetch) are not available.",
  ].join("\n");
}
