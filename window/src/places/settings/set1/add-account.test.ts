import { describe, expect, it } from "vitest";
import { servicesOf } from "./add-account";

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
