import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GATEWAY_OWNER_PROFILE_ID } from "../../packages/gateway-protocol/src/schema/users.js";
import {
  clearRuntimeConfigSnapshot,
  setRuntimeConfigSnapshot,
} from "../config/runtime-snapshot.js";
import { resetGatewayWorkAdmission } from "../process/gateway-work-admission.js";
import { handleGatewayRequest } from "./server-methods.js";
import type { GatewayClient, GatewayRequestHandler } from "./server-methods/types.js";

type Caller = "owner-token" | "owner-device" | "teammate" | "agent";

function clientFor(caller: Caller): GatewayClient {
  const base = {
    connId: `lockdown-${caller}`,
    clientIp: "127.0.0.1",
    connect: {
      role: "operator",
      scopes: ["operator.admin"],
      client: { id: "branch-control-ui", version: "1", platform: "windows", mode: "ui" },
      minProtocol: 1,
      maxProtocol: 1,
    },
  };
  if (caller === "owner-token") {
    return {
      ...base,
      internal: { authenticatedOperator: true, operatorRoleActor: { kind: "system" } },
      authenticatedUserProfile: { profileId: GATEWAY_OWNER_PROFILE_ID },
    } as unknown as GatewayClient;
  }
  if (caller === "owner-device") {
    return {
      ...base,
      internal: { authenticatedOperator: true },
      authenticatedUserProfile: { profileId: GATEWAY_OWNER_PROFILE_ID },
    } as unknown as GatewayClient;
  }
  if (caller === "teammate") {
    return {
      ...base,
      internal: { authenticatedOperator: true },
      authenticatedUserProfile: { profileId: "teammate-1" },
    } as unknown as GatewayClient;
  }
  return {
    ...base,
    internal: {
      authenticatedOperator: true,
      syntheticClient: true,
      operatorRoleActor: { kind: "system" },
    },
  } as unknown as GatewayClient;
}

async function request(
  method: string,
  params?: Record<string, unknown>,
  caller: Caller = "owner-token",
) {
  const handler = vi.fn<GatewayRequestHandler>(({ respond }) =>
    respond(true, { ok: true }, undefined),
  );
  const respond = vi.fn();
  await handleGatewayRequest({
    req: { type: "req", id: crypto.randomUUID(), method, ...(params ? { params } : {}) },
    respond,
    client: clientFor(caller),
    isWebchatConnect: () => false,
    context: {
      logGateway: { warn: vi.fn() },
      getRuntimeConfig: () => ({}),
    } as unknown as Parameters<typeof handleGatewayRequest>[0]["context"],
    extraHandlers: { [method]: handler },
  });
  return {
    ran: handler.mock.calls.length === 1,
    error: respond.mock.calls[0]?.[2] as { code?: string; message?: string } | undefined,
  };
}

const OFF = { raw: '{"security":{"lockdown":false}}', baseHash: "h1" };
const ON = { raw: '{"security":{"lockdown":true}}', baseHash: "h1" };

describe("Lockdown gateway admission", () => {
  beforeEach(() => {
    resetGatewayWorkAdmission();
    setRuntimeConfigSnapshot({ security: { lockdown: true } });
  });
  afterEach(() => clearRuntimeConfigSnapshot());

  it("refuses writes and spending reads, and keeps plain reads", async () => {
    expect((await request("tts.enable")).ran).toBe(false);
    expect((await request("tts.enable")).error?.message).toBe(
      "Lockdown is on: this action is unavailable.",
    );
    expect((await request("health")).ran).toBe(true);
    for (const method of [
      "sessions.companion.ask",
      "users.personalFile.set",
      "users.github.disconnect",
      "controlUi.linkPreview",
      "skills.search",
    ]) {
      expect((await request(method)).ran, method).toBe(false);
    }
  });

  it("keeps Stop and narrowing actions: Don't, device revoke, pausing a schedule", async () => {
    expect((await request("chat.abort", { sessionKey: "main" })).ran).toBe(true);
    expect((await request("exec.approval.resolve", { id: "a1", decision: "deny" })).ran).toBe(true);
    expect((await request("exec.approval.resolve", { id: "a1", decision: "allow-once" })).ran).toBe(
      false,
    );
    expect(
      (await request("plugin.approval.resolve", { id: "a1", decision: "allow-always" })).ran,
    ).toBe(false);
    expect((await request("device.token.revoke", { deviceId: "d1", role: "operator" })).ran).toBe(
      true,
    );
    expect((await request("cron.update", { id: "j1", patch: { enabled: false } })).ran).toBe(true);
    expect((await request("cron.update", { id: "j1", patch: { enabled: true } })).ran).toBe(false);
    expect(
      (
        await request("cron.update", {
          id: "j1",
          patch: { enabled: false, schedule: { kind: "every", everyMs: 1 } },
        })
      ).ran,
    ).toBe(false);
  });

  it("lets only the owner switch Lockdown off; anyone admin may switch it on", async () => {
    expect((await request("config.patch", OFF, "owner-token")).ran).toBe(true);
    expect((await request("config.patch", OFF, "owner-device")).ran).toBe(true);
    const teammate = await request("config.patch", OFF, "teammate");
    expect(teammate.ran).toBe(false);
    expect(teammate.error?.message).toBe("Only the owner can switch Lockdown off.");
    expect((await request("config.patch", OFF, "agent")).ran).toBe(false);
    expect((await request("config.patch", ON, "teammate")).ran).toBe(true);
  });

  it("admits only a lockdown-only patch with no other parameters", async () => {
    expect(
      (
        await request("config.patch", {
          raw: '{"security":{"lockdown":false},"tools":{}}',
          baseHash: "h1",
        })
      ).ran,
    ).toBe(false);
    expect((await request("config.patch", { ...OFF, note: "x" })).ran).toBe(false);
    expect((await request("config.patch", { ...OFF, restartDelayMs: 0 })).ran).toBe(false);
    expect((await request("config.patch", { ...OFF, sessionKey: "agent:main:main" })).ran).toBe(
      false,
    );
  });

  it("admits everything once Lockdown is off", async () => {
    clearRuntimeConfigSnapshot();
    expect((await request("tts.enable")).ran).toBe(true);
    expect((await request("sessions.companion.ask")).ran).toBe(true);
  });
});
