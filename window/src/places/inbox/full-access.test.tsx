// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ScopeUpgradeOutcome, WindowEngine } from "../../connect/engine";

/** Same scopes BranchGateway.requestScopeUpgrade sends (OPERATOR_SCOPES). */
const FULL_SCOPES = [
  "operator.admin",
  "operator.read",
  "operator.write",
  "operator.approvals",
  "operator.questions",
  "operator.pairing",
] as const;
import { dismiss, getToasts } from "../../shell/notify";
import { NeedsYou } from "./NeedsYou";
import type { Needs } from "./data";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  for (const toast of getToasts()) dismiss(toast.id);
});

const needs = (): Needs => ({
  approvals: [], proposals: [], pairing: [], ownerSet: false, devices: [], nodes: [], questions: [], mentions: [],
  failed: [], expired: [], channels: [], sessions: [], authByAgent: {},
  agents: { defaultId: "main", mainKey: "home", list: [{ id: "main", name: "Rowan", mode: "" }] },
  errors: [],
});

const rec = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const str = (value: unknown): string => typeof value === "string" ? value : "";

function limitedEngine(request: WindowEngine["request"], cancel = vi.fn()): WindowEngine {
  return {
    request,
    onEvent: () => () => {},
    sessionKey: null,
    scopes: ["operator.read"],
    cancelScopeUpgrade: cancel,
    requestScopeUpgrade: async (options) => {
      const registration = rec(await request("device.scopes.requestUpgrade", { scopes: [...FULL_SCOPES] }));
      const requestId = str(registration.requestId) || "upgrade-1";
      options?.onPending?.(requestId);
      return await request("device.scopes.waitUpgrade", { requestId }) as ScopeUpgradeOutcome;
    },
  };
}

async function render(engine: WindowEngine) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root!.render(
    <NeedsYou data={needs()} engine={engine} busy={false} act={async () => true} level="regular" loading={false} openConversation={() => {}} openPlace={() => {}} />,
  ));
  return host;
}

const btn = (host: ParentNode, label: string) => [...host.querySelectorAll("button")].filter(b => b.textContent?.trim() === label);
const card = (host: ParentNode) => [...host.querySelectorAll(".ib-card")].find(el => el.textContent?.includes("This device has limited access"));
const click = async (button: HTMLElement | undefined) => { await act(async () => { button!.click(); await Promise.resolve(); await Promise.resolve(); }); };
const toastText = () => getToasts().at(-1)?.text ?? "";

describe("Inbox › Needs you › Ask for full access", () => {
  it("enables Ask for full access on a limited device and shows Check again / Stop waiting after asking", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "device.scopes.requestUpgrade") return { requestId: "upgrade-1" };
      if (method === "device.scopes.waitUpgrade") return new Promise(() => {});
      return {};
    });
    const cancel = vi.fn();
    const host = await render(limitedEngine(request as WindowEngine["request"], cancel));
    const ask = btn(host, "Ask for full access")[0] as HTMLButtonElement;
    expect(ask.disabled).toBe(false);
    await click(ask);
    expect(request).toHaveBeenCalledWith("device.scopes.requestUpgrade", { scopes: [...FULL_SCOPES] });
    expect(toastText()).toBe("Asked. An owner sees it in their Inbox.");
    expect(card(host)?.textContent).toContain("Waiting for an owner to say yes in their Inbox or in People › Signing in.");
    expect(btn(host, "Check again")).toHaveLength(1);
    expect(btn(host, "Stop waiting")).toHaveLength(1);
    await click(btn(host, "Check again")[0]);
    expect(toastText()).toBe("No answer yet.");
    await click(btn(host, "Stop waiting")[0]);
    expect(cancel).toHaveBeenCalled();
    expect(btn(host, "Ask for full access")).toHaveLength(1);
    expect(card(host)?.textContent).toContain("You can look around, but some changes need an owner’s yes.");
  });

  it("shows that an owner said no, with Ask again", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "device.scopes.requestUpgrade") return { requestId: "upgrade-1" };
      if (method === "device.scopes.waitUpgrade") return { status: "rejected", requestId: "upgrade-1" };
      return {};
    });
    const host = await render(limitedEngine(request as WindowEngine["request"]));
    await click(btn(host, "Ask for full access")[0]);
    expect(card(host)?.textContent).toContain("An owner said no to full access.");
    expect(btn(host, "Ask again")).toHaveLength(1);
    expect(btn(host, "Ask for full access")).toHaveLength(0);
  });

  it("toasts a plain-words error and leaves Ask for full access usable", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "device.scopes.requestUpgrade") {
        throw new Error("device.scopes.requestUpgrade failed: pairing store is locked");
      }
      return {};
    });
    const host = await render(limitedEngine(request as WindowEngine["request"]));
    await click(btn(host, "Ask for full access")[0]);
    expect(toastText()).not.toMatch(/device\.scopes\.requestUpgrade|stack/i);
    expect(toastText().length).toBeGreaterThan(0);
    const ask = btn(host, "Ask for full access")[0] as HTMLButtonElement;
    expect(ask).toBeDefined();
    expect(ask.disabled).toBe(false);
  });

  it("shows that the request ran out of time", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "device.scopes.requestUpgrade") return { requestId: "upgrade-1" };
      if (method === "device.scopes.waitUpgrade") return { status: "expired", requestId: "upgrade-1" };
      return {};
    });
    const host = await render(limitedEngine(request as WindowEngine["request"]));
    await click(btn(host, "Ask for full access")[0]);
    expect(card(host)?.textContent).toContain("The request ran out of time. Ask again.");
    expect(btn(host, "Ask again")).toHaveLength(1);
  });
});
