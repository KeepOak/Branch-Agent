// Trunk-made model changes follow tools.modelChoice and Full access; an approval comes before any write.
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDeferred } from "../../../test/helpers/promise.js";
import { upsertSessionEntryCore } from "../../config/sessions/session-accessor.js";
import type { BranchConfig } from "../../config/types.branch.js";
import { GatewayClientRequestError } from "../../gateway/client.js";
import { flushPendingSessionsChangedEvents } from "../../gateway/server-methods/session-change-event.js";
import { sessionMutationHandlers } from "../../gateway/server-methods/sessions-mutations.js";
import type {
  GatewayClient,
  GatewayRequestContext,
  RespondFn,
} from "../../gateway/server-methods/types.js";
import { withBranchTestState } from "../../test-utils/branch-test-state.js";
import type { ModelChoiceDecision } from "../model-choice.js";
import type { AgentToolGatewayRequestCaller } from "./in-process-gateway.js";
import { createSessionsTool } from "./sessions-tool.js";

const mocks = vi.hoisted(() => ({
  executeSessionPatchMutations: vi.fn(),
  requestModelChoiceApproval: vi.fn(),
}));
vi.mock("../../gateway/server-methods/sessions-patch-engine.js", () => ({
  executeSessionPatchMutations: mocks.executeSessionPatchMutations,
}));
vi.mock("../../gateway/server-methods/model-choice-approval.js", () => ({
  requestModelChoiceApproval: mocks.requestModelChoiceApproval,
}));

const currentKey = "agent:main:main";
const targetKey = "agent:main:dashboard:first";

afterEach(() => {
  flushPendingSessionsChangedEvents();
  mocks.executeSessionPatchMutations.mockReset();
  mocks.requestModelChoiceApproval.mockReset();
});

const fullAccessExec = { security: "full", ask: "off", host: "gateway" } as const;
const askingExec = { security: "full", ask: "always", host: "gateway" } as const;

function createModelChoiceFixture(config: BranchConfig) {
  mocks.executeSessionPatchMutations.mockImplementation(
    async (params: { targets: readonly unknown[] }) => ({
      ok: true,
      archivedSessionsCommitted: false,
      outcomes: params.targets.map(() => ({ ok: true })),
    }),
  );
  const asked = createDeferred<string>();
  const decision = createDeferred<ModelChoiceDecision>();
  mocks.requestModelChoiceApproval.mockImplementation(async (params: { question: string }) => {
    asked.resolve(params.question);
    return await decision.promise;
  });
  const client: GatewayClient = {
    connect: {
      minProtocol: 1,
      maxProtocol: 1,
      client: { id: "gateway-client", version: "test", platform: "test", mode: "backend" },
      role: "operator",
      scopes: ["operator.read", "operator.write"],
    },
  };
  const context = {
    getRuntimeConfig: () => config,
    loadGatewayModelCatalog: async () => [],
    getSessionEventSubscriberConnIds: () => new Set(),
    broadcastToConnIds: vi.fn(),
    chatAbortControllers: new Map(),
    chatQueuedTurns: new Map(),
    dedupe: new Map(),
  } as unknown as GatewayRequestContext;
  const callGateway: AgentToolGatewayRequestCaller = async <T>(
    request: Parameters<AgentToolGatewayRequestCaller>[0],
  ) => {
    const handler = sessionMutationHandlers[request.method];
    if (!handler) {
      throw new Error(`Unexpected Gateway request: ${request.method}`);
    }
    const responses: Parameters<RespondFn>[] = [];
    await handler({
      req: { type: "req", id: "model-choice-test", method: request.method, params: request.params },
      params: request.params as Record<string, unknown>,
      respond: (...response) => {
        responses.push(response);
      },
      context,
      client,
      isWebchatConnect: () => false,
    });
    const [ok, payload, error] = responses[0]!;
    if (!ok) {
      throw new GatewayClientRequestError(error!);
    }
    return payload as T;
  };
  const tool = createSessionsTool({
    agentSessionKey: currentKey,
    agentSessionId: "current-session",
    config,
    callGateway,
  });
  return {
    asked: asked.promise,
    decide: decision.resolve,
    switchModel: (model: string) =>
      tool.execute("switch-model", {
        action: "patch",
        targets: [{ sessionKey: targetKey }],
        model,
      }),
  };
}

async function seedSessions() {
  await upsertSessionEntryCore(
    { agentId: "main", sessionKey: currentKey },
    { sessionId: "current-session", updatedAt: 1 },
  );
  await upsertSessionEntryCore(
    { agentId: "main", sessionKey: targetKey },
    { sessionId: "target-session", updatedAt: 1 },
  );
}

const writes = () => mocks.executeSessionPatchMutations.mock.calls.length;
const approvalRequests = () => mocks.requestModelChoiceApproval.mock.calls.length;

/** The question asked, or the tool's own outcome if it settled without asking. */
function questionOrOutcome(
  fixture: ReturnType<typeof createModelChoiceFixture>,
  pending: Promise<unknown>,
) {
  return Promise.race([
    fixture.asked,
    pending.then(
      (result) => {
        throw new Error(`settled without an approval request: ${JSON.stringify(result)}`);
      },
      (error: unknown) => {
        throw new Error(`failed without an approval request: ${String(error)}`);
      },
    ),
  ]);
}

describe("Trunk model choice", () => {
  it("refuses a model change while the setting is off and writes nothing", async () => {
    await withBranchTestState({ scenario: "minimal" }, async () => {
      await seedSessions();
      const fixture = createModelChoiceFixture({ tools: { exec: fullAccessExec } });
      await expect(fixture.switchModel("openai/gpt-5.5")).rejects.toThrow(
        '"Trunks may switch their own model" is off',
      );
      expect(writes()).toBe(0);
      expect(approvalRequests()).toBe(0);
    });
  });

  it("applies straight away with Full access and asks nothing", async () => {
    await withBranchTestState({ scenario: "minimal" }, async () => {
      await seedSessions();
      const fixture = createModelChoiceFixture({
        tools: { exec: fullAccessExec, modelChoice: { enabled: true } },
      });
      const result = await fixture.switchModel("openai/gpt-5.5");
      expect(result.details).toMatchObject({ status: "updated", succeeded: [0] });
      expect(writes()).toBe(1);
      expect(approvalRequests()).toBe(0);
    });
  });

  it("without Full access asks once and writes only after allow", async () => {
    await withBranchTestState({ scenario: "minimal" }, async () => {
      await seedSessions();
      const fixture = createModelChoiceFixture({
        tools: { exec: askingExec, modelChoice: { enabled: true } },
      });
      const pending = fixture.switchModel("openai/gpt-5.5@openai:work");
      expect(await questionOrOutcome(fixture, pending)).toBe(
        "Switch to openai/gpt-5.5 on account openai:work?",
      );
      expect(writes()).toBe(0);
      fixture.decide("allow");
      await expect(pending).resolves.toMatchObject({
        details: { status: "updated", succeeded: [0] },
      });
      expect(writes()).toBe(1);
      expect(approvalRequests()).toBe(1);
    });
  });

  it("without Full access a deny leaves the model as it was and says so", async () => {
    await withBranchTestState({ scenario: "minimal" }, async () => {
      await seedSessions();
      const fixture = createModelChoiceFixture({
        tools: { exec: askingExec, modelChoice: { enabled: true } },
      });
      const pending = fixture.switchModel("openai/gpt-5.5");
      const settled = pending.catch((error: unknown) => error);
      await questionOrOutcome(fixture, pending);
      fixture.decide("deny");
      expect(String(await settled)).toContain(
        "the person didn't allow switching to openai/gpt-5.5. The model stays as it was.",
      );
      expect(writes()).toBe(0);
      expect(approvalRequests()).toBe(1);
    });
  });
});
