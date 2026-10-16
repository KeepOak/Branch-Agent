import { describe, expect, it } from "vitest";
import { freshTokenLabel, localSetupCopy, loginChoiceRef, servicesOf, tokenProfileName } from "./add-account";
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
    expect(out.find((s) => s.brand === "anthropic")?.keySupported).toBe(true);
    expect(out.find((s) => s.id === "plan:openai")?.logins.map((l) => l.id)).toEqual(["openai/openai-device-code"]);
  });

  it("dedupes brands, uses plain names, and ranks local first", () => {
    const out = servicesOf(
      [
        { provider: "google", apiKeySupported: true, loginOptions: [{ id: "google-oauth", kind: "oauth" }] },
        { provider: "openrouter", apiKeySupported: true, loginOptions: [{ id: "openrouter-oauth", kind: "oauth" }] },
        { provider: "xai", apiKeySupported: true, loginOptions: [{ id: "xai-oauth", kind: "oauth" }] },
        { provider: "minimax", apiKeySupported: true },
        { provider: "minimax-portal", loginOptions: [{ id: "minimax-oauth", kind: "oauth" }] },
        { provider: "litellm", apiKeySupported: true },
        { provider: "huggingface", apiKeySupported: true },
      ],
      [],
      { prepareOptions: [{ id: "ollama", brandId: "ollama", label: "Ollama" }] },
    );
    const names = out.map((s) => s.name);
    expect(names.filter((n) => n === "Google Gemini")).toHaveLength(1);
    expect(names.filter((n) => n === "OpenRouter")).toHaveLength(1);
    expect(names.filter((n) => n === "xAI")).toHaveLength(1);
    expect(names.filter((n) => n === "MiniMax")).toHaveLength(1);
    expect(names).toContain("LiteLLM");
    expect(names).toContain("Hugging Face");
    expect(names[0]).toBe("Ollama");
    expect(names).not.toContain("Litellm");
    expect(names).not.toContain("Huggingface");
    expect(localSetupCopy({ id: "local:ollama", brand: "ollama", name: "Ollama", kind: "local", signedIn: 0, logins: [] })).toMatch(/9\.6 GB/);
    expect(localSetupCopy({ id: "local:llama-cpp", brand: "llama-cpp", name: "llama.cpp", kind: "local", signedIn: 0, logins: [] })).toMatch(/few GB/);
    expect(localSetupCopy({ id: "local:lmstudio", brand: "lmstudio", name: "LM Studio", kind: "local", signedIn: 0, logins: [] })).toMatch(/several GB|LM Studio/i);
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
