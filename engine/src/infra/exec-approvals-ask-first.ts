import type { ExecAsk } from "./exec-approvals-core.js";
import type { ExecAllowlistEntry, ExecAskFirstRule } from "./exec-approvals.types.js";
// Ask-first exec rules: commands they match always prompt, even when an
// always-allow entry or the host policy would otherwise run them silently.
import type { ExecCommandSegment } from "./exec-command-analysis-types.js";
import { matchAllowlist, type ExecutableResolution } from "./exec-command-resolution.js";
import {
  extractShellWrapperInlineCommand,
  isShellWrapperInvocation,
} from "./shell-wrapper-resolution.js";

export type ExecAskFirstMatch =
  | { matched: false }
  | { matched: true; reason: "rule"; rule: ExecAskFirstRule }
  | { matched: true; reason: "unparsed" | "shell-wrapper" };

function toMatchEntry(rule: ExecAskFirstRule): ExecAllowlistEntry {
  // Ask-first rules reuse allowlist pattern semantics. They are never generated
  // allow-always entries, so path-only and hand-authored argPattern rules apply.
  return rule.argPattern === undefined
    ? { pattern: rule.pattern }
    : { pattern: rule.pattern, argPattern: rule.argPattern };
}

function segmentResolutions(segment: ExecCommandSegment): ExecutableResolution[] {
  const resolution = segment.resolution;
  if (!resolution) {
    return [];
  }
  return resolution.policy === resolution.execution
    ? [resolution.policy]
    : [resolution.policy, resolution.execution];
}

function segmentArgvs(segment: ExecCommandSegment): string[][] {
  const argvs = [segment.argv];
  const effective = segment.resolution?.effectiveArgv;
  if (effective && effective !== segment.argv) {
    argvs.push(effective);
  }
  if (segment.sourceArgv && segment.sourceArgv !== segment.argv) {
    argvs.push(segment.sourceArgv);
  }
  return argvs;
}

function isOpaqueShellWrapper(segment: ExecCommandSegment): boolean {
  return segmentArgvs(segment).some(
    (argv) => isShellWrapperInvocation(argv) || extractShellWrapperInlineCommand(argv) !== null,
  );
}

/**
 * Match a parsed command against ask-first rules.
 *
 * A false negative would run a command the owner asked to review, so the match
 * fails closed: an unparsed command or a shell wrapper whose inline payload is
 * not analyzed here counts as a match whenever any ask-first rule exists.
 */
export function matchExecAskFirstRules(params: {
  rules: readonly ExecAskFirstRule[] | undefined;
  analysisOk: boolean;
  segments: readonly ExecCommandSegment[];
  platform?: string | null;
  cwd?: string;
}): ExecAskFirstMatch {
  const rules = (params.rules ?? []).filter((rule) => rule.pattern.trim().length > 0);
  if (rules.length === 0) {
    return { matched: false };
  }
  if (!params.analysisOk || params.segments.length === 0) {
    return { matched: true, reason: "unparsed" };
  }
  const entries = rules.map(toMatchEntry);
  for (const segment of params.segments) {
    for (const resolution of segmentResolutions(segment)) {
      for (const argv of segmentArgvs(segment)) {
        const hit = matchAllowlist(entries, resolution, argv, params.platform, params.cwd);
        if (hit) {
          const rule = rules[entries.indexOf(hit)];
          if (rule) {
            return { matched: true, reason: "rule", rule };
          }
        }
      }
    }
    if (isOpaqueShellWrapper(segment)) {
      return { matched: true, reason: "shell-wrapper" };
    }
  }
  return { matched: false };
}

/**
 * Ask-first precedence: a matched rule raises the effective ask to "always".
 * That outranks always-allow entries and durable approvals, and keeps the
 * prompt to Allow once or Deny so an always-allow answer cannot silence it.
 */
export function resolveExecAskWithAskFirst(ask: ExecAsk, match: ExecAskFirstMatch): ExecAsk {
  return match.matched ? "always" : ask;
}
