import { describe, expect, it, vi } from "vitest";
import { resolveAnthropicTokenIdentity } from "./provider-auth-token.js";

describe("Anthropic setup-token account identity", () => {
  it("names two accounts by email without a shared manual slot", async () => {
    const fetchFn = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const token = String((init?.headers as Record<string, string>).Authorization).split(" ")[1];
      return new Response(JSON.stringify({ account: { uuid: `${token}-uuid`, email: `${token}@example.test` } }), { status: 200 });
    }) as unknown as typeof fetch;
    const first = await resolveAnthropicTokenIdentity("first", fetchFn);
    const second = await resolveAnthropicTokenIdentity("second", fetchFn);
    expect(first).toEqual({ profileId: "anthropic:first@example.test", email: "first@example.test", accountId: "first-uuid" });
    expect(second).toEqual({ profileId: "anthropic:second@example.test", email: "second@example.test", accountId: "second-uuid" });
    expect(new Set([first.profileId, second.profileId]).size).toBe(2);
  });

  it("reuses the same account slot when its token rotates", async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ account: { uuid: "same-uuid", email: "Same@Example.test" } }), { status: 200 })) as unknown as typeof fetch;
    const first = await resolveAnthropicTokenIdentity("old-token", fetchFn);
    const second = await resolveAnthropicTokenIdentity("new-token", fetchFn);
    expect(first.profileId).toBe("anthropic:same@example.test");
    expect(second.profileId).toBe(first.profileId);
  });

  it("keeps distinct tokens separate when the profile endpoint denies identity", async () => {
    const fetchFn = vi.fn(async () => new Response(null, { status: 403 })) as unknown as typeof fetch;
    const first = await resolveAnthropicTokenIdentity("first", fetchFn);
    const second = await resolveAnthropicTokenIdentity("second", fetchFn);
    expect(first.profileId).toMatch(/^anthropic:id-[0-9a-f]{12}$/);
    expect(second.profileId).not.toBe(first.profileId);
    expect((await resolveAnthropicTokenIdentity("first", fetchFn)).profileId).toBe(first.profileId);
  });
});
