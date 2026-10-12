// google-gemini/gemini-cli@c6bccb7ecbf6d8368d995455dd725ed34466faad:packages/core/src/utils/untrustedContextTracker.ts (atlas SAFETY-0054)
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { parse as shellParse } from "shell-quote";
import type { ExecAutoReviewTranscript } from "../infra/exec-auto-review.js";

export interface UntrustedContextData {
  untrustedTexts: string[];
  untrustedTokens: Set<string>;
}

/** The parts of a conversation message that can carry untrusted content. */
export interface UntrustedHistoryPart {
  text?: string;
  functionResponse?: { name?: string; response?: unknown };
}

export interface UntrustedHistoryMessage {
  role?: string;
  parts?: UntrustedHistoryPart[];
}

interface LogResponse {
  output?: unknown;
  content?: unknown;
}

const UNTRUSTED_CONTEXT_REGEX = /<untrusted_context[^>]*>([\s\S]*?)<\/untrusted_context>/gi;

// Branch wraps outside content in these boundary markers
// (engine/src/security/external-content.ts); they mark the same untrusted data.
const EXTERNAL_UNTRUSTED_CONTENT_REGEX =
  /<<<EXTERNAL_UNTRUSTED_CONTENT(?:\s+id="[^"]*")?>>>([\s\S]*?)<<<END_EXTERNAL_UNTRUSTED_CONTENT(?:\s+id="[^"]*")?>>>/g;

/**
 * Root commands that invoke build engines, test runners, or dependency lifecycles.
 */
export const BUILD_TEST_COMMAND_ROOTS: ReadonlySet<string> = new Set([
  "blaze",
  "bazel",
  "build_cleaner",
  "make",
  "cmake",
  "ninja",
  "npm",
  "npx",
  "yarn",
  "pnpm",
  "bun",
  "cargo",
  "mvn",
  "gradle",
  "gradlew",
  "./gradlew",
  "pytest",
  "python",
  "python3",
  "go",
]);

/**
 * Common, benign subcommands or tokens that should not trigger untrusted flag detection
 * on their own unless paired with explicit flags or non-standard arguments.
 */
const BENIGN_SUBCOMMAND_TOKENS: ReadonlySet<string> = new Set([
  "test",
  "build",
  "run",
  "exec",
  "compile",
  "install",
  "add",
  "update",
  "upgrade",
  "remove",
  "uninstall",
  "clean",
  "format",
  "lint",
  "check",
  "typecheck",
  "start",
  "stop",
  "restart",
  "status",
]);

function partSearchText(part: UntrustedHistoryPart): string {
  // Find untrusted content in either text parts or tool response parts
  if (part.text) {
    return part.text;
  }
  const response = part.functionResponse?.response;
  if (!response || typeof response !== "object") {
    return "";
  }
  const responseObj = response as LogResponse;
  if (typeof responseObj.output === "string") {
    return responseObj.output;
  }
  return typeof responseObj.content === "string" ? responseObj.content : "";
}

function untrustedBlocks(text: string): string[] {
  const blocks: string[] = [];
  for (const regex of [UNTRUSTED_CONTEXT_REGEX, EXTERNAL_UNTRUSTED_CONTENT_REGEX]) {
    for (const match of text.matchAll(regex)) {
      const content = match[1]?.trim();
      if (content) {
        blocks.push(content);
      }
    }
  }
  return blocks;
}

function addWithoutFlagPrefix(tokens: Set<string>, token: string): void {
  // Also index without common flag prefixes so we can match '--flag' against 'flag'
  if (token.startsWith("--")) {
    tokens.add(token.slice(2));
  } else if (token.startsWith("-")) {
    tokens.add(token.slice(1));
  }
}

function indexUntrustedToken(tokens: Set<string>, token: string): void {
  const lowerToken = token.toLowerCase();
  tokens.add(lowerToken);
  addWithoutFlagPrefix(tokens, lowerToken);
  // Split on equals to handle key-value pairs
  if (lowerToken.includes("=")) {
    for (const eqPart of lowerToken.split("=")) {
      const trimmedPart = eqPart.trim();
      if (trimmedPart.length > 1) {
        tokens.add(trimmedPart);
        addWithoutFlagPrefix(tokens, trimmedPart);
      }
    }
  }
  // Split on slashes to handle path segments and filenames
  if (lowerToken.includes("/")) {
    for (const part of lowerToken.split("/")) {
      const trimmedPart = part.trim();
      if (trimmedPart.length > 1) {
        tokens.add(trimmedPart);
      }
    }
  }
}

function indexUntrustedText(data: UntrustedContextData, untrustedContent: string): void {
  const normalizedContent = untrustedContent.replace(/\\/g, "/");
  data.untrustedTexts.push(normalizedContent);
  // Tokenize the untrusted text to index specific words/flags
  const tokens = normalizedContent
    .split(/[\s,`"';()|&[\]{}<>]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 1) // Ignore single-character words/punctuation
    .filter((t) => !BENIGN_SUBCOMMAND_TOKENS.has(t.toLowerCase()));
  for (const token of tokens) {
    indexUntrustedToken(data.untrustedTokens, token);
  }
}

/**
 * Extracts and indices all text and individual tokens contained within
 * <untrusted_context> tags (and Branch's external-content markers) across the
 * conversation history.
 *
 * @param history The conversation messages history.
 * @returns Struct containing extracted texts and a set of lowercased tokens.
 */
export function extractUntrustedContext(
  history: readonly UntrustedHistoryMessage[],
): UntrustedContextData {
  const data: UntrustedContextData = { untrustedTexts: [], untrustedTokens: new Set<string>() };
  if (!history || history.length === 0) {
    return data;
  }
  for (const message of history) {
    for (const part of message.parts ?? []) {
      const contentToSearch = partSearchText(part);
      if (!contentToSearch) {
        continue;
      }
      for (const block of untrustedBlocks(contentToSearch)) {
        indexUntrustedText(data, block);
      }
    }
  }
  return data;
}

type ShellParseEntry = ReturnType<typeof shellParse>[number];

function parseCommandTokens(command: string): string[] {
  // Parse the command safely using shell-quote to handle quotes and escapes correctly
  let parsed: ShellParseEntry[];
  try {
    const normalizedCommand =
      process.platform === "win32" ? command.replace(/\\(?!")/g, "/") : command;
    parsed = shellParse(normalizedCommand);
  } catch {
    // Fallback to whitespace split if parsing fails
    parsed = command.trim().split(/\s+/);
  }
  return parsed
    .flatMap((x) => {
      if (typeof x === "string") {
        return [x];
      }
      if (x && typeof x === "object") {
        const tokens: string[] = [];
        if ("pattern" in x && typeof x.pattern === "string") {
          tokens.push(x.pattern);
        }
        if ("file" in x && typeof x.file === "string") {
          tokens.push(x.file);
        }
        return tokens;
      }
      return [];
    })
    .filter(Boolean);
}

function checkFlagToken(
  token: string,
  nextToken: string | undefined,
  untrustedContext: UntrustedContextData,
  detected: Set<string>,
): void {
  const lowerToken = token.toLowerCase();
  let flagToCheck = lowerToken;
  let valToCheck: string | undefined;
  if (token.includes("=")) {
    const eqIdx = lowerToken.indexOf("=");
    flagToCheck = lowerToken.slice(0, eqIdx);
    valToCheck = lowerToken.slice(eqIdx + 1);
  }
  // Check if full flag or flag name exists in untrusted tokens
  const tokens = untrustedContext.untrustedTokens;
  if (tokens.has(lowerToken) || tokens.has(flagToCheck)) {
    detected.add(token);
    return;
  }
  // If the flag has a value, check if that value exists in untrusted tokens
  if (valToCheck && tokens.has(valToCheck)) {
    detected.add(token);
    return;
  }
  // Check if the next token is an argument for this flag and exists in untrusted tokens
  if (nextToken && !nextToken.startsWith("-") && tokens.has(nextToken.toLowerCase())) {
    detected.add(token);
    detected.add(nextToken);
  }
}

function isHighRiskPattern(token: string): boolean {
  return (
    token.startsWith("http://") ||
    token.startsWith("https://") ||
    token.startsWith("/") ||
    token.startsWith("\\") ||
    /^[a-zA-Z]:[\\/]/.test(token)
  );
}

function checkArgumentToken(
  token: string,
  untrustedContext: UntrustedContextData,
  detected: Set<string>,
): void {
  // Non-flag arguments. Check if the token is a sensitive value
  // (e.g., file paths, URLs, command strings) that is sourced from untrusted context.
  // We only flag it if the token is exactly present as a word/token in the untrusted index
  // OR if it is a substantial substring of any unsegmented untrusted text block.
  if (token.length <= 1) {
    return;
  }
  const isSensitiveWord = token.includes("/") || token.includes(".") || token.includes(":");
  if (!isSensitiveWord) {
    return;
  }
  const lowerToken = token.toLowerCase();
  if (untrustedContext.untrustedTokens.has(lowerToken)) {
    detected.add(token);
    return;
  }
  if (isHighRiskPattern(token)) {
    const normalizedLowerToken = lowerToken.replace(/\\/g, "/");
    if (
      untrustedContext.untrustedTexts.some((text) =>
        text.toLowerCase().includes(normalizedLowerToken),
      )
    ) {
      detected.add(token);
    }
  }
}

/**
 * Inspects a shell command to identify flags or sensitive arguments that were
 * sourced directly from untrusted text in the conversation history.
 *
 * @param command The shell command string.
 * @param untrustedContext The extracted untrusted context data.
 * @returns An array of detected flags or arguments sourced from untrusted text.
 */
export function findUntrustedFlags(
  command: string,
  untrustedContext: UntrustedContextData,
): string[] {
  if (
    !command ||
    untrustedContext.untrustedTexts.length === 0 ||
    untrustedContext.untrustedTokens.size === 0
  ) {
    return [];
  }
  const detected = new Set<string>();
  const rawTokens = parseCommandTokens(command);
  rawTokens.forEach((token, i) => {
    // Check 1: Flags (starting with '-' or '--'); check 2: other arguments
    if (token.startsWith("-")) {
      checkFlagToken(token, rawTokens[i + 1], untrustedContext, detected);
    } else {
      checkArgumentToken(token, untrustedContext, detected);
    }
  });
  return Array.from(detected);
}

const COMMAND_SEPARATOR_OPS: ReadonlySet<string> = new Set(["&&", "||", "|", "|&", ";", "&"]);
const COMMAND_PREFIXES: ReadonlySet<string> = new Set(["sudo", "env", "time"]);

/**
 * Returns the root executable of each command in a chained or piped command line.
 * Stands in for gemini-cli's tree-sitter getCommandRoots (shell-utils.ts).
 */
export function getCommandRoots(command: string): string[] {
  const roots: string[] = [];
  let expectRoot = true;
  for (const entry of shellParse(command)) {
    if (typeof entry === "object" && entry !== null && "op" in entry) {
      expectRoot = COMMAND_SEPARATOR_OPS.has(entry.op);
      continue;
    }
    if (!expectRoot || typeof entry !== "string") {
      continue;
    }
    if (entry.includes("=") || COMMAND_PREFIXES.has(entry.toLowerCase())) {
      continue;
    }
    roots.push(entry);
    expectRoot = false;
  }
  return roots;
}

function commandBaseName(cmd: string): string {
  const base = cmd.replace(/\\/g, "/").split("/").pop();
  if (!base) {
    return cmd.toLowerCase();
  }
  return base.toLowerCase().replace(/\.(exe|cmd|bat)$/, "");
}

function isBuildOrTestRoot(root: string): boolean {
  return (
    BUILD_TEST_COMMAND_ROOTS.has(commandBaseName(root)) ||
    BUILD_TEST_COMMAND_ROOTS.has(root.toLowerCase())
  );
}

/**
 * Checks whether a command invokes a build tool, test harness, or compilation engine.
 *
 * @param command The shell command string.
 * @returns True if the command is a build or test tool.
 */
export function isBuildOrTestCommand(command: string): boolean {
  if (!command) {
    return false;
  }
  try {
    const roots = getCommandRoots(command);
    if (roots.length > 0) {
      return roots.some(isBuildOrTestRoot);
    }
  } catch {
    // Ignore and fallback
  }
  // Fallback if parsing fails or returns empty roots
  const root = command
    .trim()
    .split(/\s+/)
    .find((part) => !part.includes("=") && !COMMAND_PREFIXES.has(part.toLowerCase()));
  return root ? isBuildOrTestRoot(root) : false;
}

const MODIFIED_BUILD_FILES_SYMBOL = Symbol("sessionModifiedBuildFiles");

interface SessionRecord {
  [MODIFIED_BUILD_FILES_SYMBOL]?: Set<string>;
}

function hasSessionRecord(sessionKey: object): sessionKey is SessionRecord {
  return typeof sessionKey === "object" && sessionKey !== null;
}

/**
 * Records that a build configuration file was modified in this session.
 */
export function recordModifiedBuildFile(filePath: string, sessionKey: object): void {
  if (hasSessionRecord(sessionKey)) {
    let files = sessionKey[MODIFIED_BUILD_FILES_SYMBOL];
    if (!files) {
      files = new Set<string>();
      sessionKey[MODIFIED_BUILD_FILES_SYMBOL] = files;
    }
    files.add(filePath);
  }
}

/**
 * Returns all build configuration files that were modified in this session.
 */
export function getModifiedBuildFiles(sessionKey: object): string[] {
  if (hasSessionRecord(sessionKey)) {
    const files = sessionKey[MODIFIED_BUILD_FILES_SYMBOL];
    return files ? Array.from(files) : [];
  }
  return [];
}

/**
 * Resets the tracked modified build files (primarily for testing or session reset).
 */
export function resetModifiedBuildFiles(sessionKey: object): void {
  if (hasSessionRecord(sessionKey)) {
    delete sessionKey[MODIFIED_BUILD_FILES_SYMBOL];
  }
}

/**
 * Flags and arguments of an exec command that came from untrusted content in the
 * session transcript (Branch's exec review transcript; atlas SAFETY-0054).
 */
export function findUntrustedFlagsInTranscript(
  command: string,
  transcript: ExecAutoReviewTranscript | undefined,
): string[] {
  if (!transcript || transcript.entries.length === 0) {
    return [];
  }
  const history: UntrustedHistoryMessage[] = transcript.entries.map((entry) => ({
    role: entry.kind,
    parts: [{ text: entry.text }],
  }));
  return findUntrustedFlags(command, extractUntrustedContext(history));
}
