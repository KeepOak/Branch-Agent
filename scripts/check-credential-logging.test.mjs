#!/usr/bin/env node

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { findCredentialLoggingViolations } from "./check-credential-logging.mjs";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";

/**
 * Creates a temporary git repository for testing.
 */
function createTestRepo() {
  const dir = mkdtempSync(join(tmpdir(), "credential-logging-test-"));
  execSync("git init", { cwd: dir });
  execSync('git config user.email "test@example.com"', { cwd: dir });
  execSync('git config user.name "Test User"', { cwd: dir });
  return dir;
}

test("finds console.log with sessionToken", () => {
  const dir = createTestRepo();
  try {
    const file = join(dir, "test.js");
    writeFileSync(file, 'console.log("session token:", sessionToken);\n');
    execSync("git add test.js", { cwd: dir });

    const violations = findCredentialLoggingViolations(dir);
    assert.strictEqual(violations.length, 1);
    assert.strictEqual(violations[0].filePath, "test.js");
    assert.ok(violations[0].content.includes("sessionToken"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("finds logger.info with apiKey", () => {
  const dir = createTestRepo();
  try {
    const file = join(dir, "test.ts");
    writeFileSync(file, 'logger.info("key:", apiKey);\n');
    execSync("git add test.ts", { cwd: dir });

    const violations = findCredentialLoggingViolations(dir);
    assert.strictEqual(violations.length, 1);
    assert.ok(violations[0].content.includes("apiKey"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("allows opt-out with reason", () => {
  const dir = createTestRepo();
  try {
    const file = join(dir, "test.js");
    writeFileSync(
      file,
      'console.log("token file:", tokenFile); // credential-logging-allowed: file path\n',
    );
    execSync("git add test.js", { cwd: dir });

    const violations = findCredentialLoggingViolations(dir);
    assert.strictEqual(violations.length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("allows redacted logging", () => {
  const dir = createTestRepo();
  try {
    const file = join(dir, "test.ts");
    writeFileSync(file, 'logger.info("token:", redactSensitiveText(token));\n');
    execSync("git add test.ts", { cwd: dir });

    const violations = findCredentialLoggingViolations(dir);
    assert.strictEqual(violations.length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("finds multiple violations", () => {
  const dir = createTestRepo();
  try {
    const file = join(dir, "test.js");
    writeFileSync(
      file,
      `console.log("session:", session);
console.warn("password:", password);
logger.error("token:", accessToken);
`,
    );
    execSync("git add test.js", { cwd: dir });

    const violations = findCredentialLoggingViolations(dir);
    assert.strictEqual(violations.length, 3);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("ignores test files", () => {
  const dir = createTestRepo();
  try {
    const file = join(dir, "test.test.js");
    writeFileSync(file, 'console.log("token:", token);\n');
    execSync("git add test.test.js", { cwd: dir });

    const violations = findCredentialLoggingViolations(dir);
    assert.strictEqual(violations.length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("ignores check script itself", () => {
  const dir = createTestRepo();
  try {
    const file = join(dir, "scripts/check-credential-logging.mjs");
    execSync("mkdir -p scripts", { cwd: dir });
    writeFileSync(file, 'console.log("token pattern");\n');
    execSync("git add scripts/check-credential-logging.mjs", { cwd: dir });

    const violations = findCredentialLoggingViolations(dir);
    assert.strictEqual(violations.length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("requires opt-out reason", () => {
  const dir = createTestRepo();
  try {
    const file = join(dir, "test.js");
    writeFileSync(file, 'console.log("token:", token); // credential-logging-allowed:\n');
    execSync("git add test.js", { cwd: dir });

    const violations = findCredentialLoggingViolations(dir);
    assert.strictEqual(violations.length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("finds property access patterns", () => {
  const dir = createTestRepo();
  try {
    const file = join(dir, "test.js");
    writeFileSync(file, 'console.log("data:", obj.sessionToken);\n');
    execSync("git add test.js", { cwd: dir });

    const violations = findCredentialLoggingViolations(dir);
    assert.strictEqual(violations.length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
