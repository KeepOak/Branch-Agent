import { afterEach, describe, expect, it, vi } from "vitest";
import { xaiUserAgent, xaiUserAgentHeaderFor } from "./xai-user-agent.js";

vi.mock("branch/plugin-sdk/agent-harness-runtime", () => {
  throw new Error("xAI attribution must not load the harness execution runtime");
});

describe("xaiUserAgent", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("prefers BRANCH_VERSION env over the bundled package version", () => {
    vi.stubEnv("BRANCH_VERSION", "2026.3.22");
    expect(xaiUserAgent()).toBe("branch/2026.3.22");
  });
});

describe("xaiUserAgentHeaderFor", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("emits User-Agent for the xAI-native host", () => {
    vi.stubEnv("BRANCH_VERSION", "2026.3.22");
    expect(xaiUserAgentHeaderFor("https://api.x.ai/v1")).toEqual({
      "User-Agent": "branch/2026.3.22",
    });
    expect(xaiUserAgentHeaderFor("https://api.x.ai/v1/tts")).toEqual({
      "User-Agent": "branch/2026.3.22",
    });
  });

  it("withholds User-Agent on user-configured proxy baseUrls", () => {
    vi.stubEnv("BRANCH_VERSION", "2026.3.22");
    expect(xaiUserAgentHeaderFor("https://my-corp.proxy/xai/v1")).toEqual({});
    expect(xaiUserAgentHeaderFor("http://127.0.0.1:8080/v1")).toEqual({});
    expect(xaiUserAgentHeaderFor("https://api.grok.x.ai/v1")).toEqual({});
  });

  it("returns an empty record for missing or invalid input", () => {
    expect(xaiUserAgentHeaderFor(undefined)).toEqual({});
    expect(xaiUserAgentHeaderFor("")).toEqual({});
    expect(xaiUserAgentHeaderFor("not a url")).toEqual({});
  });
});
