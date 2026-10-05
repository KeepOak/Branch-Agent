// Verifies startup recovery rescans agents whose database admission was still pending.
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createDeferred } from "../../../test/helpers/promise.js";
import type { InternalSessionEntry as SessionEntry } from "../../config/sessions.js";
import {
  listSessionEntriesCore,
  replaceSessionEntry,
} from "../../config/sessions/session-accessor.js";
import { callGateway } from "../../gateway/call.js";
import type { GatewayRecoveryRuntime } from "../../gateway/server-instance-runtime.types.js";
import { resetAgentEventsForTest } from "../../infra/agent-events.js";
import { resetGatewayWorkAdmission } from "../../process/gateway-work-admission.js";
import {
  createAgentDatabaseInspectionRefusal,
  recordAgentDatabaseAdmissions,
} from "../../state/agent-database-admission.js";
import { cleanupSessionStateForTest } from "../../test-utils/session-state-cleanup.js";
import { createSessionEntry } from "../subagent-test-fixtures.test-helpers.js";
import { createRecoveryRuntimeFixture } from "./main-session-recovery-runtime.test-support.js";
import { createRestartRecoveryTranscriptFixture } from "./main-session-restart-recovery-fixture.test-support.js";
import * as recoveryShared from "./main-session-restart-recovery-shared.js";
import { scheduleRestartAbortedMainSessionRecovery } from "./main-session-restart-recovery.js";

vi.mock("../../gateway/call.js", () => ({
  callGateway: vi.fn(async () => ({ runId: "run-resumed" })),
}));

const sendRecoveryNotice = vi.fn<GatewayRecoveryRuntime["sendRecoveryNotice"]>(async () => ({
  suppressed: false,
}));
let dispatchSettlement = createDeferred();
const mockRecoveryRuntime = createRecoveryRuntimeFixture({
  callGateway,
  getDispatchSettlement: () => dispatchSettlement.promise,
  sendRecoveryNotice,
});

function readStore(storePath: string): Record<string, SessionEntry> {
  return Object.fromEntries(
    listSessionEntriesCore({ storePath }).map(({ sessionKey, entry }) => [sessionKey, entry]),
  );
}

const { writeTranscript } = createRestartRecoveryTranscriptFixture(readStore);
let tmpDir: string;

beforeEach(async () => {
  vi.clearAllMocks();
  dispatchSettlement = createDeferred();
  resetAgentEventsForTest();
  resetGatewayWorkAdmission();
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "branch-pending-admission-recovery-"));
});

afterEach(async () => {
  resetGatewayWorkAdmission();
  await cleanupSessionStateForTest({ stateDir: tmpDir });
  await fs.rm(tmpDir, { recursive: true, force: true });
});

it("rescans an agent whose database admission was still pending at startup", async () => {
  const sessionsDir = path.join(tmpDir, "agents", "main", "sessions");
  await fs.mkdir(sessionsDir, { recursive: true });
  const storePath = path.join(sessionsDir, "sessions.json");
  const sessionKey = "agent:main:dogfood-1";
  await replaceSessionEntry(
    { storePath, sessionKey },
    createSessionEntry({
      sessionId: "dogfood-session",
      updatedAt: Date.now() - 10_000,
      status: "running",
    }),
  );
  await writeTranscript(sessionsDir, "dogfood-session", [
    { role: "user", content: "keep building" },
    { role: "toolResult", content: "done" },
  ]);
  const env = { ...process.env, BRANCH_STATE_DIR: tmpDir };
  const pendingRefusal = createAgentDatabaseInspectionRefusal({
    agentId: "main",
    paths: [path.join(tmpDir, "agents", "main", "agent", "branch-agent.sqlite")],
    pending: true,
    reason: "Agent main has not completed startup inspection and preparation.",
  });
  recordAgentDatabaseAdmissions([pendingRefusal], { env, source: "startup" });
  const pendingCheck = vi.spyOn(recoveryShared, "hasPendingRestartRecoveryAdmission");
  const recovery = scheduleRestartAbortedMainSessionRecovery({
    getConfig: () => ({}),
    delayMs: 0,
    stateDir: tmpDir,
    gatewayRuntime: mockRecoveryRuntime,
  });
  try {
    // The first scan skips the preparing agent instead of treating it as checked.
    await vi.waitFor(() => expect(pendingCheck).toHaveBeenCalled());
    expect(callGateway).not.toHaveBeenCalled();

    recordAgentDatabaseAdmissions([], { env, source: "startup" });
    await mockRecoveryRuntime.expectAdmission(1, recovery, { sessionKey, storePath });
    expect(readStore(storePath)[sessionKey]).toMatchObject({
      status: "running",
      abortedLastRun: false,
    });
  } finally {
    recordAgentDatabaseAdmissions([], { env, source: "startup" });
    pendingCheck.mockRestore();
    await recovery.stop();
  }
});
