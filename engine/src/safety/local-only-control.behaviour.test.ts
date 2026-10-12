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
  type LocalOnlyControl,
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
        client({ isDeviceTokenAuth: true, pairedClientId: "phone-1", internal: { authenticatedOperator: true } }),
      ),
    ).toMatchObject({ kind: "paired-door", deviceId: "phone-1" });
    expect(resolveGatewayCaller(client({ internal: { authenticatedOperator: true } })).kind).toBe("remote");
    expect(resolveGatewayCaller(client({ internal: { syntheticClient: true } })).kind).toBe("in-process");
    expect(
      resolveGatewayCaller(client({ internal: { agentToolCaller: { agentId: "main", sessionKey: "agent:main:x" } } })),
    ).toMatchObject({ kind: "agent", turnSourceLocal: false, ownerAutomationGrant: false });
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
          isLocalWindow: (control?: LocalOnlyControl) => isLocalWindowCaller(caller(kind), control ?? "lockdown-off"),
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
          isLocalWindow: (control?: LocalOnlyControl) => isLocalWindowCaller(caller(kind), control ?? "lockdown-off"),
        }),
      ).toEqual({ admitted: true });
      expect(
        decideLocalOnlyControl({
          method: "config.patch",
          params: patch({ security: { lockdown: true } }),
          currentConfig: {},
          isLocalWindow: (control?: LocalOnlyControl) => isLocalWindowCaller(caller(kind), control ?? "lockdown-off"),
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

  it("G-1614: the window reconnecting on its stored device key on this computer is still the local window", () => {
    const window = client({
      isDeviceTokenAuth: true,
      pairedClientId: "window-1",
      internal: { isLocalClient: true, localWindowDevice: true, authenticatedOperator: true },
      authenticatedUserProfile: { profileId: GATEWAY_OWNER_PROFILE_ID, displayName: null, hasAvatar: false, updatedAt: 0 },
    });
    expect(resolveGatewayCaller(window).kind).toBe("owner-window");
    expect(authorizeLocalOnlyControlForMethod("cron.add", {}, resolveGatewayCaller(window), {})).toEqual({
      allowed: true,
    });
  });

  it("G-1614: a paired phone's key arriving over a local proxy or tunnel is a paired door and cannot switch Lockdown off", () => {
    const tunnelledPhone = client({
      isDeviceTokenAuth: true,
      pairedClientId: "phone-1",
      internal: { isLocalClient: true, authenticatedOperator: true },
      authenticatedUserProfile: { profileId: GATEWAY_OWNER_PROFILE_ID, displayName: null, hasAvatar: false, updatedAt: 0 },
    });
    const callerFacts = resolveGatewayCaller(tunnelledPhone);
    expect(callerFacts.kind).toBe("paired-door");
    expect(
      decideLockdownAdmission({
        method: "config.patch",
        params: patch({ security: { lockdown: false } }),
        scope: "operator.admin",
        isOwner: () => true,
        isLocalWindow: () => isLocalWindowCaller(callerFacts, "lockdown-off"),
      }),
    ).toEqual({ admitted: false, reason: "local-only" });
    expect(authorizeLocalOnlyControlForMethod("cron.add", {}, callerFacts, {}).allowed).toBe(false);
  });

  it("G-1614: the method gate holds even for a paired door with operator.admin", () => {
    const phone = client({
      isDeviceTokenAuth: true,
      pairedClientId: "phone-1",
      internal: { authenticatedOperator: true },
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

  const agent = (facts: { turnSourceLocal?: boolean; ownerAutomationGrant?: boolean }): GatewayCaller => ({
    kind: "agent",
    owner: false,
    local: false,
    ...facts,
  });

  it("G-1614: a Trunk run started from outside cannot add people, triggers, webhooks or chat setups", () => {
    const outside = agent({});
    for (const [method, params] of [
      ["config.patch", patch({ commands: { ownerAllowFrom: ["telegram:9"] } })],
      ["users.setRole", { profileId: "p", role: "admin" }],
      ["cron.add", { name: "nightly" }],
      ["config.patch", patch({ hooks: { mappings: [{ match: { path: "x" } }] } })],
      ["config.patch", patch({ channels: { telegram: { botToken: "t" } } })],
      ["config.apply", { raw: JSON.stringify({ tools: {} }) }],
    ] as const) {
      expect(authorizeLocalOnlyControlForMethod(method, params, outside, {}).allowed).toBe(false);
    }
  });

  it("G-1614: a Trunk on the owner's window turn may create triggers, webhooks and chat setups, never people", () => {
    const windowTurn = agent({ turnSourceLocal: true });
    expect(authorizeLocalOnlyControlForMethod("cron.add", {}, windowTurn, {})).toEqual({ allowed: true });
    expect(
      authorizeLocalOnlyControlForMethod("config.patch", patch({ channels: { telegram: { botToken: "t" } } }), windowTurn, {}),
    ).toEqual({ allowed: true });
    expect(authorizeLocalOnlyControlForMethod("config.apply", { raw: JSON.stringify({ tools: {} }) }, windowTurn, {})).toEqual({
      allowed: true,
    });
    for (const [method, params] of [
      ["config.patch", patch({ commands: { ownerAllowFrom: ["telegram:9"] } })],
      ["config.apply", { raw: JSON.stringify({ commands: { ownerAllowFrom: ["telegram:9"] } }) }],
      ["users.linkChannelIdentity", { channel: "telegram", senderId: "1" }],
      ["device.pair.setupCode", {}],
    ] as const) {
      expect(authorizeLocalOnlyControlForMethod(method, params, windowTurn, {}).allowed).toBe(false);
    }
    expect(isLocalWindowCaller(windowTurn, "lockdown-off")).toBe(false);
  });

  it("G-1614: the owner-bound cron management grant keeps letting a Trunk create a trigger, and nothing else", () => {
    const granted = agent({ ownerAutomationGrant: true });
    expect(authorizeLocalOnlyControlForMethod("cron.add", {}, granted, {})).toEqual({ allowed: true });
    expect(
      authorizeLocalOnlyControlForMethod("config.patch", patch({ hooks: { mappings: [{ match: { path: "x" } }] } }), granted, {}).allowed,
    ).toBe(false);
  });

  it("G-1614: a whole-config replacement keeping the same owners is not a person change", () => {
    const current = { commands: { ownerAllowFrom: ["telegram:1"] } };
    expect(classifyLocalOnlyControl("config.apply", { raw: JSON.stringify(current) }, current)).toBe("whole-config");
    expect(
      classifyLocalOnlyControl("config.apply", { raw: JSON.stringify({ commands: { ownerAllowFrom: ["telegram:1", "x:2"] } }) }, current),
    ).toBe("person");
  });
});
