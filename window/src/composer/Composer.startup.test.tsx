// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../connect/engine";
import { Composer } from "./Composer";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.innerHTML = "";
  localStorage.clear();
});

describe("Composer startup preparation", () => {
  it("offers one account action when no model is connected", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "agents.list") return { agents: [{ id: "main", name: "Oak" }], defaultId: "main" };
      if (method === "branch.setup.activate") return new Promise(() => {});
      return {};
    });
    const engine = { request: request as WindowEngine["request"], onEvent: () => () => undefined, sessionKey: "agent:main:empty", agentId: "main", scopes: [] } as WindowEngine;
    const onOpen = vi.fn();
    const host = document.body.appendChild(document.createElement("div"));
    const root = createRoot(host);
    try {
      await act(async () => root.render(<Composer name="Oak" working={false} disabled={false} onSend={vi.fn()} onStop={vi.fn()} engine={engine} onOpen={onOpen} />));
      await vi.waitFor(() => expect(host.querySelector('[data-testid="connect-model"]')).not.toBeNull());
      const buttons = host.querySelectorAll<HTMLButtonElement>('[data-testid="connect-model"] button');
      expect(buttons).toHaveLength(1);
      expect(buttons[0].textContent).toBe("Connect a model");
      expect(host.textContent).toContain("Connect a model to get answers");
      await act(async () => buttons[0].click());
      expect(onOpen).toHaveBeenCalledExactlyOnceWith("settings/accounts/add");
    } finally { await act(async () => root.unmount()); }
  });
  it("shows the failure and Try again when a free model is not ready", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "agents.list") return { agents: [{ id: "main", name: "Oak" }], defaultId: "main" };
      if (method === "models.list") return { models: [] };
      if (method === "branch.setup.activate") return { ok: false, error: "A free local model isn’t ready on this computer yet. Connecting an account makes answers smarter and faster." };
      return {};
    });
    const engine = { request: request as WindowEngine["request"], onEvent: () => () => undefined, sessionKey: "agent:main:empty", agentId: "main", scopes: [] } as WindowEngine;
    const onOpen = vi.fn();
    const host = document.body.appendChild(document.createElement("div"));
    const root = createRoot(host);
    try {
      await act(async () => root.render(<Composer name="Oak" working={false} disabled={false} onSend={vi.fn()} onStop={vi.fn()} engine={engine} onOpen={onOpen} />));
      await vi.waitFor(() => expect(host.querySelector('[data-testid="connect-model"]')).not.toBeNull());
      const line = host.querySelector('[data-testid="connect-model"]')!;
      expect(line.textContent).toContain("Connect a model to get answers");
      expect(host.querySelector("textarea")?.getAttribute("placeholder")).not.toBe("Getting a free model ready…");
      const buttons = [...line.querySelectorAll<HTMLButtonElement>("button")].map((b) => b.textContent);
      expect(buttons).toEqual(["Connect a model", "Try again"]);
      await act(async () => line.querySelectorAll<HTMLButtonElement>("button")[1]!.click());
      expect(request.mock.calls.filter((c) => c[0] === "branch.setup.activate").length).toBe(2);
    } finally { await act(async () => root.unmount()); }
  });
  it("keeps the draft and sends nothing when Enter is pressed during preparation", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "agents.list") return { agents: [{ id: "main", name: "Oak" }], defaultId: "main" };
      if (method === "sessions.describe") return { session: { model: "openai/test" } };
      if (method === "sessions.list") return { defaults: { model: "openai/test" } };
      if (method === "models.list") throw new Error("models.list unavailable during gateway startup");
      return {};
    });
    const engine: WindowEngine = {
      request: request as WindowEngine["request"],
      onEvent: () => () => undefined,
      sessionKey: "agent:main:startup",
      agentId: "main",
      scopes: [],
    };
    const onSend = vi.fn();
    const host = document.body.appendChild(document.createElement("div"));
    const root = createRoot(host);
    try {
      await act(async () => root.render(<Composer name="Oak" working={false} disabled={false} onSend={onSend} onStop={vi.fn()} engine={engine} />));
      await vi.waitFor(() => expect(host.querySelector('[role="status"]')?.textContent).toContain("Getting Oak ready"));
      const box = host.querySelector<HTMLTextAreaElement>('[data-testid="composer"]')!;
      await act(async () => {
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
        setter.call(box, "Keep this message");
        box.dispatchEvent(new Event("input", { bubbles: true }));
      });
      expect(box.value).toBe("Keep this message");
      expect(host.querySelector<HTMLButtonElement>('[aria-label="Send"]')?.disabled).toBe(true);
      await act(async () => {
        box.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
      });
      expect(box.value).toBe("Keep this message");
      expect(onSend).not.toHaveBeenCalled();
    } finally {
      await act(async () => root.unmount());
    }
  });
});
