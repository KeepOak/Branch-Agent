// sessions_send tests cover tool-driven agent-to-agent delivery, transcript
// updates, gateway auth, plugin routing, and emitted agent events.
import fs from "node:fs/promises";
import path from "node:path";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  type Mock,
  vi,
} from "vitest";
import { useAutoCleanupTempDirTracker } from "../../test/helpers/temp-dir.js";
import { buildAgentRunTerminalReplySnapshot } from "../agents/agent-run-terminal-reply.js";
import type { AgentCommandGatewayIngressOpts } from "../agents/command/types.js";
import {
  loadSessionEntry,
  persistSessionTranscriptTurn,
} from "../config/sessions/session-accessor.js";
import type { BranchConfig } from "../config/types.branch.js";
import { emitAgentEvent } from "../infra/agent-events.js";
import { waitForGatewayActiveWork } from "../infra/gateway-active-work.js";
import { readMessage } from "../mcp/trunk-tools.js";
import { captureEnv } from "../test-utils/env.js";
import { acquireTestPortBlock } from "../test-utils/port-claims.js";
import { runDirectSessionReplyScenario } from "./server.sessions-send.direct-reply.test-support.js";
import {
  agentCommandMock,
  installGatewayTestHooks,
  prepareGatewayReplyRuntimeForTest,
  startTestGatewayServer,
  testState,
  writeSessionStore,
} from "./test-helpers.js";
import { releaseGatewaySessionStoreFixture } from "./test/server-sessions-resources.test-helpers.js";

const { createBranchTools } = await import("../agents/branch-tools.js");

installGatewayTestHooks({ scope: "suite" });

let server: Awaited<ReturnType<typeof startTestGatewayServer>>;
let kernel: Awaited<ReturnType<(typeof import("./server-kernel.js"))["createGatewayKernel"]>>;
let gatewayPort: number;
const gatewayToken = "test-gateway-token-1234567890";
let envSnapshot: ReturnType<typeof captureEnv>;
const tempDirs = useAutoCleanupTempDirTracker((cleanup) =>
  afterEach(async () => {
    for (const dir of tempDirs.dirs) {
      await releaseGatewaySessionStoreFixture(dir);
    }
    cleanup();
  }),
);

const SESSION_SEND_E2E_TIMEOUT_MS = 10_000;
const SESSION_SEND_ROUTING_E2E_TIMEOUT_MS = 30_000;

function getSessionsSendTool(options?: Parameters<typeof createBranchTools>[0]) {
  const tool = createBranchTools(options).find((candidate) => candidate.name === "sessions_send");
  if (!tool) {
    throw new Error("missing sessions_send tool");
  }
  return tool;
}

function expectSessionsSendDetails(
  result: { details?: unknown },
  expected: { reply: string; sessionKey: string },
): void {
  expect(result.details).toMatchObject({ status: "ok", ...expected });
}

async function writeConfig(config: BranchConfig) {
  const configPath = process.env.BRANCH_CONFIG_PATH;
  if (!configPath) {
    throw new Error("BRANCH_CONFIG_PATH missing in gateway test environment");
  }
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  await fs.writeFile(configPath, `${JSON.stringify(config)}\n`, "utf-8");
}

async function emitLifecycleAssistantReply(params: {
  opts: unknown;
  defaultSessionId: string;
  includeTimestamp?: boolean;
  resolveText: (extraSystemPrompt?: string) => string;
}) {
  const commandParams = params.opts as {
    sessionId?: string;
    sessionKey?: string;
    runId?: string;
    agentId?: string;
    lifecycleGeneration?: string;
    extraSystemPrompt?: string;
  };
  const sessionId = commandParams.sessionId ?? params.defaultSessionId;
  const runId = commandParams.runId ?? sessionId;
  if (!commandParams.sessionKey) {
    throw new Error("expected session key for lifecycle reply");
  }

  const routing = {
    runId,
    sessionKey: commandParams.sessionKey,
    sessionId,
    agentId: commandParams.agentId,
    lifecycleGeneration: commandParams.lifecycleGeneration,
  };
  const startedAt = Date.now();
  emitAgentEvent({
    ...routing,
    stream: "lifecycle",
    data: { phase: "start", startedAt },
  });

  const text = params.resolveText(commandParams.extraSystemPrompt);
  const message = {
    role: "assistant",
    content: [{ type: "text", text }],
    ...(params.includeTimestamp ? { timestamp: Date.now() } : {}),
  };
  await persistSessionTranscriptTurn(
    {
      sessionId,
      sessionKey: commandParams.sessionKey,
      ...(testState.sessionStorePath ? { storePath: testState.sessionStorePath } : {}),
    },
    {
      cwd: "/tmp",
      updateMode: "none",
      messages: [{ message, now: Date.now() }],
    },
  );

  emitAgentEvent({
    ...routing,
    stream: "lifecycle",
    data: {
      phase: "end",
      startedAt,
      endedAt: Date.now(),
      terminalReply: buildAgentRunTerminalReplySnapshot({ visibleText: text, rawText: text }),
    },
  });
}

beforeAll(async () => {
  envSnapshot = captureEnv(["BRANCH_GATEWAY_PORT", "BRANCH_GATEWAY_TOKEN"]);
  const { approveDevicePairing } = await import("../infra/device-pairing-approval.js");
  const { requestDevicePairing } = await import("../infra/device-pairing.js");
  const { loadOrCreateDeviceIdentity, publicKeyRawBase64UrlFromPem } =
    await import("../infra/device-identity.js");
  const identity = loadOrCreateDeviceIdentity();
  const pending = await requestDevicePairing({
    deviceId: identity.deviceId,
    publicKey: publicKeyRawBase64UrlFromPem(identity.publicKeyPem),
    clientId: "branch-cli",
    clientMode: "cli",
    role: "operator",
    scopes: ["operator.admin", "operator.read", "operator.write", "operator.approvals"],
    silent: false,
  });
  await approveDevicePairing(pending.request.requestId, {
    callerScopes: pending.request.scopes ?? ["operator.admin"],
  });
  testState.gatewayAuth = { mode: "token", token: gatewayToken };
  const portClaim = await acquireTestPortBlock({ offsets: [0, 1, 2, 3, 4] });
  gatewayPort = portClaim.port;
  process.env.BRANCH_GATEWAY_PORT = String(gatewayPort);
  process.env.BRANCH_GATEWAY_TOKEN = gatewayToken;
  const kernelModule = await import("./server-kernel.js");
  const createKernel = kernelModule.createGatewayKernel;
  const captureKernel = vi
    .spyOn(kernelModule, "createGatewayKernel")
    .mockImplementation(async (...args) => {
      kernel = await createKernel(...args);
      return kernel;
    });
  try {
    server = await startTestGatewayServer(portClaim);
  } finally {
    captureKernel.mockRestore();
  }
  // Prepare the real history handler before the RPC deadline starts.
  await import("./server-methods/chat.js");
});

beforeEach(async () => {
  testState.gatewayAuth = { mode: "token", token: gatewayToken };
  process.env.BRANCH_GATEWAY_PORT = String(gatewayPort);
  process.env.BRANCH_GATEWAY_TOKEN = gatewayToken;
  testState.sessionStorePath = path.join(
    tempDirs.make("branch-sessions-send-case-"),
    "sessions.json",
  );
  await writeSessionStore({ entries: {} });
  await prepareGatewayReplyRuntimeForTest();
});

// Detached replies retain their selected store until the owner has settled.
afterEach(
  async () => {
    await waitForGatewayActiveWork(SESSION_SEND_E2E_TIMEOUT_MS * 3);
  },
  SESSION_SEND_E2E_TIMEOUT_MS * 3 + 1_000,
);

afterAll(async () => {
  await server.close();
  envSnapshot.restore();
});

describe("sessions_send gateway loopback", () => {
  it("rejects a missing explicit key without creating or running a session", async () => {
    const dir = tempDirs.make("branch-sessions-send-missing-");
    const missingKey = "agent:main:missing";
    const spy = agentCommandMock as unknown as Mock<(opts: unknown) => Promise<void>>;
    testState.sessionStorePath = path.join(dir, "sessions.json");
    try {
      await writeSessionStore({
        entries: {
          main: {
            sessionId: "sess-main",
            updatedAt: Date.now(),
          },
        },
      });
      spy.mockClear();
      const tool = getSessionsSendTool({
        agentSessionKey: "agent:main:main",
        config: { tools: { sessions: { visibility: "all" } } },
      });

      const result = await tool.execute("call-missing-key", {
        sessionKey: missingKey,
        message: "ping",
        timeoutSeconds: 0,
      });

      expect(result.details).toMatchObject({
        status: "error",
        error: `No session found: ${missingKey}`,
      });
      expect(spy).not.toHaveBeenCalled();
      expect(
        loadSessionEntry({ sessionKey: missingKey, storePath: testState.sessionStorePath }),
      ).toBe(undefined);
    } finally {
      testState.sessionStorePath = undefined;
    }
  });

  it("returns reply when lifecycle ends before agent.wait", async () => {
    const body = "    const first = 1;\n        const second = 2;";
    const spy = agentCommandMock as unknown as Mock<
      (opts: AgentCommandGatewayIngressOpts) => Promise<void>
    >;
    spy.mockImplementation(async (opts) => {
      await opts.userTurnTranscriptRecorder?.persistApproved();
      await emitLifecycleAssistantReply({
        opts,
        defaultSessionId: "main",
        includeTimestamp: true,
        resolveText: () => "pong",
      });
    });

    const tool = getSessionsSendTool();

    const result = await tool.execute("call-loopback", {
      sessionKey: "main",
      message: body,
      timeoutSeconds: 5,
    });
    expectSessionsSendDetails(result, { reply: "pong", sessionKey: "main" });

    const firstCall = spy.mock.calls.at(0)?.[0];
    expect(firstCall?.lane).toMatch(/^nested(?::|$)/);
    expect(firstCall?.inputProvenance?.kind).toBe("inter_session");
    expect(firstCall?.inputProvenance?.sourceTool).toBe("sessions_send");
    expect(firstCall?.runId).toBeTypeOf("string");
    expect(result.details).toMatchObject({ runId: firstCall?.runId });
    expect(firstCall?.userTurnTranscriptRecorder?.hasPersisted()).toBe(true);

    expect(spy).toHaveBeenCalledOnce();
    const { callGateway } = await import("./call.js");
    const history = await callGateway<{ messages?: unknown[] }>({
      method: "chat.history",
      params: { sessionKey: "main", limit: 10 },
      timeoutMs: 5_000,
    });
    // Observe both receiving and persisted body failures before ending the case.
    expect.soft(firstCall?.message?.split("\n").slice(-2).join("\n")).toBe(body);
    expect.soft(history.messages).toContainEqual(
      expect.objectContaining({
        role: "assistant",
        idempotencyKey: `${firstCall?.runId}:user`,
        content: body,
        provenance: expect.objectContaining({
          kind: "inter_session",
          sourceTool: "sessions_send",
        }),
      }),
    );
  });

  it(
    "delivers a same-session reply to an account-scoped DM without stored delivery context",
    { timeout: SESSION_SEND_ROUTING_E2E_TIMEOUT_MS },
    async () => {
      await runDirectSessionReplyScenario({
        dir: tempDirs.make("branch-direct-reply-"),
        resolveGatewayContext: () => kernel.gatewayRequestContext,
        sessionKey: "agent:main:feishu:work:dm:ou_reply_recipient",
        expectedAccountId: "work",
      });
    },
  );
});

describe("sessions_send label lookup", () => {
  it(
    "finds session by label and sends message",
    { timeout: SESSION_SEND_E2E_TIMEOUT_MS },
    async () => {
      await writeConfig({ tools: { sessions: { visibility: "all" } } });
      const spy = agentCommandMock as unknown as Mock<(opts: unknown) => Promise<void>>;
      spy.mockImplementation(async (opts: unknown) =>
        emitLifecycleAssistantReply({
          opts,
          defaultSessionId: "test-labeled",
          resolveText: () => "labeled response",
        }),
      );

      const { callGateway } = await import("./call.js");
      await callGateway({
        method: "sessions.patch",
        params: { key: "test-labeled-session", label: "my-test-worker" },
        timeoutMs: 5000,
      });

      const tool = getSessionsSendTool({
        config: { tools: { sessions: { visibility: "all" } } },
      });

      const result = await tool.execute("call-by-label", {
        label: "my-test-worker",
        message: "hello labeled session",
        timeoutSeconds: 5,
      });
      expectSessionsSendDetails(result, {
        reply: "labeled response",
        sessionKey: "agent:main:test-labeled-session",
      });
    },
  );
});

describe("sessions_send agent targeting", () => {
  const agents: BranchConfig["agents"] = {
    ownership: "explicit",
    defaults: {
      systemAgent: { agentId: "main" },
      sessionStore: { agentId: "main" },
    },
    entries: { main: {}, orion: {} },
  };

  beforeEach(async () => {
    testState.agentsConfig = agents;
    await writeConfig({ agents });
    // Prepare both local agents before the delivery deadline starts.
    await prepareGatewayReplyRuntimeForTest({ force: true });
  });

  it.each([
    { name: "default cross-agent access", tools: undefined },
    {
      name: "disabled agent-to-agent access",
      tools: { agentToAgent: { enabled: false } },
      error: "Agent-to-agent messaging is disabled",
    },
    {
      name: "restrictive allow list",
      tools: { agentToAgent: { allow: ["main"] } },
      error: "denied by tools.agentToAgent.allow",
    },
  ] satisfies Array<{ name: string; tools: BranchConfig["tools"]; error?: string }>)(
    "enforces $name when targeting a configured agent main session by agentId",
    async ({ tools, error }) => {
      const dir = tempDirs.make("branch-sessions-send-agent-");
      const config: BranchConfig = {
        ...(tools ? { tools } : {}),
        agents,
      };

      testState.sessionStorePath = path.join(dir, "sessions.json");
      testState.agentsConfig = config.agents;
      try {
        await writeConfig(config);
        await writeSessionStore({
          entries: {
            main: {
              sessionId: "sess-main",
              updatedAt: Date.now(),
            },
          },
        });
        const targetDelivery = Promise.withResolvers<void>();
        const spy = agentCommandMock as unknown as Mock<(opts: unknown) => Promise<void>>;
        spy.mockImplementation(async (opts: unknown) => {
          await (opts as AgentCommandGatewayIngressOpts).userTurnTranscriptRecorder?.persistApproved();
          await emitLifecycleAssistantReply({
            opts,
            defaultSessionId: "orion-created",
            resolveText: () => "orion response",
          });
          if ((opts as AgentCommandGatewayIngressOpts).sessionKey === "agent:orion:main") {
            targetDelivery.resolve();
          }
        });
        spy.mockClear();

        const tool = getSessionsSendTool({
          agentSessionKey: "agent:main:main",
          config,
        });

        const result = await tool.execute("call-agent-id", {
          agentId: "orion",
          message: "hello orion",
          timeoutSeconds: 0,
        });
        if (error) {
          expect(spy.mock.calls.map(([opts]) => opts)).not.toContainEqual(
            expect.objectContaining({ sessionKey: "agent:orion:main" }),
          );
          expect(
            loadSessionEntry({
              sessionKey: "agent:orion:main",
              storePath: testState.sessionStorePath,
            }),
          ).toBeUndefined();
          expect(result.details).toMatchObject({
            status: "forbidden",
            error: expect.stringContaining(error),
          });
          return;
        }
        expect(result.details, JSON.stringify(result.details)).toMatchObject({
          status: "accepted",
          sessionKey: "agent:orion:main",
        });
        await targetDelivery.promise;

        const orionCall = spy.mock.calls
          .map(([opts]) => opts as { sessionId?: string; sessionKey?: string })
          .find((call) => call.sessionKey === "agent:orion:main");
        expect(orionCall).toBeDefined();
        expect(orionCall?.sessionId).toBeTypeOf("string");

        const stored = loadSessionEntry({
          sessionKey: "agent:orion:main",
          storePath: testState.sessionStorePath,
        });
        expect(stored?.sessionId).toBe(orionCall?.sessionId);

        // C05: observe the delivered input through the same projection Graft's
        // thread_history uses, not just the tool's admission receipt.
        const { callGateway } = await import("./call.js");
        const history = await callGateway<{ messages: unknown[] }>({
          method: "chat.history",
          params: { sessionKey: "agent:orion:main", limit: 20 },
          timeoutMs: 5_000,
        });
        const messages = history.messages.map(readMessage);
        expect(messages).toContainEqual(
          expect.objectContaining({ role: "assistant", text: "orion response" }),
        );
        const forwarded = messages.filter(
          (message) => message.from === "main" && String(message.text).includes("hello orion"),
        );
        expect(forwarded).toHaveLength(1);
        expect(forwarded[0]?.text).toMatch(/^\[Inter-session message\] sourceSession=agent:main:main /);
        expect(forwarded[0]?.text).toContain("sourceTool=sessions_send");
        expect(forwarded[0]?.text).toContain("isUser=false");
        expect(forwarded[0]?.text).toMatch(/\nhello orion$/);
      } finally {
        testState.agentsConfig = undefined;
      }
    },
    SESSION_SEND_ROUTING_E2E_TIMEOUT_MS,
  );
});
