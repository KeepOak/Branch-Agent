import { afterEach, describe, expect, it } from "vitest";
import {
  readAnthropicUnifiedRateLimits,
  recordAnthropicUnifiedRateLimits,
  resetAnthropicUnifiedRateLimitsForTest,
} from "../agents/auth-profiles/usage-rate-limits.js";
import { RECORDED_UNIFIED_HEADERS } from "../agents/auth-profiles/usage-rate-limits.test-support.js";
import { createProviderUsageFetch, makeResponse } from "../test-utils/provider-usage-fetch.js";
import { fetchClaudeUsage, resetClaudeUsageStateForTest } from "./provider-usage.fetch.claude.js";

const SETUP_TOKEN = "sk-ant-oat01-test-setup-token";
const PROFILE = "anthropic:work";
const scopeResponse = () =>
  makeResponse(403, {
    error: { message: "OAuth token does not meet scope requirement user:profile" },
  });
const messagesResponse = (headers: Record<string, string> = RECORDED_UNIFIED_HEADERS) =>
  new Response(JSON.stringify({ type: "message", content: [] }), { status: 200, headers });
const WINDOWS = [
  { label: "5h", usedPercent: 9, resetAt: 1_791_764_400_000 },
  { label: "Week", usedPercent: 1, resetAt: 1_792_360_800_000 },
];

function setupTokenFetch(onMessages = () => messagesResponse()) {
  return createProviderUsageFetch(async (url) =>
    url.includes("/api/oauth/usage") ? scopeResponse() : onMessages(),
  );
}

describe("fetchClaudeUsage with unified rate-limit headers", () => {
  afterEach(() => {
    resetClaudeUsageStateForTest();
    resetAnthropicUnifiedRateLimitsForTest();
  });

  it("reads a setup-token's 5h and weekly usage from one tiny refresh request", async () => {
    const fetch = setupTokenFetch();
    const result = await fetchClaudeUsage(SETUP_TOKEN, 5000, fetch, {
      authProfileId: PROFILE,
      isInCooldown: () => false,
    });
    expect(result).toEqual({ provider: "anthropic", displayName: "Claude", windows: WINDOWS });
    expect(fetch).toHaveBeenCalledTimes(2);
    const [url, init] = fetch.mock.calls[1];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    const body = JSON.parse(String(init?.body));
    expect(body).toMatchObject({ model: "claude-haiku-4-5", max_tokens: 1 });
    expect(new Headers(init?.headers).get("anthropic-beta")).toContain("oauth-2025-04-20");
    expect(readAnthropicUnifiedRateLimits({ profileId: PROFILE })?.fiveHour?.usedPercent).toBe(9);
  });

  it("uses a recent request's reading without asking again", async () => {
    recordAnthropicUnifiedRateLimits({ profileId: PROFILE, headers: RECORDED_UNIFIED_HEADERS });
    const fetch = setupTokenFetch();
    const first = await fetchClaudeUsage(SETUP_TOKEN, 5000, fetch, { authProfileId: PROFILE });
    const second = await fetchClaudeUsage(SETUP_TOKEN, 5000, fetch, { authProfileId: PROFILE });
    expect(first.windows).toEqual(WINDOWS);
    expect(second.windows).toEqual(WINDOWS);
    // Only the first oauth/usage 403; the scope result and the fresh reading are reused.
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      "https://api.anthropic.com/api/oauth/usage",
    ]);
  });

  it("refreshes an idle profile at most once per 30 minutes", async () => {
    const fetch = setupTokenFetch(() => messagesResponse({ "content-type": "application/json" }));
    const options = { authProfileId: PROFILE, isInCooldown: () => false };
    const first = await fetchClaudeUsage(SETUP_TOKEN, 5000, fetch, options);
    const second = await fetchClaudeUsage(SETUP_TOKEN, 5000, fetch, options);
    expect(first.signInNeeded).toBe(true);
    expect(second.signInNeeded).toBe(true);
    const messageCalls = fetch.mock.calls.filter(([url]) => String(url).endsWith("/v1/messages"));
    expect(messageCalls).toHaveLength(1);
  });

  it("sends no refresh while the profile cools down", async () => {
    const fetch = setupTokenFetch();
    const result = await fetchClaudeUsage(SETUP_TOKEN, 5000, fetch, {
      authProfileId: PROFILE,
      isInCooldown: () => true,
    });
    expect(result.signInNeeded).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("never spends a refresh on an API key", async () => {
    const fetch = setupTokenFetch();
    await fetchClaudeUsage("sk-ant-api03-key", 5000, fetch, { isInCooldown: () => false });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("prefers /api/oauth/usage when the token has user:profile", async () => {
    recordAnthropicUnifiedRateLimits({ profileId: PROFILE, headers: RECORDED_UNIFIED_HEADERS });
    const fetch = createProviderUsageFetch(async () =>
      makeResponse(200, { five_hour: { utilization: 40 }, seven_day: { utilization: 70 } }),
    );
    const result = await fetchClaudeUsage(SETUP_TOKEN, 5000, fetch, { authProfileId: PROFILE });
    expect(result.windows.map((window) => window.usedPercent)).toEqual([40, 70]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("shows the header reading while /api/oauth/usage is rate limited", async () => {
    recordAnthropicUnifiedRateLimits({ profileId: PROFILE, headers: RECORDED_UNIFIED_HEADERS });
    const fetch = createProviderUsageFetch(async () =>
      makeResponse(429, { error: { message: "Rate limited. Please try again later." } }),
    );
    const result = await fetchClaudeUsage(SETUP_TOKEN, 5000, fetch, { authProfileId: PROFILE });
    expect(result.error).toBeUndefined();
    expect(result.windows).toEqual(WINDOWS);
  });
});
