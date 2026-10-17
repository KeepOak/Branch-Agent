// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../../connect/engine";
import { AddAccountDialog } from "./add-account";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../stall", () => ({
  STALL_MS: 0,
  STALL_TEXT: "Branch didn’t answer in time.",
  stallAfter: (onStall: () => void) => {
    onStall();
    return () => undefined;
  },
  stalledRead: <T,>(read: Promise<T>) => read,
}));

const CAPS = [
  { provider: "anthropic", apiKeySupported: true, loginOptions: [{ id: "claude-oauth", kind: "oauth", groupLabel: "Claude" }] },
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

const DETECT = {
  manualProviders: [
    { id: "setup-token", brandId: "anthropic", label: "Anthropic setup-token" },
    { id: "minimax-token", brandId: "minimax", label: "MiniMax token" },
    { id: "ollama", brandId: "ollama", label: "Ollama" },
  ],
  prepareOptions: [
    { id: "ollama", brandId: "ollama", label: "Ollama" },
    { id: "lmstudio", brandId: "lmstudio", label: "LM Studio" },
    { id: "opencode", brandId: "opencode", label: "OpenCode" },
  ],
  authOptions: [{ id: "custom-endpoint", kind: "custom", label: "Your own" }],
};

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = "";
});

function dialog() {
  return document.querySelector('[data-testid="add-account"]');
}

function catalogue() {
  const node = dialog();
  return {
    lede: node?.querySelector(".aa-lede")?.textContent ?? "",
    tabs: [...(node?.querySelectorAll('[role="tab"]') ?? [])].map((tab) => tab.textContent),
    tiles: [...(node?.querySelectorAll(".aa-grp .prov") ?? [])].map((tile) => ({
      section: tile.closest(".aa-grp")?.querySelector("h3")?.childNodes[0]?.textContent?.trim() ?? "",
      name: tile.querySelector(":scope > b")?.textContent ?? "",
      sub: tile.querySelector("small")?.textContent ?? "",
    })),
  };
}

function engineOf(request: (method: string) => Promise<unknown>) {
  return { request, onEvent: () => () => undefined, sessionKey: "s", agentId: "main", scopes: [] } as unknown as WindowEngine;
}

function namesIn(shown: ReturnType<typeof catalogue>, section: string) {
  return shown.tiles.filter((tile) => tile.section === section).map((tile) => tile.name);
}

describe("Add an account catalogue", () => {
  it("stays the same after backing out of a sign-in when detect arrives late", async () => {
    let resolveDetect!: (value: unknown) => void;
    const detected = new Promise<unknown>((resolve) => { resolveDetect = resolve; });
    const request = vi.fn(async (method: string) => (method === "branch.setup.detect" ? detected : {}));
    await act(async () => root.render(
      <AddAccountDialog engine={engineOf(request)} start={{}} caps={CAPS} providers={[]} agent={{ agentId: "main" }} onClose={() => undefined} />,
    ));
    await act(async () => { await Promise.resolve(); });
    expect(document.querySelector('[data-testid="add-account-loading"]')).toBeNull();
    expect(dialog()?.textContent).toContain("Branch didn’t answer in time.");
    const before = catalogue();
    expect(before.lede).toMatch(/\d+ services/);
    expect(before.tabs).toEqual(expect.arrayContaining(["All", "Your plan", "A key", "On this computer"]));
    expect(namesIn(before, "Your plan")).not.toEqual(expect.arrayContaining(["Ollama", "LM Studio", "OpenCode"]));
    expect(namesIn(before, "On this computer")).toEqual(expect.arrayContaining(["Ollama", "LM Studio", "OpenCode"]));
    expect(namesIn(before, "Your plan").filter((name) => name === "MiniMax")).toHaveLength(1);
    expect(namesIn(before, "A key").filter((name) => name === "Google Gemini")).toHaveLength(1);
    expect(before.tiles.map((tile) => tile.name)).toEqual(expect.arrayContaining(["Microsoft Foundry", "OpenCode Go", "Ollama Cloud", "Hugging Face", "LiteLLM"]));
    expect(before.tiles.some((tile) => tile.section === "A key" && tile.sub.includes("a key"))).toBe(true);
    expect(before.tiles.some((tile) => tile.section === "Your plan" && tile.sub.includes("your plan"))).toBe(true);

    await act(async () => [...document.querySelectorAll<HTMLButtonElement>(".dlg .prov")].find((button) => button.textContent?.includes("Claude"))!.click());
    expect(dialog()?.querySelector("h2")?.textContent).toMatch(/Claude/);
    await act(async () => resolveDetect(DETECT));
    await act(async () => [...document.querySelectorAll<HTMLButtonElement>(".dlg-f button")].find((button) => button.textContent === "Back")!.click());
    expect(catalogue()).toEqual(before);
  });

  it("shows the service list after detect stalls without resolving", async () => {
    const request = vi.fn(async (method: string) => (method === "branch.setup.detect" ? new Promise(() => undefined) : {}));
    await act(async () => root.render(
      <AddAccountDialog engine={engineOf(request)} start={{}} caps={CAPS} providers={[]} agent={{ agentId: "main" }} onClose={() => undefined} />,
    ));
    await act(async () => { await Promise.resolve(); });
    expect(document.querySelector('[data-testid="add-account-loading"]')).toBeNull();
    expect(dialog()?.textContent).toContain("Branch didn’t answer in time.");
    const shown = catalogue();
    expect(shown.lede).toMatch(/\d+ services/);
    expect(shown.tiles.map((tile) => tile.name)).toEqual(expect.arrayContaining(["Claude", "Google Gemini", "Ollama"]));
    expect(namesIn(shown, "Your own")).toHaveLength(0);
  });

  it("rebuilds the catalogue when capabilities arrive after an empty first render", async () => {
    const request = vi.fn(async (method: string) => (method === "branch.setup.detect" ? DETECT : {}));
    const engine = engineOf(request);
    const close = () => undefined;
    await act(async () => root.render(
      <AddAccountDialog engine={engine} start={{}} caps={[]} providers={[]} agent={{ agentId: "main" }} onClose={close} />,
    ));
    await act(async () => { await Promise.resolve(); });
    const empty = catalogue();
    expect(document.querySelector('[data-testid="add-account-loading"]')).toBeNull();
    expect(empty.tiles.map((tile) => tile.name)).not.toEqual(expect.arrayContaining(["Claude", "Google Gemini"]));
    await act(async () => root.render(
      <AddAccountDialog engine={engine} start={{}} caps={CAPS} providers={[]} agent={{ agentId: "main" }} onClose={close} />,
    ));
    await act(async () => { await Promise.resolve(); });
    const filled = catalogue();
    expect(filled.lede).toMatch(/\d+ services/);
    expect(filled.tiles.map((tile) => tile.name)).toEqual(expect.arrayContaining(["Claude", "Google Gemini", "Ollama"]));
    expect(filled.tiles.length).toBeGreaterThan(empty.tiles.length);
  });
});
