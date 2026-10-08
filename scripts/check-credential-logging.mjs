#!/usr/bin/env node

// Rejects log calls that pass credential-named identifiers without a redaction helper.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CREDENTIAL_IDENTIFIERS = [
  "accessToken",
  "access_token",
  "refreshToken",
  "refresh_token",
  "idToken",
  "id_token",
  "sessionToken",
  "session_token",
  "sessionSecret",
  "session_secret",
  "apiKey",
  "api_key",
  "authToken",
  "auth_token",
  "botToken",
  "bot_token",
  "clientSecret",
  "client_secret",
  "secret",
  "password",
  "passwd",
  "authorization",
  "bearer",
  "cookie",
  "token",
];

const LOG_SEARCH_PATTERNS = [
  "console\\.(log|info|warn|error|debug)",
  "logger\\.(trace|debug|info|warn|error|fatal)",
  "(^|[^A-Za-z0-9_$])log\\.(trace|debug|info|warn|error|fatal)",
  "getLogger\\(\\)\\.(trace|debug|info|warn|error|fatal)",
];

const REDACTION_HELPERS = [
  "redactSensitiveText",
  "redactLogRecordForTransport",
  "redactSecrets",
  "redactSensitiveFieldValue",
  "redactToolPayloadText",
  "redactModelVisibleSecrets",
  "redactSensitiveLines",
  "serializeRedactedFileLogRecord",
  "redactText",
  "redactJsonRecord",
];

const GREP_EXCLUDES = [
  ":!*.test.*",
  ":!test/**",
  ":!*.spec.*",
  ":!scripts/check-credential-logging.test.mjs",
  ":!scripts/check-credential-logging.mjs",
  ":!*.min.js",
  ":!*.bundle.js",
  ":!design/**",
  ":!dist/**",
  ":!build/**",
  ":!node_modules/**",
];

const IDENTIFIER_RE = new RegExp(
  String.raw`(?:^|[^A-Za-z0-9_$])(?:${CREDENTIAL_IDENTIFIERS.join("|")})(?![A-Za-z0-9_$])`,
  "i",
);

const REDACTION_RE = new RegExp(
  String.raw`(?:^|[^A-Za-z0-9_$])(?:${REDACTION_HELPERS.join("|")})(?![A-Za-z0-9_$])`,
);

const CALL_OPEN_RE =
  /(?:getLogger\s*\(\s*\)|console|logger|(?:^|[^A-Za-z0-9_$])log)\s*\.\s*(?:trace|debug|info|warn|error|fatal|log)\s*(?:\?\.)?\s*\(/g;

const MAX_CALL_LINES = 80;
const GIT_IO = { encoding: "utf8", windowsHide: true };

function isQuote(ch) {
  return ch === "'" || ch === '"' || ch === "`";
}

function skipString(text, start) {
  const quote = text[start];
  let i = start + 1;
  let content = "";
  let interpolations = "";
  while (i < text.length) {
    if (text[i] === "\\") {
      content += text.slice(i, i + 2);
      i += 2;
      continue;
    }
    if (quote === "`" && text[i] === "$" && text[i + 1] === "{") {
      i += 2;
      let depth = 1;
      const interpStart = i;
      while (i < text.length && depth > 0) {
        if (isQuote(text[i])) {
          i = skipString(text, i).end;
          continue;
        }
        if (text[i] === "{") {
          depth += 1;
        } else if (text[i] === "}") {
          depth -= 1;
        }
        i += 1;
      }
      const inner = text.slice(interpStart, Math.max(interpStart, i - 1));
      interpolations += ` ${inner} `;
      content += ` ${inner} `;
      continue;
    }
    if (text[i] === quote) {
      return { content, interpolations, end: i + 1 };
    }
    content += text[i];
    i += 1;
  }
  return { content, interpolations, end: text.length };
}

/**
 * Drops quoted message text and comments so words like "session" or "token"
 * are ignored, while keeping quoted object keys (`{ "password": v }`) and
 * `${…}` interpolations.
 */
export function stripStringLiterals(line) {
  let out = "";
  let i = 0;
  while (i < line.length) {
    if (line[i] === "/" && line[i + 1] === "/") {
      break;
    }
    if (line[i] === "/" && line[i + 1] === "*") {
      const end = line.indexOf("*/", i + 2);
      if (end === -1) {
        break;
      }
      i = end + 2;
      continue;
    }
    if (isQuote(line[i])) {
      const skipped = skipString(line, i);
      i = skipped.end;
      let j = i;
      while (j < line.length && (line[j] === " " || line[j] === "\t")) {
        j += 1;
      }
      if (line[j] === ":") {
        out += skipped.content;
      } else {
        out += skipped.interpolations;
      }
      continue;
    }
    out += line[i];
    i += 1;
  }
  return out;
}

export function extractCommentBodies(text) {
  const bodies = [];
  let i = 0;
  while (i < text.length) {
    if (text[i] === "/" && text[i + 1] === "/") {
      const end = text.indexOf("\n", i + 2);
      bodies.push(end === -1 ? text.slice(i + 2) : text.slice(i + 2, end));
      i = end === -1 ? text.length : end;
      continue;
    }
    if (text[i] === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      if (end === -1) {
        bodies.push(text.slice(i + 2));
        break;
      }
      bodies.push(text.slice(i + 2, end));
      i = end + 2;
      continue;
    }
    if (isQuote(text[i])) {
      i = skipString(text, i).end;
      continue;
    }
    i += 1;
  }
  return bodies;
}

export function isOptedOut(content) {
  for (const body of extractCommentBodies(content)) {
    const match = body.match(/credential-logging-allowed:\s*(.+)/i);
    if (match?.[1]?.trim()) {
      return true;
    }
  }
  return false;
}

export function includesRedaction(content) {
  return REDACTION_RE.test(stripStringLiterals(content));
}

function hasCredentialIdentifier(content) {
  return IDENTIFIER_RE.test(stripStringLiterals(content));
}

function findCallOpenParen(line) {
  CALL_OPEN_RE.lastIndex = 0;
  let open = -1;
  let match;
  while ((match = CALL_OPEN_RE.exec(line))) {
    open = match.index + match[0].length - 1;
  }
  return open;
}

function collectLogCall(lines, startLine) {
  const first = lines[startLine] ?? "";
  const open = findCallOpenParen(first);
  if (open < 0) {
    return first;
  }
  let depth = 0;
  const collected = [];
  for (let lineIndex = startLine; lineIndex < lines.length && collected.length < MAX_CALL_LINES; lineIndex++) {
    const line = lines[lineIndex];
    collected.push(line);
    let i = lineIndex === startLine ? open : 0;
    while (i < line.length) {
      if (line[i] === "/" && line[i + 1] === "/") {
        break;
      }
      if (line[i] === "/" && line[i + 1] === "*") {
        const end = line.indexOf("*/", i + 2);
        if (end === -1) {
          i = line.length;
          break;
        }
        i = end + 2;
        continue;
      }
      if (isQuote(line[i])) {
        i = skipString(line, i).end;
        continue;
      }
      if (line[i] === "(" || line[i] === "{" || line[i] === "[") {
        depth += 1;
      } else if (line[i] === ")" || line[i] === "}" || line[i] === "]") {
        depth -= 1;
        if (depth === 0) {
          return collected.join("\n");
        }
      }
      i += 1;
    }
  }
  return collected.join("\n");
}

function parseGitGrepOutput(stdout) {
  const violations = [];
  const output = stdout.toString("utf8");
  for (const line of output.split("\n").filter(Boolean)) {
    const match = line.match(/^([^:]+):(\d+):(.*)$/);
    if (!match) {
      continue;
    }
    const [, filePath, lineNumber, content] = match;
    violations.push({
      filePath,
      lineNumber: Number(lineNumber),
      content: content.trim(),
    });
  }
  return violations;
}

function isExcludedPath(file) {
  return (
    /\.(test|spec)\./.test(file) ||
    file.endsWith(".min.js") ||
    file.endsWith(".bundle.js") ||
    file.startsWith("design/") ||
    file.startsWith("dist/") ||
    file.startsWith("build/") ||
    file.startsWith("node_modules/") ||
    file === "scripts/check-credential-logging.mjs" ||
    file === "scripts/check-credential-logging.test.mjs"
  );
}

function runGit(cwd, args, extra = {}) {
  return spawnSync("git", args, {
    cwd,
    ...GIT_IO,
    ...extra,
  });
}

/**
 * Changed paths versus the PR base (first parent of the merge commit, matching
 * scripts/changed-test-coverage.mjs). Override with CREDENTIAL_LOGGING_BASE.
 */
export function changedFiles(cwd = process.cwd()) {
  const base = process.env.CREDENTIAL_LOGGING_BASE || "HEAD^1";
  const result = runGit(cwd, ["diff", "--name-only", "--diff-filter=d", base, "HEAD"]);
  if (result.status !== 0) {
    const stderr = result.stderr?.trim();
    throw new Error(stderr || `git diff failed with status ${result.status ?? "unknown"}`);
  }
  return result.stdout.split("\n").map((line) => line.trim()).filter(Boolean);
}

function grepLogCalls(cwd, paths) {
  const candidates = [];
  for (const pattern of LOG_SEARCH_PATTERNS) {
    const args = ["grep", "--no-color", "-n", "-E", pattern, "--"];
    if (paths) {
      const filtered = paths.filter((file) => !isExcludedPath(file));
      if (filtered.length === 0) {
        continue;
      }
      args.push(...filtered);
    } else {
      args.push(".", ...GREP_EXCLUDES);
    }
    const result = runGit(cwd, args, { maxBuffer: 50 * 1024 * 1024 });
    if (result.status === 1) {
      continue;
    }
    if (result.status !== 0) {
      const stderr = result.stderr?.trim();
      throw new Error(stderr || `git grep failed with status ${result.status ?? "unknown"}`);
    }
    candidates.push(...parseGitGrepOutput(Buffer.from(result.stdout)));
  }
  return candidates;
}

function loadFileLines(cwd, filePath, cache) {
  if (cache.has(filePath)) {
    return cache.get(filePath);
  }
  try {
    const lines = readFileSync(path.join(cwd, filePath), "utf8").split(/\r?\n/);
    cache.set(filePath, lines);
    return lines;
  } catch {
    cache.set(filePath, null);
    return null;
  }
}

/**
 * Finds log calls whose arguments include a credential identifier that is not
 * passed through a shared redaction helper and is not opted out.
 */
export function findCredentialLoggingViolations(cwd = process.cwd(), checkAll = false) {
  const paths = checkAll ? null : changedFiles(cwd);
  const unique = new Map();
  for (const candidate of grepLogCalls(cwd, paths)) {
    const key = `${candidate.filePath}:${candidate.lineNumber}`;
    if (!unique.has(key)) {
      unique.set(key, candidate);
    }
  }

  const fileCache = new Map();
  const violations = [];
  for (const candidate of unique.values()) {
    const lines = loadFileLines(cwd, candidate.filePath, fileCache);
    const call =
      lines && candidate.lineNumber > 0
        ? collectLogCall(lines, candidate.lineNumber - 1)
        : candidate.content;
    if (isOptedOut(call)) {
      continue;
    }
    if (includesRedaction(call)) {
      continue;
    }
    if (hasCredentialIdentifier(call)) {
      violations.push({
        ...candidate,
        content: call.split("\n").map((line) => line.trim()).find(Boolean) || candidate.content,
      });
    }
  }
  return violations;
}

export async function main(argv = process.argv.slice(2), cwd = process.cwd()) {
  const checkAll = argv.includes("--all");
  const violations = findCredentialLoggingViolations(cwd, checkAll);
  if (violations.length === 0) {
    return;
  }

  console.error("Found log calls with credential identifiers without redaction:");
  console.error("");
  console.error("These calls may leak credentials. Use a redaction helper like:");
  console.error("  - redactSensitiveText()");
  console.error("  - redactLogRecordForTransport()");
  console.error("  - redactSecrets()");
  console.error("");
  console.error("Or add an opt-out comment with a reason:");
  console.error("  // credential-logging-allowed: reason");
  console.error("");
  for (const violation of violations) {
    console.error(`  ${violation.filePath}:${violation.lineNumber}`);
    console.error(`    ${violation.content}`);
  }
  process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
