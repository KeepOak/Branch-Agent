// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import type { WindowEngine } from "../../../connect/engine";
import { AddAccountDialog, freshTokenLabel, loginChoiceRef, servicesOf, tokenProfileName } from "./add-account";
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

  it("groups duplicate services by preview section, names products, and keeps local runtimes off plans and keys", () => {
    const out = servicesOf([
      { provider: "minimax", loginOptions: [{ id: "minimax/oauth", kind: "oauth" }] },
      { provider: "minimax-portal", loginOptions: [{ id: "minimax-portal/oauth", kind: "oauth" }] },
      { provider: "google", apiKeySupported: true },
      { provider: "google-gemini", apiKeySupported: true },
      { provider: "microsoft-foundry", apiKeySupported: true },
      { provider: "opencode-go", apiKeySupported: true },
      { provider: "ollama-cloud", apiKeySupported: true },
      { provider: "huggingface", apiKeySupported: true },
      { provider: "litellm", apiKeySupported: true },
      { provider: "ollama", apiKeySupported: true },
      { provider: "lmstudio", apiKeySupported: true },
    ], [], {
      manualProviders: [{ id: "minimax-token", brandId: "minimax", label: "MiniMax token" }, { id: "ollama", brandId: "ollama", label: "Ollama" }],
      prepareOptions: [{ id: "ollama", label: "Ollama" }, { id: "lmstudio", label: "LM Studio" }, { id: "litellm", label: "LiteLLM" }],
    });
    expect(out.filter((s) => s.kind === "plan" && s.name === "MiniMax")).toHaveLength(1);
    expect(out.find((s) => s.name === "MiniMax")?.logins.map((l) => l.id)).toEqual(["minimax/oauth", "minimax-portal/oauth", "minimax-token"]);
    expect(out.filter((s) => s.kind === "key" && s.name === "Google Gemini")).toHaveLength(1);
    expect(out.filter((s) => s.kind === "local").map((s) => s.name)).toEqual(["Ollama", "LM Studio", "LiteLLM"]);
    expect(out.filter((s) => s.kind !== "local").map((s) => s.name)).not.toContain("Ollama");
    expect(out.filter((s) => s.kind === "key").map((s) => s.name)).toEqual(expect.arrayContaining(["Microsoft Foundry", "OpenCode Go", "Ollama Cloud", "Hugging Face"]));
  });
});

it("keeps the catalogue hidden until detection completes, then shows the preview's section order", async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  let finish!: (value: unknown) => void;
  const detected = new Promise((resolve) => { finish = resolve; });
  const engine = { request: () => detected } as unknown as WindowEngine;
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  try {
    await act(async () => root.render(createElement(AddAccountDialog, {
      engine, start: {}, caps: [
        { provider: "openai", loginOptions: [{ id: "openai/login", kind: "oauth" }] },
        { provider: "claude-cli", loginOptions: [{ id: "claude-cli/login", kind: "oauth" }] },
        { provider: "google", apiKeySupported: true },
      ], providers: [], agent: {}, onClose: () => undefined,
    })));
    expect(host.textContent).toContain("Looking for services…");
    expect(host.querySelectorAll(".aa-grp")).toHaveLength(0);
    expect(host.textContent).not.toContain("3 services");
    await act(async () => finish({ prepareOptions: [{ id: "ollama", label: "Ollama" }], authOptions: [{ id: "custom-api-key", kind: "custom", label: "Something else" }] }));
    expect([...host.querySelectorAll(".aa-grp h3")].map((h) => h.textContent?.replace(/\d+$/, "").trim())).toEqual(["Your plan", "Coding assistants", "A key", "On this computer", "Your own"]);
    expect(host.textContent).toContain("5 services");
    await act(async () => host.querySelector<HTMLButtonElement>(".aa-grp .prov")!.click());
    await act(async () => [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Back")!.click());
    expect(host.textContent).toContain("5 services");
    expect(host.querySelectorAll(".aa-grp")).toHaveLength(5);
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
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
