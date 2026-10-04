import { describe, expect, it } from "vitest";
import { freshTokenLabel, loginChoiceRef, servicesOf, tokenProfileName } from "./add-account";

describe("servicesOf", () => {
  const caps = [
    { provider: "anthropic", apiKeySupported: true },
    { provider: "openai", apiKeySupported: true, loginOptions: [{ id: "openai/openai-device-code", kind: "device-code", featured: true }] },
  ];
  const detect = { manualProviders: [
    { id: "apiKey", brandId: "anthropic", label: "Anthropic API key" },
    { id: "setup-token", brandId: "anthropic", label: "Anthropic setup-token", groupLabel: "Anthropic" },
    { id: "openai-api-key", brandId: "openai", label: "OpenAI API Key" },
  ] };

  it("offers Claude's setup-token as a plan sign-in and keeps keys under keys", () => {
    const out = servicesOf(caps, [], detect);
    const claude = out.find((s) => s.id === "plan:anthropic");
    expect(claude?.logins.map((l) => [l.id, l.kind])).toEqual([["setup-token", "setup-secret"]]);
    expect(out.some((s) => s.id === "key:anthropic")).toBe(true);
    expect(out.find((s) => s.id === "plan:openai")?.logins.map((l) => l.id)).toEqual(["openai/openai-device-code"]);
  });
});

describe("a new Claude sign-in's label", () => {
  it("is claude, then claude-2, claude-3… skipping every existing anthropic account", () => {
    expect(freshTokenLabel("", ["openai:claude", "anthropic:manual"])).toBe("claude");
    expect(freshTokenLabel("", ["anthropic:claude"])).toBe("claude-2");
    expect(freshTokenLabel("", ["anthropic:claude", "anthropic:claude-2"])).toBe("claude-3");
  });

  it("uses the typed name as the engine stores it, never replacing another account", () => {
    expect(tokenProfileName("  Work Account! ")).toBe("work-account");
    expect(tokenProfileName("***")).toBe("default");
    expect(freshTokenLabel("Work Account", [])).toBe("work-account");
    expect(freshTokenLabel("Manual", ["anthropic:manual"])).toBe("manual-2");
  });

  it("starts the engine's sign-in by its plugin/choice ref", () => {
    expect(loginChoiceRef("anthropic", "setup-token")).toBe("anthropic/setup-token");
    expect(loginChoiceRef("openai", "openai/openai-device-code")).toBe("openai/openai-device-code");
  });
});
