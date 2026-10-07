// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../../connect/engine";
import { KitProvider, type SaveReport } from "../kit";
import { AccountsPage, accountName, accountsOf, movedUp, type Provider } from "./accounts";
import { servicesOf } from "./add-account";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const PROVIDERS: Provider[] = [
  { provider: "openai", displayName: "OpenAI", status: "ok", profileOrder: ["openai:b", "openai:a"], profiles: [
    { profileId: "openai:a", type: "oauth", status: "ok", email: "a@example.test", logoutSupported: true },
    { profileId: "openai:b", type: "oauth", status: "ok", email: "b@example.test", logoutSupported: true }] },
  { provider: "anthropic", displayName: "Anthropic", status: "ok", profiles: [{ profileId: "anthropic:c", type: "token", status: "ok", displayName: "Max", source: "config" }] },
];
const CAPS = [
  { provider: "openai", apiKeySupported: true, loginOptions: [{ id: "openai", kind: "oauth", label: "Codex login (browser)", featured: true }] },
  { provider: "mistral", apiKeySupported: true, loginOptions: [] },
];

let root: Root;
let host: HTMLDivElement;
beforeEach(() => { host = document.body.appendChild(document.createElement("div")); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); document.body.innerHTML = ""; });

function engineOf(extra: Record<string, unknown> = {}) {
  const request = vi.fn(async (method: string) => {
    if (method === "models.authStatus") return extra[method] ?? { ts: 1, providers: PROVIDERS, providerCapabilities: CAPS };
    if (method === "config.get") return { hash: "h1", valid: true, config: {} };
    if (method in extra) return extra[method];
    return {};
  });
  const engine = { request, onEvent: () => () => undefined, sessionKey: "s", scopes: [] } as unknown as WindowEngine;
  return { engine, request };
}
const report: SaveReport = { saving: vi.fn(), saved: vi.fn(), failed: vi.fn() };
async function render(engine: WindowEngine, level: 0 | 1 | 2 = 0) {
  await act(async () => root.render(<KitProvider level={level} report={report} scope={null}><AccountsPage page="accounts" title="Accounts" level="regular" engine={engine} /></KitProvider>));
}

describe("Settings › Accounts", () => {
  it("opens Add directly when the no-model action routes here", async () => {
    sessionStorage.setItem("branch.openAddAccount", "1");
    const { engine } = engineOf({});
    await render(engine);
    expect(document.querySelector('[data-testid="add-account"]')).not.toBeNull();
    expect(sessionStorage.getItem("branch.openAddAccount")).toBeNull();
  });
  it("opens Claude browser sign-in first and keeps token paste collapsed", async () => {
    const { engine, request } = engineOf({
      "models.authStatus": { providers: PROVIDERS, providerCapabilities: [...CAPS, { provider: "anthropic", apiKeySupported: true, loginOptions: [{ id: "anthropic/claude-browser", kind: "oauth", label: "Sign in with Claude" }] }] },
      "branch.setup.detect": { manualProviders: [{ id: "setup-token", brandId: "anthropic", label: "Anthropic setup-token" }] },
    });
    await render(engine);
    await act(async () => [...host.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === "Add a Claude account")!.click());
    expect(document.querySelector('[data-testid="add-account"]')?.textContent).toContain("Sign in with Claude");
    const fallback = document.querySelector<HTMLDetailsElement>(".dlg details")!;
    expect(fallback.open).toBe(false);
    expect(fallback.textContent).not.toContain("claude setup-token");
    expect(fallback.textContent).not.toContain("terminal");
    await act(async () => [...document.querySelectorAll<HTMLButtonElement>(".dlg button")].find((b) => b.textContent === "Sign in with Claude")!.click());
    expect(request).toHaveBeenCalledWith("models.authLogin", expect.objectContaining({ authChoice: "anthropic/claude-browser" }));
  });
  it("lists each provider's accounts in the engine's order, one list across providers", () => {
    const all = accountsOf(PROVIDERS);
    expect(all.map((a) => a.a.profileId)).toEqual(["openai:b", "openai:a", "anthropic:c"]);
    expect(movedUp(all[1], all)).toEqual(["openai:a", "openai:b"]);
  });

  it("names each Claude subscription token as its own Claude account", () => {
    const p: Provider = { provider: "anthropic", displayName: "Claude", status: "ok", profileOrder: ["anthropic:setup-1"], profiles: [
      { profileId: "anthropic:setup-1", type: "token", status: "ok" }, { profileId: "anthropic:setup-2", type: "token", status: "ok" }] };
    expect(accountsOf([p]).map((acc) => accountName(acc))).toEqual(["Claude · Account 1", "Claude · Account 2"]);
  });

  it("names a labelled Claude sign-in by its label, as a ChatGPT account by its email", () => {
    const p: Provider = { provider: "anthropic", displayName: "Claude", status: "ok", profiles: [
      { profileId: "anthropic:claude", type: "token", status: "ok" }, { profileId: "anthropic:work", type: "token", status: "ok" },
      { profileId: "anthropic:default", type: "token", status: "ok" }] };
    expect(accountsOf([p]).map((acc) => accountName(acc))).toEqual(["Claude · claude", "Claude · work", "Claude · Account 3"]);
  });

  it("draws the designed rows from models.authStatus, never a credential", async () => {
    const { engine } = engineOf();
    await render(engine);
    expect([...host.querySelectorAll(".prow b")].map((b) => b.textContent)).toEqual(["ChatGPT · b@example.test", "ChatGPT · a@example.test", "Claude · Max"]);
    expect(host.textContent).toContain("3 accounts signed in");
    expect(host.querySelector(".prow .pill.ok")?.textContent).toBe("used next");
  });

  it("↑ saves the new order at once through models.authOrderSet", async () => {
    const { engine, request } = engineOf();
    await render(engine);
    const up = [...host.querySelectorAll<HTMLButtonElement>('button[aria-label="Move up"]')];
    expect(up[0].disabled).toBe(true);
    await act(async () => up[1].click());
    expect(request).toHaveBeenCalledWith("models.authOrderSet", { provider: "openai", profileIds: ["openai:a", "openai:b"] });
    expect(report.saved).toHaveBeenCalled();
  });

  it("Fall back to this computer adds the local model to the fallbacks", async () => {
    const { engine, request } = engineOf({ "models.list": { models: [{ id: "qwen3:8b", provider: "ollama", name: "Qwen3 8B", local: true }] }, "config.patch": { ok: true, hash: "h2", config: {} } });
    await render(engine);
    const sw = host.querySelector<HTMLInputElement>('input[aria-label="Fall back to this computer"]')!;
    expect(sw.disabled).toBe(false);
    await act(async () => sw.click());
    const patch = request.mock.calls.find(([m]) => m === "config.patch") as unknown as [string, { raw: string; baseHash: string }];
    expect(JSON.parse(patch[1].raw)).toEqual({ agents: { defaults: { model: { fallbacks: ["ollama/qwen3:8b"] } } } });
    expect(patch[1].baseHash).toBe("h1");
  });

  it("Select several signs out of the ticked accounts, one models.authLogout per service", async () => {
    const { engine, request } = engineOf();
    await render(engine, 1);
    await act(async () => [...host.querySelectorAll("button")].find((b) => b.textContent === "Select several")!.click());
    const boxes = [...host.querySelectorAll<HTMLInputElement>(".prow input.chk-acc")];
    expect(boxes).toHaveLength(3);
    await act(async () => boxes[0].click());
    await act(async () => boxes[1].click());
    expect(host.querySelector(".bulk-acc b")?.textContent).toBe("2 selected");
    await act(async () => [...host.querySelectorAll<HTMLButtonElement>(".bulk-acc button")].find((b) => b.textContent === "Sign out")!.click());
    expect(request).toHaveBeenCalledWith("models.authLogout", { provider: "openai", profileIds: ["openai:b", "openai:a"] });
    expect(request.mock.calls.filter(([m]) => m === "models.authLogout")).toHaveLength(1);
    expect(host.querySelector(".bulk-acc")).toBeNull();
  });

  it("Select several moves the ticked accounts to the top of their service's order", async () => {
    const { engine, request } = engineOf();
    await render(engine, 1);
    await act(async () => [...host.querySelectorAll("button")].find((b) => b.textContent === "Select several")!.click());
    await act(async () => host.querySelectorAll<HTMLInputElement>(".prow input.chk-acc")[1].click());
    await act(async () => [...host.querySelectorAll<HTMLButtonElement>(".bulk-acc button")].find((b) => b.textContent === "Move to the top")!.click());
    expect(request).toHaveBeenCalledWith("models.authOrderSet", { provider: "openai", profileIds: ["openai:a", "openai:b"] });
  });

  it("the wizard lists every service the engine can sign in to, by kind", () => {
    const services = servicesOf(CAPS, PROVIDERS, { prepareOptions: [{ id: "ollama", label: "Ollama" }] });
    expect(services.map((s) => [s.kind, s.name, s.signedIn])).toEqual([["plan", "ChatGPT", 2], ["key", "OpenAI", 0], ["key", "Mistral", 0], ["local", "Ollama", 0]]);
  });

  it("a key goes to models.authSetApiKey", async () => {
    const { engine, request } = engineOf({ "branch.setup.detect": { candidates: [] } });
    await render(engine);
    await act(async () => [...host.querySelectorAll("button")].find((b) => b.textContent === "Add an account")!.click());
    await act(async () => [...document.querySelectorAll<HTMLButtonElement>(".dlg .prov")].find((b) => b.textContent?.includes("Mistral"))!.click());
    const input = document.querySelector<HTMLInputElement>('.dlg input[aria-label="Key"]')!;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "sk-test"); input.dispatchEvent(new Event("input", { bubbles: true })); });
    await act(async () => [...document.querySelectorAll<HTMLButtonElement>(".dlg button")].find((b) => b.textContent === "Add key")!.click());
    expect(request).toHaveBeenCalledWith("models.authSetApiKey", { provider: "mistral", apiKey: "sk-test" });
  });

  it.each([
    { name: "   ", profileLabel: undefined },
    { name: "Work Account", profileLabel: "work-account" },
  ])("Claude sign-in sends the right models.authLogin params for name '$name'", async ({ name, profileLabel }) => {
    const { engine, request } = engineOf({ "branch.setup.detect": { manualProviders: [{ id: "setup-token", brandId: "anthropic", label: "Anthropic setup-token" }] } });
    await render(engine);
    await act(async () => [...host.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === "Add a Claude account")!.click());
    const input = document.querySelector<HTMLInputElement>('.dlg input[aria-label="Call it"]')!;
    expect(input.placeholder).toBe("Saved by email if blank");
    if (name) await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, name); input.dispatchEvent(new Event("input", { bubbles: true })); });
    if (!name.trim()) expect(document.querySelector(".dlg .hint")?.textContent).toContain("by its email");
    const token = document.querySelector<HTMLInputElement>('.dlg input[aria-label="Token"]')!;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(token, "sk-ant-oat01-test"); token.dispatchEvent(new Event("input", { bubbles: true })); });
    await act(async () => [...document.querySelectorAll<HTMLButtonElement>(".dlg button")].find((b) => b.textContent === "Sign in")!.click());
    const login = request.mock.calls.find(([method]) => method === "models.authLogin") as unknown as [string, Record<string, unknown>];
    expect(login[1]).toMatchObject({ authChoice: "anthropic/setup-token", sessionId: expect.any(String) });
    if (profileLabel) expect(login[1].profileLabel).toBe(profileLabel);
    else expect(login[1]).not.toHaveProperty("profileLabel");
  });
});

describe("Settings › Accounts on a partial engine reply", () => {
  it("renders every level, without crashing, when every reply is empty, GitHub's status included", async () => {
    const request = vi.fn(async () => ({}));
    const engine = { request, onEvent: () => () => undefined, sessionKey: "s", agentId: "main", scopes: ["operator.admin"] } as unknown as WindowEngine;
    for (const level of [0, 1, 2] as const) {
      await render(engine, level);
      await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
      expect(document.querySelector("h1")?.textContent).toBe("Accounts");
    }
  });
});
