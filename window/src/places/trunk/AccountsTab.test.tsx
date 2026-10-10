// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../connect/engine";
import { accountName, accountsOf, type Provider } from "../settings/set1/accounts";
import { AccountsPage } from "../settings/set1/accounts";
import { KitProvider } from "../settings/kit";
import { AccountsTab } from "./AccountsTab";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let host: HTMLDivElement;
beforeEach(() => { host = document.body.appendChild(document.createElement("div")); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); document.body.innerHTML = ""; });

describe("Trunk Accounts", () => {
  it("Settings lists two Claude subscriptions by email and offers one add button", async () => {
    const provider: Provider = { provider: "anthropic", displayName: "Claude", status: "ok", profiles: [
      { profileId: "anthropic:one@example.test", type: "token", status: "ok", email: "one@example.test" },
      { profileId: "anthropic:two@example.test", type: "token", status: "ok", email: "two@example.test" },
    ] };
    expect(accountsOf([provider]).map(accountName)).toEqual(["Claude · one@example.test", "Claude · two@example.test"]);
    const request = vi.fn(async (method: string) => method === "models.authStatus"
      ? { providers: [provider], providerCapabilities: [] }
      : method === "config.get" ? { hash: "test", valid: true, config: {} } : {});
    const engine = { request, onEvent: () => () => undefined, sessionKey: "test", scopes: [] } as unknown as WindowEngine;
    await act(async () => root.render(<KitProvider level={0} report={{ saving: vi.fn(), saved: vi.fn(), failed: vi.fn() }} scope={null}>
      <AccountsPage page="accounts" title="Accounts" level="regular" engine={engine} />
    </KitProvider>));
    expect([...host.querySelectorAll(".prow b")].map((item) => item.textContent)).toContain("Claude · one@example.test");
    expect([...host.querySelectorAll(".prow b")].map((item) => item.textContent)).toContain("Claude · two@example.test");
    expect([...host.querySelectorAll("button")].filter((button) => button.textContent === "Add a Claude account")).toHaveLength(1);
  });

  it("Add a Claude account selects setup-token after async provider discovery", async () => {
    let resolveDetect!: (value: unknown) => void;
    const detected = new Promise<unknown>((resolve) => { resolveDetect = resolve; });
    const request = vi.fn(async (method: string) => method === "models.authStatus"
      ? { providers: [], providerCapabilities: [{ provider: "anthropic", apiKeySupported: true, loginOptions: [] }] }
      : method === "branch.setup.detect" ? detected
      : method === "config.get" ? { hash: "test", valid: true, config: {} } : {});
    const engine = { request, onEvent: () => () => undefined, sessionKey: "test", scopes: [] } as unknown as WindowEngine;
    await act(async () => root.render(<KitProvider level={0} report={{ saving: vi.fn(), saved: vi.fn(), failed: vi.fn() }} scope={null}>
      <AccountsPage page="accounts" title="Accounts" level="regular" engine={engine} />
    </KitProvider>));
    await act(async () => [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Add a Claude account")!.click());
    expect(document.querySelector('[data-testid="add-account"]')?.textContent).toContain("Which service is the new account with?");
    expect(document.querySelector('[data-testid="add-account"]')?.textContent).not.toContain("Add key");
    await act(async () => resolveDetect({ manualProviders: [{ id: "setup-token", brandId: "anthropic", label: "Anthropic setup-token" }] }));
    expect(document.querySelector('[data-testid="add-account"]')?.textContent).toContain("Claude");
    expect(document.querySelector('[data-testid="add-account"]')?.textContent).toContain("Paste a token instead");
    expect(document.querySelector('[data-testid="add-account"]')?.textContent).not.toContain("Add key");
  });

  it("reorders selected accounts by drag and Use any clears the Trunk override", async () => {
    let order: string[] | undefined = ["anthropic:one@example.test", "anthropic:two@example.test"];
    const request = vi.fn(async (method: string, params: Record<string, unknown>) => {
      if (method === "models.authOrderSet") { order = params.profileIds as string[] | undefined; return {}; }
      if (method === "models.authStatus") return { providers: [{
        provider: "anthropic", displayName: "Claude", status: "ok", profileOrder: order,
        profileOrderStored: Boolean(order), profiles: [
          { profileId: "anthropic:one@example.test", type: "token", status: "ok", email: "one@example.test" },
          { profileId: "anthropic:two@example.test", type: "token", status: "ok", email: "two@example.test" },
        ],
      }] };
      return {};
    });
    const engine = { request, scopes: ["operator.admin"] } as unknown as WindowEngine;
    await act(async () => root.render(<AccountsTab engine={engine} agentId="oak" />));
    const rows = () => [...host.querySelectorAll<HTMLLIElement>(".tk-accounts-list li")];
    await act(async () => { rows()[0].dispatchEvent(new Event("dragstart", { bubbles: true })); });
    await act(async () => {
      rows()[1].dispatchEvent(new Event("dragover", { bubbles: true, cancelable: true }));
      rows()[1].dispatchEvent(new Event("drop", { bubbles: true, cancelable: true }));
    });
    expect(request).toHaveBeenCalledWith("models.authOrderSet", {
      provider: "anthropic", agentId: "oak", profileIds: ["anthropic:two@example.test", "anthropic:one@example.test"],
    });
    await act(async () => [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Use any")!.click());
    expect(request).toHaveBeenCalledWith("models.authOrderSet", { provider: "anthropic", agentId: "oak" });
  });

  it("a new Trunk with no account says so loudly, offers Sign in an account, and Use my accounts turns the owner's accounts off and on", async () => {
    let useOwnerAccounts: boolean | undefined;
    const patches: unknown[] = [];
    const request = vi.fn(async (method: string, params: Record<string, unknown>) => {
      if (method === "config.get") return { hash: `h${patches.length}`, valid: true, config: { agents: { entries: { "mac-builder-1": useOwnerAccounts === undefined ? {} : { useOwnerAccounts } } } } };
      if (method === "config.patch") {
        const patch = JSON.parse(params.raw as string);
        patches.push(patch);
        const value = patch.agents.entries["mac-builder-1"].useOwnerAccounts;
        useOwnerAccounts = value === null ? undefined : value;
        return { ok: true };
      }
      if (method === "models.authStatus") return { providers: [] };
      return {};
    });
    const engine = { request, scopes: ["operator.admin"] } as unknown as WindowEngine;
    await act(async () => root.render(<AccountsTab engine={engine} agentId="mac-builder-1" />));
    const alert = host.querySelector('[data-testid="no-account"]')!;
    expect(alert.getAttribute("role")).toBe("alert");
    expect(alert.textContent).toContain("no model account");
    let page = "";
    const listen = (event: Event) => { page = (event as CustomEvent<{ page?: string }>).detail?.page ?? ""; };
    window.addEventListener("branch:navigate-settings", listen);
    await act(async () => [...alert.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Sign in an account")!.click());
    window.removeEventListener("branch:navigate-settings", listen);
    expect(page).toBe("accounts");
    const toggle = () => host.querySelector<HTMLInputElement>('[data-testid="use-owner-accounts"]')!;
    expect(toggle().checked).toBe(true);
    expect(toggle().disabled).toBe(false);
    await act(async () => toggle().click());
    expect(patches[0]).toEqual({ agents: { entries: { "mac-builder-1": { useOwnerAccounts: false } } } });
    expect(request).toHaveBeenCalledWith("config.patch", expect.objectContaining({ baseHash: "h0" }));
    expect(toggle().checked).toBe(false);
    await act(async () => toggle().click());
    expect(patches[1]).toEqual({ agents: { entries: { "mac-builder-1": { useOwnerAccounts: null } } } });
    expect(toggle().checked).toBe(true);
  });

  it("disables locked and read-only controls and hides raw static status", async () => {
    const provider = { provider: "anthropic", displayName: "Claude", status: "ok", profileOrderStored: true,
      profileOrder: ["anthropic:id-123456abcdef"], profileOrderLocked: "config",
      profiles: [{ profileId: "anthropic:id-123456abcdef", type: "token", status: "static" },
        { profileId: "anthropic:other", type: "token", status: "static" }] };
    const request = vi.fn(async () => ({ providers: [provider] }));
    const engine = { request, scopes: [] } as unknown as WindowEngine;
    await act(async () => root.render(<AccountsTab engine={engine} agentId="oak" />));
    expect([...host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].every((input) => input.disabled)).toBe(true);
    const useAny = [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Use any")!;
    expect(useAny.disabled).toBe(true);
    expect(useAny.title).toContain("settings file");
    expect(host.textContent).not.toContain("static");
    // Opaque token IDs use the P61 account label in both Settings and Trunk.
    expect(host.textContent).toContain("Claude · Account 1");
    expect(request).not.toHaveBeenCalledWith("models.authOrderSet", expect.anything());
  });
});
