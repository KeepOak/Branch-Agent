import { PassThrough } from "node:stream";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  findWindowsBroadReadPrincipals,
  readSetupCodeFromEnv,
  readSetupCodeFromFile,
  readSetupCodeFromStream,
  resolveSetupCode,
  warnIfSetupCodeFromArgv,
} from "./setup-code-input.js";

describe("readSetupCodeFromStream", () => {
  it("reads a piped setup code from stdin without echoing it", async () => {
    const stream = new PassThrough();
    const pending = readSetupCodeFromStream(stream);
    stream.end("  piped-setup-code  \n");
    await expect(pending).resolves.toBe("piped-setup-code");
  });
});

describe("readSetupCodeFromFile", () => {
  let tempDir: string;
  let testFilePath: string;

  afterEach(() => {
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  function writeCodeFile(mode: number, contents = "test-setup-code-12345") {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "setup-code-test-"));
    testFilePath = path.join(tempDir, "code.txt");
    fs.writeFileSync(testFilePath, contents, { mode });
    fs.chmodSync(testFilePath, mode);
    return testFilePath;
  }

  it("reads setup code from file with mode 0600", () => {
    const filePath = writeCodeFile(0o600, "test-setup-code-12345");
    expect(readSetupCodeFromFile(filePath)).toBe("test-setup-code-12345");
  });

  it("trims whitespace from file content", () => {
    const filePath = writeCodeFile(0o600, "  test-code-with-whitespace  \n");
    expect(readSetupCodeFromFile(filePath)).toBe("test-code-with-whitespace");
  });

  it.skipIf(os.platform() === "win32")(
    "rejects file with group-readable permissions on POSIX",
    () => {
      const filePath = writeCodeFile(0o640);
      expect(() => readSetupCodeFromFile(filePath)).toThrow(/unsafe permissions/);
    },
  );

  it.skipIf(os.platform() === "win32")(
    "rejects file with world-readable permissions on POSIX",
    () => {
      const filePath = writeCodeFile(0o604);
      expect(() => readSetupCodeFromFile(filePath)).toThrow(/unsafe permissions/);
    },
  );

  it.skipIf(os.platform() === "win32")(
    "rejects file with group-writable permissions on POSIX",
    () => {
      const filePath = writeCodeFile(0o620);
      expect(() => readSetupCodeFromFile(filePath)).toThrow(/unsafe permissions/);
    },
  );

  it.skipIf(os.platform() === "win32")(
    "rejects file with world-writable permissions on POSIX",
    () => {
      const filePath = writeCodeFile(0o602);
      expect(() => readSetupCodeFromFile(filePath)).toThrow(/unsafe permissions/);
    },
  );

  it.skipIf(os.platform() === "win32")(
    "accepts file with mode 0400 (read-only) on POSIX",
    () => {
      const filePath = writeCodeFile(0o400, "code");
      expect(readSetupCodeFromFile(filePath)).toBe("code");
    },
  );

  it("throws when file does not exist", () => {
    expect(() => readSetupCodeFromFile("/nonexistent/path/code.txt")).toThrow(
      /Cannot read setup code file/,
    );
  });

  it("throws when path is a directory", () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "setup-code-test-"));
    expect(() => readSetupCodeFromFile(tempDir)).toThrow(/not a regular file/);
  });
});

describe("findWindowsBroadReadPrincipals", () => {
  it("ignores inherited SYSTEM and Administrators entries", () => {
    expect(
      findWindowsBroadReadPrincipals(
        "C:\\code.txt NT AUTHORITY\\SYSTEM:(F)\n                BUILTIN\\Administrators:(F)\n                DESKTOP\\owner:(F)\n",
      ),
    ).toEqual([]);
  });

  it("detects Everyone, Users, Authenticated Users, and Guest", () => {
    expect(
      findWindowsBroadReadPrincipals(
        "C:\\code.txt Everyone:(R)\n                BUILTIN\\Users:(R)\n                NT AUTHORITY\\Authenticated Users:(R)\n                Guest:(R)\n",
      ),
    ).toEqual(["everyone", "builtin\\users", "nt authority\\authenticated users", "guest"]);
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
    expect(readSetupCodeFromEnv("BRANCH_PAIRING_CODE")).toBe("env-code-12345");
  });

  it("trims whitespace from env value", () => {
    process.env.BRANCH_PAIRING_CODE = "  env-code-trimmed  \n";
    expect(readSetupCodeFromEnv("BRANCH_PAIRING_CODE")).toBe("env-code-trimmed");
  });

  it("returns undefined when env var is not set", () => {
    delete process.env.BRANCH_PAIRING_CODE;
    expect(readSetupCodeFromEnv("BRANCH_PAIRING_CODE")).toBeUndefined();
  });

  it("returns undefined when env var is empty", () => {
    process.env.BRANCH_PAIRING_CODE = "";
    expect(readSetupCodeFromEnv("BRANCH_PAIRING_CODE")).toBeUndefined();
  });
});

describe("resolveSetupCode", () => {
  let tempDir: string;
  let testFilePath: string;
  const originalEnv = process.env.BRANCH_PAIRING_CODE;

  afterEach(() => {
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
    if (originalEnv !== undefined) {
      process.env.BRANCH_PAIRING_CODE = originalEnv;
    } else {
      delete process.env.BRANCH_PAIRING_CODE;
    }
  });

  it("prefers file over env and argv", async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "setup-code-test-"));
    testFilePath = path.join(tempDir, "code.txt");
    fs.writeFileSync(testFilePath, "file-code", { mode: 0o600 });
    fs.chmodSync(testFilePath, 0o600);
    process.env.BRANCH_PAIRING_CODE = "env-code";
    const result = await resolveSetupCode({
      argv: "argv-code",
      filePath: testFilePath,
      envVar: "BRANCH_PAIRING_CODE",
      allowStdin: false,
    });
    expect(result.code).toBe("file-code");
    expect(result.source).toEqual({ kind: "file", path: testFilePath });
  });

  it("prefers env over argv when no file", async () => {
    process.env.BRANCH_PAIRING_CODE = "env-code";
    const result = await resolveSetupCode({
      argv: "argv-code",
      envVar: "BRANCH_PAIRING_CODE",
      allowStdin: false,
    });
    expect(result.code).toBe("env-code");
    expect(result.source).toEqual({ kind: "env", varName: "BRANCH_PAIRING_CODE" });
  });

  it("uses argv when no file or env", async () => {
    delete process.env.BRANCH_PAIRING_CODE;
    const result = await resolveSetupCode({
      argv: "argv-code",
      allowStdin: false,
    });
    expect(result.code).toBe("argv-code");
    expect(result.source).toEqual({ kind: "argv" });
  });

  it("throws when no code is provided", async () => {
    delete process.env.BRANCH_PAIRING_CODE;
    await expect(resolveSetupCode({ allowStdin: false })).rejects.toThrow(/No setup code provided/);
  });
});

describe("warnIfSetupCodeFromArgv", () => {
  it("warns when source is argv without echoing the code", () => {
    const logs: string[] = [];
    warnIfSetupCodeFromArgv({ kind: "argv" }, { log: (msg) => logs.push(msg) });
    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain("deprecated and insecure");
    expect(logs[0]).not.toContain("secret-code");
  });

  it("does not warn when source is stdin", () => {
    const logs: string[] = [];
    warnIfSetupCodeFromArgv({ kind: "stdin" }, { log: (msg) => logs.push(msg) });
    expect(logs).toHaveLength(0);
  });

  it("does not warn when source is file", () => {
    const logs: string[] = [];
    warnIfSetupCodeFromArgv({ kind: "file", path: "/path/to/file" }, { log: (msg) => logs.push(msg) });
    expect(logs).toHaveLength(0);
  });

  it("warns that the env var is visible to same-user processes", () => {
    const logs: string[] = [];
    warnIfSetupCodeFromArgv({ kind: "env", varName: "BRANCH_PAIRING_CODE" }, { log: (msg) => logs.push(msg) });
    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain("visible to same-user processes");
    expect(logs[0]).toContain("fallback for non-interactive automation");
  });
});
