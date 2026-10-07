#!/usr/bin/env node

// Rejects log calls that reference credential-named identifiers without using the redaction helper.
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CREDENTIAL_IDENTIFIERS = [
  "token",
  "accessToken",
  "access_token",
  "refreshToken",
  "refresh_token",
  "session",
  "sessionToken",
  "session_token",
  "cookie",
  "apiKey",
  "api_key",
  "secret",
  "password",
  "passwd",
  "authorization",
  "bearer",
];

const LOG_CALL_PATTERNS = [
  // console.* methods
  "console\\.(?:log|info|warn|error|debug)",
  // logger.* methods
  "logger\\.(?:trace|debug|info|warn|error|fatal)",
  // file log writers (common patterns)
  "fs\\.writeFile(?:Sync)?\\(",
  "fs\\.appendFile(?:Sync)?\\(",
  "createWriteStream\\(",
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

/**
 * Parses git grep output into violation records with context.
 */
function parseGitGrepOutput(stdout) {
  const violations = [];
  const output = stdout.toString("utf8");
  const lines = output.split("\n").filter(Boolean);

  for (const line of lines) {
    const match = line.match(/^([^:]+):(\d+):(.*)$/);
    if (!match) continue;

    const [, filePath, lineNumber, content] = match;
    violations.push({
      filePath,
      lineNumber: Number(lineNumber),
      content: content.trim(),
    });
  }

  return violations;
}

/**
 * Checks if a line is opted out via an inline comment.
 */
function isOptedOut(content, filePath, lineNumber, cwd) {
  const match = content.match(OPT_OUT_COMMENT_PATTERN);
  if (!match) return false;

  // Opt-out requires a reason
  const reason = match[1].trim();
  return reason.length > 0;
}

/**
 * Checks if the log call includes redaction.
 */
function includesRedaction(content) {
  return REDACTION_HELPERS.some((helper) => content.includes(helper));
}

/**
 * Uses git grep to find potential credential logging violations.
 */
export function findCredentialLoggingViolations(cwd = process.cwd()) {
  const violations = [];

  // Search for log calls separately for each pattern to avoid complex regex issues
  const searchPatterns = [
    "console\\.(log|info|warn|error|debug)",
    "logger\\.(trace|debug|info|warn|error|fatal)",
  ];

  const allCandidates = [];

  for (const pattern of searchPatterns) {
    const logCallResult = spawnSync(
      "git",
      [
        "grep",
        "--no-color",
        "-n",
        "-E",
        pattern,
        "--",
        ".",
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
      ],
      {
        cwd,
        encoding: "utf8",
        maxBuffer: 50 * 1024 * 1024,
      },
    );

    if (logCallResult.status === 1) {
      continue;
    }
    if (logCallResult.status !== 0) {
      const stderr = logCallResult.stderr?.trim();
      throw new Error(stderr || `git grep failed with status ${logCallResult.status ?? "unknown"}`);
    }

    allCandidates.push(...parseGitGrepOutput(Buffer.from(logCallResult.stdout)));
  }

  // Remove duplicates
  const uniqueCandidates = new Map();
  for (const candidate of allCandidates) {
    const key = `${candidate.filePath}:${candidate.lineNumber}`;
    if (!uniqueCandidates.has(key)) {
      uniqueCandidates.set(key, candidate);
    }
  }

  // Filter candidates that mention credential identifiers
  for (const candidate of uniqueCandidates.values()) {
    const { filePath, lineNumber, content } = candidate;

    // Skip if opted out
    if (isOptedOut(content, filePath, lineNumber, cwd)) {
      continue;
    }

    // Skip if redaction is present
    if (includesRedaction(content)) {
      continue;
    }

    // Check if line contains credential identifiers
    const hasCredentialIdentifier = CREDENTIAL_IDENTIFIERS.some((identifier) => {
      // Match identifier as whole word or property access
      const wordPattern = new RegExp(`\\b${identifier}\\b`, "i");
      const propertyPattern = new RegExp(`\\.${identifier}\\b`, "i");
      return wordPattern.test(content) || propertyPattern.test(content);
    });

    if (hasCredentialIdentifier) {
      violations.push(candidate);
    }
  }

  return violations;
}

/**
 * Runs the credential logging check.
 */
export async function main() {
  const cwd = process.cwd();
  const violations = findCredentialLoggingViolations(cwd);

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

  process.exit(1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
