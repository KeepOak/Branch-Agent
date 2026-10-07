import { describe, expect, it } from "vitest";
import { freshTokenLabel, loginChoiceRef, servicesOf, tokenProfileName } from "./add-account";
import { tokenLabel } from "./accounts";

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

  it("deduplicates plan services and reports configured local runtimes under On this computer", () => {
    const out = servicesOf([
      { provider: "minimax", loginOptions: [{ id: "minimax/oauth", kind: "oauth" }] },
      { provider: "minimax", loginOptions: [{ id: "minimax/oauth", kind: "oauth" }] },
      { provider: "opencode", loginOptions: [{ id: "opencode/oauth", kind: "oauth" }] },
      { provider: "chutes", apiKeySupported: true, loginOptions: [{ id: "chutes/oauth", kind: "oauth" }] },
      { provider: "llama-cpp", apiKeySupported: true },
      { provider: "lmstudio", apiKeySupported: true },
      { provider: "ollama", apiKeySupported: true },
    ], [], { prepareOptions: [{ id: "llama-cpp", label: "llama.cpp" }] }, [{ provider: "llama-cpp", id: "local", available: true }]);
    expect(out.filter((s) => s.kind === "plan").map((s) => s.brand)).toEqual(["minimax", "opencode", "chutes"]);
    expect(out.find((s) => s.brand === "chutes")?.keySupported).toBe(true);
    expect(out.filter((s) => s.brand === "chutes")).toHaveLength(1);
    expect(out.filter((s) => s.kind === "key")).toEqual([]);
    expect(out.filter((s) => s.kind === "local").map((s) => [s.brand, s.state])).toEqual([
      ["llama-cpp", "Ready to use"], ["lmstudio", "Not set up"], ["ollama", "Not set up"],
    ]);
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
    expect(freshTokenLabel("x".repeat(80), []).length).toBe(56);
  });

  it("starts the engine's sign-in by its plugin/choice ref", () => {
    expect(loginChoiceRef("anthropic", "setup-token")).toBe("anthropic/setup-token");
    expect(loginChoiceRef("openai", "openai/openai-device-code")).toBe("openai/openai-device-code");
  });

  it("does not show a generated hash id as a name", () => {
    expect(tokenLabel({ profileId: "anthropic:id-123456abcdef", type: "token" })).toBeUndefined();
    expect(tokenLabel({ profileId: "anthropic:work", type: "token" })).toBe("work");
  });
});
