// Adapted from continuedev/continue@5522c6f44ca0ac3528b37244818fbfa39b5af470 extensions/cli/src/hubLoader.ts,
// extensions/cli/src/shared-options.ts (repeatable --rule) and services/ConfigService rule handling.
import fs from "node:fs";
import path from "node:path";

/**
 * Pattern to match hub slugs (owner/package format). Hub package loading does not
 * exist upstream any more either; the pattern only lets isStringRule reject them.
 */
export const HUB_SLUG_PATTERN = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;

/** Process a rule specification: a file path is replaced by the file content, anything else is literal. */
export function processRule(ruleSpec: string, cwd: string = process.cwd()): string {
  const trimmedRuleSpec = ruleSpec.trim();
  const hasNewline = /[\r\n]/.test(ruleSpec);

  // If it looks like a file path (single line, typical path indicators)
  const looksLikePath =
    !hasNewline &&
    (trimmedRuleSpec.startsWith(".") ||
      trimmedRuleSpec.startsWith("/") ||
      trimmedRuleSpec.includes("\\") ||
      /\.[a-zA-Z]+$/.test(trimmedRuleSpec));

  if (looksLikePath) {
    try {
      const absolutePath = path.resolve(cwd, trimmedRuleSpec);
      if (!fs.existsSync(absolutePath)) {
        throw new Error(`Rule file not found: ${ruleSpec}`);
      }
      return fs.readFileSync(absolutePath, "utf-8");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to read rule file "${ruleSpec}": ${message}`, { cause: error });
    }
  }

  // Otherwise, treat it as direct string content
  return ruleSpec;
}

function looksLikeLocalPath(rule: string): boolean {
  return ["file:/", ".", "/", "~"].some((prefix) => rule.startsWith(prefix)) || rule.includes("\\");
}

/** True when a rule is literal text rather than a path or a hub slug. */
export function isStringRule(rule: string): boolean {
  if (rule.includes(" ") || rule.includes("\n")) {
    return true;
  }
  if (looksLikeLocalPath(rule)) {
    return false;
  }
  if (HUB_SLUG_PATTERN.test(rule)) {
    return false;
  }
  return true;
}

/**
 * Resolve repeatable `--rule` values into one block of extra system-prompt text.
 * Duplicate rule specs are applied once (upstream rule-duplication behaviour), and
 * hub slugs fail like upstream's removed hub loader instead of becoming literal text.
 */
export function resolveCliRules(
  ruleSpecs: readonly string[] | undefined,
  cwd: string = process.cwd(),
): string[] {
  const seen = new Set<string>();
  const rules: string[] = [];
  for (const spec of ruleSpecs ?? []) {
    if (!spec.trim() || seen.has(spec)) {
      continue;
    }
    seen.add(spec);
    if (!isStringRule(spec) && !looksLikeLocalPath(spec) && HUB_SLUG_PATTERN.test(spec)) {
      throw new Error(`Hub package loading has been removed. Cannot load "${spec}" from hub.`);
    }
    const content = processRule(spec, cwd).trim();
    if (content && !rules.includes(content)) {
      rules.push(content);
    }
  }
  return rules;
}

/** Merge resolved `--rule` text into an existing extra system prompt. */
export function mergeCliRulesIntoExtraSystemPrompt(
  extraSystemPrompt: string | undefined,
  ruleSpecs: readonly string[] | undefined,
  cwd?: string,
): string | undefined {
  const rules = resolveCliRules(ruleSpecs, cwd);
  if (rules.length === 0) {
    return extraSystemPrompt;
  }
  return [extraSystemPrompt?.trim(), ...rules].filter(Boolean).join("\n\n");
}
