// NousResearch/hermes-agent@18d125cc1bd9d0e26188ab49bb325427d5945fa2:tools/approval_detection.py (atlas SAFETY-0020)
// NousResearch/hermes-agent@18d125cc1bd9d0e26188ab49bb325427d5945fa2:tools/approval_floors.py (atlas SAFETY-0020)
// Always-ask floor for catastrophic commands: a deliberately tiny list with no recovery path (root
// wipe, raw block device writes, shutdown, fork bomb, kill -1, sudo -S password piping). The exec
// tool turns a hit into a required human approval even in full access; sandboxed runs skip it.
import fs from "node:fs";
import os from "node:os";
import { stripAnsi } from "../../packages/terminal-core/src/ansi.js";
import {
  deobfuscateShellWordForDetection,
  iterShellCommandWordSpans,
  markCommandStarts,
  maskQuotedNewlines,
  maskQuotedProse,
} from "./exec-hardline-command-words.js";
import { executionFlagPayloads, grepSafeDetectionVariant } from "./exec-hardline-payloads.js";
import { shellBasename, spliceShell, type ShellEdit } from "./exec-hardline-shell-scan.js";

export type HardlineFinding = { description: string };

const BT = "\u0060";
// Start-of-command position: start of string, newline, subshell opener ($( or backtick),
// optionally consuming sudo/env/exec/nohup/setsid/time wrappers.
const CMDPOS =
  String.raw`(?:^|[\n` +
  BT +
  String.raw`]|\$\()\s*` +
  String.raw`(?:sudo\s+(?:-[^\s]+\s+)*)?(?:env\s+(?:\w+=\S*\s+)*)?` +
  String.raw`(?:(?:exec|nohup|setsid|time)\s+)*\s*`;
const RM_PATH_TAIL = String.raw`(?:\s|$|[)` + BT + String.raw`;|&])`;
// Protected system roots whose recursive deletion has no recovery path.
const HARDLINE_SYSTEM_DIRS =
  String.raw`/home|/home/\*|/root|/root/\*|/etc|/etc/\*|/usr|/usr/\*|` +
  String.raw`/var|/var/\*|/bin|/bin/\*|/sbin|/sbin/\*|/boot|/boot/\*|/lib|/lib/\*`;
const RM_FLAG_PREFIX = CMDPOS + String.raw`rm\s+(-[^\s]*\s+)*`;

// Accept the path wrapped in a matching quote pair or bare with a terminator.
function hardlineRmPath(pathAlt: string): string {
  return `(?:["'](?:${pathAlt})["']|(?:${pathAlt})${RM_PATH_TAIL})`;
}

const HARDLINE_PATTERNS: ReadonlyArray<readonly [string, string]> = [
  // Any root-anchored path whose components collapse to "/" ("/", "//", "/.", "/../..").
  [
    RM_FLAG_PREFIX + hardlineRmPath(String.raw`/(?:(?:\.\.?)?/)*(?:\.\.?)?\**|/ \*`),
    "recursive delete of root filesystem",
  ],
  [RM_FLAG_PREFIX + hardlineRmPath(HARDLINE_SYSTEM_DIRS), "recursive delete of system directory"],
  [
    RM_FLAG_PREFIX + hardlineRmPath(String.raw`(?:~|\$\{?HOME\}?)(?:/?|/\*)?`),
    "recursive delete of home directory",
  ],
  [CMDPOS + String.raw`mkfs(\.[a-z0-9]+)?\b`, "format filesystem (mkfs)"],
  [
    CMDPOS + String.raw`dd\b[^\n]*\bof=/dev/(sd|nvme|hd|mmcblk|vd|xvd)[a-z0-9]*`,
    "dd to raw block device",
  ],
  // Positionless rules are matched against a quote-masked variant (see matchHardlinePatterns).
  [String.raw`>\s*/dev/(sd|nvme|hd|mmcblk|vd|xvd)[a-z0-9]*\b`, "redirect to raw block device"],
  [String.raw`:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:`, "fork bomb"],
  [CMDPOS + String.raw`kill\s+(-[^\s]+\s+)*-1\b`, "kill all processes"],
  [CMDPOS + String.raw`(shutdown|reboot|halt|poweroff)\b`, "system shutdown/reboot"],
  [CMDPOS + String.raw`init\s+[06]\b`, "init 0/6 (shutdown/reboot)"],
  [CMDPOS + String.raw`systemctl\s+(poweroff|reboot|halt|kexec)\b`, "systemctl poweroff/reboot"],
  [CMDPOS + String.raw`telinit\s+[06]\b`, "telinit 0/6 (shutdown/reboot)"],
];
const QUOTE_MASKED_HARDLINE_DESCRIPTIONS = new Set(["redirect to raw block device", "fork bomb"]);
const HARDLINE_RULES = HARDLINE_PATTERNS.map(([pattern, description]) => ({
  re: new RegExp(pattern, "is"),
  description,
  quoteMasked: QUOTE_MASKED_HARDLINE_DESCRIPTIONS.has(description),
}));
// Commands that hand a quoted argument to another shell to execute: quoted text is code.
const SHELL_CARRIER_NAMES = new Set(["eval", "sh", "bash", "zsh", "ksh", "dash", "source", "."]);
const SUDO_STDIN_RE = new RegExp(
  String.raw`(?:^|[;&|` + BT + String.raw`\n]|&&|\|\||\$\()\s*sudo\s+-S\b`,
  "i",
);
const MAX_DETECTION_COMMAND_CHARS = 128_000;
const MAX_SEPARATOR_FREE_COMMAND_CHARS = 4_096;
const MAX_DETECTION_SEGMENTS = 25_000;
export const PARSER_LIMIT_DESCRIPTION = "command parser limit exceeded";
export const MALFORMED_EXEC_DESCRIPTION = "command parser limit or malformed executable payload";
const PATH_TAIL = String.raw`(?<tail>(?:[/\\][^/\\\s'"` + BT + String.raw`;|&<>()]*)+)`;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function homePrefixFoldRegex(path: string): RegExp | null {
  const components = path.split(/[/\\]+/).filter(Boolean);
  if (components.length < 2) {
    return null;
  }
  const body = components.map(escapeRegExp).join(String.raw`[/\\]+`);
  return new RegExp(String.raw`[/\\]*` + body + PATH_TAIL, "g");
}

function resolvedUserHomes(): string[] {
  const home = os.homedir();
  let real: string;
  try {
    real = fs.realpathSync.native(home);
  } catch {
    real = "";
  }
  return [home, real, process.env.HOME ?? ""];
}

/** Fold absolute user-home prefixes to ~/ so the static rules see one spelling. */
function rewriteResolvedUserHome(command: string): string {
  const paths = [...new Set(resolvedUserHomes().filter(Boolean))].toSorted(
    (a, b) => b.length - a.length,
  );
  let out = command;
  for (const path of paths) {
    const pattern = homePrefixFoldRegex(path);
    if (pattern) {
      out = out.replace(pattern, (_match, tail: string) => "~" + tail.replaceAll("\\", "/"));
    }
  }
  return out;
}

/**
 * Normalize before matching so ANSI escapes, null bytes, fullwidth forms, line continuations and
 * shell splicing tricks (r\m, r''m, $IFS) cannot bypass detection.
 */
export function normalizeCommandForDetection(command: string): string {
  let out = stripAnsi(command).replaceAll("\0", "").normalize("NFKC");
  // Collapse backslash-newline continuations before the generic escape strip.
  out = out.replace(/\\\r?\n/g, "");
  out = rewriteResolvedUserHome(out);
  out = out.replace(/\\([^\n])/g, "$1");
  out = out.replace(/''|""/g, "");
  return out.replace(/\$\{IFS\b[^}]*\}|\$IFS\b/g, " ");
}

function commandParserLimitExceeded(command: string): boolean {
  if (command.length > MAX_DETECTION_COMMAND_CHARS) {
    return true;
  }
  const separators = command.match(/[;&|\n]/g)?.length ?? 0;
  if (command.length > MAX_SEPARATOR_FREE_COMMAND_CHARS && separators === 0) {
    return true;
  }
  return separators >= MAX_DETECTION_SEGMENTS;
}

function containsShellCarrier(command: string): boolean {
  return iterShellCommandWordSpans(command).some((span) =>
    SHELL_CARRIER_NAMES.has(shellBasename(deobfuscateShellWordForDetection(span[2])).toLowerCase()),
  );
}

type Fresh = (variant: string | null | undefined) => variant is string;

function* executionPayloadVariants(normalized: string, fresh: Fresh): Generator<string> {
  const pending = [normalized];
  while (pending.length > 0) {
    for (const payload of executionFlagPayloads(pending.pop() ?? "")) {
      if (fresh(payload)) {
        yield payload;
        const marked = markCommandStarts(payload);
        if (marked !== payload && fresh(marked)) {
          yield marked;
        }
        pending.push(payload);
      }
    }
  }
}

function* deobfuscatedWordVariants(normalized: string, fresh: Fresh): Generator<string> {
  let pending: ShellEdit[] = iterShellCommandWordSpans(normalized)
    .map(([start, end, word]) => [start, end, deobfuscateShellWordForDetection(word)] as const)
    .filter(
      ([start, end, deobfuscated]) => deobfuscated && deobfuscated !== normalized.slice(start, end),
    )
    .toSorted((a, b) => a[0] - b[0] || a[1] - b[1]);
  while (pending.length > 0) {
    const applied: ShellEdit[] = [];
    const carry: ShellEdit[] = [];
    let cursor = 0;
    for (const span of pending) {
      if (span[0] < cursor) {
        carry.push(span);
      } else {
        applied.push(span);
        cursor = span[1];
      }
    }
    const variant = spliceShell(normalized, applied);
    if (fresh(variant)) {
      yield variant;
    }
    pending = carry;
  }
}

function* commandDetectionVariants(command: string): Generator<string> {
  // Mask quoted newlines before normalization, which would corrupt quote tracking.
  const normalized = normalizeCommandForDetection(maskQuotedNewlines(command));
  const grepSafe = grepSafeDetectionVariant(normalized).variant;
  const seen = new Set([grepSafe]);
  yield grepSafe;
  const fresh: Fresh = (variant): variant is string => {
    if (!variant || seen.has(variant)) {
      return false;
    }
    seen.add(variant);
    return true;
  };
  if (/(?:[A-Za-z]:|\\\\)[\\\\]/.test(command) || /[A-Za-z]:\\/.test(command)) {
    const windowsPath = command.replaceAll("\\", "/");
    const variant = normalizeCommandForDetection(maskQuotedNewlines(windowsPath));
    if (fresh(variant)) {
      yield variant;
    }
  }
  yield* executionPayloadVariants(normalized, fresh);
  const marked = markCommandStarts(grepSafe);
  if (marked !== grepSafe && fresh(marked)) {
    yield marked;
  }
  // Mark starts on the raw command so escaped quotes cannot flip quote parity.
  const faithful = normalizeCommandForDetection(
    markCommandStarts(maskQuotedNewlines(command), " \n"),
  );
  if (fresh(faithful)) {
    yield faithful;
  }
  yield* deobfuscatedWordVariants(normalized, fresh);
}

function matchHardlinePatterns(variant: string): string | null {
  const lower = variant.toLowerCase();
  let masked: string | null = null;
  for (const rule of HARDLINE_RULES) {
    if (rule.quoteMasked && masked === null) {
      // Quoted prose is data, except under shell carriers whose quoted argument is code.
      masked = containsShellCarrier(variant) ? lower : maskQuotedProse(variant).toLowerCase();
    }
    if (rule.re.test(rule.quoteMasked ? (masked ?? lower) : lower)) {
      return rule.description;
    }
  }
  return null;
}

/** Hardline patterns: never bypassed by full access, auto review or durable grants. */
export function detectHardlineCommand(command: string): HardlineFinding | null {
  if (commandParserLimitExceeded(command)) {
    return { description: PARSER_LIMIT_DESCRIPTION };
  }
  // The malformed-quoting verdict needs the author's quote state, before normalization.
  if (grepSafeDetectionVariant(maskQuotedNewlines(command)).malformed) {
    return { description: MALFORMED_EXEC_DESCRIPTION };
  }
  for (const variant of commandDetectionVariants(command)) {
    const description = matchHardlinePatterns(variant);
    if (description) {
      return { description };
    }
  }
  return null;
}

/** An explicit sudo -S without a configured SUDO_PASSWORD is the model piping a guessed password. */
export function checkSudoStdinGuard(
  command: string,
  env: NodeJS.ProcessEnv = process.env,
): HardlineFinding | null {
  const normalized = normalizeCommandForDetection(command).toLowerCase();
  return env.SUDO_PASSWORD === undefined && SUDO_STDIN_RE.test(normalized)
    ? { description: "sudo password guessing via stdin (sudo -S)" }
    : null;
}

/** Combined floor used by the exec tool for host (non-sandbox) runs. */
export function detectExecHardlineFloor(command: string): HardlineFinding | null {
  return detectHardlineCommand(command) ?? checkSudoStdinGuard(command);
}

export function formatExecHardlineFloorWarning(finding: HardlineFinding): string {
  return `Warning: this command is on the always-ask floor (${finding.description}); it needs your explicit approval even in full access.`;
}
