// NousResearch/hermes-agent@18d125cc1bd9d0e26188ab49bb325427d5945fa2:tools/approval_detection.py (atlas SAFETY-0020)
// Structural grep-pattern masking and program-bearing option payloads for the hardline floor.
import {
  iterShellCommandWordSpans,
  iterTopLevelShellSegments,
  deobfuscateShellWordForDetection,
} from "./exec-hardline-command-words.js";
import {
  isShellSpace,
  scanShell,
  shellBasename,
  shlexSplit,
  spliceShell,
  type ShellQuote,
} from "./exec-hardline-shell-scan.js";

type SpanToken = { value: string; start: number; end: number; inert: boolean };

const SHELL_NAMES = new Set(["bash", "sh", "zsh", "ksh", "dash"]);
const GREP_OPTIONS_WITH_ARG = new Set([
  "--after-context", "--before-context", "--binary-files", "--context", "--directories",
  "--devices", "--exclude", "--exclude-dir", "--exclude-from", "--include", "--label",
  "--max-count", "--regexp", "--file",
]);
const GREP_SHORT_OPTIONS_WITH_ARG = new Set(["A", "B", "C", "D", "d", "e", "f", "m"]);
const BASH_OPTIONS_WITH_ARG = new Set(["-O", "+O", "-o", "+o", "--init-file", "--rcfile"]);
const BASH_SHORT_OPTION_LETTERS = new Set("ilrsDcabefhkmnptuvxBCEHPTOo");
const READ_TOOL_EXEC_FLAGS: Record<string, ReadonlySet<string>> = {
  sort: new Set(["--compress-program"]),
  rg: new Set(["--pre", "--hostname-bin"]),
  ag: new Set(["--pager"]),
  man: new Set(["--pager", "--html", "-P", "-H"]),
};
// Required-argument options are ownership boundaries (ripgrep 14, GNU sort, man-db, ag 2.2).
const READ_TOOL_LONG_OPTIONS_WITH_ARG: Record<string, ReadonlySet<string>> = {
  rg: new Set([
    "--after-context", "--before-context", "--color", "--colors", "--context",
    "--context-separator", "--dfa-size-limit", "--encoding", "--engine",
    "--field-context-separator", "--field-match-separator", "--file", "--generate", "--glob",
    "--hostname-bin", "--hyperlink-format", "--iglob", "--ignore-file", "--max-columns",
    "--max-count", "--max-depth", "--max-filesize", "--path-separator", "--pre", "--pre-glob",
    "--regex-size-limit", "--regexp", "--replace", "--sort", "--sortr", "--threads", "--type",
    "--type-add", "--type-clear", "--type-not",
  ]),
  sort: new Set([
    "--batch-size", "--buffer-size", "--compress-program", "--field-separator",
    "--files0-from", "--key", "--output", "--parallel", "--random-source", "--sort",
    "--temporary-directory",
  ]),
  man: new Set([
    "--config-file", "--encoding", "--extension", "--locale", "--manpath", "--pager",
    "--preprocessor", "--prompt", "--recode", "--sections", "--systems",
  ]),
  ag: new Set([
    "--ackmate-dir-filter", "--color-line-number", "--color-match", "--color-path", "--depth",
    "--filename-pattern", "--file-search-regex", "--ignore", "--ignore-dir", "--max-count",
    "--pager", "--path-to-ignore", "--width", "--workers",
  ]),
};
const READ_TOOL_SHORT_OPTIONS_WITH_ARG: Record<string, ReadonlySet<string>> = {
  rg: new Set("efEmjgdtTABCMr"),
  sort: new Set("koStT"),
  man: new Set("CRLmMSserEPp"),
  ag: new Set("gGmpW"),
};

function backtickEndFrom(segment: string, i: number): number | null {
  let j = segment.indexOf("`", i + 1);
  while (j !== -1 && segment.charAt(j - 1) === "\\") {
    j = segment.indexOf("`", j + 1);
  }
  return j === -1 ? null : j;
}

type LexState = {
  tokens: SpanToken[];
  value: string[];
  tokenStart: number | null;
  quote: ShellQuote;
  depth: number;
  inBacktick: boolean;
};

function flushSpanToken(segment: string, state: LexState, end: number): void {
  const start = state.tokenStart ?? end;
  const raw = segment.slice(start, end);
  // Only a wholly single-quoted operand is inert shell data.
  const inert = (raw.startsWith("'") && raw.endsWith("'")) || (raw.includes("='") && raw.endsWith("'"));
  state.tokens.push({ value: state.value.join(""), start, end, inert });
  state.value = [];
  state.tokenStart = null;
}

/** Returns "end" when the unquoted char ends the simple command, else "continue". */
function trackUnquotedChar(segment: string, i: number, state: LexState): "end" | "continue" {
  const ch = segment.charAt(i);
  if (segment.startsWith("$(", i)) {
    state.depth += 1;
  } else if (ch === "`") {
    if (state.inBacktick) {
      state.inBacktick = false;
    } else if (state.depth === 0 && backtickEndFrom(segment, i) === null) {
      return "end";
    } else {
      state.inBacktick = true;
    }
  } else if (ch === ")") {
    if (state.depth === 0) {
      return "end";
    }
    state.depth -= 1;
  } else if (";|&\n".includes(ch)) {
    return "end";
  }
  return "continue";
}

/** Shell words with source spans, or null on malformed quoting. Stops at the simple command's end. */
export function shellTokensWithSpans(segment: string, start: number): SpanToken[] | null {
  const state: LexState = {
    tokens: [], value: [], tokenStart: null, quote: null, depth: 0, inBacktick: false,
  };
  let endAt = segment.length;
  for (const { kind, i } of scanShell(segment, { start })) {
    const ch = segment.charAt(i);
    if (kind === "char" && !state.quote) {
      if (isShellSpace(ch) && ch !== "\n") {
        if (state.tokenStart !== null) {
          flushSpanToken(segment, state, i);
        }
        continue;
      }
      if (trackUnquotedChar(segment, i, state) === "end") {
        endAt = i;
        break;
      }
    }
    state.tokenStart ??= i;
    if (kind === "quote") {
      state.quote = state.quote ? null : (ch as ShellQuote);
    } else if (kind === "esc") {
      state.value.push(segment.charAt(i + 1));
    } else if (ch === "\\" && !state.quote) {
      return null; // dangling backslash
    } else {
      state.value.push(ch);
    }
  }
  if (state.quote) {
    return null;
  }
  if (state.tokenStart !== null) {
    flushSpanToken(segment, state, endAt);
  }
  return state.tokens;
}

type GrepParse = { pcre: boolean; explicit: boolean; operand: number | null; patterns: number[] };

/** Returns the index to continue from, or null when the option is missing its value. */
function parseGrepLongOption(args: SpanToken[], i: number, parse: GrepParse): number | null {
  const token = args[i]?.value ?? "";
  const equals = token.indexOf("=");
  const option = equals < 0 ? token : token.slice(0, equals);
  parse.pcre ||= option === "--perl-regexp";
  parse.explicit ||= option === "--regexp" || option === "--file";
  const takesNext = GREP_OPTIONS_WITH_ARG.has(option) && equals < 0;
  if (takesNext && i + 1 >= args.length) {
    return null;
  }
  if (option === "--regexp") {
    parse.patterns.push(takesNext ? i + 1 : i);
  }
  return takesNext ? i + 1 : i;
}

function parseGrepShortBundle(args: SpanToken[], i: number, parse: GrepParse): number | null {
  const chars = (args[i]?.value ?? "").slice(1);
  for (let k = 0; k < chars.length; k += 1) {
    const char = chars.charAt(k);
    parse.pcre ||= char === "P";
    parse.explicit ||= char === "e" || char === "f";
    if (GREP_SHORT_OPTIONS_WITH_ARG.has(char)) {
      // The first argument-taking short option owns the rest of the bundle, or the next token.
      const attached = k + 1 < chars.length;
      if (!attached && i + 1 >= args.length) {
        return null;
      }
      if (char === "e") {
        parse.patterns.push(attached ? i : i + 1);
      }
      return attached ? i : i + 1;
    }
  }
  return i;
}

function parseGrepArgs(args: SpanToken[]): GrepParse | null {
  const parse: GrepParse = { pcre: false, explicit: false, operand: null, patterns: [] };
  let options = true;
  for (let i = 0; i < args.length; i += 1) {
    const token = args[i]?.value ?? "";
    let next: number | null = i;
    if (options && token === "--") {
      options = false;
    } else if (options && token.startsWith("--")) {
      next = parseGrepLongOption(args, i, parse);
    } else if (options && token.startsWith("-") && token !== "-") {
      next = parseGrepShortBundle(args, i, parse);
    } else if (parse.operand === null) {
      parse.operand = i;
    }
    if (next === null) {
      return null;
    }
    i = next;
  }
  return parse;
}

type GrepSpans = { spans: Array<readonly [number, number]>; malformed: boolean };

function grepSegmentSpans(segment: string, segmentAt: number, out: GrepSpans): boolean {
  for (const [start, , word] of iterShellCommandWordSpans(segment)) {
    const name = shellBasename(deobfuscateShellWordForDetection(word)).toLowerCase();
    if (name !== "grep" && name !== "egrep") {
      continue;
    }
    const tokens = shellTokensWithSpans(segment, start);
    const args = tokens?.slice(1) ?? [];
    const parse = tokens === null ? null : parseGrepArgs(args);
    if (parse === null) {
      out.malformed = true;
      return false;
    }
    if (!parse.explicit) {
      if (parse.operand === null) {
        out.malformed = parse.pcre;
        out.spans = [];
        return false;
      }
      parse.patterns.push(parse.operand);
    }
    if (parse.pcre) {
      for (const index of parse.patterns) {
        const arg = args[index];
        if (arg?.inert) {
          out.spans.push([segmentAt + arg.start, segmentAt + arg.end]);
        }
      }
    }
  }
  return true;
}

/** Structurally locate quoted grep PCRE operands; malformed parses hide nothing. */
export function quotedGrepPatternSpans(command: string): GrepSpans {
  const out: GrepSpans = { spans: [], malformed: false };
  let offset = 0;
  for (const segment of iterTopLevelShellSegments(command)) {
    const segmentAt = command.indexOf(segment, offset);
    offset = segmentAt + segment.length;
    if (!grepSegmentSpans(segment, segmentAt, out)) {
      return out.malformed ? { spans: [], malformed: true } : out;
    }
  }
  return out;
}

export function grepSafeDetectionVariant(command: string): { variant: string; malformed: boolean } {
  const { spans, malformed } = quotedGrepPatternSpans(command);
  if (malformed || spans.length === 0) {
    return { variant: command, malformed };
  }
  const edits = spans.map(([start, end]) => [start, end, " ".repeat(end - start)] as const);
  return { variant: spliceShell(command, edits), malformed: false };
}

/** Whether Bash -c occurs and the command string it owns. */
export function bashExecPayload(args: string[]): { found: boolean; payload: string | null } {
  let index = 0;
  while (index < args.length) {
    const token = args[index] ?? "";
    if (token === "--" || !(token.startsWith("-") || token.startsWith("+"))) {
      break;
    }
    if (BASH_OPTIONS_WITH_ARG.has(token)) {
      index += 2;
      continue;
    }
    const chars = [...token.slice(1)];
    if (token.startsWith("--") || !chars.every((char) => BASH_SHORT_OPTION_LETTERS.has(char))) {
      index += 1;
      continue;
    }
    const consumedOptionArg = chars.includes("O") || chars.includes("o") ? 1 : 0;
    if (chars.includes("c")) {
      const payloadIndex = index + 1 + consumedOptionArg;
      return { found: true, payload: args[payloadIndex] ?? null };
    }
    index += 1 + consumedOptionArg;
  }
  return { found: false, payload: null };
}

function readToolOptionMatch(tool: string, token: string) {
  const equals = token.indexOf("=");
  const option = equals < 0 ? token : token.slice(0, equals);
  let payload: string | null = equals < 0 ? null : token.slice(equals + 1);
  let matched = READ_TOOL_EXEC_FLAGS[tool]?.has(option) ? option : null;
  if (tool === "man" && (token.startsWith("-P") || token.startsWith("-H")) && token.length > 2) {
    matched = token.slice(0, 2);
    payload = token.slice(2);
  }
  return { option, matched, payload };
}

/** (option, program) for a read-only tool's program-running flag. */
export function readToolExecFlag(tool: string, args: string[]): [string, string] | null {
  let index = 0;
  while (index < args.length) {
    const token = args[index] ?? "";
    if (token === "--") {
      break;
    }
    const { option, matched, payload: attached } = readToolOptionMatch(tool, token);
    if (matched) {
      const payload = attached ?? (index + 1 < args.length ? args[index + 1] : null);
      if (payload) {
        return [matched, payload];
      }
      index += payload !== null && !token.includes("=") ? 2 : 1;
    } else if (READ_TOOL_LONG_OPTIONS_WITH_ARG[tool]?.has(option) && attached === null) {
      index += 2;
    } else if (token.startsWith("-") && !token.startsWith("--") && token.length > 1) {
      const shorts = READ_TOOL_SHORT_OPTIONS_WITH_ARG[tool] ?? new Set<string>();
      const owner = [...token.slice(1)].findIndex((char) => shorts.has(char));
      index += owner >= 0 && owner + 1 === token.length - 1 ? 2 : 1;
    } else {
      index += 1;
    }
  }
  return null;
}

/**
 * Executable payloads carried by program-bearing options (sh -c, rg --pre, ...). Upstream's
 * _execution_flag_findings also reports payload-less findings; the hardline floor only consumes
 * payloads, so only those are produced here.
 */
export function executionFlagPayloads(command: string): string[] {
  const payloads: string[] = [];
  for (const segment of iterTopLevelShellSegments(command)) {
    for (const [start, , word] of iterShellCommandWordSpans(segment)) {
      const name = shellBasename(deobfuscateShellWordForDetection(word)).toLowerCase();
      const tokens = shlexSplit(segment.slice(start), "<>");
      if (!tokens || tokens.length === 0) {
        continue;
      }
      const args = tokens.slice(1);
      const shell = SHELL_NAMES.has(name) ? bashExecPayload(args).payload : null;
      const tool = name in READ_TOOL_EXEC_FLAGS ? readToolExecFlag(name, args)?.[1] : undefined;
      for (const payload of [shell, tool]) {
        if (payload) {
          payloads.push(payload);
        }
      }
    }
  }
  return payloads;
}
