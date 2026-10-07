// Tests for log file scrubbing on startup.
import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTempDirTracker } from "../../test/helpers/temp-dir.js";
import {
  isRotatedOrRetiredLogName,
  resolveLogScrubDirectories,
  SCRUB_CHUNK_OVERLAP,
  SCRUB_CHUNK_SIZE,
  scrubLogDirectory,
} from "./log-file-scrub.js";

const tempDirs = createTempDirTracker();

let logDir: string;

beforeEach(() => {
  logDir = tempDirs.make("branch-log-scrub-");
});

afterEach(() => {
  vi.restoreAllMocks();
  tempDirs.cleanup();
});

async function writeLog(name: string, body: string): Promise<string> {
  const logFile = path.join(logDir, name);
  await fs.writeFile(logFile, body, "utf8");
  return logFile;
}

describe("isRotatedOrRetiredLogName", () => {
  it("matches size-rotated, syslog-rotated, and dated rolling names", () => {
    expect(isRotatedOrRetiredLogName("branch.1.log")).toBe(true);
    expect(isRotatedOrRetiredLogName("gateway.1.log")).toBe(true);
    expect(isRotatedOrRetiredLogName("background.1.log")).toBe(true);
    expect(isRotatedOrRetiredLogName("background.log.1")).toBe(true);
    expect(isRotatedOrRetiredLogName("gateway.log.1")).toBe(true);
    expect(isRotatedOrRetiredLogName("branch-2024-10-07.log")).toBe(true);
    expect(isRotatedOrRetiredLogName("branch.log")).toBe(false);
    expect(isRotatedOrRetiredLogName("gateway.log")).toBe(false);
    expect(isRotatedOrRetiredLogName("background.log")).toBe(false);
    expect(isRotatedOrRetiredLogName("desktop.log")).toBe(false);
    expect(isRotatedOrRetiredLogName("notes.txt")).toBe(false);
  });
});

describe("resolveLogScrubDirectories", () => {
  it("includes the desktop data dir and engine gateway log dir from the same helpers the apps use", () => {
    const desktopDir = tempDirs.make("branch-desktop-data-");
    const stateDir = tempDirs.make("branch-state-");
    const engineLogDir = tempDirs.make("branch-engine-logs-");
    const dirs = resolveLogScrubDirectories(engineLogDir, {
      VITEST: "true",
      BRANCH_DESKTOP_DATA: desktopDir,
      BRANCH_STATE_DIR: stateDir,
      HOME: tempDirs.make("branch-home-"),
    });
    expect(dirs.map((dir) => path.resolve(dir))).toEqual(
      expect.arrayContaining([
        path.resolve(engineLogDir),
        path.resolve(desktopDir),
        path.resolve(path.join(stateDir, "logs")),
      ]),
    );
  });
});

describe("scrubLogDirectory", () => {
  it("redacts session tokens from URLs in log files", async () => {
    const logFile = await writeLog(
      "branch-2024-10-07.log",
      [
        `{"time":"2024-10-07T12:00:00.000Z","level":"INFO","message":"Gateway listening at ws://localhost:19031/api?sessionToken=sk-test-session-token-1234567890abcdef"}`,
        `{"time":"2024-10-07T12:00:01.000Z","level":"INFO","message":"Normal log line"}`,
        `{"time":"2024-10-07T12:00:02.000Z","level":"WARN","url":"ws://localhost:19031/api?sessionToken=sk-test-session-token-1234567890abcdef","message":"Request failed"}`,
      ].join("\n") + "\n",
    );
    const sessionToken = "sk-test-session-token-1234567890abcdef";

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
    const logFile = await writeLog(
      "branch.1.log",
      [
        `{"time":"2024-10-07T12:00:00.000Z","level":"INFO","message":"Authorization: Bearer sk-test-bearer-token-1234567890abcdef"}`,
        `{"time":"2024-10-07T12:00:01.000Z","headers":{"authorization":"Bearer sk-test-bearer-token-1234567890abcdef"},"message":"Request logged"}`,
      ].join("\n") + "\n",
    );
    const bearerToken = "sk-test-bearer-token-1234567890abcdef";

    const result = await scrubLogDirectory(logDir);

    expect(result.scrubbedFiles).toBe(1);
    const scrubbedContent = await fs.readFile(logFile, "utf8");
    expect(scrubbedContent).not.toContain(bearerToken);
    expect(scrubbedContent).toContain("Authorization: Bearer");
  });

  it("redacts access tokens and session_token from structured logs", async () => {
    const logFile = await writeLog(
      "branch-2024-10-07.log",
      [
        `{"time":"2024-10-07T12:00:00.000Z","level":"INFO","accessToken":"ya29.test-access-token-with-enough-length","message":"Token logged"}`,
        `{"time":"2024-10-07T12:00:01.000Z","level":"INFO","session_token":"test-session-token-1234567890","message":"Session created"}`,
        `{"time":"2024-10-07T12:00:02.000Z","level":"INFO","token":"another-secret-token","message":"Generic token"}`,
      ].join("\n") + "\n",
    );

    const result = await scrubLogDirectory(logDir);

    expect(result.scrubbedFiles).toBe(1);
    const scrubbedContent = await fs.readFile(logFile, "utf8");
    expect(scrubbedContent).not.toContain("ya29.test-access-token-with-enough-length");
    expect(scrubbedContent).not.toContain("test-session-token-1234567890");
    expect(scrubbedContent).not.toContain("another-secret-token");
    expect(scrubbedContent).toContain("Token logged");
    expect(scrubbedContent).toContain("Session created");
  });

  it("does not modify files that have no secrets", async () => {
    const cleanContent = [
      `{"time":"2024-10-07T12:00:00.000Z","level":"INFO","message":"Normal log line"}`,
      `{"time":"2024-10-07T12:00:01.000Z","level":"INFO","message":"Another normal line"}`,
    ].join("\n") + "\n";
    const logFile = await writeLog("branch-2024-10-07.log", cleanContent);
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
    const secretToken = "sk-test-secret-1234567890";
    const logFile = await writeLog(
      "branch-2024-10-07.log",
      `{"time":"2024-10-07T12:00:00.000Z","level":"INFO","token":"${secretToken}","message":"Secret"}\n`,
    );

    const result = await scrubLogDirectory(logDir, { dryRun: true });

    expect(result.scrubbedFiles).toBe(1);
    const content = await fs.readFile(logFile, "utf8");
    expect(content).toContain(secretToken);
  });

  it("processes multiple rotated log files in a directory", async () => {
    const secret = "sk-secret-token-12345678";
    const log1 = await writeLog("branch-2024-10-07.log", `{"token":"${secret}","message":"Log 1"}\n`);
    const log2 = await writeLog("branch-2024-10-06.log", `{"token":"${secret}","message":"Log 2"}\n`);
    const log3 = await writeLog("branch.1.log", `{"token":"${secret}","message":"Log 3"}\n`);

    const result = await scrubLogDirectory(logDir);

    expect(result.scrubbedFiles).toBe(3);
    expect(result.errors).toEqual([]);

    for (const logFile of [log1, log2, log3]) {
      const content = await fs.readFile(logFile, "utf8");
      expect(content).not.toContain(secret);
    }
  });

  it("continues processing after individual file errors", async () => {
    const secret = "sk-secret-token-12345678";
    await writeLog("branch-2024-10-07.log", `{"token":"${secret}","message":"Good"}\n`);
    const badLog = await writeLog("branch-2024-10-06.log", "content");
    await fs.chmod(badLog, 0o000);

    const result = await scrubLogDirectory(logDir);

    expect(result.scrubbedFiles).toBeGreaterThanOrEqual(0);
    expect(result.errors.length).toBeGreaterThan(0);

    await fs.chmod(badLog, 0o644);
  });

  it("redacts API keys and passwords from config dump logs", async () => {
    const apiKey = "sk-proj-test-api-key-1234567890abcdef";
    const password = "mySecretPassword123!";
    const logFile = await writeLog(
      "branch-2024-10-07.log",
      [
        `{"time":"2024-10-07T12:00:00.000Z","level":"INFO","config":{"apiKey":"${apiKey}"},"message":"Config loaded"}`,
        `{"time":"2024-10-07T12:00:01.000Z","level":"INFO","gateway":{"password":"${password}"},"message":"Gateway auth"}`,
      ].join("\n") + "\n",
    );

    const result = await scrubLogDirectory(logDir);

    expect(result.scrubbedFiles).toBe(1);
    const scrubbedContent = await fs.readFile(logFile, "utf8");
    expect(scrubbedContent).not.toContain(apiKey);
    expect(scrubbedContent).not.toContain(password);
  });

  it("redacts tokens from URLs in various query param formats", async () => {
    const token1 = "token-value-123456";
    const token2 = "access-token-789";
    const token3 = "refresh-token-abc";
    const logFile = await writeLog(
      "branch-2024-10-07.log",
      [
        `{"time":"2024-10-07T12:00:00.000Z","url":"https://api.example.com/callback?token=${token1}"}`,
        `{"time":"2024-10-07T12:00:01.000Z","url":"https://api.example.com/auth?access_token=${token2}&user=test"}`,
        `{"time":"2024-10-07T12:00:02.000Z","url":"https://api.example.com/refresh?refresh_token=${token3}"}`,
      ].join("\n") + "\n",
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

  it("scrubs rotated branch.1.log copies", async () => {
    const secret = "sk-rotated-copy-token-1234567890";
    const logFile = await writeLog("branch.1.log", `{"token":"${secret}","message":"rotated copy"}\n`);

    const result = await scrubLogDirectory(logDir);

    expect(result.scrubbedFiles).toBe(1);
    expect(result.errors).toEqual([]);
    const scrubbedContent = await fs.readFile(logFile, "utf8");
    expect(scrubbedContent).not.toContain(secret);
    expect(scrubbedContent).toContain("rotated copy");
  });

  it("scrubs background.log and gateway.log rotations", async () => {
    const secret = "sk-desktop-rotated-token-1234567890";
    const background = await writeLog(
      "background.1.log",
      `{"token":"${secret}","message":"desktop background rotation"}\n`,
    );
    const gateway = await writeLog(
      "gateway.log.1",
      `{"token":"${secret}","message":"engine gateway rotation"}\n`,
    );
    const liveBackground = await writeLog(
      "background.log",
      `{"token":"${secret}","message":"live background"}\n`,
    );
    const liveGateway = await writeLog(
      "gateway.log",
      `{"token":"${secret}","message":"live gateway"}\n`,
    );

    const result = await scrubLogDirectory(logDir);

    expect(result.scrubbedFiles).toBe(2);
    expect(await fs.readFile(background, "utf8")).not.toContain(secret);
    expect(await fs.readFile(gateway, "utf8")).not.toContain(secret);
    expect(await fs.readFile(liveBackground, "utf8")).toContain(secret);
    expect(await fs.readFile(liveGateway, "utf8")).toContain(secret);
  });

  it("leaves the original intact when a crash happens before the swap", async () => {
    const secret = "sk-crash-before-swap-token-1234567890";
    const original = `{"token":"${secret}","message":"keep the original"}\n`;
    const logFile = await writeLog("branch.1.log", original);

    const result = await scrubLogDirectory(logDir, {
      beforeRename: async () => {
        throw new Error("simulated crash before swap");
      },
    });

    expect(result.scrubbedFiles).toBe(0);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(await fs.readFile(logFile, "utf8")).toBe(original);
    const leftovers = (await fs.readdir(logDir)).filter((name) => name.includes(".tmp"));
    expect(leftovers).toEqual([]);
  });

  it("does not lose appends to the active log while a rotated copy is scrubbed", async () => {
    const secret = "sk-active-race-token-1234567890";
    const active = await writeLog("branch.log", "original active line\n");
    const rotated = await writeLog("branch.1.log", `{"token":"${secret}","message":"rotated"}\n`);

    const result = await scrubLogDirectory(logDir, {
      skipFiles: [active],
      beforeRename: async () => {
        await fs.appendFile(active, "appended during scrub\n");
      },
    });

    expect(result.scrubbedFiles).toBe(1);
    expect(await fs.readFile(rotated, "utf8")).not.toContain(secret);
    expect(await fs.readFile(active, "utf8")).toBe("original active line\nappended during scrub\n");
  });

  it("streams a large rotated log without reading the whole file into memory", async () => {
    const secret = "sk-large-file-token-1234567890abcdef";
    const line = `{"token":"${secret}","message":"chunked"}\n`;
    const repeats = Math.ceil((SCRUB_CHUNK_SIZE * 3) / line.length);
    const logFile = await writeLog("branch.1.log", line.repeat(repeats));
    const readFile = vi.spyOn(fs, "readFile");

    const result = await scrubLogDirectory(logDir);

    expect(result.scrubbedFiles).toBe(1);
    expect(readFile).not.toHaveBeenCalled();
    const scrubbed = await fs.readFile(logFile, "utf8");
    expect(scrubbed).not.toContain(secret);
    expect(scrubbed).toContain("chunked");
  });

  it("redacts a token that sits across a chunk boundary", async () => {
    const secret = "sk-boundary-token-1234567890abcdef";
    const marker = `token=${secret}`;
    const prefix = "n".repeat(SCRUB_CHUNK_SIZE - Math.floor(marker.length / 2));
    const logFile = await writeLog("branch.1.log", `${prefix}${marker}\n`);

    const result = await scrubLogDirectory(logDir);

    expect(result.scrubbedFiles).toBe(1);
    const scrubbed = await fs.readFile(logFile, "utf8");
    expect(scrubbed).not.toContain(secret);
    expect(scrubbed.length).toBeGreaterThan(SCRUB_CHUNK_OVERLAP);
  });

  it("does not rewrite benign fields that only resemble secret names", async () => {
    const cleanContent =
      [
        `{"tokenCount":42,"sessionName":"office-standup","deviceName":"laptop","pairingStatus":"ready","message":"tokens remaining: 3"}`,
      ].join("\n") + "\n";
    const logFile = await writeLog("branch.1.log", cleanContent);
    const beforeStat = await fs.stat(logFile);

    const result = await scrubLogDirectory(logDir);

    expect(result.scrubbedFiles).toBe(0);
    expect(await fs.readFile(logFile, "utf8")).toBe(cleanContent);
    expect((await fs.stat(logFile)).mtimeMs).toBe(beforeStat.mtimeMs);
  });
});
