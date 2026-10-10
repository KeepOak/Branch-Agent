import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it, vi } from "vitest";
import type { RuntimeConfigWriteApplication } from "../../config/runtime-write-application.js";
import type { BranchConfig } from "../../config/types.branch.js";

const mocks = vi.hoisted(() => ({
  createAgent: vi.fn(),
  append: vi.fn(async () => ({ ok: true })),
  ownerWorkspace: "",
  reviveAgentDatabases: vi.fn(async () => {}),
  warmAdmission: vi.fn(async () => ({ databaseClaim: { release: async () => {} } })),
}));

vi.mock("../../agents/agent-create.js", () => ({ createAgent: mocks.createAgent }));
vi.mock("../server-reload-agent-databases.js", () => ({
  reviveAgentDatabasesAfterConfigCommit: mocks.reviveAgentDatabases,
}));
vi.mock("../../agents/agent-scope-config.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../agents/agent-scope-config.js")>()),
  resolveAgentWorkspaceDir: () => mocks.ownerWorkspace,
}));
vi.mock("../../config/sessions/transcript.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../config/sessions/transcript.js")>()),
  appendAssistantMessageToSessionTranscript: mocks.append,
}));
vi.mock("../../config/sessions/session-accessor.sqlite-entry.js", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../../config/sessions/session-accessor.sqlite-entry.js")
  >()),
  loadSessionEntryForAdmission: mocks.warmAdmission,
}));
vi.mock("./optional-model-catalog.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./optional-model-catalog.js")>()),
  readPreparedServerMethodModelCatalog: async () => undefined,
}));

const { agentsHandlers } = await import("./agents.js");

const cfg: BranchConfig = { agents: { entries: { main: {} } } };

function context() {
  return {
    getRuntimeConfig: () => cfg,
    logGateway: { warn: vi.fn() },
  } as never;
}

function createCall(params: Record<string, unknown> = { name: "New Trunk" }) {
  const respond = vi.fn();
  const promise = agentsHandlers["agents.create"]!({
    params,
    respond,
    context: context(),
    client: null,
    req: { type: "req", id: "agents.create", method: "agents.create" },
    isWebchatConnect: () => false,
  } as never);
  return { respond, promise };
}

function stubCreate(status: "created" | "existing", bootstrapPending: boolean) {
  mocks.createAgent.mockImplementation(
    async (params: { runtimeApplication: RuntimeConfigWriteApplication }) => {
      params.runtimeApplication.claim()!.settle("applied");
      return {
        status,
        agentId: "new-trunk",
        name: "New Trunk",
        workspace: "/workspace/new-trunk",
        bootstrapPending,
      };
    },
  );
}

function setup() {
  mocks.ownerWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), "create-greeting-owner-"));
  mocks.append.mockClear();
  mocks.append.mockImplementation(async () => ({ ok: true }));
}

it("greets a brand-new Trunk once, after the create is answered", async () => {
  setup();
  stubCreate("created", true);

  const created = createCall();
  await created.promise;
  expect(created.respond).toHaveBeenCalledWith(
    true,
    expect.objectContaining({ agentId: "new-trunk" }),
    undefined,
  );
  await vi.waitFor(() => expect(mocks.append).toHaveBeenCalledTimes(1));
  expect(mocks.append).toHaveBeenCalledWith(
    expect.objectContaining({
      agentId: "new-trunk",
      sessionKey: "agent:new-trunk:main",
      idempotencyKey: "first-run-greeting:new-trunk",
    }),
  );
});

it("never greets an existing Trunk, even one whose ritual is pending", async () => {
  setup();
  stubCreate("existing", true);

  const created = createCall();
  await created.promise;
  await new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
  expect(created.respond).toHaveBeenCalledWith(true, expect.anything(), undefined);
  expect(mocks.append).not.toHaveBeenCalled();
});

it("does not hold the create response while the greeting write is slow", async () => {
  setup();
  stubCreate("created", true);
  mocks.append.mockImplementation(() => new Promise(() => {}));

  const created = createCall();
  await created.promise;
  expect(created.respond).toHaveBeenCalledWith(
    true,
    expect.objectContaining({ agentId: "new-trunk" }),
    undefined,
  );
  await vi.waitFor(() => expect(mocks.append).toHaveBeenCalledTimes(1));
});
