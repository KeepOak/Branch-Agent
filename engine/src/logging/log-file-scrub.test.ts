// Tests for log file scrubbing on startup.
import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTempDirTracker } from "../../test/helpers/temp-dir.js";
import { scrubLogDirectory } from "./log-file-scrub.js";

const tempDirs = createTempDirTracker();

let logDir: string;

beforeEach(() => {
  logDir = tempDirs.make("branch-log-scrub-");
});

afterEach(() => {
  tempDirs.cleanup();
});

describe("scrubLogDirectory", () => {
  it("redacts session tokens from URLs in log files", async () => {
    const logFile = path.join(logDir, "branch-2024-10-07.log");
    const sessionToken = "sk-test-session-token-1234567890abcdef";
    const gatewayUrl = `ws://localhost:19031/api?sessionToken=${sessionToken}`;

    await fs.writeFile(
      logFile,
      [
        `{"time":"2024-10-07T12:00:00.000Z","level":"INFO","message":"Gateway listening at ${gatewayUrl}"}`,
        `{"time":"2024-10-07T12:00:01.000Z","level":"INFO","message":"Normal log line"}`,
        `{"time":"2024-10-07T12:00:02.000Z","level":"WARN","url":"${gatewayUrl}","message":"Request failed"}`,
      ].join("\n") + "\n",
      "utf8",
    );

    const result = await scrubLogDirectory(logDir);

    expect(result.scrubbedFiles).toBe(1);
    expect(result.skippedFiles).toBe(0);
    expect(result.errors).toEqual([]);

    const scrubbedContent = await fs.readFile(logFile, "utf8");
    expect(scrubbedContent).not.toContain(sessionToken);
    expect(scrubbedContent).toContain("sessionToken=***");
    expect(scrubbedContent).toContain("Normal log line");
  });

  it("redacts bearer tokens from authorization headers", async () => {
    const logFile = path.join(logDir, "branch.log");
    const bearerToken = "sk-test-bearer-token-1234567890abcdef";

    await fs.writeFile(
      logFile,
      [
        `{"time":"2024-10-07T12:00:00.000Z","level":"INFO","message":"Authorization: Bearer ${bearerToken}"}`,
        `{"time":"2024-10-07T12:00:01.000Z","headers":{"authorization":"Bearer ${bearerToken}"},"message":"Request logged"}`,
      ].join("\n") + "\n",
      "utf8",
    );

    const result = await scrubLogDirectory(logDir);

    expect(result.scrubbedFiles).toBe(1);
    const scrubbedContent = await fs.readFile(logFile, "utf8");
    expect(scrubbedContent).not.toContain(bearerToken);
    expect(scrubbedContent).toContain("Authorization: Bearer");
  });

  it("redacts access tokens and session_token from structured logs", async () => {
    const logFile = path.join(logDir, "branch-2024-10-07.log");
    const accessToken = "ya29.test-access-token-with-enough-length";
    const sessionToken = "test-session-token-1234567890";

    await fs.writeFile(
      logFile,
      [
        `{"time":"2024-10-07T12:00:00.000Z","level":"INFO","accessToken":"${accessToken}","message":"Token logged"}`,
        `{"time":"2024-10-07T12:00:01.000Z","level":"INFO","session_token":"${sessionToken}","message":"Session created"}`,
        `{"time":"2024-10-07T12:00:02.000Z","level":"INFO","token":"another-secret-token","message":"Generic token"}`,
      ].join("\n") + "\n",
      "utf8",
    );

    const result = await scrubLogDirectory(logDir);

    expect(result.scrubbedFiles).toBe(1);
    const scrubbedContent = await fs.readFile(logFile, "utf8");
    expect(scrubbedContent).not.toContain(accessToken);
    expect(scrubbedContent).not.toContain(sessionToken);
    expect(scrubbedContent).not.toContain("another-secret-token");
    expect(scrubbedContent).toContain("Token logged");
    expect(scrubbedContent).toContain("Session created");
  });

  it("skips files that are too large", async () => {
    const logFile = path.join(logDir, "branch-2024-10-07.log");
    // Create a file that reports as larger than MAX_SCRUB_FILE_SIZE
    const hugeContent = "x".repeat(210 * 1024 * 1024);
    await fs.writeFile(logFile, hugeContent, "utf8");

    const result = await scrubLogDirectory(logDir);

    expect(result.scrubbedFiles).toBe(0);
    expect(result.skippedFiles).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("exceeds limit");
  });

  it("does not modify files that have no secrets", async () => {
    const logFile = path.join(logDir, "branch-2024-10-07.log");
    const cleanContent = [
      `{"time":"2024-10-07T12:00:00.000Z","level":"INFO","message":"Normal log line"}`,
      `{"time":"2024-10-07T12:00:01.000Z","level":"INFO","message":"Another normal line"}`,
    ].join("\n") + "\n";

    await fs.writeFile(logFile, cleanContent, "utf8");
    const beforeStat = await fs.stat(logFile);

    const result = await scrubLogDirectory(logDir);

    expect(result.scrubbedFiles).toBe(0);
    expect(result.errors).toEqual([]);

    const afterContent = await fs.readFile(logFile, "utf8");
    expect(afterContent).toBe(cleanContent);
    const afterStat = await fs.stat(logFile);
    expect(afterStat.mtimeMs).toBe(beforeStat.mtimeMs);
  });

  it("handles dry run mode without modifying files", async () => {
    const logFile = path.join(logDir, "branch-2024-10-07.log");
    const secretToken = "sk-test-secret-1234567890";

    await fs.writeFile(
      logFile,
      `{"time":"2024-10-07T12:00:00.000Z","level":"INFO","token":"${secretToken}","message":"Secret"}` + "\n",
      "utf8",
    );

    const result = await scrubLogDirectory(logDir, { dryRun: true });

    expect(result.scrubbedFiles).toBe(1);
    const content = await fs.readFile(logFile, "utf8");
    expect(content).toContain(secretToken); // Should still be there in dry run
  });

  it("processes multiple log files in a directory", async () => {
    const log1 = path.join(logDir, "branch-2024-10-07.log");
    const log2 = path.join(logDir, "branch-2024-10-06.log");
    const log3 = path.join(logDir, "branch.log");
    const secret = "sk-secret-token-12345678";

    await Promise.all([
      fs.writeFile(log1, `{"token":"${secret}","message":"Log 1"}` + "\n", "utf8"),
      fs.writeFile(log2, `{"token":"${secret}","message":"Log 2"}` + "\n", "utf8"),
      fs.writeFile(log3, `{"token":"${secret}","message":"Log 3"}` + "\n", "utf8"),
    ]);

    const result = await scrubLogDirectory(logDir);

    expect(result.scrubbedFiles).toBe(3);
    expect(result.errors).toEqual([]);

    for (const logFile of [log1, log2, log3]) {
      const content = await fs.readFile(logFile, "utf8");
      expect(content).not.toContain(secret);
    }
  });

  it("continues processing after individual file errors", async () => {
    const goodLog = path.join(logDir, "branch-2024-10-07.log");
    const badLog = path.join(logDir, "branch-2024-10-06.log");
    const secret = "sk-secret-token-12345678";

    await fs.writeFile(goodLog, `{"token":"${secret}","message":"Good"}` + "\n", "utf8");
    // Create a file we can't read
    await fs.writeFile(badLog, "content", "utf8");
    await fs.chmod(badLog, 0o000);

    const result = await scrubLogDirectory(logDir);

    // Should process what it can
    expect(result.scrubbedFiles).toBeGreaterThanOrEqual(0);
    expect(result.errors.length).toBeGreaterThan(0);

    // Cleanup
    await fs.chmod(badLog, 0o644);
  });

  it("redacts API keys and passwords from config dump logs", async () => {
    const logFile = path.join(logDir, "branch-2024-10-07.log");
    const apiKey = "sk-proj-test-api-key-1234567890abcdef";
    const password = "mySecretPassword123!";

    await fs.writeFile(
      logFile,
      [
        `{"time":"2024-10-07T12:00:00.000Z","level":"INFO","config":{"apiKey":"${apiKey}"},"message":"Config loaded"}`,
        `{"time":"2024-10-07T12:00:01.000Z","level":"INFO","gateway":{"password":"${password}"},"message":"Gateway auth"}`,
      ].join("\n") + "\n",
      "utf8",
    );

    const result = await scrubLogDirectory(logDir);

    expect(result.scrubbedFiles).toBe(1);
    const scrubbedContent = await fs.readFile(logFile, "utf8");
    expect(scrubbedContent).not.toContain(apiKey);
    expect(scrubbedContent).not.toContain(password);
  });

  it("redacts tokens from URLs in various query param formats", async () => {
    const logFile = path.join(logDir, "branch-2024-10-07.log");
    const token1 = "token-value-123456";
    const token2 = "access-token-789";
    const token3 = "refresh-token-abc";

    await fs.writeFile(
      logFile,
      [
        `{"time":"2024-10-07T12:00:00.000Z","url":"https://api.example.com/callback?token=${token1}"}`,
        `{"time":"2024-10-07T12:00:01.000Z","url":"https://api.example.com/auth?access_token=${token2}&user=test"}`,
        `{"time":"2024-10-07T12:00:02.000Z","url":"https://api.example.com/refresh?refresh_token=${token3}"}`,
      ].join("\n") + "\n",
      "utf8",
    );

    const result = await scrubLogDirectory(logDir);

    expect(result.scrubbedFiles).toBe(1);
    const scrubbedContent = await fs.readFile(logFile, "utf8");
    expect(scrubbedContent).not.toContain(token1);
    expect(scrubbedContent).not.toContain(token2);
    expect(scrubbedContent).not.toContain(token3);
    expect(scrubbedContent).toContain("token=***");
    expect(scrubbedContent).toContain("access_token=***");
    expect(scrubbedContent).toContain("refresh_token=***");
  });
});
