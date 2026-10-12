// Kilo-Org/kilocode@6fd9b7b29ce63b5a38176e45b738e94ed6167cfb:packages/opencode/src/kilocode/bash-hierarchy.ts (atlas SAFETY-0005)
// Scope choices for "always allow": the person picks "npm *", "npm install *"
// or the exact "npm install lodash" instead of the exact string or everything.
// The chosen pattern is stored through the existing exec approvals allowlist.
import { splitShellArgs } from "../utils/shell-argv.js";
import { commandArityPrefix } from "./command-arity.js";

/**
 * Adds hierarchical always-patterns for one command to target.
 * ["npm", "install", "lodash"] adds "npm *", "npm install *", "npm install lodash".
 * When the text equals the arity prefix ("git branch"), the exact text is
 * skipped because "git branch *" already covers it.
 */
export function addCommandPrefixPatterns(
  target: Set<string>,
  command: readonly string[],
  text: string,
): void {
  const prefix = commandArityPrefix(command);
  for (let i = 1; i <= prefix.length; i++) {
    target.add(prefix.slice(0, i).join(" ") + " *");
  }
  if (text !== prefix.join(" ")) {
    target.add(text);
  }
}

/** Builds the ordered scope choices for a single, unchained shell command. */
export function commandPrefixChoices(commandText: string): string[] {
  const text = commandText.trim();
  if (!text || /[;&|<>`$()\n]/u.test(text)) {
    return text ? [text] : [];
  }
  const tokens = splitShellArgs(text);
  if (!tokens || tokens.length === 0) {
    return [text];
  }
  const choices = new Set<string>();
  addCommandPrefixPatterns(choices, tokens, text);
  return [...choices];
}

/** True when a stored always-pattern ("npm install *" or an exact string) covers the command. */
export function commandMatchesPrefixPattern(pattern: string, commandText: string): boolean {
  const text = commandText.trim();
  if (!pattern.endsWith(" *")) {
    return pattern === text;
  }
  if (/[;&|<>`$()\n]/u.test(text)) {
    return false;
  }
  const base = pattern.slice(0, -2);
  return text === base || text.startsWith(base + " ");
}
