#!/usr/bin/env node

import { strict as assert } from "node:assert";
import { execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import {
  findCredentialLoggingViolations,
  includesRedaction,
  isOptedOut,
  stripStringLiterals,
} from "./check-credential-logging.mjs";

const hide = { windowsHide: true };

function git(dir, args) {
  return execSync(`git ${args}`, { cwd: dir, ...hide });
}

function createTestRepo() {
  const dir = mkdtempSync(join(tmpdir(), "credential-logging-test-"));
  git(dir, "init");
  git(dir, 'config user.email test@example.com');
  git(dir, 'config user.name Test');
  return dir;
}

function writeTracked(dir, relativePath, contents) {
  const file = join(dir, relativePath);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, contents);
  git(dir, `add ${relativePath}`);
}

function addAndCommit(dir, relativePath, contents, message = "commit") {
  writeTracked(dir, relativePath, contents);
  git(dir, `commit -m "${message}"`);
}

function scan(dir, checkAll = true) {
  return findCredentialLoggingViolations(dir, checkAll);
}

test("finds console.log(accessToken)", () => {
  const dir = createTestRepo();
  try {
    writeTracked(dir, "app.js", "console.log(accessToken);\n");
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
    writeTracked(dir, "app.ts", "logger.info({ password });\n");
    const violations = scan(dir);
    assert.strictEqual(violations.length, 1);
    assert.ok(violations[0].content.includes("password"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("finds log.info({ accessToken })", () => {
  const dir = createTestRepo();
  try {
    writeTracked(dir, "app.ts", "log.info({ accessToken });\n");
    assert.strictEqual(scan(dir).length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("finds getLogger().info({ apiKey: secret })", () => {
  const dir = createTestRepo();
  try {
    writeTracked(dir, "app.ts", "getLogger().info({ apiKey: secret });\n");
    assert.strictEqual(scan(dir).length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("finds credentials on later lines of a multi-line log call", () => {
  const dir = createTestRepo();
  try {
    writeTracked(
      dir,
      "app.ts",
      `log.info({
  accessToken: value,
});
`,
    );
    assert.strictEqual(scan(dir).length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("finds quoted object keys such as { \"password\": v }", () => {
  const dir = createTestRepo();
  try {
    writeTracked(dir, "app.ts", 'logger.info({ "password": v });\n');
    assert.strictEqual(scan(dir).length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("finds whole-identifier token", () => {
  const dir = createTestRepo();
  try {
    writeTracked(dir, "app.js", "console.log(token);\n");
    assert.strictEqual(scan(dir).length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("finds property access such as obj.sessionToken", () => {
  const dir = createTestRepo();
  try {
    writeTracked(dir, "app.js", 'console.log("data:", obj.sessionToken);\n');
    assert.strictEqual(scan(dir).length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("finds authToken and botToken identifiers", () => {
  const dir = createTestRepo();
  try {
    writeTracked(
      dir,
      "app.ts",
      `log.info({ authToken });
getLogger().warn({ bot_token: value });
`,
    );
    assert.strictEqual(scan(dir).length, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("no hit on sessionKey object or session=${sessionKey} template", () => {
  const dir = createTestRepo();
  try {
    writeTracked(
      dir,
      "app.ts",
      `log.info({ sessionKey });
console.log(\`session=\${sessionKey}\`);
`,
    );
    assert.strictEqual(scan(dir).length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("no hit on sessionId", () => {
  const dir = createTestRepo();
  try {
    writeTracked(dir, "app.js", "console.log(sessionId);\n");
    assert.strictEqual(scan(dir).length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("no hit on tokenCount", () => {
  const dir = createTestRepo();
  try {
    writeTracked(dir, "app.js", "console.log(tokenCount);\n");
    assert.strictEqual(scan(dir).length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("no hit on session.json", () => {
  const dir = createTestRepo();
  try {
    writeTracked(dir, "app.js", 'console.log("Reading session.json");\n');
    assert.strictEqual(scan(dir).length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("no hit on token used as a message word", () => {
  const dir = createTestRepo();
  try {
    writeTracked(dir, "app.js", 'console.log("token already present:", tokenFile);\n');
    assert.strictEqual(scan(dir).length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("opt-out only silences the annotated call", () => {
  const dir = createTestRepo();
  try {
    writeTracked(
      dir,
      "app.ts",
      `log.info({ token: expiresIn }); // credential-logging-allowed: expiry only
log.info({ token: value });
`,
    );
    const violations = scan(dir);
    assert.strictEqual(violations.length, 1);
    assert.ok(violations[0].content.includes("token: value"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("allows a same-line // opt-out with a reason", () => {
  const dir = createTestRepo();
  try {
    writeTracked(
      dir,
      "app.js",
      "console.log(accessToken); // credential-logging-allowed: reviewed debug dump\n",
    );
    assert.strictEqual(scan(dir).length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("allows a /* */ opt-out with a reason", () => {
  const dir = createTestRepo();
  try {
    writeTracked(
      dir,
      "app.js",
      "console.log(accessToken); /* credential-logging-allowed: reviewed debug dump */\n",
    );
    assert.strictEqual(scan(dir).length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("requires an opt-out reason", () => {
  const dir = createTestRepo();
  try {
    writeTracked(dir, "app.js", "console.log(accessToken); // credential-logging-allowed:\n");
    assert.strictEqual(scan(dir).length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("blocks opt-out text that is not in a comment", () => {
  const dir = createTestRepo();
  try {
    writeTracked(
      dir,
      "app.js",
      'console.log("credential-logging-allowed: fake", accessToken);\n',
    );
    assert.strictEqual(scan(dir).length, 1);
    assert.equal(isOptedOut('console.log("credential-logging-allowed: fake", accessToken);'), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("allows redacted logging", () => {
  const dir = createTestRepo();
  try {
    writeTracked(dir, "app.ts", "logger.info(redactSensitiveText(accessToken));\n");
    assert.strictEqual(scan(dir).length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("does not treat a redaction helper name in a string as redaction", () => {
  const dir = createTestRepo();
  try {
    writeTracked(dir, "app.ts", 'logger.info("redactSensitiveText", accessToken);\n');
    assert.strictEqual(scan(dir).length, 1);
    assert.equal(includesRedaction('logger.info("redactSensitiveText", accessToken);'), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("does not treat a redaction helper name in a comment as redaction", () => {
  const dir = createTestRepo();
  try {
    writeTracked(dir, "app.ts", "logger.info(accessToken); // redactSensitiveText\n");
    assert.strictEqual(scan(dir).length, 1);
    assert.equal(includesRedaction("logger.info(accessToken); // redactSensitiveText"), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("ignores test files", () => {
  const dir = createTestRepo();
  try {
    writeTracked(dir, "app.test.js", "console.log(accessToken);\n");
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

test("stripStringLiterals keeps interpolations and quoted keys", () => {
  assert.equal(stripStringLiterals("console.log(`hi ${accessToken}`)")?.includes("accessToken"), true);
  assert.equal(stripStringLiterals('console.log("accessToken")')?.includes("accessToken"), false);
  assert.equal(stripStringLiterals('logger.info({ "password": v })')?.includes("password"), true);
});
