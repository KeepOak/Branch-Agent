import { createTestPluginApi } from "branch/plugin-sdk/plugin-test-api";
import { describe, expect, it, vi } from "vitest";
import plugin from "./index.js";

type Handler = (opts: {
  params: Record<string, unknown>;
  respond: (ok: boolean, payload?: unknown, error?: unknown) => void;
}) => void;

function registerWith(pluginConfig: Record<string, unknown>) {
  const methods = new Map<string, { handler: Handler; opts: unknown }>();
  const registerCli = vi.fn();
  plugin.register(
    createTestPluginApi({
      id: "bitwarden",
      name: "Bitwarden",
      source: "test",
      config: {},
      pluginConfig,
      runtime: {
        config: {
          current: () => ({
            plugins: { entries: { bitwarden: { enabled: true, config: pluginConfig } } },
          }),
        },
        state: { resolveStateDir: () => "/tmp/branch-bitwarden-test" },
      } as never,
      registerCli,
      registerGatewayMethod: ((name: string, handler: Handler, opts: unknown) => {
        methods.set(name, { handler, opts });
      }) as never,
    }),
  );
  const call = (name: string, params: Record<string, unknown>) => {
    const respond = vi.fn();
    methods.get(name)?.handler({ params, respond });
    return respond.mock.calls[0] as [boolean, unknown, unknown];
  };
  return { methods, registerCli, call };
}

describe("bitwarden plugin", () => {
  const pluginConfig = {
    signIns: { github: { item: "GitHub", sites: ["github.com"], totp: true } },
  };

  it("registers the CLI and read-only sign-in gateway methods", () => {
    const { methods, registerCli } = registerWith(pluginConfig);
    expect(registerCli).toHaveBeenCalledTimes(1);
    expect([...methods.keys()]).toEqual(["bitwarden.signins.list", "bitwarden.signins.match"]);
    for (const { opts } of methods.values()) {
      expect(opts).toEqual({ scope: "operator.read" });
    }
  });

  it("returns the fill list as references only", () => {
    const { call } = registerWith(pluginConfig);
    const [ok, payload] = call("bitwarden.signins.list", {});
    expect(ok).toBe(true);
    expect(payload).toEqual({
      providerAlias: "bitwarden",
      signIns: [
        {
          slug: "github",
          sites: ["github.com"],
          refs: {
            username: { source: "exec", provider: "bitwarden", id: "GitHub/username" },
            password: { source: "exec", provider: "bitwarden", id: "GitHub/password" },
            totp: { source: "exec", provider: "bitwarden", id: "GitHub/totp" },
          },
        },
      ],
    });
    expect(call("bitwarden.signins.list", { extra: 1 })[0]).toBe(false);
  });

  it("matches sign-ins for a page and validates the url", () => {
    const { call } = registerWith(pluginConfig);
    const [ok, payload] = call("bitwarden.signins.match", { url: "https://github.com/login" });
    expect(ok).toBe(true);
    expect((payload as { signIns: Array<{ slug: string }> }).signIns.map((s) => s.slug)).toEqual([
      "github",
    ]);
    expect(call("bitwarden.signins.match", { url: "https://example.com/" })[1]).toEqual({
      providerAlias: "bitwarden",
      signIns: [],
    });
    expect(call("bitwarden.signins.match", {})[0]).toBe(false);
  });

  it("reports an invalid sign-in config instead of throwing", () => {
    const { call } = registerWith({
      signIns: { github: { item: "GitHub", sites: ["*.github.com"] } },
    });
    const [ok, , error] = call("bitwarden.signins.list", {});
    expect(ok).toBe(false);
    expect(error).toMatchObject({ code: "INVALID_REQUEST" });
  });
});
