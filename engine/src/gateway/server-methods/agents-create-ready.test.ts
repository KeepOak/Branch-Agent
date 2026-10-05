import { expect, it, vi } from "vitest";
import type { RuntimeConfigWriteApplication } from "../../config/runtime-write-application.js";
import type { BranchConfig } from "../../config/types.branch.js";

const mocks = vi.hoisted(() => ({
  createAgent: vi.fn(),
  reviveAgentDatabases: vi.fn(async () => {}),
}));

vi.mock("../../agents/agent-create.js", () => ({ createAgent: mocks.createAgent }));
vi.mock("../server-reload-agent-databases.js", () => ({
  reviveAgentDatabasesAfterConfigCommit: mocks.reviveAgentDatabases,
}));
vi.mock("../session-utils.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../session-utils.js")>()),
  listAgentsForGateway: async (cfg: BranchConfig) => ({
    defaultId: "main",
    mainKey: "agent:main:main",
    scope: "global",
    agents: Object.keys(cfg.agents?.entries ?? {}).map((id) => ({ id })),
  }),
}));
vi.mock("./optional-model-catalog.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./optional-model-catalog.js")>()),
  readPreparedServerMethodModelCatalog: async () => undefined,
}));

const { agentsHandlers } = await import("./agents.js");

it("resolves the new agent for agents.list when create returns", async () => {
  let runtimeConfig: BranchConfig = { agents: { entries: { main: {} } } };
  let application: RuntimeConfigWriteApplication | undefined;
  let claim: ReturnType<RuntimeConfigWriteApplication["claim"]> = null;
  mocks.createAgent.mockImplementation(
    async (params: { runtimeApplication: RuntimeConfigWriteApplication }) => {
      application = params.runtimeApplication;
      claim = application.claim();
      return {
        status: "created",
        agentId: "new-agent",
        name: "New Agent",
        workspace: "/workspace/new-agent",
      };
    },
  );

  const context = {
    getRuntimeConfig: () => runtimeConfig,
    logGateway: { warn: vi.fn() },
  } as never;
  const invoke = (method: "agents.create" | "agents.list", params: Record<string, unknown>) => {
    const respond = vi.fn();
    const promise = agentsHandlers[method]!({
      params,
      respond,
      context,
      client: null,
      req: { type: "req", id: method, method },
      isWebchatConnect: () => false,
    } as never);
    return { respond, promise };
  };

  const created = invoke("agents.create", { name: "New Agent" });
  await vi.waitFor(() => expect(application).toBeDefined());
  expect(created.respond).not.toHaveBeenCalled();
  expect(claim).not.toBeNull();
  runtimeConfig = { agents: { entries: { main: {}, "new-agent": {} } } };
  claim!.settle("applied");
  await created.promise;
  expect(created.respond).toHaveBeenCalledWith(
    true,
    expect.objectContaining({ agentId: "new-agent" }),
    undefined,
  );

  const listed = invoke("agents.list", {});
  await listed.promise;
  expect(listed.respond).toHaveBeenCalledWith(
    true,
    expect.objectContaining({
      agents: expect.arrayContaining([expect.objectContaining({ id: "new-agent" })]),
    }),
    undefined,
  );
});
