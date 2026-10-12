// kenryu42/cc-safety-net@acd15d5d5c6dba1a3e979d0db592afc20c463094:src/gate/analyzer/rm.ts (atlas SAFETY-0019)
import os from "node:os";
import path from "node:path";
import type {
  CommandScanFinding,
  CommandScanOptions,
  CommandScanWord,
} from "./command-scan-types.js";

export const REASON_RM_RF =
  "rm -rf outside cwd is blocked. Retry deleting only explicit paths inside the current directory; escalate for anything outside it.";
export const REASON_RM_RF_DYNAMIC_TARGET =
  "rm -rf target contains shell variables that cannot be verified safely. Use literal paths within cwd, /tmp, /var/tmp, or $TMPDIR.";
export const REASON_RM_RF_ROOT_HOME =
  "rm -rf targeting root or home directory is extremely dangerous and always blocked.";
export const REASON_RM_HOME_CWD =
  "rm -rf in home directory is dangerous. Change to a project directory first.";

type RmClassification =
  | "root_or_home_target"
  | "dynamic_target"
  | "home_cwd_target"
  | "cwd_self_target"
  | "outside_anchored_cwd"
  | "safe";

const RM_RULES: Record<Exclude<RmClassification, "safe">, { id: string; reason: string }> = {
  root_or_home_target: { id: "rm.recursive-force-root-or-home", reason: REASON_RM_RF_ROOT_HOME },
  dynamic_target: { id: "rm.recursive-force-dynamic-target", reason: REASON_RM_RF_DYNAMIC_TARGET },
  home_cwd_target: { id: "rm.recursive-force-home-cwd", reason: REASON_RM_HOME_CWD },
  cwd_self_target: { id: "rm.recursive-force-cwd-self", reason: REASON_RM_RF },
  outside_anchored_cwd: { id: "rm.recursive-force-outside-cwd", reason: REASON_RM_RF },
};

const ROOT_OR_HOME_TARGETS = new Set(["/", "/*", "~", "~/", "~/*", "$HOME", "$HOME/", "$HOME/*"]);
const TEMP_ROOTS = ["/tmp", "/var/tmp", "/private/tmp", "/private/var/tmp"];

function rmFlags(values: readonly string[]): { recursive: boolean; force: boolean } {
  let recursive = false;
  let force = false;
  for (const value of values) {
    if (value === "--") {
      break;
    }
    if (value === "--recursive") {
      recursive = true;
    } else if (value === "--force") {
      force = true;
    } else if (/^-[A-Za-z]+$/u.test(value)) {
      recursive ||= /[rR]/u.test(value);
      force ||= value.includes("f");
    }
  }
  return { recursive, force };
}

function rmTargets(words: readonly CommandScanWord[]): CommandScanWord[] {
  const targets: CommandScanWord[] = [];
  let pastDoubleDash = false;
  for (const word of words.slice(1)) {
    if (!pastDoubleDash && word.value === "--") {
      pastDoubleDash = true;
    } else if (pastDoubleDash || !word.value.startsWith("-")) {
      targets.push(word);
    }
  }
  return targets;
}

function stripQuotes(raw: string): string {
  return raw.replace(/["']/gu, "");
}

function isDynamicRaw(raw: string): boolean {
  const unquotedGlob = /[*?]/u.test(raw.replace(/'[^']*'|"[^"]*"/gu, ""));
  return raw.includes("$") || raw.includes("`") || unquotedGlob;
}

function isInside(child: string, parent: string): boolean {
  const relative = path.relative(parent, child);
  return relative.length > 0 && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function isSameOrAncestor(candidate: string, of: string): boolean {
  return candidate === of || isInside(of, candidate);
}

function tempRoots(): string[] {
  const roots = [...TEMP_ROOTS, os.tmpdir()];
  return roots.map((root) => path.resolve(root));
}

function classifyResolved(
  resolved: string,
  literalAbsolute: boolean,
  anchor: string,
): RmClassification {
  if (resolved === anchor) {
    return "cwd_self_target";
  }
  if (isSameOrAncestor(resolved, anchor)) {
    return "outside_anchored_cwd";
  }
  if (isInside(resolved, anchor)) {
    return "safe";
  }
  // Only an explicitly spelled temp path is trusted; a relative path that
  // happens to climb into a temp directory is still outside the anchored cwd.
  if (literalAbsolute && tempRoots().some((root) => isInside(resolved, root))) {
    return "safe";
  }
  return "outside_anchored_cwd";
}

function expandHome(target: string, home: string | undefined): string {
  if (home && (target === "~" || target.startsWith("~/"))) {
    return path.join(home, target.slice(1));
  }
  return target;
}

/** Classifies one rm target the way the upstream recursive-delete table does. */
export function classifyRmTarget(
  word: CommandScanWord,
  options: CommandScanOptions,
): RmClassification {
  const literal = stripQuotes(word.raw);
  if (ROOT_OR_HOME_TARGETS.has(literal) || ROOT_OR_HOME_TARGETS.has(word.value)) {
    return "root_or_home_target";
  }
  if (/\{[^}]*\.\.[^}]*\}/u.test(word.raw)) {
    return "outside_anchored_cwd";
  }
  if (isDynamicRaw(word.raw)) {
    return options.strict ? "dynamic_target" : "safe";
  }
  const cwd = options.cwd;
  const anchor = options.originalCwd ?? cwd;
  if (!cwd || !anchor) {
    return path.isAbsolute(word.value) ? "outside_anchored_cwd" : "safe";
  }
  const target = word.value.replace(/\{([^,}]*),[^}]*\}/gu, "$1");
  const resolved = path.resolve(cwd, expandHome(target, options.home));
  return classifyResolved(resolved, path.isAbsolute(target), path.resolve(anchor));
}

function toFinding(kind: RmClassification, command: string): CommandScanFinding | null {
  if (kind === "safe") {
    return null;
  }
  const rule = RM_RULES[kind];
  const intent = kind === "root_or_home_target" ? "hard_stop" : "ask";
  return { id: rule.id, reason: rule.reason, intent, command };
}

/** Returns the first rm finding for one parsed rm command, or null when it is safe. */
export function analyzeRm(
  words: readonly CommandScanWord[],
  options: CommandScanOptions,
  command: string,
): CommandScanFinding | null {
  const { recursive, force } = rmFlags(words.map((word) => word.value));
  if (!recursive) {
    return null;
  }
  const anchor = options.originalCwd ?? options.cwd;
  if (force && options.home && anchor && path.resolve(anchor) === path.resolve(options.home)) {
    return toFinding("home_cwd_target", command);
  }
  for (const target of rmTargets(words)) {
    const kind = classifyRmTarget(target, options);
    if (kind === "root_or_home_target" || (force && kind !== "safe")) {
      return toFinding(kind, command);
    }
  }
  return null;
}
