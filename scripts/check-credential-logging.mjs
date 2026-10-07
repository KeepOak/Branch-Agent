#!/usr/bin/env node

// Rejects log calls that pass credential-named identifiers without a redaction helper.
import { spawnSync } from "node:child_process";
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
  "sessionKey",
  "session_key",
  "sessionSecret",
  "session_secret",
  "apiKey",
  "api_key",
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

const OPT_OUT_COMMENT_PATTERN = /credential-logging-allowed:\s*(.+)/i;

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

/**
 * Drops quoted text so words like "session" or "token" in messages are ignored,
 * while keeping `${…}` interpolations (those can hold identifiers).
 */
export function stripStringLiterals(line) {
  let out = "";
  let i = 0;
  while (i < line.length) {
    const ch = line[i];
    if (ch === "/" && line[i + 1] === "/") {
      break;
    }
    if (ch === "/" && line[i + 1] === "*") {
      const end = line.indexOf("*/", i + 2);
      if (end === -1) {
        break;
      }
      i = end + 2;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") {
      const quote = ch;
      i += 1;
      while (i < line.length) {
        if (line[i] === "\\") {
          i += 2;
          continue;
        }
        if (quote === "`" && line[i] === "$" && line[i + 1] === "{") {
          i += 2;
          let depth = 1;
          const start = i;
          while (i < line.length && depth > 0) {
            if (line[i] === "{") {
              depth += 1;
            } else if (line[i] === "}") {
              depth -= 1;
            }
            i += 1;
          }
          out += ` ${stripStringLiterals(line.slice(start, Math.max(start, i - 1)))} `;
          continue;
        }
        if (line[i] === quote) {
          i += 1;
          break;
        }
        i += 1;
      }
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
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

function isOptedOut(content) {
  const match = content.match(OPT_OUT_COMMENT_PATTERN);
  return Boolean(match?.[1]?.trim());
}

function includesRedaction(content) {
  return REDACTION_HELPERS.some((helper) => content.includes(helper));
}

function hasCredentialIdentifier(content) {
  return IDENTIFIER_RE.test(stripStringLiterals(content));
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

/**
 * Changed paths versus the PR base (first parent of the merge commit, matching
 * scripts/changed-test-coverage.mjs). Override with CREDENTIAL_LOGGING_BASE.
 */
export function changedFiles(cwd = process.cwd()) {
  const base = process.env.CREDENTIAL_LOGGING_BASE || "HEAD^1";
  const result = spawnSync("git", ["diff", "--name-only", "--diff-filter=d", base, "HEAD"], {
    cwd,
    encoding: "utf8",
  });
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
    const result = spawnSync("git", args, {
      cwd,
      encoding: "utf8",
      maxBuffer: 50 * 1024 * 1024,
    });
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

  const violations = [];
  for (const candidate of unique.values()) {
    if (isOptedOut(candidate.content)) {
      continue;
    }
    if (includesRedaction(candidate.content)) {
      continue;
    }
    if (hasCredentialIdentifier(candidate.content)) {
      violations.push(candidate);
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
