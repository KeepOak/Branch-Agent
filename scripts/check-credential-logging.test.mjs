#!/usr/bin/env node

import { strict as assert } from "node:assert";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  findCredentialLoggingViolations,
  stripStringLiterals,
} from "./check-credential-logging.mjs";

function createTestRepo() {
  const dir = mkdtempSync(join(tmpdir(), "credential-logging-test-"));
  execSync("git init", { cwd: dir });
  execSync("git config user.email test@example.com", { cwd: dir });
  execSync("git config user.name Test", { cwd: dir });
  return dir;
}

function addAndCommit(dir, relativePath, contents, message = "commit") {
  const file = join(dir, relativePath);
  const parts = relativePath.split("/");
  if (parts.length > 1) {
    execSync(`mkdir -p ${parts.slice(0, -1).join("/")}`, { cwd: dir });
  }
  writeFileSync(file, contents);
  execSync(`git add ${relativePath}`, { cwd: dir });
  execSync(`git commit -m "${message}"`, { cwd: dir });
}

function scan(dir, checkAll = true) {
  return findCredentialLoggingViolations(dir, checkAll);
}

test("finds console.log(accessToken)", () => {
  const dir = createTestRepo();
  try {
    writeFileSync(join(dir, "app.js"), "console.log(accessToken);\n");
    execSync("git add app.js", { cwd: dir });
    const violations = scan(dir);
    assert.strictEqual(violations.length, 1);
    assert.ok(violations[0].content.includes("accessToken"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("finds logger.info({ password })", () => {
  const dir = createTestRepo();
  try {
    writeFileSync(join(dir, "app.ts"), "logger.info({ password });\n");
    execSync("git add app.ts", { cwd: dir });
    const violations = scan(dir);
    assert.strictEqual(violations.length, 1);
    assert.ok(violations[0].content.includes("password"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("finds whole-identifier token", () => {
  const dir = createTestRepo();
  try {
    writeFileSync(join(dir, "app.js"), "console.log(token);\n");
    execSync("git add app.js", { cwd: dir });
    assert.strictEqual(scan(dir).length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("finds property access such as obj.sessionToken", () => {
  const dir = createTestRepo();
  try {
    writeFileSync(join(dir, "app.js"), 'console.log("data:", obj.sessionToken);\n');
    execSync("git add app.js", { cwd: dir });
    assert.strictEqual(scan(dir).length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("no hit on sessionId", () => {
  const dir = createTestRepo();
  try {
    writeFileSync(join(dir, "app.js"), "console.log(sessionId);\n");
    execSync("git add app.js", { cwd: dir });
    assert.strictEqual(scan(dir).length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("no hit on tokenCount", () => {
  const dir = createTestRepo();
  try {
    writeFileSync(join(dir, "app.js"), "console.log(tokenCount);\n");
    execSync("git add app.js", { cwd: dir });
    assert.strictEqual(scan(dir).length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("no hit on session.json", () => {
  const dir = createTestRepo();
  try {
    writeFileSync(join(dir, "app.js"), 'console.log("Reading session.json");\n');
    execSync("git add app.js", { cwd: dir });
    assert.strictEqual(scan(dir).length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("no hit on token used as a message word", () => {
  const dir = createTestRepo();
  try {
    writeFileSync(join(dir, "app.js"), 'console.log("token already present:", tokenFile);\n');
    execSync("git add app.js", { cwd: dir });
    assert.strictEqual(scan(dir).length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("allows opt-out with a reason", () => {
  const dir = createTestRepo();
  try {
    writeFileSync(
      join(dir, "app.js"),
      "console.log(accessToken); // credential-logging-allowed: reviewed debug dump\n",
    );
    execSync("git add app.js", { cwd: dir });
    assert.strictEqual(scan(dir).length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("requires an opt-out reason", () => {
  const dir = createTestRepo();
  try {
    writeFileSync(join(dir, "app.js"), "console.log(accessToken); // credential-logging-allowed:\n");
    execSync("git add app.js", { cwd: dir });
    assert.strictEqual(scan(dir).length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("allows redacted logging", () => {
  const dir = createTestRepo();
  try {
    writeFileSync(join(dir, "app.ts"), "logger.info(redactSensitiveText(accessToken));\n");
    execSync("git add app.ts", { cwd: dir });
    assert.strictEqual(scan(dir).length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("ignores test files", () => {
  const dir = createTestRepo();
  try {
    writeFileSync(join(dir, "app.test.js"), "console.log(accessToken);\n");
    execSync("git add app.test.js", { cwd: dir });
    assert.strictEqual(scan(dir).length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("default scan is only changed files", () => {
  const dir = createTestRepo();
  try {
    addAndCommit(dir, "old.js", "console.log(accessToken);\n", "base");
    addAndCommit(dir, "new.js", "console.log(password);\n", "change");
    const violations = scan(dir, false);
    assert.strictEqual(violations.length, 1);
    assert.strictEqual(violations[0].filePath, "new.js");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("stripStringLiterals keeps interpolations", () => {
  assert.equal(stripStringLiterals("console.log(`hi ${accessToken}`)")?.includes("accessToken"), true);
  assert.equal(stripStringLiterals('console.log("accessToken")')?.includes("accessToken"), false);
});
