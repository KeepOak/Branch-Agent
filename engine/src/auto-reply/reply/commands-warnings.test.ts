import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  resetDiagnosticEventsForTest,
  setDiagnosticsEnabledForProcess,
} from "../../infra/diagnostic-events.js";
import {
  applyLoggingConfig,
  getChildLogger,
  getLogger,
  resetLogger,
  setLoggerOverride,
} from "../../logging/logger.js";
import {
  readRetainedWarnings,
  resetRetainedWarningsForTests,
} from "../../logging/retained-warnings.js";
import { registerSecretValueForRedaction } from "../../logging/secret-redaction-registry.js";
import { resetSecretRedactionRegistryForTest } from "../../logging/secret-redaction-registry.test-support.js";
import { createDiagnosticLogRecordCapture } from "../../logging/test-helpers/diagnostic-log-capture.js";
import type { HandleCommandsParams } from "./commands-types.js";
import { handleWarningsCommand } from "./commands-warnings.js";

const fixture = vi.hoisted(() => ({
  registry: {
    diagnostics: [] as { level: "warn" | "error" | "info"; message: string; pluginId?: string }[],
    plugins: [] as { id: string; status: "error"; error: string }[],
  },
  deliver: vi.fn(async (_input: { reply: { text: string } }) => "delivered"),
}));

vi.mock("../../logging/logger-file-transport.js", () => ({
  fileLogTransport: { enqueue: vi.fn(), flush: vi.fn(async () => {}) },
}));
vi.mock("../../plugins/runtime/gateway-request-scope.js", () => ({
  getPluginRegistryForContext: () => fixture.registry,
}));
vi.mock("./commands-private-route.js", () => ({
  buildPrivateCommandApprovalRequest: (input: unknown) => input,
  resolvePrivateCommandRouteTargets: async () => [{ channel: "telegram", to: "owner-fixture" }],
  deliverPrivateCommandReply: fixture.deliver,
}));

function params(overrides: Partial<HandleCommandsParams> = {}): HandleCommandsParams {
  return {
    cfg: {},
    ctx: {},
    command: {
      commandBodyNormalized: "/warnings",
      isAuthorizedSender: true,
      senderIsOwner: true,
      senderId: "owner-fixture",
      channel: "webchat",
    },
    isGroup: false,
    ...overrides,
  } as HandleCommandsParams;
}

beforeEach(() => {
  resetRetainedWarningsForTests();
  resetLogger();
  applyLoggingConfig({});
  setDiagnosticsEnabledForProcess(false);
  setLoggerOverride({
    level: "warn",
    file: path.join(
      tmpdir(),
      "Codex-session-files",
      "branch-feature-batch-20261003",
      "observability",
      "fixture.log",
    ),
  });
  fixture.registry.diagnostics = [];
  fixture.registry.plugins = [];
  fixture.deliver.mockClear();
});
afterEach(() => {
  resetRetainedWarningsForTests();
  resetSecretRedactionRegistryForTest();
  resetDiagnosticEventsForTest();
  resetLogger();
});

describe("/warnings production logger integration", () => {
  it("shows actual startup and child-logger warnings without telemetry being enabled", async () => {
    const capture = createDiagnosticLogRecordCapture();
    getLogger().warn("startup fixture warning");
    getChildLogger({ subsystem: "connector" }).error("runtime fixture error");
    const result = await handleWarningsCommand(params(), true);
    expect(result?.reply?.text).toContain("1 warnings, 1 errors");
    expect(result?.reply?.text).toContain("startup fixture warning");
    expect(result?.reply?.text).toContain("connector: runtime fixture error");
    await capture.flush();
    expect(capture.records).toHaveLength(0);
    capture.cleanup();
  });

  it("redacts real logger and current plugin diagnostics before displaying them", async () => {
    const secret = "fixture-warning-secret-123456789";
    registerSecretValueForRedaction(secret);
    getLogger().warn(`Authorization failed: ${secret}`);
    fixture.registry.diagnostics = [{ level: "error", pluginId: "connector", message: secret }];
    fixture.registry.plugins = [{ id: "connector", status: "error", error: secret }];
    const result = await handleWarningsCommand(params(), true);
    expect(result?.reply?.text).not.toContain(secret);
    expect(result?.reply?.text).toContain("1 warnings, 1 errors");
    expect(JSON.stringify(readRetainedWarnings())).not.toContain(secret);
  });

  it("retains structured messages and Error details with redacted stack frames", async () => {
    const secret = "fixture-structured-error-secret-123456789";
    registerSecretValueForRedaction(secret);
    getLogger().warn({ message: `structured synthetic warning detail ${secret}` });
    const error = new Error(`synthetic error detail ${secret}`);
    error.stack = `Error: synthetic error detail ${secret}\n    at ${secret}/fixture.ts:1:1`;
    getLogger().error(error);
    const result = await handleWarningsCommand(params(), true);
    expect(result?.reply?.text).toContain("structured synthetic warning detail");
    expect(result?.reply?.text).toContain("synthetic error detail");
    expect(result?.reply?.text).toContain("fixture.ts:1:1");
    expect(result?.reply?.text).not.toContain(secret);
    expect(result?.reply?.text).toContain("1 warnings, 1 errors");
    expect(JSON.stringify(readRetainedWarnings())).not.toContain(secret);
  });

  it("preserves telemetry event formatting while retaining structured warning content", async () => {
    setDiagnosticsEnabledForProcess(true);
    const capture = createDiagnosticLogRecordCapture();
    getLogger().warn({ message: "structured diagnostic fixture" });
    const result = await handleWarningsCommand(params(), true);
    expect(result?.reply?.text).toContain("structured diagnostic fixture");
    await capture.flush();
    expect(capture.records).toHaveLength(1);
    expect(capture.records[0]).toMatchObject({ type: "log.record", message: "log" });
    expect(readRetainedWarnings().diagnostics).toHaveLength(1);
    capture.cleanup();
  });

  it("routes group warnings privately and keeps warning details out of the group reply", async () => {
    getLogger().warn("private runtime fixture");
    const result = await handleWarningsCommand(params({ isGroup: true }), true);
    expect(fixture.deliver).toHaveBeenCalledOnce();
    expect(fixture.deliver.mock.calls[0]?.[0]).toMatchObject({
      reply: { text: expect.stringContaining("private runtime fixture") },
    });
    expect(result?.reply?.text).toBe("I sent the warnings to the owner privately.");
  });

  it("does not read warnings for disabled commands, unrelated commands, or non-owners", async () => {
    expect(await handleWarningsCommand(params(), false)).toBeNull();
    const unrelated = params();
    unrelated.command.commandBodyNormalized = "/warnings-extra";
    expect(await handleWarningsCommand(unrelated, true)).toBeNull();
    const denied = params();
    denied.command.senderIsOwner = false;
    const result = await handleWarningsCommand(denied, true);
    expect(result?.reply?.text).toContain("not authorized");
    expect(fixture.deliver).not.toHaveBeenCalled();
  });
});
