// kenryu42/cc-safety-net@acd15d5d5c6dba1a3e979d0db592afc20c463094:src/gate/analyzer/analyze-command.ts (atlas SAFETY-0019)
// Text-level command checks: hidden characters, terminal control codes and look-alike letters.
import { stripInvisibleUnicode } from "../infra/unicode-visibility.js";
import type { CommandScanFinding } from "./command-scan-types.js";

export const REASON_HIDDEN_CHARACTERS =
  "The command contains invisible characters (zero-width or text-direction marks) that can hide what really runs.";
export const REASON_TERMINAL_CODES =
  "The command contains terminal control codes that can rewrite what the screen shows.";
export const REASON_LOOK_ALIKE =
  "The command contains look-alike letters from another alphabet that can disguise a different program or path.";

const LATIN_LETTER = /[A-Za-z]/u;
const CONFUSABLE_SCRIPT = /[\p{Script=Cyrillic}\p{Script=Greek}\p{Script=Armenian}]/u;
const FULLWIDTH_FORM = /[\uFF01-\uFF5E]/u;

function isTerminalControlCode(codePoint: number): boolean {
  if (codePoint === 0x09 || codePoint === 0x0a || codePoint === 0x0d) {
    return false;
  }
  return codePoint < 0x20 || (codePoint >= 0x7f && codePoint <= 0x9f);
}

/** True when the text carries C0/C1 control codes such as ESC sequences. */
export function hasTerminalControlCodes(text: string): boolean {
  for (const char of text) {
    const codePoint = char.codePointAt(0);
    if (codePoint !== undefined && isTerminalControlCode(codePoint)) {
      return true;
    }
  }
  return false;
}

/** True when a single word mixes Latin letters with a look-alike alphabet, or uses fullwidth forms. */
export function isLookAlikeWord(word: string): boolean {
  if (FULLWIDTH_FORM.test(word)) {
    return true;
  }
  return CONFUSABLE_SCRIPT.test(word) && LATIN_LETTER.test(word);
}

function hasLookAlikeWord(source: string): boolean {
  return source.split(/\s+/u).some((word) => word.length > 0 && isLookAlikeWord(word));
}

/** Runs the text-level checks over the raw command source. */
export function scanCommandText(source: string): CommandScanFinding[] {
  const findings: CommandScanFinding[] = [];
  if (stripInvisibleUnicode(source) !== source) {
    findings.push({
      id: "text.hidden-characters",
      reason: REASON_HIDDEN_CHARACTERS,
      intent: "ask",
      command: source,
    });
  }
  if (hasTerminalControlCodes(source)) {
    findings.push({
      id: "text.terminal-codes",
      reason: REASON_TERMINAL_CODES,
      intent: "ask",
      command: source,
    });
  }
  if (hasLookAlikeWord(source)) {
    findings.push({
      id: "text.look-alike-letters",
      reason: REASON_LOOK_ALIKE,
      intent: "ask",
      command: source,
    });
  }
  return findings;
}
