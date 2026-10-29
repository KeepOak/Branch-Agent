import os from "node:os";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const fakes = vi.hoisted(() => ({
  connect: vi.fn(), save: vi.fn(), ensure: vi.fn(), hello: vi.fn(), stop: vi.fn(),
}));
vi.mock("../pairing/setup-code.js", () => ({ decodePairingSetupCode: () => ({ url: "wss://other.example.test", bootstrapToken: "one-time" }) }));
vi.mock("../config/config.js", () => ({ getRuntimeConfig: () => ({}) }));
vi.mock("./agent-list.js", () => ({ listGatewayAgentsBasic: async () => ({ agents: [{ id: "oak", name: "Oak" }, { id: "system", kind: "system" }] }) }));
vi.mock("../mcp/graft-join.js", () => ({
  connectAsDevice: fakes.connect,
  graftBranchIdentity: (name: string) => ({ id: "branch-this", name }),
  graftTrunkIdentity: (_branch: unknown, trunk: { id: string }) => ({ id: `branch-this--${trunk.id}` }),
  saveGraftLink: fakes.save,
}));
vi.mock("../mcp/graft-link.js", () => ({ ensureGraftLinks: fakes.ensure }));
const { joinGraftFromWindow } = await import("./graft-join-ui.js");

beforeEach(() => {
  vi.clearAllMocks();
});

const REAL_HOST = "real-host-should-not-show";
const savedDisplayHostname = process.env.BRANCH_DISPLAY_HOSTNAME;

afterEach(() => {
  vi.restoreAllMocks();
  if (savedDisplayHostname === undefined) {
    delete process.env.BRANCH_DISPLAY_HOSTNAME;
  } else {
    process.env.BRANCH_DISPLAY_HOSTNAME = savedDisplayHostname;
  }
});

it.each([
  ["no name", undefined],
  ["a blank name", "   "],
])("names this Branch with the display placeholder, not the real hostname, given %s", async (_label, name) => {
  process.env.BRANCH_DISPLAY_HOSTNAME = "Tour Mac";
  vi.spyOn(os, "hostname").mockReturnValue(REAL_HOST);
  fakes.connect.mockResolvedValueOnce({ outcome: { ok: false, pendingRequestId: "req-2", message: "approval needed" } });
  expect(await joinGraftFromWindow("code", name)).toEqual({ pending: true, requestId: "req-2" });
  expect(fakes.connect).toHaveBeenCalledWith(expect.objectContaining({ name: "Tour Mac", displayName: "Tour Mac" }));
  expect(JSON.stringify(fakes.connect.mock.calls)).not.toContain(REAL_HOST);
});

it("keeps a pending teammate approval retryable without saving a link", async () => {
  fakes.connect.mockResolvedValueOnce({ outcome: { ok: false, pendingRequestId: "req-1", message: "approval needed" } });
  expect(await joinGraftFromWindow("code", "This Branch")).toEqual({ pending: true, requestId: "req-1" });
  expect(fakes.save).not.toHaveBeenCalled();
});

it("saves an approved teammate and announces its Trunks", async () => {
  fakes.connect.mockResolvedValueOnce({ outcome: { ok: true, scopes: ["operator.read", "operator.write"] }, connection: { stop: fakes.stop } });
  fakes.connect.mockResolvedValueOnce({ outcome: { ok: true, scopes: ["operator.read", "operator.write"] }, connection: { request: fakes.hello, stop: fakes.stop } });
  fakes.hello.mockResolvedValue({});
  const result = await joinGraftFromWindow("code", "This Branch");
  expect(result).toMatchObject({ pending: false, link: { url: "wss://other.example.test", name: "This Branch" } });
  expect(fakes.save).toHaveBeenCalledOnce();
  expect(fakes.hello).toHaveBeenCalledWith("contacts.outside.hello", { agent: { id: "branch-this--oak" } });
  expect(fakes.ensure).toHaveBeenCalledOnce();
});
