// Structural pass for the always-ask floor (atlas SAFETY-0020). The pattern rules in
// exec-hardline-floor.ts match command text; this pass parses the command into shell segments
// first, so prefixes, path spellings and indirection cannot step around them:
// - each segment split on ; && || | & and newlines is checked on its own;
// - leading NAME=value words and command/builtin/exec/env/sudo/doas/nohup/nice/timeout/time
//   wrappers are dropped, and the command word is reduced to its basename (/bin/rm -> rm);
// - path operands are normalized (// collapsed, trailing / and globs dropped, . and .. resolved)
//   before they are compared with the protected roots;
// - sh/bash/zsh -c, eval, env -S, git -c, find -exec and xargs payloads are parsed again;
// - targets the floor cannot see (a variable or command substitution under rm -r, xargs, an
//   interpreter payload that deletes or shells out to a floor verb, a decoded pipe into a shell)
//   count as a hit.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { stripAnsi } from "../../packages/terminal-core/src/ansi.js";
import { parseShell, UNRESOLVED, type Segment, type Word } from "./exec-hardline-shell-parse.js";

export type StructuralFinding = { description: string };

const MAX_DEPTH = 8;

export const NESTING_LIMIT_DESCRIPTION = "command nesting limit exceeded";
const ROOT_DESCRIPTION = "recursive delete of root filesystem";
const SYSTEM_DESCRIPTION = "recursive delete of system directory";
const HOME_DESCRIPTION = "recursive delete of home directory";
const UNRESOLVED_DESCRIPTION = "recursive delete of a target the floor cannot resolve";

type TargetClass = "root" | "system" | "home" | "unresolved" | null;

// Protected roots, compared lowercased (macOS volumes are case-insensitive).
const SYSTEM_ROOTS = new Set([
  "/bin",
  "/boot",
  "/dev",
  "/etc",
  "/home",
  "/lib",
  "/lib32",
  "/lib64",
  "/libx32",
  "/proc",
  "/root",
  "/sbin",
  "/sys",
  "/usr",
  "/var",
  "/users",
  "/library",
  "/applications",
  "/system",
  "/private",
]);
const RAW_DEVICE_RE = /^\/dev\/(?:r?disk\d|sd[a-z]|nvme\d|hd[a-z]|mmcblk\d|vd[a-z]|xvd[a-z])/i;
const ASSIGNMENT_RE = /^[A-Za-z_][A-Za-z0-9_]*(?:\[[^\]]*\])?\+?=/;
const SHELLS = new Set(["sh", "bash", "zsh", "ksh", "mksh", "dash", "ash", "fish", "yash"]);
const SHUTDOWN_COMMANDS = new Set(["shutdown", "reboot", "halt", "poweroff"]);
const KEYWORDS = new Set([
  "!",
  "{",
  "}",
  "(",
  ")",
  "then",
  "do",
  "else",
  "elif",
  "if",
  "while",
  "until",
]);
const SUDO_ARG_FLAGS = new Set(["-u", "-g", "-h", "-p", "-C", "-D", "-R", "-T", "-U", "-r", "-t"]);
// A floor verb written inside another program's text (pipe source, interpreter payload).
const DESTRUCTIVE_TEXT_RE =
  /(?:^|[\s;&|(\x60'"{])(?:\S*\/)?(?:rm\s+(?:-\S*\s+)*-\S*[rR]|rm\s+--recursive|dd\s[^\n]*\bof=|asr\s+restore|diskutil\s+(?:erase|partitiondisk|zerodisk|randomdisk|secureerase|reformat)|(?:mkfs\S*|mke2fs|newfs\S*|wipefs|shutdown|reboot|halt|poweroff)\b)/i;
const DELETE_API_RE =
  /\b(?:rmtree|rm_rf|rm_r|remove_entry(?:_secure)?|remove_tree|removedirs|rmsync|rmdirsync|rimraf|deltree)\b/i;
const SHELLOUT_RE =
  /\b(?:system|popen|subprocess|spawn(?:sync)?|exec(?:sync|file|filesync|vp|lp)?|check_output|check_call|getoutput|getstatusoutput|qx|shell_exec|passthru|proc_open)\b|\x60|%x|do shell script/i;
const DECODER_TEXT_RE =
  /\bbase64\b[^|]*\s(?:-d|-D|--decode)\b|\bxxd\b[^|]*\s-r|\bopenssl\b[^|]*\s-d\b|\buudecode\b|\b(?:gunzip|zcat|bzcat|xzcat)\b|\bgzip\b[^|]*\s-d\b/;

function homes(): string[] {
  const out = new Set<string>();
  for (const home of [os.homedir(), process.env.HOME ?? ""]) {
    if (!home) {
      continue;
    }
    out.add(home.toLowerCase());
    try {
      out.add(fs.realpathSync.native(home).toLowerCase());
    } catch {
      // A missing home still matches by spelling.
    }
  }
  return [...out];
}

function commandName(word: string): string {
  const base = word.slice(Math.max(word.lastIndexOf("/"), word.lastIndexOf("\\")) + 1);
  return base.toLowerCase().replace(/\.exe$/, "");
}

function normalizeAbsolutePath(value: string): string {
  const stack: string[] = [];
  for (const part of value.split("/")) {
    if (!part || part === ".") {
      continue;
    }
    if (part === "..") {
      stack.pop();
    } else {
      stack.push(part);
    }
  }
  // A trailing glob names the directory's contents: /etc/* wipes /etc as surely as /etc.
  while (stack.length > 0 && /^(?:\.?\*)+$/.test(stack.at(-1) ?? "")) {
    stack.pop();
  }
  return "/" + stack.join("/");
}

/** Collapse //, drop trailing / and globs, resolve . and .. (exported for tests). */
export function normalizeFloorPath(value: string): string {
  return normalizeAbsolutePath(value);
}

function classifyPath(normalized: string): TargetClass {
  const lower = normalized.toLowerCase();
  if (lower === "/") {
    return "root";
  }
  if (SYSTEM_ROOTS.has(lower) || /^\/private\/[^/]+$/.test(lower) || lower.startsWith("/system/")) {
    return "system";
  }
  if (/^\/(?:home|users)\/[^/]+$/.test(lower) || lower === "/var/root") {
    return "home";
  }
  return homes().includes(lower) ? "home" : null;
}

function classifyTarget(word: Word): TargetClass {
  let value = word.value;
  if (value.startsWith("~")) {
    const slash = value.indexOf("/");
    const user = slash < 0 ? value.slice(1) : value.slice(1, slash);
    if (user.includes(UNRESOLVED)) {
      return "unresolved";
    }
    const home = os.homedir() || "/home/user";
    const base = user ? path.posix.join(path.posix.dirname(home), user) : home;
    value = base + (slash < 0 ? "" : value.slice(slash));
  }
  if (value.includes(UNRESOLVED)) {
    return "unresolved";
  }
  return value.startsWith("/") ? classifyPath(normalizeAbsolutePath(value)) : null;
}

function describeTarget(target: TargetClass): string | null {
  switch (target) {
    case "root":
      return ROOT_DESCRIPTION;
    case "system":
      return SYSTEM_DESCRIPTION;
    case "home":
      return HOME_DESCRIPTION;
    case "unresolved":
      return UNRESOLVED_DESCRIPTION;
    default:
      return null;
  }
}

function finding(description: string | null): StructuralFinding | null {
  return description ? { description } : null;
}

type Stripped = { words: Word[] } | { split: string };

function skipFlags(words: Word[], k: number, withArg: ReadonlySet<string>): number {
  let i = k;
  while (i < words.length) {
    const value = words[i].value;
    if (value === "--") {
      return i + 1;
    }
    if (!value.startsWith("-") || value === "-") {
      return i;
    }
    i += withArg.has(value) ? 2 : 1;
  }
  return i;
}

/** Drop assignments, keywords and exec wrappers until the real command word. */
function stripWrappers(words: Word[]): Stripped {
  let k = 0;
  while (k < words.length) {
    const word = words[k];
    if (word.unresolved) {
      break;
    }
    const value = word.value;
    if (ASSIGNMENT_RE.test(value) || KEYWORDS.has(value)) {
      k++;
      continue;
    }
    const name = commandName(value);
    if (name === "command") {
      const rest = words.slice(k + 1).map((w) => w.value);
      const firstNonFlag = rest.findIndex((v) => !v.startsWith("-"));
      const flags = firstNonFlag < 0 ? rest : rest.slice(0, firstNonFlag);
      if (flags.some((flag) => /^-[a-zA-Z]*[vV]/.test(flag))) {
        return { words: [] };
      }
      k = skipFlags(words, k + 1, new Set());
    } else if (name === "builtin" || name === "nohup") {
      k++;
    } else if (name === "exec") {
      k = skipFlags(words, k + 1, new Set(["-a"]));
    } else if (name === "env") {
      k++;
      while (k < words.length) {
        const flag = words[k].value;
        if (flag === "--") {
          k++;
          break;
        }
        if (flag === "-S" || flag === "--split-string") {
          return {
            split: words
              .slice(k + 1)
              .map((w) => w.literal)
              .join(" "),
          };
        }
        if (flag.startsWith("--split-string=") || (flag.startsWith("-S") && flag.length > 2)) {
          const payload = flag.startsWith("-S") ? flag.slice(2) : flag.slice(15);
          return { split: [payload, ...words.slice(k + 1).map((w) => w.literal)].join(" ") };
        }
        if (flag === "-u" || flag === "-C" || flag === "--unset" || flag === "--chdir") {
          k += 2;
        } else if ((flag.startsWith("-") && flag !== "-") || ASSIGNMENT_RE.test(flag)) {
          k++;
        } else {
          break;
        }
      }
    } else if (name === "sudo" || name === "doas") {
      k = skipFlags(words, k + 1, SUDO_ARG_FLAGS);
    } else if (name === "nice") {
      k = skipFlags(words, k + 1, new Set(["-n"]));
    } else if (name === "ionice") {
      k = skipFlags(words, k + 1, new Set(["-c", "-n", "-p", "-P", "-u"]));
    } else if (name === "caffeinate" || name === "setsid") {
      k = skipFlags(words, k + 1, new Set(["-t", "-w"]));
    } else if (name === "stdbuf") {
      k = skipFlags(words, k + 1, new Set(["-i", "-o", "-e"]));
    } else if (name === "timeout") {
      k = skipFlags(words, k + 1, new Set(["-s", "-k", "--signal", "--kill-after"])) + 1;
    } else if (name === "time" || name === "arch") {
      k = skipFlags(words, k + 1, new Set());
    } else {
      break;
    }
  }
  return { words: words.slice(k) };
}

function checkRm(args: Word[]): StructuralFinding | null {
  let recursive = false;
  let options = true;
  const operands: Word[] = [];
  for (const arg of args) {
    const value = arg.value;
    if (options && value === "--") {
      options = false;
    } else if (options && value.startsWith("--") && !arg.unresolved) {
      recursive ||= value === "--recursive";
    } else if (options && value.startsWith("-") && value.length > 1 && !arg.unresolved) {
      recursive ||= /[rR]/.test(value);
    } else {
      operands.push(arg);
    }
  }
  for (const operand of operands) {
    const target = classifyTarget(operand);
    if (target === "unresolved" ? recursive : target !== null) {
      return finding(describeTarget(target));
    }
  }
  return null;
}

function checkShell(args: Word[], seg: Segment | null, depth: number): StructuralFinding | null {
  let script = false;
  for (let i = 0; i < args.length; i++) {
    const value = args[i].value;
    if (/^-[A-Za-z]*c[A-Za-z]*$/.test(value)) {
      return analyzeCommand(args[i + 1]?.literal ?? "", depth + 1);
    }
    if (value === "--") {
      script = i + 1 < args.length;
      break;
    }
    if (value.startsWith("-") || value.startsWith("+")) {
      if (/^[-+][oO]$/.test(value)) {
        i++;
      }
      continue;
    }
    script = true;
    break;
  }
  for (const body of seg?.hereDocs ?? []) {
    const hit = analyzeCommand(body, depth + 1);
    if (hit) {
      return hit;
    }
  }
  return !script && seg?.pipedFrom ? checkPipeIntoShell(seg.pipedFrom) : null;
}

function isDecoder(words: Word[]): boolean {
  const [head, ...args] = words;
  if (!head) {
    return false;
  }
  const name = commandName(head.value);
  const values = args.map((a) => a.value);
  if (name === "base64" || name === "gbase64") {
    return values.some((v) => /^-[a-zA-Z]*[dD]/.test(v) || v === "--decode");
  }
  if (name === "openssl") {
    return values.includes("-d");
  }
  if (name === "xxd") {
    return values.some((v) => /^-[a-zA-Z]*r/.test(v));
  }
  if (name === "gzip") {
    return values.includes("-d");
  }
  if (name === "printf" || name === "echo") {
    return args.some((a) => /\\(?:x[0-9a-f]{2}|[0-7]{3}|u[0-9a-f]{4})/i.test(a.literal));
  }
  return ["uudecode", "gunzip", "zcat", "bzcat", "xzcat", "rev", "tr"].includes(name);
}

function checkPipeIntoShell(source: Segment): StructuralFinding | null {
  for (let seg: Segment | null = source; seg; seg = seg.pipedFrom) {
    const stripped = stripWrappers(seg.words);
    if ("words" in stripped && isDecoder(stripped.words)) {
      return { description: "decoded payload piped into a shell" };
    }
    const texts = [...seg.words.map((w) => w.literal), ...seg.hereDocs];
    if (texts.some((text) => DESTRUCTIVE_TEXT_RE.test(text))) {
      return { description: "destructive payload piped into a shell" };
    }
  }
  return null;
}

function interpreterPayloads(name: string, args: Word[]): string[] | null {
  const flagged = (re: RegExp, longNames: string[] = []): string[] => {
    const out: string[] = [];
    for (let i = 0; i < args.length; i++) {
      const value = args[i].value;
      const eq = longNames.find((long) => value.startsWith(long + "="));
      if (eq) {
        out.push(args[i].literal.slice(eq.length + 1));
      } else if (re.test(value) || longNames.includes(value)) {
        out.push(args[i + 1]?.literal ?? "");
        i++;
      }
    }
    return out;
  };
  if (/^python[0-9.]*$/.test(name) || name === "pypy3") {
    return flagged(/^-[A-Za-z]*c$/);
  }
  if (/^perl[0-9.]*$/.test(name)) {
    return flagged(/^-[A-Za-z]*[eE]$/);
  }
  if (name === "ruby" || name === "lua" || name === "luajit" || name === "rscript") {
    return flagged(/^-[A-Za-z]*e$/);
  }
  if (name === "node" || name === "nodejs" || name === "bun") {
    return flagged(/^-[ep]$/, ["--eval", "--print"]);
  }
  if (name === "deno") {
    return args[0]?.value === "eval" ? [args[1]?.literal ?? ""] : [];
  }
  if (name === "php") {
    return flagged(/^-r$/);
  }
  if (name === "osascript") {
    return flagged(/^-e$/);
  }
  if (["awk", "gawk", "mawk", "nawk"].includes(name)) {
    let i = 0;
    while (i < args.length && args[i].value.startsWith("-")) {
      if (args[i].value === "-f") {
        return [];
      }
      i += /^-[Fvf]$/.test(args[i].value) ? 2 : 1;
    }
    return args[i] ? [args[i].literal] : [];
  }
  return null;
}

function checkInterpreter(payloads: string[], seg: Segment | null): StructuralFinding | null {
  for (const payload of [...payloads, ...(payloads.length ? [] : (seg?.hereDocs ?? []))]) {
    if (
      DELETE_API_RE.test(payload) ||
      (SHELLOUT_RE.test(payload) && DESTRUCTIVE_TEXT_RE.test(payload))
    ) {
      return { description: "destructive command in an interpreter payload" };
    }
  }
  return null;
}

function checkFind(args: Word[], depth: number): StructuralFinding | null {
  let i = 0;
  while (i < args.length && /^-(?:[HLP]|D|O\d*)$/.test(args[i].value)) {
    i += args[i].value === "-D" ? 2 : 1;
  }
  const starts: Word[] = [];
  while (i < args.length && !/^[-(!,]/.test(args[i].value)) {
    starts.push(args[i++]);
  }
  const startTargets = starts.map(classifyTarget).filter((t) => t !== null);
  const unsafeStart = startTargets.length > 0;
  for (; i < args.length; i++) {
    const value = args[i].value;
    if (value === "-delete" && unsafeStart) {
      return finding(describeTarget(startTargets[0]));
    }
    if (!["-exec", "-execdir", "-ok", "-okdir"].includes(value)) {
      continue;
    }
    const cmd: Word[] = [];
    for (i++; i < args.length && args[i].value !== ";" && args[i].value !== "+"; i++) {
      const word = args[i];
      cmd.push(
        unsafeStart && word.value.includes("{}")
          ? { ...word, value: UNRESOLVED, unresolved: true }
          : word,
      );
    }
    const hit = analyzeWords(cmd, null, depth + 1);
    if (hit) {
      return hit;
    }
  }
  return null;
}

function checkXargs(args: Word[], depth: number): StructuralFinding | null {
  const withArg = new Set(["-I", "-n", "-P", "-L", "-s", "-d", "-E", "-a"]);
  let i = 0;
  while (i < args.length && args[i].value.startsWith("-")) {
    if (args[i].value === "--") {
      i++;
      break;
    }
    i += withArg.has(args[i].value) ? 2 : 1;
  }
  const cmd = args.slice(i);
  if (cmd.length === 0) {
    return null;
  }
  const appended: Word = { value: UNRESOLVED, literal: "", unresolved: true, substitutions: [] };
  return analyzeWords([...cmd, appended], null, depth + 1);
}

function checkDiskutil(args: Word[]): StructuralFinding | null {
  const values = args.map((a) => a.value.toLowerCase()).filter((v) => !v.startsWith("-"));
  const [sub, next] = values;
  if (
    sub?.startsWith("erase") ||
    ["partitiondisk", "zerodisk", "randomdisk", "secureerase", "reformat"].includes(sub ?? "") ||
    (sub === "apfs" && /^(?:deletecontainer|erasevolume|deletevolume)$/.test(next ?? ""))
  ) {
    return { description: "erase disk (diskutil)" };
  }
  return null;
}

function analyzeInvocation(
  name: string,
  args: Word[],
  seg: Segment | null,
  depth: number,
): StructuralFinding | null {
  const values = args.map((a) => a.value);
  if (name === "rm") {
    return checkRm(args);
  }
  if (/^mkfs(?:\.[a-z0-9]+)?$/.test(name) || name === "mke2fs" || name === "wipefs") {
    return { description: "format filesystem (mkfs)" };
  }
  if (/^newfs(?:_[a-z0-9]+)?$/.test(name)) {
    return { description: "format filesystem (newfs)" };
  }
  if (name === "dd") {
    for (const arg of args) {
      if (arg.value.toLowerCase().startsWith("of=")) {
        const target = arg.value.slice(3);
        if (target.includes(UNRESOLVED)) {
          return { description: "dd to a target the floor cannot resolve" };
        }
        if (RAW_DEVICE_RE.test(target)) {
          return { description: "dd to raw block device" };
        }
      }
    }
    return null;
  }
  if (name === "diskutil") {
    return checkDiskutil(args);
  }
  if (name === "asr" && values.some((v) => /^(?:restore|restoreexact|-?-erase)$/i.test(v))) {
    return { description: "restore over a volume (asr restore)" };
  }
  if (SHUTDOWN_COMMANDS.has(name) || (name === "launchctl" && values[0] === "reboot")) {
    return { description: "system shutdown/reboot" };
  }
  if ((name === "init" || name === "telinit") && /^[06]$/.test(values[0] ?? "")) {
    return { description: "init 0/6 (shutdown/reboot)" };
  }
  if (name === "systemctl" && values.some((v) => /^(?:poweroff|reboot|halt|kexec)$/.test(v))) {
    return { description: "systemctl poweroff/reboot" };
  }
  if (name === "kill" && values.includes("-1")) {
    return { description: "kill all processes" };
  }
  if (name === "eval") {
    if (args.some((a) => a.substitutions.some((s) => DECODER_TEXT_RE.test(s)))) {
      return { description: "eval of a decoded payload" };
    }
    return analyzeCommand(args.map((a) => a.literal).join(" "), depth + 1);
  }
  if (SHELLS.has(name)) {
    return checkShell(args, seg, depth);
  }
  if (name === "su") {
    const at = values.findIndex((v) => v === "-c" || v === "--command");
    const inline = values.find((v) => v.startsWith("--command="));
    const payload = at >= 0 ? (args[at + 1]?.literal ?? "") : inline?.slice(10);
    return payload === undefined ? null : analyzeCommand(payload, depth + 1);
  }
  if (name === "busybox") {
    return analyzeWords(args, seg, depth);
  }
  if (name === "find") {
    return checkFind(args, depth);
  }
  if (name === "xargs") {
    return checkXargs(args, depth);
  }
  if (name === "git") {
    for (let i = 0; i < args.length; i++) {
      if (values[i] === "-c") {
        const pair = args[i + 1]?.literal ?? "";
        const hit = analyzeCommand(pair.slice(pair.indexOf("=") + 1).replace(/^!/, ""), depth + 1);
        if (hit) {
          return hit;
        }
      }
    }
    return null;
  }
  const payloads = interpreterPayloads(name, args);
  return payloads ? checkInterpreter(payloads, seg) : null;
}

function analyzeWords(words: Word[], seg: Segment | null, depth: number): StructuralFinding | null {
  if (depth > MAX_DEPTH) {
    return { description: NESTING_LIMIT_DESCRIPTION };
  }
  const stripped = stripWrappers(words);
  if ("split" in stripped) {
    return analyzeCommand(stripped.split, depth + 1);
  }
  const [head, ...args] = stripped.words;
  if (!head || head.unresolved) {
    return null;
  }
  return analyzeInvocation(commandName(head.value), args, seg, depth);
}

function analyzeCommand(text: string, depth: number): StructuralFinding | null {
  if (depth > MAX_DEPTH) {
    return { description: NESTING_LIMIT_DESCRIPTION };
  }
  const parsed = parseShell(text);
  for (const seg of parsed.segments) {
    if (seg.redirects.some((r) => RAW_DEVICE_RE.test(r.value))) {
      return { description: "redirect to raw block device" };
    }
    const hit = analyzeWords(seg.words, seg, depth);
    if (hit) {
      return hit;
    }
  }
  for (const inner of parsed.substitutions) {
    const hit = analyzeCommand(inner, depth + 1);
    if (hit) {
      return hit;
    }
  }
  return null;
}

/** Structural floor check over parsed shell segments; see the header comment. */
export function detectStructuralHardline(command: string): StructuralFinding | null {
  const prepared = stripAnsi(command)
    .replaceAll("\0", "")
    .normalize("NFKC")
    .replace(/\r\n?/g, "\n")
    .replace(/\$\{IFS\}|\$IFS\b/g, " ");
  return analyzeCommand(prepared, 0);
}
