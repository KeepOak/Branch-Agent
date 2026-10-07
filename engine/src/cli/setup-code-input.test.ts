import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  readSetupCodeFromFile,
  readSetupCodeFromEnv,
  resolveSetupCode,
  warnIfSetupCodeFromArgv,
} from "./setup-code-input.js";

describe("readSetupCodeFromFile", () => {
  let tempDir: string;
  let testFilePath: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "setup-code-test-"));
    testFilePath = path.join(tempDir, "code.txt");
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("reads setup code from file with mode 0600", () => {
    const code = "test-setup-code-12345";
    fs.writeFileSync(testFilePath, code, { mode: 0o600 });
    const result = readSetupCodeFromFile(testFilePath);
    expect(result).toBe(code);
  });

  it("trims whitespace from file content", () => {
    const code = "  test-code-with-whitespace  \n";
    fs.writeFileSync(testFilePath, code, { mode: 0o600 });
    const result = readSetupCodeFromFile(testFilePath);
    expect(result).toBe("test-code-with-whitespace");
  });

  it("rejects file with group-readable permissions on POSIX", function () {
    if (os.platform() === "win32") {
      this.skip();
    }
    fs.writeFileSync(testFilePath, "code", { mode: 0o640 });
    expect(() => readSetupCodeFromFile(testFilePath)).toThrow(/unsafe permissions/);
  });

  it("rejects file with world-readable permissions on POSIX", function () {
    if (os.platform() === "win32") {
      this.skip();
    }
    fs.writeFileSync(testFilePath, "code", { mode: 0o604 });
    expect(() => readSetupCodeFromFile(testFilePath)).toThrow(/unsafe permissions/);
  });

  it("rejects file with group-writable permissions on POSIX", function () {
    if (os.platform() === "win32") {
      this.skip();
    }
    fs.writeFileSync(testFilePath, "code", { mode: 0o620 });
    expect(() => readSetupCodeFromFile(testFilePath)).toThrow(/unsafe permissions/);
  });

  it("rejects file with world-writable permissions on POSIX", function () {
    if (os.platform() === "win32") {
      this.skip();
    }
    fs.writeFileSync(testFilePath, "code", { mode: 0o602 });
    expect(() => readSetupCodeFromFile(testFilePath)).toThrow(/unsafe permissions/);
  });

  it("accepts file with mode 0400 (read-only) on POSIX", function () {
    if (os.platform() === "win32") {
      this.skip();
    }
    fs.writeFileSync(testFilePath, "code", { mode: 0o400 });
    const result = readSetupCodeFromFile(testFilePath);
    expect(result).toBe("code");
  });

  it("throws when file does not exist", () => {
    expect(() => readSetupCodeFromFile("/nonexistent/path/code.txt")).toThrow(
      /Cannot read setup code file/,
    );
  });

  it("throws when path is a directory", () => {
    expect(() => readSetupCodeFromFile(tempDir)).toThrow(/not a regular file/);
  });
});

describe("readSetupCodeFromEnv", () => {
  const originalEnv = process.env.BRANCH_PAIRING_CODE;

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.BRANCH_PAIRING_CODE = originalEnv;
    } else {
      delete process.env.BRANCH_PAIRING_CODE;
    }
  });

  it("reads setup code from environment variable", () => {
    process.env.BRANCH_PAIRING_CODE = "env-code-12345";
    const result = readSetupCodeFromEnv("BRANCH_PAIRING_CODE");
    expect(result).toBe("env-code-12345");
  });

  it("trims whitespace from env value", () => {
    process.env.BRANCH_PAIRING_CODE = "  env-code-trimmed  \n";
    const result = readSetupCodeFromEnv("BRANCH_PAIRING_CODE");
    expect(result).toBe("env-code-trimmed");
  });

  it("returns undefined when env var is not set", () => {
    delete process.env.BRANCH_PAIRING_CODE;
    const result = readSetupCodeFromEnv("BRANCH_PAIRING_CODE");
    expect(result).toBeUndefined();
  });

  it("returns undefined when env var is empty", () => {
    process.env.BRANCH_PAIRING_CODE = "";
    const result = readSetupCodeFromEnv("BRANCH_PAIRING_CODE");
    expect(result).toBeUndefined();
  });
});

describe("resolveSetupCode", () => {
  let tempDir: string;
  let testFilePath: string;
  const originalEnv = process.env.BRANCH_PAIRING_CODE;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "setup-code-test-"));
    testFilePath = path.join(tempDir, "code.txt");
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
    if (originalEnv !== undefined) {
      process.env.BRANCH_PAIRING_CODE = originalEnv;
    } else {
      delete process.env.BRANCH_PAIRING_CODE;
    }
  });

  it("prefers file over env and argv", async () => {
    fs.writeFileSync(testFilePath, "file-code", { mode: 0o600 });
    process.env.BRANCH_PAIRING_CODE = "env-code";
    const result = await resolveSetupCode({
      argv: "argv-code",
      filePath: testFilePath,
      envVar: "BRANCH_PAIRING_CODE",
      allowStdin: false,
    });
    expect(result.code).toBe("file-code");
    expect(result.source.kind).toBe("file");
  });

  it("prefers env over argv when no file", async () => {
    process.env.BRANCH_PAIRING_CODE = "env-code";
    const result = await resolveSetupCode({
      argv: "argv-code",
      envVar: "BRANCH_PAIRING_CODE",
      allowStdin: false,
    });
    expect(result.code).toBe("env-code");
    expect(result.source.kind).toBe("env");
  });

  it("uses argv when no file or env", async () => {
    delete process.env.BRANCH_PAIRING_CODE;
    const result = await resolveSetupCode({
      argv: "argv-code",
      allowStdin: false,
    });
    expect(result.code).toBe("argv-code");
    expect(result.source.kind).toBe("argv");
  });

  it("throws when no code is provided", async () => {
    delete process.env.BRANCH_PAIRING_CODE;
    await expect(
      resolveSetupCode({
        allowStdin: false,
      }),
    ).rejects.toThrow(/No setup code provided/);
  });
});

describe("warnIfSetupCodeFromArgv", () => {
  it("warns when source is argv", () => {
    const warnings: string[] = [];
    const runtime = {
      warn: (msg: string) => warnings.push(msg),
    };
    warnIfSetupCodeFromArgv({ kind: "argv", value: "code" }, runtime);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("deprecated and insecure");
  });

  it("does not warn when source is stdin", () => {
    const warnings: string[] = [];
    const runtime = {
      warn: (msg: string) => warnings.push(msg),
    };
    warnIfSetupCodeFromArgv({ kind: "stdin", value: "code" }, runtime);
    expect(warnings).toHaveLength(0);
  });

  it("does not warn when source is file", () => {
    const warnings: string[] = [];
    const runtime = {
      warn: (msg: string) => warnings.push(msg),
    };
    warnIfSetupCodeFromArgv({ kind: "file", value: "code", path: "/path/to/file" }, runtime);
    expect(warnings).toHaveLength(0);
  });

  it("does not warn when source is env", () => {
    const warnings: string[] = [];
    const runtime = {
      warn: (msg: string) => warnings.push(msg),
    };
    warnIfSetupCodeFromArgv({ kind: "env", value: "code", varName: "VAR" }, runtime);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("visible to same-user processes");
  });
});
