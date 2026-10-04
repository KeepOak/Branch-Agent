// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../../connect/engine";
import { KitProvider, type SaveReport } from "../kit";
import { AccountsPage, accountsOf, movedUp, type Provider } from "./accounts";
import { servicesOf } from "./add-account";
import { BulkBar } from "./accounts-select";

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
    if (method === "models.authStatus") return { ts: 1, providers: PROVIDERS, providerCapabilities: CAPS };
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
  it("lists each provider's accounts in the engine's order, one list across providers", () => {
    const all = accountsOf(PROVIDERS);
    expect(all.map((a) => a.a.profileId)).toEqual(["openai:b", "openai:a", "anthropic:c"]);
    expect(movedUp(all[1], all)).toEqual(["openai:a", "openai:b"]);
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

  it.each(["Move to the top", "Sign out"])("locks bulk %s until the native mutation completes", async (label) => {
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => { finish = resolve; });
    const request = vi.fn(() => pending);
    const engine = { request } as unknown as WindowEngine;
    const done = vi.fn();
    const reload = vi.fn(async () => undefined);
    await act(async () => root.render(<KitProvider level={1} report={report} scope={null}><BulkBar engine={engine} all={accountsOf(PROVIDERS)} picked={["openai/openai:a"]} agent={{ agentId: "scout" }} reload={reload} done={done} /></KitProvider>));
    const buttons = [...host.querySelectorAll<HTMLButtonElement>("button")];
    const chosen = buttons.find((button) => button.textContent === label)!;
    await act(async () => { chosen.click(); chosen.click(); });
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0][0]).toBe(label === "Sign out" ? "models.authLogout" : "models.authOrderSet");
    expect(buttons.every((button) => button.disabled)).toBe(true);
    expect(done).not.toHaveBeenCalled();
    await act(async () => finish());
    expect(reload).toHaveBeenCalledTimes(1);
    expect(done).toHaveBeenCalledTimes(1);
  });

  it("keeps selection and unlocks bulk actions after a failed mutation", async () => {
    let fail = true;
    const request = vi.fn(async () => { if (fail) throw new Error("Sign out unavailable"); });
    const engine = { request } as unknown as WindowEngine;
    const done = vi.fn();
    const reload = vi.fn(async () => undefined);
    await act(async () => root.render(<KitProvider level={1} report={report} scope={null}><BulkBar engine={engine} all={accountsOf(PROVIDERS)} picked={["openai/openai:a"]} agent={{}} reload={reload} done={done} /></KitProvider>));
    const signOut = [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Sign out")!;
    await act(async () => signOut.click());
    expect(done).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
    expect(signOut.disabled).toBe(false);
    expect(host.textContent).toContain("1 selected");
    expect(report.failed).toHaveBeenCalledWith("Sign out unavailable");
    fail = false;
    await act(async () => signOut.click());
    expect(request).toHaveBeenCalledTimes(2);
    expect(done).toHaveBeenCalledTimes(1);
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
