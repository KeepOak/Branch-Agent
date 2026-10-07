import { beforeEach, expect, it, vi } from "vitest";

const fakes = vi.hoisted(() => ({
  connect: vi.fn(),
  save: vi.fn(),
  ensure: vi.fn(),
  hello: vi.fn(),
  stop: vi.fn(),
  url: "wss://other.example.test",
  port: 41002,
}));
vi.mock("../pairing/setup-code.js", () => ({
  decodePairingSetupCode: () => ({ url: fakes.url, bootstrapToken: "one-time" }),
}));
vi.mock("../config/config.js", () => ({ getRuntimeConfig: () => ({ gateway: { port: 41001 } }) }));
vi.mock("../infra/gateway-lock.js", () => ({ readActiveGatewayLockPort: async () => fakes.port }));
vi.mock("./agent-list.js", () => ({
  listGatewayAgentsBasic: async () => ({
    agents: [
      { id: "oak", name: "Oak" },
      { id: "system", kind: "system" },
    ],
  }),
}));
vi.mock("../mcp/graft-join.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../mcp/graft-join.js")>()),
  connectAsDevice: fakes.connect,
  graftBranchIdentity: (name: string) => ({ id: "branch-this", name }),
  graftTrunkIdentity: (_branch: unknown, trunk: { id: string }) => ({
    id: `branch-this--${trunk.id}`,
  }),
  saveGraftLink: fakes.save,
}));
vi.mock("../mcp/graft-link.js", () => ({ ensureGraftLinks: fakes.ensure }));
const { joinGraftFromWindow } = await import("./graft-join-ui.js");

beforeEach(() => {
  vi.clearAllMocks();
  fakes.url = "wss://other.example.test";
  fakes.port = 41002;
});

it("keeps a pending teammate approval retryable without saving a link", async () => {
  fakes.connect.mockResolvedValueOnce({
    outcome: { ok: false, pendingRequestId: "req-1", message: "approval needed" },
  });
  expect(await joinGraftFromWindow("code", "This Branch")).toEqual({
    pending: true,
    requestId: "req-1",
  });
  expect(fakes.save).not.toHaveBeenCalled();
});

it("saves an approved teammate and announces its Trunks", async () => {
  fakes.connect.mockResolvedValueOnce({
    outcome: { ok: true, scopes: ["operator.read", "operator.write"] },
    connection: { stop: fakes.stop },
  });
  fakes.connect.mockResolvedValueOnce({
    outcome: { ok: true, scopes: ["operator.read", "operator.write"] },
    connection: { request: fakes.hello, stop: fakes.stop },
  });
  fakes.hello.mockResolvedValue({});
  const result = await joinGraftFromWindow("code", "This Branch");
  expect(result).toMatchObject({
    pending: false,
    link: { url: "wss://other.example.test", name: "This Branch" },
  });
  expect(fakes.save).toHaveBeenCalledOnce();
  expect(fakes.save).toHaveBeenCalledWith(
    expect.objectContaining({ url: fakes.url }),
    undefined,
    fakes.port,
  );
  expect(fakes.hello).toHaveBeenCalledWith("contacts.outside.hello", {
    agent: { id: "branch-this--oak" },
  });
  expect(fakes.ensure).toHaveBeenCalledOnce();
});

it.each(["approved", "pending"])(
  "rejects a self-join before an %s pairing attempt",
  async (outcome) => {
    fakes.url = "ws://localhost:41002";
    fakes.connect.mockResolvedValue({
      outcome:
        outcome === "approved"
          ? { ok: true, scopes: [] }
          : { ok: false, pendingRequestId: "req-self", message: "approval needed" },
    });
    await expect(joinGraftFromWindow("code", "This Branch")).rejects.toThrow(
      "This is this Branch's own gateway. Use a code from another Branch.",
    );
    expect(fakes.connect).not.toHaveBeenCalled();
    expect(fakes.save).not.toHaveBeenCalled();
    expect(fakes.ensure).not.toHaveBeenCalled();
  },
);
