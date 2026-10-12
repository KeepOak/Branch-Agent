// kenryu42/cc-safety-net@acd15d5d5c6dba1a3e979d0db592afc20c463094:src/gate/analyzer/analyze-command.ts (atlas SAFETY-0019)
// OpenHands/software-agent-sdk@0a9abc87641ad7ffe02e2dadf5e2cb3976b35217:openhands-sdk/openhands/sdk/security/defense_in_depth/policy_rails.py (atlas SAFETY-0019)
//
// Dangerous-command scan. Parsing is the engine's existing tree-sitter command
// explainer (quotes, nesting, bash -c payloads, substitutions); this module only
// adds the destructive and threat rules on top of its steps. It is one ordered
// check for the existing exec approval path, never a second decision engine.
import path from "node:path";
import { explainShellCommand } from "../infra/command-explainer/extract.js";
import type { CommandExplanation, CommandStep } from "../infra/command-explainer/types.js";
import { analyzeGit } from "./command-scan-git.js";
import { analyzeRm } from "./command-scan-rm.js";
import { scanCommandText } from "./command-scan-text.js";
import type {
  CommandScanFinding,
  CommandScanOptions,
  CommandScanWord,
} from "./command-scan-types.js";

export type { CommandScanFinding, CommandScanOptions } from "./command-scan-types.js";

export const REASON_PIPED_DOWNLOAD =
  "Downloading a script and piping it straight into a shell or interpreter runs code nobody has read.";

/** "when-needed" is the shipped default (R-2164). */
export type CommandScanMode = "off" | "when-needed" | "always";
export const DEFAULT_COMMAND_SCAN_MODE: CommandScanMode = "when-needed";

const DOWNLOADERS = new Set(["curl", "wget", "fetch", "aria2c", "http", "xh"]);
const EXECUTORS = new Set([
  "sh",
  "bash",
  "zsh",
  "dash",
  "ksh",
  "fish",
  "source",
  ".",
  "eval",
  "python",
  "python3",
  "node",
  "perl",
  "ruby",
  "php",
  "osascript",
]);
const DISPATCH_WRAPPERS = new Set([
  "sudo",
  "doas",
  "env",
  "nice",
  "nohup",
  "time",
  "command",
  "exec",
  "xargs",
]);
const POWERSHELL_PIPED_DOWNLOAD =
  /\b(?:iwr|irm|curl|wget|invoke-webrequest|invoke-restmethod)\b[^|\n]*\|\s*(?:iex|invoke-expression)\b/iu;

export type CommandScanResult = { ok: boolean; findings: CommandScanFinding[] };

/**
 * Decides whether the scan runs. The owner on Full access in a trusted
 * surface is never asked by "when-needed" (page 03 rule 6); the floor stays
 * with SAFETY-0020 and is not part of this scan.
 */
export function shouldRunCommandScan(params: {
  mode?: CommandScanMode;
  ownerFullAccess: boolean;
}): boolean {
  const mode = params.mode ?? DEFAULT_COMMAND_SCAN_MODE;
  if (mode === "off") {
    return false;
  }
  if (mode === "always") {
    return true;
  }
  return !params.ownerFullAccess;
}

function baseName(executable: string): string {
  return path.basename(executable).toLowerCase();
}

function stepWords(step: CommandStep, source: string): CommandScanWord[] {
  return step.argv.map((value, index) => {
    const span = step.argvSpans?.[index];
    const raw = span ? source.slice(span.startIndex, span.endIndex) : value;
    return { value, raw };
  });
}

/** Drops sudo/env/xargs style prefixes so the real program is analysed. */
export function unwrapDispatch(words: CommandScanWord[]): CommandScanWord[] {
  let rest = words;
  while (rest.length > 1 && DISPATCH_WRAPPERS.has(baseName(rest[0]?.value ?? ""))) {
    rest = rest.slice(1);
    while (
      rest.length > 1 &&
      (rest[0]?.value.startsWith("-") || /^[A-Za-z_][A-Za-z0-9_]*=/u.test(rest[0]?.value ?? ""))
    ) {
      rest = rest.slice(1);
    }
  }
  return rest;
}

function analyzeStep(
  step: CommandStep,
  source: string,
  options: CommandScanOptions,
): CommandScanFinding | null {
  const words = unwrapDispatch(stepWords(step, source));
  const program = baseName(words[0]?.value ?? "");
  if (program === "rm") {
    return analyzeRm(words, options, step.text);
  }
  if (program === "git") {
    return analyzeGit(
      words.map((word) => word.value),
      step.text,
    );
  }
  return null;
}

function programOf(step: CommandStep | undefined, source: string): string {
  if (!step) {
    return "";
  }
  return baseName(unwrapDispatch(stepWords(step, source))[0]?.value ?? "");
}

function pipedDownloads(explanation: CommandExplanation): CommandScanFinding[] {
  const steps = [...explanation.topLevelCommands, ...explanation.nestedCommands];
  const byId = new Map(steps.flatMap((step) => (step.id ? [[step.id, step] as const] : [])));
  const findings: CommandScanFinding[] = [];
  for (const operator of explanation.operators ?? []) {
    if (operator.kind !== "pipe" && operator.kind !== "stderr-pipe") {
      continue;
    }
    const from = programOf(byId.get(operator.fromCommandId), explanation.source);
    const to = programOf(byId.get(operator.toCommandId), explanation.source);
    if (DOWNLOADERS.has(from) && EXECUTORS.has(to)) {
      findings.push({
        id: "pipe.download-to-shell",
        reason: REASON_PIPED_DOWNLOAD,
        intent: "ask",
        command: operator.text,
      });
    }
  }
  const executesDynamic = explanation.risks.some((risk) => risk.kind === "dynamic-executable");
  for (const step of explanation.nestedCommands) {
    const substituted =
      step.context === "command-substitution" || step.context === "process-substitution";
    if (!substituted || !DOWNLOADERS.has(programOf(step, explanation.source))) {
      continue;
    }
    const executor = [...ancestors(step, byId), ...enclosing(step, steps)].find((parent) =>
      EXECUTORS.has(programOf(parent, explanation.source)),
    );
    if (executor || executesDynamic) {
      findings.push({
        id: "pipe.download-to-shell",
        reason: REASON_PIPED_DOWNLOAD,
        intent: "ask",
        command: executor?.text ?? step.text,
      });
    }
  }
  return findings;
}

function enclosing(step: CommandStep, steps: readonly CommandStep[]): CommandStep[] {
  return steps.filter(
    (other) =>
      other !== step &&
      other.span.startIndex <= step.span.startIndex &&
      other.span.endIndex >= step.span.endIndex,
  );
}

function ancestors(step: CommandStep, byId: ReadonlyMap<string, CommandStep>): CommandStep[] {
  const chain: CommandStep[] = [];
  let parentId = step.parentCommandId;
  while (parentId && chain.length < 32) {
    const parent = byId.get(parentId);
    if (!parent) {
      break;
    }
    chain.push(parent);
    parentId = parent.parentCommandId;
  }
  return chain;
}

/** Scans one shell command for destructive and threat patterns before it runs. */
export async function scanShellCommand(
  source: string,
  options: CommandScanOptions = {},
): Promise<CommandScanResult> {
  const findings = scanCommandText(source);
  if (POWERSHELL_PIPED_DOWNLOAD.test(source)) {
    findings.push({
      id: "pipe.download-to-shell",
      reason: REASON_PIPED_DOWNLOAD,
      intent: "ask",
      command: source,
    });
  }
  const explanation = await explainShellCommand(source);
  for (const step of [...explanation.topLevelCommands, ...explanation.nestedCommands]) {
    const finding = analyzeStep(step, explanation.source, options);
    if (finding) {
      findings.push(finding);
    }
  }
  findings.push(...pipedDownloads(explanation));
  return { ok: findings.length === 0, findings: dedupeFindings(findings) };
}

function dedupeFindings(findings: CommandScanFinding[]): CommandScanFinding[] {
  const seen = new Set<string>();
  return findings.filter((finding) => {
    const key = finding.id + "\u0000" + finding.command;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}
