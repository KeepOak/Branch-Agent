import { afterEach, describe, expect, it, vi } from "vitest";
import { loginAnthropicOAuth } from "branch/plugin-sdk/provider-oauth-runtime";
import { runAnthropicBrowserAuth } from "./auth.runtime.js";

vi.mock("branch/plugin-sdk/provider-oauth-runtime", () => ({ loginAnthropicOAuth: vi.fn() }));

afterEach(() => vi.restoreAllMocks());

describe("Claude browser account sign-in", () => {
  it("saves the captured OAuth credential under the account email", async () => {
    const access = "sk-ant-oat01-private-access";
    vi.mocked(loginAnthropicOAuth).mockImplementation(async (callbacks) => {
      callbacks.onAuth({ url: "https://claude.ai/oauth/authorize?test=1", instructions: "Sign in" });
      callbacks.onProgress?.("Finishing sign-in…");
      return { access, refresh: "private-refresh", expires: Date.now() + 3_600_000 };
    });
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ account: { email: "owner@example.test", uuid: "account-1" } }) })));
    const opened = vi.fn(async () => undefined);
    const stop = vi.fn();
    const result = await runAnthropicBrowserAuth({
      openUrl: opened,
      prompter: { progress: () => ({ update: vi.fn(), stop }) },
      isRemote: false,
      assertCurrent: vi.fn(),
    } as never, "anthropic/claude-sonnet-4-6");
    expect(opened).toHaveBeenCalledWith("https://claude.ai/oauth/authorize?test=1");
    expect(result.profiles[0]).toMatchObject({ profileId: "anthropic:owner@example.test", credential: { type: "oauth", provider: "anthropic", email: "owner@example.test", access, refresh: "private-refresh" } });
    expect(stop).toHaveBeenCalledWith("Claude sign-in complete");
  });
});
