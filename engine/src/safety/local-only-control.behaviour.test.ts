// Behaviour tests for atlas SAFETY-0194 (G-1614): local-only control changes, and the caller facts they use.
import { describe, expect, it } from "vitest";
import { GATEWAY_OWNER_PROFILE_ID } from "../../packages/gateway-protocol/src/schema/users.js";
import { decideLocalOnlyControl, decideLockdownAdmission } from "../config/lockdown-policy.js";
import { authorizeLocalOnlyControlForMethod } from "../gateway/method-scopes.js";
import type { GatewayClient } from "../gateway/server-methods/client-types.js";
import { resolveGatewayCaller, type GatewayCaller } from "./caller-identity.js";
import {
  classifyLocalOnlyControl,
  isLocalWindowCaller,
  patchAddsEntries,
} from "./local-only-control.js";

const caller = (kind: GatewayCaller["kind"]): GatewayCaller => ({ kind, owner: true, local: kind !== "remote" });
const patch = (value: unknown) => ({ raw: JSON.stringify(value), baseHash: "h" });

function client(overrides: Partial<GatewayClient> & { internal?: GatewayClient["internal"] }): GatewayClient {
  return {
    connect: { role: "operator", scopes: ["operator.admin"] } as unknown as GatewayClient["connect"],
    ...overrides,
  };
}

describe("caller identity", () => {
  it("resolves handshake facts into one frozen caller", () => {
    const window = resolveGatewayCaller(
      client({
        internal: { isLocalClient: true, authenticatedOperator: true },
        authenticatedUserProfile: {
          profileId: GATEWAY_OWNER_PROFILE_ID,
          displayName: null,
          hasAvatar: false,
          updatedAt: 0,
        },
      }),
    );
    expect(window).toMatchObject({ kind: "owner-window", local: true, owner: true });
    expect(
      resolveGatewayCaller(client({ internal: { isLocalClient: true, authenticatedOperator: true } })).kind,
    ).toBe("local-operator");
    expect(Object.isFrozen(window)).toBe(true);
    expect(
      resolveGatewayCaller(
        client({ isDeviceTokenAuth: true, pairedClientId: "phone-1", internal: { isLocalClient: true } }),
      ),
    ).toMatchObject({ kind: "paired-door", deviceId: "phone-1" });
    expect(resolveGatewayCaller(client({ internal: { authenticatedOperator: true } })).kind).toBe("remote");
    expect(resolveGatewayCaller(client({ internal: { syntheticClient: true } })).kind).toBe("in-process");
    expect(resolveGatewayCaller(null).kind).toBe("in-process");
  });
});

describe("G-1614 local-only control changes", () => {
  it("G-1614: switching Lockdown off from a paired door, a phone key or off this computer is refused", () => {
    for (const kind of ["paired-door", "remote"] as const) {
      expect(
        decideLockdownAdmission({
          method: "config.patch",
          params: patch({ security: { lockdown: false } }),
          scope: "operator.admin",
          isOwner: () => true,
          isLocalWindow: () => isLocalWindowCaller(caller(kind)),
        }),
      ).toEqual({ admitted: false, reason: "local-only" });
    }
    expect(
      decideLockdownAdmission({
        method: "config.patch",
        params: patch({ security: { lockdown: false } }),
        scope: "operator.admin",
        isOwner: () => true,
        isLocalWindow: () => isLocalWindowCaller(caller("owner-window")),
      }),
    ).toEqual({ admitted: true });
  });

  it("G-1614: switching Lockdown on stays allowed from anywhere", () => {
    for (const kind of ["paired-door", "remote", "owner-window"] as const) {
      expect(
        decideLockdownAdmission({
          method: "config.patch",
          params: patch({ security: { lockdown: true } }),
          scope: "operator.admin",
          isOwner: () => false,
          isLocalWindow: () => isLocalWindowCaller(caller(kind)),
        }),
      ).toEqual({ admitted: true });
      expect(
        decideLocalOnlyControl({
          method: "config.patch",
          params: patch({ security: { lockdown: true } }),
          currentConfig: {},
          isLocalWindow: () => isLocalWindowCaller(caller(kind)),
        }),
      ).toEqual({ admitted: true });
    }
  });

  it("G-1614: webhooks, triggers, chat setups, sign-in codes and people are created only from the local window", () => {
    const cases: Array<[string, unknown, string]> = [
      ["config.patch", patch({ hooks: { mappings: [{ match: { path: "x" } }] } }), "webhook"],
      ["cron.add", { name: "nightly" }, "trigger"],
      ["config.patch", patch({ channels: { telegram: { botToken: "t" } } }), "chat-setup"],
      ["web.login.start", {}, "chat-setup"],
      ["device.pair.setupCode", {}, "sign-in-code"],
      ["users.linkChannelIdentity", { channel: "telegram", senderId: "1" }, "person"],
      ["channels.pairing.approve", { channel: "telegram", requestId: "r", bootstrapCommandOwner: true }, "person"],
      ["config.patch", patch({ commands: { ownerAllowFrom: ["telegram:9"] } }), "person"],
    ];
    for (const [method, params, control] of cases) {
      for (const kind of ["paired-door", "remote"] as const) {
        expect(authorizeLocalOnlyControlForMethod(method, params, caller(kind), {})).toEqual({
          allowed: false,
          control,
        });
      }
      for (const kind of ["owner-window", "local-operator", "in-process"] as const) {
        expect(authorizeLocalOnlyControlForMethod(method, params, caller(kind), {})).toEqual({ allowed: true });
      }
    }
  });

  it("G-1614: editing an existing setting or approving a sender from a paired door is not a creation", () => {
    const current = { channels: { telegram: { botToken: "t", enabled: true } }, hooks: { mappings: [] } };
    for (const [method, params] of [
      ["config.patch", patch({ channels: { telegram: { enabled: false, streaming: "off" } } })],
      ["config.patch", patch({ hooks: { mappings: [] } })],
      ["channels.pairing.approve", { channel: "telegram", requestId: "r" }],
      ["cron.update", { id: "a", patch: { enabled: false } }],
      ["chat.send", { sessionKey: "agent:main:main", message: "hi" }],
    ] as const) {
      expect(classifyLocalOnlyControl(method, params, current)).toBeUndefined();
      expect(authorizeLocalOnlyControlForMethod(method, params, caller("paired-door"), current)).toEqual({
        allowed: true,
      });
    }
    expect(patchAddsEntries({ accounts: { work: { token: "x" } } }, { accounts: {} })).toBe(true);
    expect(patchAddsEntries({ enabled: true }, { token: "x" })).toBe(false);
  });

  it("G-1614: the method gate holds even for a paired door with operator.admin", () => {
    const phone = client({
      isDeviceTokenAuth: true,
      pairedClientId: "phone-1",
      internal: { isLocalClient: true, authenticatedOperator: true },
    });
    expect(authorizeLocalOnlyControlForMethod("cron.add", {}, resolveGatewayCaller(phone), {})).toEqual({
      allowed: false,
      control: "trigger",
    });
  });

  it("owner window on full access is asked nothing new", () => {
    const owner = caller("owner-window");
    for (const method of ["cron.add", "config.apply", "device.pair.setupCode", "users.setRole"]) {
      expect(authorizeLocalOnlyControlForMethod(method, {}, owner, {})).toEqual({ allowed: true });
    }
  });
});
