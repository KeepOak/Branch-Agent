import { Command } from "commander";
import { beforeEach, expect, it, vi } from "vitest";

const fakes = vi.hoisted(() => ({
  connect: vi.fn(),
  save: vi.fn(),
  rpc: vi.fn(),
  error: vi.fn(),
  exit: vi.fn(),
  log: vi.fn(),
  url: "ws://localhost:41002",
  port: 41002,
}));
vi.mock("../config/config.js", () => ({ getRuntimeConfig: () => ({ gateway: { port: 41001 } }) }));
vi.mock("../infra/gateway-lock.js", () => ({ readActiveGatewayLockPort: async () => fakes.port }));
vi.mock("../pairing/setup-code.js", () => ({
  decodePairingSetupCode: () => ({ url: fakes.url, bootstrapToken: "fixture-bootstrap" }),
}));
vi.mock("../gateway/agent-list.js", () => ({
  listGatewayAgentsBasic: async () => ({ agents: [] }),
}));
vi.mock("./gateway-rpc.js", () => ({ callGatewayFromCli: fakes.rpc }));
vi.mock("../runtime.js", () => ({
  defaultRuntime: {
    error: fakes.error,
    exit: fakes.exit,
    log: fakes.log,
    writeJson: vi.fn(),
  },
}));
vi.mock("../mcp/graft-join.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../mcp/graft-join.js")>()),
  connectAsDevice: fakes.connect,
  saveGraftLink: fakes.save,
}));

import { registerGraftBranchCommands } from "./graft-cli.js";

beforeEach(() => {
  vi.clearAllMocks();
  fakes.url = "ws://localhost:41002";
  fakes.port = 41002;
});

it.each(["approved", "pending"])(
  "rejects a self-join before an %s pairing attempt with a --port override",
  async (outcome) => {
    fakes.connect.mockResolvedValue({
      outcome:
        outcome === "approved"
          ? { ok: true, scopes: [] }
          : { ok: false, pendingRequestId: "req-self", message: "approval needed" },
    });
    const command = new Command("graft");
    registerGraftBranchCommands(command);
    await command.parseAsync(["join", "fixture-code", "--name", "This Branch"], { from: "user" });
    expect(fakes.error).toHaveBeenCalledWith(
      "Could not join: This is this Branch's own gateway. Use a code from another Branch.",
    );
    expect(fakes.exit).toHaveBeenCalledWith(1);
    expect(fakes.connect).not.toHaveBeenCalled();
    expect(fakes.save).not.toHaveBeenCalled();
    expect(fakes.rpc).not.toHaveBeenCalled();
    expect(fakes.log).not.toHaveBeenCalled();
  },
);
