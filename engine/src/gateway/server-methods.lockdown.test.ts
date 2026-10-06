import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetGatewayWorkAdmission } from "../process/gateway-work-admission.js";
import { handleGatewayRequest } from "./server-methods.js";
import type { GatewayRequestHandler } from "./server-methods/types.js";

vi.mock("../config/lockdown.js", async (load) => {
  const actual = await load<typeof import("../config/lockdown.js")>();
  return { ...actual, isLockdownOn: () => true };
});

describe("Lockdown gateway admission", () => {
  beforeEach(() => resetGatewayWorkAdmission());

  async function request(method: string, params?: Record<string, unknown>) {
    const handler = vi.fn<GatewayRequestHandler>(({ respond }) => respond(true, { ok: true }, undefined));
    const respond = vi.fn();
    await handleGatewayRequest({
      req: { type: "req", id: crypto.randomUUID(), method, ...(params ? { params } : {}) },
      respond,
      client: {
        connId: "lockdown-test",
        clientIp: "127.0.0.1",
        connect: { role: "operator", scopes: ["operator.admin"], client: { id: "branch-control-ui", version: "1", platform: "windows", mode: "ui" }, minProtocol: 1, maxProtocol: 1 },
      } as Parameters<typeof handleGatewayRequest>[0]["client"],
      isWebchatConnect: () => false,
      context: { logGateway: { warn: vi.fn() } } as unknown as Parameters<typeof handleGatewayRequest>[0]["context"],
      extraHandlers: { [method]: handler },
    });
    return { handler, respond };
  }

  it("refuses writes, but keeps reads and the off switch available", async () => {
    const write = await request("tts.enable");
    expect(write.handler).not.toHaveBeenCalled();
    expect(write.respond.mock.calls[0]?.[0]).toBe(false);
    const read = await request("health");
    expect(read.handler).toHaveBeenCalledOnce();
    const off = await request("config.patch", { raw: '{"security":{"lockdown":false}}', baseHash: "h1" });
    expect(off.handler).toHaveBeenCalledOnce();
    const unrelated = await request("config.patch", { raw: '{"security":{"lockdown":false},"tools":{}}', baseHash: "h1" });
    expect(unrelated.handler).not.toHaveBeenCalled();
  });
});
