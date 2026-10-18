import { describe, expect, it } from "vitest";
import { detectCatalogueReady, freshAccount, freshTokenLabel, localSetupCopy, loginChoiceRef, serviceMatchesProvider, servicesOf, tokenProfileName } from "./add-account";
import { tokenLabel } from "./accounts";
import { serviceName } from "./service";

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
    expect(out.filter((s) => s.name === "Google Gemini" && s.kind === "plan")).toHaveLength(1);
    expect(out.filter((s) => s.name === "Google Gemini" && s.kind === "key")).toHaveLength(1);
    expect(out.filter((s) => s.name === "OpenRouter" && s.kind === "plan")).toHaveLength(1);
    expect(out.filter((s) => s.name === "xAI" && s.kind === "plan")).toHaveLength(1);
    expect(out.filter((s) => s.name === "MiniMax" && s.kind === "plan")).toHaveLength(1);
    expect(out.filter((s) => s.name === "MiniMax" && s.kind === "key")).toHaveLength(1);
    expect(names).toContain("LiteLLM");
    expect(names).toContain("Hugging Face");
    expect(names[0]).toBe("Ollama");
    expect(names).not.toContain("Litellm");
    expect(names).not.toContain("Huggingface");
    expect(localSetupCopy({ id: "local:ollama", brand: "ollama", name: "Ollama", kind: "local", signedIn: 0, logins: [] })).toMatch(/9\.6 GB/);
    expect(localSetupCopy({ id: "local:llama-cpp", brand: "llama-cpp", name: "llama.cpp", kind: "local", signedIn: 0, logins: [] })).toMatch(/few GB/);
    expect(localSetupCopy({ id: "local:lmstudio", brand: "lmstudio", name: "LM Studio", kind: "local", signedIn: 0, logins: [] })).toMatch(/several GB|LM Studio/i);
    const minimax = out.find((s) => s.name === "MiniMax" && s.kind === "plan");
    expect(minimax?.providers).toEqual(expect.arrayContaining(["minimax-portal"]));
    expect(serviceMatchesProvider(minimax!, "minimax-portal")).toBe(true);
    expect(freshAccount(
      [{ provider: "minimax-portal", displayName: "MiniMax", status: "ok", profiles: [{ profileId: "minimax-portal:work", type: "oauth", status: "ok", displayName: "Work" }] }],
      "minimax",
      [],
    )?.profile.profileId).toBe("minimax-portal:work");
  });

  it("lists each service once per section, keeps local runtimes off Your plan, and uses product names", () => {
    const caps = [
      { provider: "google", apiKeySupported: true, loginOptions: [{ id: "google-oauth", kind: "oauth" }] },
      { provider: "google-gemini", apiKeySupported: true },
      { provider: "minimax", apiKeySupported: true },
      { provider: "minimax-portal", loginOptions: [{ id: "minimax-oauth", kind: "oauth" }] },
      { provider: "ollama", loginOptions: [{ id: "ollama-login", kind: "oauth" }] },
      { provider: "lmstudio", loginOptions: [{ id: "lmstudio-login", kind: "device-code" }] },
      { provider: "opencode", loginOptions: [{ id: "opencode-login", kind: "oauth" }] },
      { provider: "microsoft-foundry", apiKeySupported: true },
      { provider: "huggingface", apiKeySupported: true },
      { provider: "litellm", apiKeySupported: true },
      { provider: "ollama-cloud", apiKeySupported: true },
      { provider: "opencode-go", apiKeySupported: true },
    ];
    const providers = [
      { provider: "microsoft-foundry", displayName: "Microsoft-foundry", status: "ok" as const, profiles: [] },
      { provider: "huggingface", displayName: "Huggingface", status: "ok" as const, profiles: [] },
      { provider: "litellm", displayName: "Litellm", status: "ok" as const, profiles: [] },
      { provider: "ollama-cloud", displayName: "Ollama-cloud", status: "ok" as const, profiles: [] },
      { provider: "opencode-go", displayName: "Opencode-go", status: "ok" as const, profiles: [] },
    ];
    const detect = {
      manualProviders: [
        { id: "minimax-token", brandId: "minimax", label: "MiniMax token" },
        { id: "ollama", brandId: "ollama", label: "Ollama" },
        { id: "lmstudio", brandId: "lmstudio", label: "LM Studio" },
        { id: "opencode", brandId: "opencode", label: "OpenCode" },
      ],
      prepareOptions: [
        { id: "ollama", brandId: "ollama", label: "Ollama" },
        { id: "lmstudio", brandId: "lmstudio", label: "LM Studio" },
        { id: "opencode", brandId: "opencode", label: "OpenCode" },
      ],
    };
    const early = servicesOf(caps, providers, undefined);
    const late = servicesOf(caps, providers, detect);
    for (const list of [early, late]) {
      expect(list.filter((s) => s.kind === "plan").map((s) => s.name)).not.toEqual(expect.arrayContaining(["Ollama", "LM Studio", "OpenCode"]));
      expect(list.filter((s) => s.kind === "local").map((s) => s.name).sort()).toEqual(["LM Studio", "Ollama", "OpenCode"]);
      expect(list.filter((s) => s.name === "MiniMax" && s.kind === "plan")).toHaveLength(1);
      expect(list.filter((s) => s.name === "Google Gemini" && s.kind === "key")).toHaveLength(1);
      expect(list.filter((s) => s.name === "Google Gemini" && s.kind === "plan")).toHaveLength(1);
      expect(list.map((s) => s.name)).toEqual(expect.arrayContaining(["Microsoft Foundry", "OpenCode Go", "Ollama Cloud", "Hugging Face", "LiteLLM"]));
      expect(list.map((s) => s.name).join("\n")).not.toMatch(/Microsoft-foundry|Opencode-go|Ollama-cloud|Huggingface|Litellm/);
      for (const kind of ["plan", "key", "local", "custom"] as const) {
        const names = list.filter((s) => s.kind === kind).map((s) => s.name);
        expect(names).toEqual([...new Set(names)]);
      }
    }
  });

  it("does not treat a stall as a finished catalogue", () => {
    expect(detectCatalogueReady({ loading: true })).toBe(false);
    expect(detectCatalogueReady({ loading: false, error: "Branch didn’t answer in time." })).toBe(true);
    expect(detectCatalogueReady({ loading: false, data: { prepareOptions: [] } })).toBe(true);
    expect(detectCatalogueReady({ loading: false, error: "The engine is offline." })).toBe(true);
  });
});

describe("serviceName", () => {
  it("never shows a capitalised provider id", () => {
    expect(serviceName("microsoft-foundry", "Microsoft-foundry")).toBe("Microsoft Foundry");
    expect(serviceName("opencode-go", "Opencode-go")).toBe("OpenCode Go");
    expect(serviceName("ollama-cloud", "Ollama-cloud")).toBe("Ollama Cloud");
    expect(serviceName("huggingface", "Huggingface")).toBe("Hugging Face");
    expect(serviceName("litellm", "Litellm")).toBe("LiteLLM");
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
