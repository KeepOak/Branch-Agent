import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";

describe("branch node run pairing options", () => {
  let tempDir: string;
  let testFilePath: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "node-pair-test-"));
    testFilePath = path.join(tempDir, "code.txt");
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("warns when using deprecated --pair <code> form", async () => {
    const { stdout, stderr, exitCode } = await runNodeCommand([
      "run",
      "--pair",
      "invalid-code-for-test",
    ]);
    
    // Should emit warning about deprecated form
    const combined = stdout + stderr;
    expect(combined).toContain("deprecated and insecure");
    // Will fail because the code is invalid, but that's expected
    expect(exitCode).not.toBe(0);
  });

  it("accepts --pair-file option", async () => {
    const setupCode = "oc-pair://test-code-12345";
    fs.writeFileSync(testFilePath, setupCode, { mode: 0o600 });

    const { stdout, stderr, exitCode } = await runNodeCommand([
      "run",
      "--pair-file",
      testFilePath,
    ]);

    const combined = stdout + stderr;
    // Should not warn about deprecated form
    expect(combined).not.toContain("deprecated and insecure");
    // Will fail because code is fake, but no permission error
    expect(combined).not.toContain("unsafe permissions");
  });

  it("rejects --pair-file with unsafe permissions on POSIX", async function () {
    if (os.platform() === "win32") {
      this.skip();
    }

    const setupCode = "oc-pair://test-code-12345";
    fs.writeFileSync(testFilePath, setupCode, { mode: 0o644 });

    const { stdout, stderr, exitCode } = await runNodeCommand([
      "run",
      "--pair-file",
      testFilePath,
    ]);

    const combined = stdout + stderr;
    expect(combined).toContain("unsafe permissions");
    expect(exitCode).not.toBe(0);
  });

  it("accepts --pair-if-needed-file option", async () => {
    const setupCode = "oc-pair://test-code-67890";
    fs.writeFileSync(testFilePath, setupCode, { mode: 0o600 });

    const { stdout, stderr, exitCode } = await runNodeCommand([
      "run",
      "--pair-if-needed-file",
      testFilePath,
    ]);

    const combined = stdout + stderr;
    // Should not warn about deprecated form
    expect(combined).not.toContain("deprecated and insecure");
  });

  it("warns when using deprecated --pair-if-needed <code> form", async () => {
    const { stdout, stderr, exitCode } = await runNodeCommand([
      "run",
      "--pair-if-needed",
      "invalid-code-for-test",
    ]);

    const combined = stdout + stderr;
    expect(combined).toContain("deprecated and insecure");
    expect(exitCode).not.toBe(0);
  });
});

describe("branch graft join pairing options", () => {
  let tempDir: string;
  let testFilePath: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "graft-join-test-"));
    testFilePath = path.join(tempDir, "code.txt");
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("warns when using deprecated positional argument form", async () => {
    const { stdout, stderr, exitCode } = await runGraftCommand([
      "join",
      "invalid-code-for-test",
    ]);

    const combined = stdout + stderr;
    expect(combined).toContain("deprecated and insecure");
    expect(exitCode).not.toBe(0);
  });

  it("accepts --code-file option", async () => {
    const setupCode = "oc-pair://test-code-12345";
    fs.writeFileSync(testFilePath, setupCode, { mode: 0o600 });

    const { stdout, stderr, exitCode } = await runGraftCommand([
      "join",
      "--code-file",
      testFilePath,
    ]);

    const combined = stdout + stderr;
    // Should not warn about deprecated form
    expect(combined).not.toContain("deprecated and insecure");
  });

  it("rejects --code-file with unsafe permissions on POSIX", async function () {
    if (os.platform() === "win32") {
      this.skip();
    }

    const setupCode = "oc-pair://test-code-12345";
    fs.writeFileSync(testFilePath, setupCode, { mode: 0o644 });

    const { stdout, stderr, exitCode } = await runGraftCommand([
      "join",
      "--code-file",
      testFilePath,
    ]);

    const combined = stdout + stderr;
    expect(combined).toContain("unsafe permissions");
    expect(exitCode).not.toBe(0);
  });
});

// Helper to run node command and capture output
async function runNodeCommand(
  args: string[],
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    const child = spawn("node", ["--loader", "tsx", "src/cli/run-main.ts", "node", ...args], {
      cwd: path.resolve(__dirname, "../../"),
      env: { ...process.env, NODE_NO_WARNINGS: "1" },
      timeout: 5000,
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    child.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    child.on("close", (code) => {
      resolve({ stdout, stderr, exitCode: code ?? 1 });
    });

    child.on("error", (error) => {
      stderr += error.message;
      resolve({ stdout, stderr, exitCode: 1 });
    });

    // Kill after timeout
    setTimeout(() => {
      child.kill();
    }, 4500);
  });
}

// Helper to run graft command and capture output
async function runGraftCommand(
  args: string[],
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    const child = spawn("node", ["--loader", "tsx", "src/cli/run-main.ts", "graft", ...args], {
      cwd: path.resolve(__dirname, "../../"),
      env: { ...process.env, NODE_NO_WARNINGS: "1" },
      timeout: 5000,
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    child.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    child.on("close", (code) => {
      resolve({ stdout, stderr, exitCode: code ?? 1 });
    });

    child.on("error", (error) => {
      stderr += error.message;
      resolve({ stdout, stderr, exitCode: 1 });
    });

    // Kill after timeout
    setTimeout(() => {
      child.kill();
    }, 4500);
  });
}
