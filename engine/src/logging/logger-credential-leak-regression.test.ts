// Regression tests to prevent credential leakage to logs.
// These tests verify that tokens, API keys, and other secrets are never written to log files.
import fs from "node:fs";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { resetDiagnosticEventsForTest } from "../infra/diagnostic-events.js";
import { createSuiteLogPathTracker } from "./log-test-helpers.js";
import { getChildLogger, getLogger, resetLogger, setLoggerOverride } from "./logger.js";
import { testApi as loggerTest } from "./logger.test-support.js";

const logPathTracker = createSuiteLogPathTracker("branch-log-leak-regression-");

async function readLogFile(logPath: string): Promise<string> {
  await loggerTest.flushFileLogQueueForTests();
  return fs.readFileSync(logPath, "utf8");
}

beforeAll(async () => {
  await logPathTracker.setup();
});

beforeEach(() => {
  resetDiagnosticEventsForTest();
});

afterEach(() => {
  resetDiagnosticEventsForTest();
  resetLogger();
  setLoggerOverride(null);
});

afterAll(async () => {
  await logPathTracker.cleanup();
});

describe("credential leakage regression tests", () => {
  it("MUST NOT log sessionToken values in plain text", async () => {
    const logPath = logPathTracker.nextPath();
    setLoggerOverride({ level: "info", file: logPath });

    const sessionToken = "sk-test-session-token-1234567890abcdef";

    // Simulate various ways a sessionToken might be logged
    getLogger().info({ sessionToken }, "Session created");
    getLogger().info({ session_token: sessionToken }, "Session with underscore");
    getLogger().info(`Gateway URL: ws://localhost:19031?sessionToken=${sessionToken}`);

    const content = await readLogFile(logPath);

    // These assertions MUST pass - if they fail, credentials are leaking
    expect(content).not.toContain(sessionToken);
    expect(content).toContain("Session created");
    expect(content).toContain("sessionToken");
    expect(content).toContain("***");
  });

  it("MUST NOT log bearer tokens in authorization headers", async () => {
    const logPath = logPathTracker.nextPath();
    setLoggerOverride({ level: "info", file: logPath });

    const bearerToken = "sk-test-bearer-token-1234567890abcdef";

    getLogger().info(`Authorization: Bearer ${bearerToken}`);
    getLogger().info({ headers: { authorization: `Bearer ${bearerToken}` } }, "Request headers");

    const content = await readLogFile(logPath);

    expect(content).not.toContain(bearerToken);
    expect(content).toContain("Authorization: Bearer");
  });

  it("MUST NOT log access_token or refresh_token values", async () => {
    const logPath = logPathTracker.nextPath();
    setLoggerOverride({ level: "info", file: logPath });

    const accessToken = "ya29.test-access-token-with-enough-length";
    const refreshToken = "1//test-refresh-token-with-enough-length";

    getLogger().info({ accessToken, refreshToken }, "OAuth tokens received");
    getLogger().info({ access_token: accessToken, refresh_token: refreshToken });

    const content = await readLogFile(logPath);

    expect(content).not.toContain(accessToken);
    expect(content).not.toContain(refreshToken);
  });

  it("MUST NOT log API keys from structured objects", async () => {
    const logPath = logPathTracker.nextPath();
    setLoggerOverride({ level: "info", file: logPath });

    const apiKey = "sk-proj-test-api-key-1234567890abcdef";

    getLogger().info({ apiKey }, "API key configured");
    getLogger().info({ api_key: apiKey }, "API key underscore");
    getLogger().info({ config: { apiKey } }, "Nested API key");

    const content = await readLogFile(logPath);

    expect(content).not.toContain(apiKey);
    expect(content).toContain("API key");
  });

  it("MUST NOT log passwords in any format", async () => {
    const logPath = logPathTracker.nextPath();
    setLoggerOverride({ level: "info", file: logPath });

    const password = "mySecretPassword123!";

    getLogger().info({ password }, "Password set");
    getLogger().info({ passwd: password }, "Password with passwd field");
    getLogger().info(`Connection string: postgres://user:${password}@localhost`);

    const content = await readLogFile(logPath);

    expect(content).not.toContain(password);
    expect(content).toContain("Password");
  });

  it("MUST NOT log tokens in URL query parameters", async () => {
    const logPath = logPathTracker.nextPath();
    setLoggerOverride({ level: "info", file: logPath });

    const token = "test-token-1234567890";
    const urls = [
      `https://api.example.com/callback?token=${token}`,
      `https://api.example.com/auth?access_token=${token}&user=test`,
      `https://api.example.com/api?api_key=${token}`,
      `ws://localhost:19031?sessionToken=${token}`,
    ];

    for (const url of urls) {
      getLogger().info({ url }, "Request URL");
    }

    const content = await readLogFile(logPath);

    expect(content).not.toContain(token);
    expect(content).toContain("token=***");
    expect(content).toContain("access_token=***");
    expect(content).toContain("api_key=***");
    expect(content).toContain("sessionToken=***");
  });

  it("MUST NOT log credentials in nested objects", async () => {
    const logPath = logPathTracker.nextPath();
    setLoggerOverride({ level: "info", file: logPath });

    const secret = "secret-value-1234567890";

    getLogger().info(
      {
        config: {
          auth: {
            token: secret,
            apiKey: secret,
          },
        },
      },
      "Nested config",
    );

    const content = await readLogFile(logPath);

    expect(content).not.toContain(secret);
  });

  it("MUST NOT log session tokens in error messages", async () => {
    const logPath = logPathTracker.nextPath();
    setLoggerOverride({ level: "error", file: logPath });

    const sessionToken = "sk-session-error-token-1234567890";

    getLogger().error(
      new Error(`Authentication failed with token: ${sessionToken}`),
      "Auth error",
    );
    getLogger().error(
      { error: { message: `Token ${sessionToken} is invalid` } },
      "Validation error",
    );

    const content = await readLogFile(logPath);

    expect(content).not.toContain(sessionToken);
  });

  it("MUST NOT log credentials in structured error objects", async () => {
    const logPath = logPathTracker.nextPath();
    setLoggerOverride({ level: "error", file: logPath });

    const apiKey = "sk-error-api-key-1234567890";

    const error = Object.assign(new Error("API request failed"), {
      apiKey,
      request: {
        headers: {
          authorization: `Bearer ${apiKey}`,
        },
      },
    });

    getLogger().error({ error }, "Request failed with error");

    const content = await readLogFile(logPath);

    expect(content).not.toContain(apiKey);
  });

  it("MUST NOT log device tokens or pairing credentials", async () => {
    const logPath = logPathTracker.nextPath();
    setLoggerOverride({ level: "info", file: logPath });

    const deviceToken = "device-token-1234567890abcdef";
    const pairingToken = "pairing-token-1234567890abcdef";

    getLogger().info({ deviceToken, pairingToken }, "Device paired");

    const content = await readLogFile(logPath);

    expect(content).not.toContain(deviceToken);
    expect(content).not.toContain(pairingToken);
  });

  it("MUST NOT log oc-pair setup codes", async () => {
    const logPath = logPathTracker.nextPath();
    setLoggerOverride({ level: "info", file: logPath });

    const setupCode = "AbC_setupCodeExample123";
    getLogger().info(`pair with oc-pair://${setupCode}`);

    const content = await readLogFile(logPath);

    expect(content).not.toContain(setupCode);
    expect(content).toContain("oc-pair://");
  });

  it("MUST redact tokens even in long messages", async () => {
    const logPath = logPathTracker.nextPath();
    setLoggerOverride({ level: "info", file: logPath });

    const token = "long-message-token-1234567890";
    const longMessage = "x".repeat(1000) + ` token=${token} ` + "y".repeat(1000);

    getLogger().info(longMessage);

    const content = await readLogFile(logPath);

    expect(content).not.toContain(token);
  });

  it("MUST redact multiple different token types in same log entry", async () => {
    const logPath = logPathTracker.nextPath();
    setLoggerOverride({ level: "info", file: logPath });

    const apiKey = "sk-api-key-1234567890";
    const sessionToken = "session-token-1234567890";
    const refreshToken = "refresh-token-1234567890";

    getLogger().info(
      {
        apiKey,
        sessionToken,
        refreshToken,
        message: `API: ${apiKey}, Session: ${sessionToken}`,
      },
      "Multiple credentials",
    );

    const content = await readLogFile(logPath);

    expect(content).not.toContain(apiKey);
    expect(content).not.toContain(sessionToken);
    expect(content).not.toContain(refreshToken);
  });
});
