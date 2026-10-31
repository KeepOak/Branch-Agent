// NousResearch/hermes-agent@18d125cc1bd9d0e26188ab49bb325427d5945fa2:tools/approval_detection.py (atlas SAFETY-0020)
// Quote/escape state machine and command-position helpers behind the exec hardline floor.
// Pure lexing: nothing here expands or executes shell syntax.

export type ShellQuote = "'" | '"' | null;
export type ShellStepKind = "char" | "esc" | "quote" | "subst" | "comment";
export type ShellStep = { kind: ShellStepKind; i: number; j: number | null; quote: ShellQuote };
export type ShellEdit = readonly [start: number, end: number, text: string];
export type ShellWordSpan = readonly [start: number, end: number, word: string];

export type ShellScanOptions = {
  start?: number;
  end?: number;
  /** "u": recognize substitutions unquoted; "q": inside double quotes. */
  subst?: string;
  brace?: boolean;
  stopUnterminated?: boolean;
  naiveBacktick?: boolean;
  comments?: boolean;
};

export function isShellSpace(ch: string | undefined): boolean {
  return ch !== undefined && ch !== "" && /\s/u.test(ch);
}

export function skipShellWhitespace(command: string, pos: number): number {
  let next = pos;
  while (next < command.length && isShellSpace(command.charAt(next))) {
    next += 1;
  }
  return next;
}

export function isShellCommentStart(command: string, index: number): boolean {
  if (command.charAt(index) !== "#") {
    return false;
  }
  const previous = command.charAt(index - 1);
  return index === 0 || isShellSpace(previous) || ";&|()<>".includes(previous ?? "\u0000");
}

export function scanBacktickEnd(command: string, start: number): number | null {
  // Backticks have no quote awareness: only a backslash escapes the next char.
  const body = /(?:\\.|[^`\\])*`/suy;
  body.lastIndex = start + 1;
  return body.test(command) ? body.lastIndex : null;
}

export function scanDollarParenEnd(command: string, start: number): number | null {
  let depth = 1;
  for (const step of scanShell(command, { start: start + 2 })) {
    if (step.kind === "char" && !step.quote) {
      depth +=
        (command.startsWith("$(", step.i) ? 1 : 0) - (command.charAt(step.i) === ")" ? 1 : 0);
      if (depth === 0) {
        return step.i + 1;
      }
    }
  }
  return null;
}

function substitutionClose(text: string, i: number, naiveBacktick: boolean): number | null {
  if (text.charAt(i) === "`") {
    if (naiveBacktick) {
      const close = text.indexOf("`", i + 1);
      return close < 0 ? null : close + 1;
    }
    return scanBacktickEnd(text, i);
  }
  if (text.charAt(i + 1) === "(") {
    return scanDollarParenEnd(text, i);
  }
  const close = text.indexOf("}", i + 2);
  return close < 0 ? null : close + 1;
}

function opensSubstitution(
  text: string,
  i: number,
  quote: ShellQuote,
  options: ShellScanOptions,
): boolean {
  if (quote === "'" || !(options.subst ?? "").includes(quote ? "q" : "u")) {
    return false;
  }
  return (
    text.charAt(i) === "`" ||
    text.startsWith("$(", i) ||
    (options.brace === true && !quote && text.startsWith("${", i))
  );
}

/**
 * Yield lexical steps over text.charAt(start:end) without expanding. quote is the state the step was
 * read in. An unterminated substitution falls through as plain chars unless stopUnterminated,
 * which yields a subst step with j: null and ends the scan.
 */
export function* scanShell(text: string, options: ShellScanOptions = {}): Generator<ShellStep> {
  const n = options.end ?? text.length;
  let quote: ShellQuote = null;
  let i = options.start ?? 0;
  while (i < n) {
    const ch = text.charAt(i);
    let kind: ShellStepKind = "char";
    let j = i + 1;
    if (options.comments && quote === null && isShellCommentStart(text, i)) {
      kind = "comment";
      const newline = text.indexOf("\n", i);
      j = newline < 0 || newline >= n ? n : newline;
    } else if (quote !== "'" && ch === "\\" && i + 1 < n) {
      kind = "esc";
      j = i + 2;
    } else if (ch === quote || (quote === null && (ch === "'" || ch === '"'))) {
      kind = "quote";
    } else if (opensSubstitution(text, i, quote, options)) {
      const close = substitutionClose(text, i, options.naiveBacktick === true);
      if (close !== null) {
        kind = "subst";
        j = close;
      } else if (options.stopUnterminated) {
        yield { kind: "subst", i, j: null, quote };
        return;
      }
    }
    yield { kind, i, j, quote };
    if (kind === "quote") {
      quote = quote ? null : (ch as ShellQuote);
    }
    i = j;
  }
}

/** Read one shell word without executing expansions. */
export function readShellWord(command: string, pos: number): ShellWordSpan {
  const start = skipShellWhitespace(command, pos);
  let end = start;
  for (const step of scanShell(command, { start, subst: "u", brace: true })) {
    const ch = command.charAt(step.i) ?? "";
    const boundary = isShellSpace(ch) || ";&|<>()".includes(ch);
    if (step.kind === "char" && step.quote === null && boundary) {
      break;
    }
    end = step.j ?? end;
  }
  return [start, end, command.slice(start, end)];
}

/** Apply sorted, non-overlapping edits in one pass. */
export function spliceShell(command: string, edits: readonly ShellEdit[]): string {
  const parts: string[] = [];
  let previous = 0;
  for (const [start, end, text] of edits) {
    parts.push(command.slice(previous, start), text);
    previous = end;
  }
  return parts.join("") + command.slice(previous);
}

export function shellBasename(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

type ShlexState = { tokens: string[]; token: string; active: boolean };

function shlexFlush(state: ShlexState): void {
  if (state.active) {
    state.tokens.push(state.token);
  }
  state.token = "";
  state.active = false;
}

function shlexQuoted(text: string, start: number, state: ShlexState): number | null {
  const quote = text.charAt(start);
  let i = start + 1;
  while (i < text.length && text.charAt(i) !== quote) {
    const next = text.charAt(i + 1);
    if (quote === '"' && text.charAt(i) === "\\" && (next === '"' || next === "\\")) {
      i += 1;
    }
    state.token += text.charAt(i);
    i += 1;
  }
  return i < text.length ? i + 1 : null;
}

function shlexPunctuationEnd(text: string, start: number, punctuation: string): number {
  let end = start;
  while (end < text.length && punctuation.includes(text.charAt(end))) {
    end += 1;
  }
  return end;
}

/**
 * POSIX shlex split (whitespace_split, no comments). Runs of punctuation chars become their own
 * tokens. Returns null on an unterminated quote or a trailing escape, like shlex's ValueError.
 */
export function shlexSplit(text: string, punctuation = ""): string[] | null {
  const state: ShlexState = { tokens: [], token: "", active: false };
  let i = 0;
  while (i < text.length) {
    const ch = text.charAt(i);
    if (isShellSpace(ch)) {
      shlexFlush(state);
      i += 1;
    } else if (punctuation.includes(ch)) {
      shlexFlush(state);
      const end = shlexPunctuationEnd(text, i, punctuation);
      state.tokens.push(text.slice(i, end));
      i = end;
    } else if (ch === "'" || ch === '"') {
      state.active = true;
      const next = shlexQuoted(text, i, state);
      if (next === null) {
        return null;
      }
      i = next;
    } else if (ch === "\\") {
      if (i + 1 >= text.length) {
        return null;
      }
      state.active = true;
      state.token += text.charAt(i + 1);
      i += 2;
    } else {
      state.active = true;
      state.token += ch;
      i += 1;
    }
  }
  shlexFlush(state);
  return state.tokens;
}
