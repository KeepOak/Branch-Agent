// NousResearch/hermes-agent@18d125cc1bd9d0e26188ab49bb325427d5945fa2:tools/approval_detection.py (atlas SAFETY-0020)
// Quote-aware command starts, command-position words and quoted-text masks for the hardline floor.
import {
  isShellCommentStart,
  isShellSpace,
  readShellWord,
  scanBacktickEnd,
  scanDollarParenEnd,
  scanShell,
  shellBasename,
  shlexSplit,
  skipShellWhitespace,
  spliceShell,
  type ShellWordSpan,
} from "./exec-hardline-shell-scan.js";

const PARAM_REPLACEMENT_RE = /\$\{[^}/\s]+\/[^}/]*\/(?<replacement>[^}]*)\}/gu;
const PARAM_DEFAULT_RE = /\$\{[^}:}\s]+:-(?<default>[^}]*)\}/gu;
const SIMPLE_SHELL_LITERAL_RE = /^[A-Za-z0-9_./:@%+=,-]+$/u;
const ENV_ASSIGNMENT_RE = /^[A-Za-z_][A-Za-z0-9_]*=.*$/u;
const COMMAND_WRAPPER_WORDS = new Set([
  "sudo",
  "env",
  "exec",
  "nohup",
  "setsid",
  "time",
  "command",
  "builtin",
  "nice",
  "timeout",
  "stdbuf",
  "ionice",
  "chrt",
  "taskset",
  "chroot",
]);
const SUDO_OPTIONS_WITH_ARG = [
  "-c",
  "--close-from",
  "-g",
  "--group",
  "-h",
  "--host",
  "-p",
  "--prompt",
  "-u",
  "--user",
];
// Option operands are data, not executable positions; option spelling remains case-sensitive.
const COMMAND_WRAPPER_OPTIONS_WITH_ARG: Record<string, ReadonlySet<string>> = {
  chroot: new Set(["--groups", "--userspec"]),
  sudo: new Set(SUDO_OPTIONS_WITH_ARG),
  env: new Set(["-a", "--argv0", "-C", "--chdir", "-S", "--split-string", "-u", "--unset"]),
  exec: new Set(["-a"]),
  nice: new Set(["-n", "--adjustment"]),
  time: new Set(["-f", "--format", "-o", "--output"]),
  timeout: new Set(["-k", "--kill-after", "-s", "--signal"]),
  stdbuf: new Set(["-e", "--error", "-i", "--input", "-o", "--output"]),
  ionice: new Set(["-c", "--class", "-n", "--classdata"]),
};
const COMMAND_WRAPPER_NON_EXECUTING_OPTIONS: Record<string, ReadonlySet<string>> = {
  command: new Set(["-v", "-V"]),
  chrt: new Set(["-p", "--pid"]),
  ionice: new Set(["-p", "--pid", "--pgid", "--uid"]),
  taskset: new Set(["-p", "--pid"]),
};
const COMMAND_WRAPPER_POSITIONAL_ARGS: Record<string, number> = {
  chroot: 1,
  chrt: 1,
  taskset: 1,
  timeout: 1,
};
const SHELL_COMMAND_TRANSITIONS = new Set([
  "if",
  "then",
  "else",
  "elif",
  "do",
  "while",
  "until",
  "!",
]);

function literalCommandSubstitutionOutput(script: string): string | null {
  const tokens = shlexSplit(script) ?? [];
  if (tokens.length === 0) {
    return null;
  }
  const command = (tokens[0] ?? "").toLowerCase();
  let args = tokens.slice(1);
  if (command === "echo") {
    while (args.length > 0 && /^-[nEe]+$/u.test(args[0] ?? "")) {
      args = args.slice(1);
    }
  } else if (command !== "printf") {
    return null;
  }
  const [only] = args;
  if (args.length === 1 && only !== undefined && SIMPLE_SHELL_LITERAL_RE.test(only)) {
    return only;
  }
  if (command === "printf" && args.length === 2 && args[0] === "%s") {
    const literal = args[1] ?? "";
    return SIMPLE_SHELL_LITERAL_RE.test(literal) ? literal : null;
  }
  return null;
}

function replaceSimpleCommandSubstitutions(word: string): string {
  const chars: string[] = [];
  let i = 0;
  while (i < word.length) {
    const opener = word.startsWith("$(", i) ? 2 : word.charAt(i) === "`" ? 1 : 0;
    const end =
      opener === 2 ? scanDollarParenEnd(word, i) : opener === 1 ? scanBacktickEnd(word, i) : null;
    const replacement =
      end === null ? null : literalCommandSubstitutionOutput(word.slice(i + opener, end - 1));
    if (replacement === null || end === null) {
      chars.push(word.charAt(i));
      i += 1;
    } else {
      chars.push(replacement);
      i = end;
    }
  }
  return chars.join("");
}

function replaceSimpleShellExpansions(word: string): string {
  return replaceSimpleCommandSubstitutions(word)
    .replace(PARAM_REPLACEMENT_RE, (_match, replacement: string) => replacement)
    .replace(PARAM_DEFAULT_RE, (_match, fallback: string) => fallback);
}

function stripShellWordSyntax(word: string): string {
  const out: string[] = [];
  for (const step of scanShell(word)) {
    if (step.kind !== "quote") {
      out.push(step.kind === "esc" ? word.charAt(step.i + 1) : word.charAt(step.i));
    }
  }
  return out.join("");
}

/** Approximate how shell syntax can spell a command word, without executing anything. */
export function deobfuscateShellWordForDetection(word: string): string {
  let current = word;
  for (let round = 0; round < 2; round += 1) {
    const previous = current;
    current = stripShellWordSyntax(replaceSimpleShellExpansions(current));
    if (current === previous) {
      break;
    }
  }
  return current;
}

function opensBraceGroup(command: string, i: number): boolean {
  const previous = command.charAt(i - 1);
  return i === 0 || isShellSpace(previous) || "(;&|)".includes(previous ?? "\u0000");
}

function collectCommandStarts(command: string, start: number, end: number, starts: number[]) {
  let skip = -1;
  const steps = scanShell(command, {
    start,
    end,
    subst: "uq",
    stopUnterminated: true,
    comments: true,
  });
  for (const { kind, i, j, quote } of steps) {
    const ch = command.charAt(i);
    if (kind === "subst") {
      // Record a nested $(...)/backtick command start and scan its body.
      const inner = i + (ch === "`" ? 1 : 2);
      starts.push(inner);
      collectCommandStarts(command, inner, j === null ? end : j - 1, starts);
    } else if (kind === "char" && quote === null && i !== skip) {
      if ("(;\n".includes(ch) || (ch === "{" && opensBraceGroup(command, i))) {
        starts.push(i + 1);
      } else if (ch === "&" || ch === "|") {
        const repeated = i + 1 < end && command.charAt(i + 1) === ch;
        skip = repeated ? i + 1 : skip;
        starts.push(i + 1 + (repeated ? 1 : 0));
      }
    }
  }
}

export function iterShellCommandStarts(command: string): number[] {
  const starts = [0];
  collectCommandStarts(command, 0, command.length, starts);
  const seen = new Set<number>();
  const out: number[] = [];
  // starts grows while iterating; the array iterator visits appended entries too.
  for (const candidate of starts) {
    const start = skipShellWhitespace(command, candidate);
    if (start >= command.length || seen.has(start) || isShellCommentStart(command, start)) {
      continue;
    }
    seen.add(start);
    out.push(start);
    const [, end, word] = readShellWord(command, start);
    if (SHELL_COMMAND_TRANSITIONS.has(word)) {
      starts.push(end);
    }
  }
  return out;
}

/** Insert marker before each real (quote-aware) command start. */
export function markCommandStarts(command: string, marker = "\n"): string {
  const offsets = iterShellCommandStarts(command)
    .filter((offset) => offset > 0)
    .toSorted((a, b) => a - b);
  return offsets.length > 0
    ? spliceShell(
        command,
        offsets.map((offset) => [offset, offset, marker] as const),
      )
    : command;
}

function maskQuotedNewlinesSpan(command: string, start: number, end: number): string {
  const out: string[] = [];
  for (const { kind, i, j, quote } of scanShell(command, { start, end, subst: "q" })) {
    const stop = j ?? end;
    if (kind === "subst") {
      // A substitution inside double quotes is executable: rescan its body with fresh quote state.
      const bodyStart = i + (command.startsWith("$(", i) ? 2 : 1);
      const bodyEnd = stop - 1;
      out.push(command.slice(i, bodyStart));
      out.push(maskQuotedNewlinesSpan(command, bodyStart, bodyEnd));
      out.push(command.slice(bodyEnd, stop));
    } else if (quote && kind === "char" && command.charAt(i) === "\n") {
      out.push(" ");
    } else {
      out.push(command.slice(i, stop));
    }
  }
  return out.join("");
}

/** Replace raw newlines inside quotes with a space (detection-only). */
export function maskQuotedNewlines(command: string): string {
  return command.includes("\n") ? maskQuotedNewlinesSpan(command, 0, command.length) : command;
}

/** Blank out quoted string content for positionless hardline matching (detection-only). */
export function maskQuotedProse(command: string): string {
  const out: string[] = [];
  for (const { kind, i, j, quote } of scanShell(command, { subst: "q", naiveBacktick: true })) {
    const stop = j ?? command.length;
    const keep = quote === null || kind === "quote" || kind === "subst";
    out.push(keep ? command.slice(i, stop) : " ".repeat(stop - i));
  }
  return out.join("");
}

type WordWalk = { wrapper: string | null; positionals: number; options: boolean; skipArg: boolean };

function wrapperOptionStops(walk: WordWalk, deobfuscated: string): boolean | "skip" {
  const wrapper = walk.wrapper ?? "";
  const option = deobfuscated.split("=", 1)[0] ?? "";
  if (wrapper === "env" && (option === "--split-string" || deobfuscated.startsWith("-S"))) {
    // The split string and remaining argv form one command; the suffix is not a new executable.
    return true;
  }
  const queries = COMMAND_WRAPPER_NON_EXECUTING_OPTIONS[wrapper] ?? new Set<string>();
  const commandQuery =
    wrapper === "command" && !option.startsWith("--") && /[vV]/u.test(option.slice(1));
  if (queries.has(option) || commandQuery) {
    return true;
  }
  const withArg = COMMAND_WRAPPER_OPTIONS_WITH_ARG[wrapper] ?? new Set<string>();
  walk.skipArg = !deobfuscated.includes("=") && withArg.has(option);
  return "skip";
}

/** Classify one word: "skip" it, "stop" the walk, or "yield" it as a command word. */
function classifyWord(walk: WordWalk, word: string, deobfuscated: string) {
  if (walk.skipArg) {
    walk.skipArg = false;
    return "skip";
  }
  if (walk.wrapper && walk.options && deobfuscated === "--") {
    walk.options = false;
    return "skip";
  }
  if (walk.wrapper && walk.options && deobfuscated.startsWith("-")) {
    return wrapperOptionStops(walk, deobfuscated) === true ? "stop" : "skip";
  }
  if (walk.positionals > 0) {
    walk.positionals -= 1;
    return "skip";
  }
  return ENV_ASSIGNMENT_RE.test(word) ? "skip" : "yield";
}

function commandWordsFrom(command: string, start: number, out: ShellWordSpan[]): void {
  const walk: WordWalk = { wrapper: null, positionals: 0, options: true, skipArg: false };
  const redirection = /(?:[0-9]+)?(?:>>|<<|<>|>&|<&|>\||[<>])/uy;
  let pos = start;
  while (pos < command.length) {
    redirection.lastIndex = skipShellWhitespace(command, pos);
    if (redirection.test(command)) {
      pos = readShellWord(command, redirection.lastIndex)[1];
      continue;
    }
    const [wordStart, wordEnd, word] = readShellWord(command, pos);
    if (wordStart === wordEnd) {
      break;
    }
    pos = wordEnd;
    const deobfuscated = deobfuscateShellWordForDetection(word);
    const verdict = classifyWord(walk, word, deobfuscated);
    if (verdict === "stop") {
      break;
    }
    if (verdict === "skip") {
      continue;
    }
    out.push([wordStart, wordEnd, word]);
    const name = shellBasename(deobfuscated).toLowerCase();
    if (!COMMAND_WRAPPER_WORDS.has(name)) {
      break;
    }
    walk.wrapper = name;
    walk.options = true;
    walk.positionals = COMMAND_WRAPPER_POSITIONAL_ARGS[name] ?? 0;
  }
}

/** Command-position words that may be executable names. */
export function iterShellCommandWordSpans(command: string): ShellWordSpan[] {
  const out: ShellWordSpan[] = [];
  for (const start of iterShellCommandStarts(command)) {
    commandWordsFrom(command, start, out);
  }
  return out;
}

/** Top-level command segments in one left-to-right pass. */
export function iterTopLevelShellSegments(command: string): string[] {
  const segments: string[] = [];
  let start = 0;
  for (const { kind, i, j, quote } of scanShell(command, { comments: true })) {
    const separator = kind === "char" && quote === null && ";&|\n".includes(command.charAt(i));
    if (kind === "comment" || separator) {
      if (start < i) {
        segments.push(command.slice(start, i));
      }
      start = j ?? command.length;
    }
  }
  if (start < command.length) {
    segments.push(command.slice(start));
  }
  return segments;
}
