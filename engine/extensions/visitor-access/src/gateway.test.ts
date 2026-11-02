import type { BranchConfig, BranchPluginApi } from "branch/plugin-sdk/plugin-entry";
import { createTestPluginApi } from "branch/plugin-sdk/plugin-test-api";
import { afterEach, describe, expect, it, vi } from "vitest";
import plugin from "../index.js";
import type { VisitorAccessService } from "./visitors.js";
import { describeVisitorPolicy } from "./policy-view.js";
import { visitorRuntimeStore } from "./runtime.js";

const TOKEN = "visitor-test-token-never-echo";
const ACCOUNT = "test-account-id";
const APP = "test-app-id";

const roles: NonNullable<BranchConfig["gateway"]>["roles"] = {
  default: "external-work",
  definitions: {
    "external-work": {
      accessPolicyPlugin: "visitor-access",
      sessions: { others: "view" },
      agents: ["main"],
      scopes: ["operator.sessions.write"],
      sandbox: "required",
      modelPolicy: {},
    },
  },
};

type Registered = {
  handler: (opts: {
    params?: Record<string, unknown>;
    respond: (ok: boolean, payload?: unknown, error?: { message?: string }) => void;
    hasCurrentClientAuthority?: () => boolean;
  }) => Promise<void>;
  opts?: { scope?: string };
};

function registeredMethods(): Map<string, Registered> {
  const methods = new Map<string, Registered>();
  const api = createTestPluginApi({
    id: "visitor-access",
    pluginConfig: {
      accountId: ACCOUNT,
      appId: APP,
      apiToken: TOKEN,
      policyName: "Visitors (branch-managed)",
      defaultTtlDays: 14,
      maxVisitors: 50,
    },
    registerGatewayMethod: (name, handler, opts) => {
      methods.set(name, { handler: handler as Registered["handler"], opts });
    },
    registerService() {},
    registerGatewayAccessPolicy() {},
  });
  api.runtime.state = {
    ...api.runtime.state,
    openKeyedStore: () => ({}) as ReturnType<BranchPluginApi["runtime"]["state"]["openKeyedStore"]>,
  };
  api.runtime.config = {
    current: () => ({ gateway: { roles } }),
    async mutateConfigFile() {
      throw new Error("Visitor operations must not change Gateway configuration");
    },
    async replaceConfigFile() {
      throw new Error("Visitor operations must not replace Gateway configuration");
    },
  };
  plugin.register(api);
  return methods;
}

async function call(
  methods: Map<string, Registered>,
  name: string,
  params: Record<string, unknown> = {},
  hasCurrentClientAuthority?: () => boolean,
) {
  const registered = methods.get(name);
  if (!registered) {
    throw new Error(`missing ${name}`);
  }
  let ok = false;
  let payload: unknown;
  let error: { message?: string } | undefined;
  await registered.handler({
    params,
    hasCurrentClientAuthority,
    respond: (nextOk, nextPayload, nextError) => {
      ok = nextOk;
      payload = nextPayload;
      error = nextError;
    },
  });
  return { ok, payload, error };
}

describe("visitor gateway methods", () => {
  afterEach(() => {
    visitorRuntimeStore.clearRuntime();
  });

  it("describes the access policy without infrastructure credentials", () => {
    const view = describeVisitorPolicy(
      {
        accountId: ACCOUNT,
        appId: APP,
        apiToken: TOKEN,
        policyName: "Visitors (branch-managed)",
        defaultTtlDays: 14,
        maxVisitors: 50,
      },
      roles,
    );
    expect(view).toEqual({
      managed: true,
      policyName: "Visitors (branch-managed)",
      defaultTtlDays: 14,
      maxVisitors: 50,
      roleId: "external-work",
      roleBound: true,
    });
    const text = JSON.stringify(view);
    expect(text).not.toContain(TOKEN);
    expect(text).not.toContain(ACCOUNT);
    expect(text).not.toContain(APP);
  });

  it("registers invite, revoke, list and the access policy for administrators", async () => {
    const methods = registeredMethods();
    expect([...methods.keys()].toSorted()).toEqual([
      "visitor.invite",
      "visitor.list",
      "visitor.policy",
      "visitor.revoke",
    ]);
    for (const name of methods.keys()) {
      expect(methods.get(name)?.opts?.scope).toBe("operator.admin");
    }
    const policy = await call(methods, "visitor.policy");
    expect(policy.ok).toBe(true);
    expect(policy.payload).toMatchObject({
      policy: { managed: true, policyName: "Visitors (branch-managed)", roleBound: true },
    });
    expect(JSON.stringify(policy.payload)).not.toContain(TOKEN);
  });

  it("forwards invite, list and revoke and redacts the token from failures", async () => {
    const methods = registeredMethods();
    const service = {
      invite: vi.fn(async () => ({
        text: "invited",
        details: { outcome: "invited", grantId: "g1", email: "ada@example.test" },
      })),
      list: vi.fn(async () => ({
        text: "listed",
        details: { counts: { recorded: 0 }, grants: [], unmanaged: [] },
      })),
      revoke: vi.fn(async () => ({
        text: "revoked",
        details: { outcome: "revoked", emails: ["ada@example.test"] },
      })),
    };
    visitorRuntimeStore.setRuntime({
      service: service as unknown as VisitorAccessService,
      errorText: (error) =>
        (error instanceof Error ? error.message : "failed").replaceAll(TOKEN, "[redacted]"),
    });
    const invited = await call(methods, "visitor.invite", { email: "ada@example.test", days: 7 });
    expect(invited.ok).toBe(true);
    expect(service.invite).toHaveBeenCalledWith(
      { email: "ada@example.test", days: 7 },
      expect.objectContaining({ invitedVia: "settings" }),
    );
    expect(await call(methods, "visitor.list")).toMatchObject({ ok: true });
    expect(await call(methods, "visitor.revoke", { email: "ada@example.test" })).toMatchObject({
      ok: true,
      payload: { outcome: "revoked" },
    });

    service.list.mockRejectedValueOnce(new Error(`provider failed with ${TOKEN}`));
    const failed = await call(methods, "visitor.list");
    expect(failed.ok).toBe(false);
    expect(failed.error?.message).toBe("provider failed with [redacted]");
    expect(failed.error?.message).not.toContain(TOKEN);
  });

  it("says invitations are managed when the Gateway service is not ready", async () => {
    const methods = registeredMethods();
    const listed = await call(methods, "visitor.list");
    expect(listed.ok).toBe(false);
    expect(listed.error?.message).toBe(
      "Visitor invitations are managed by this Branch and are not ready yet.",
    );
    expect(listed.error?.message).not.toMatch(/token/i);
  });

  it("stops a mutation when the caller is no longer authorized", async () => {
    const methods = registeredMethods();
    const invite = vi.fn(async (_raw: unknown, ctx: { assertCurrent: () => void }) => {
      ctx.assertCurrent();
      return { text: "no", details: {} };
    });
    visitorRuntimeStore.setRuntime({
      service: { invite } as unknown as VisitorAccessService,
      errorText: (error) => (error instanceof Error ? error.message : "failed"),
    });
    let checks = 0;
    const refused = await call(methods, "visitor.invite", { email: "ada@example.test" }, () => {
      checks += 1;
      return checks === 1;
    });
    expect(refused.ok).toBe(false);
    expect(refused.error?.message).toBe("This request is no longer authorized.");
    expect(invite).toHaveBeenCalled();
  });
});
