// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../connect/engine";
import { CONNECT_MODEL_ANSWERS } from "./connect-model";
import { Composer } from "./Composer";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.innerHTML = "";
  localStorage.clear();
});

describe("classic composer send when no model can answer", () => {
  it("never swallows Enter: keeps the draft, sends nothing, and shows Connect a model to get answers", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "agents.list") return { agents: [{ id: "main", name: "Oak" }], defaultId: "main" };
      if (method === "models.list") return { models: [] };
      if (method === "branch.setup.activate") return { ok: false, error: "A free local model isn’t ready on this computer yet. Connecting an account makes answers smarter and faster." };
      return {};
    });
    const engine = { request: request as WindowEngine["request"], onEvent: () => () => undefined, sessionKey: "agent:main:empty", agentId: "main", scopes: [] } as WindowEngine;
    const onSend = vi.fn();
    const onOpen = vi.fn();
    const host = document.body.appendChild(document.createElement("div"));
    const root = createRoot(host);
    try {
      await act(async () => root.render(<Composer name="Oak" working={false} disabled={false} onSend={onSend} onStop={vi.fn()} engine={engine} onOpen={onOpen} />));
      await vi.waitFor(() => expect(host.querySelector('[data-testid="connect-model"]')?.textContent).toContain(CONNECT_MODEL_ANSWERS));
      const box = host.querySelector<HTMLTextAreaElement>('[data-testid="composer"]')!;
      await act(async () => {
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
        setter.call(box, "Keep this message");
        box.dispatchEvent(new Event("input", { bubbles: true }));
      });
      const sendBtn = host.querySelector<HTMLButtonElement>('[aria-label="Send"]')!;
      expect(sendBtn.disabled).toBe(true);
      expect(sendBtn.getAttribute("data-blocked")).toBe("true");
      await act(async () => box.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })));
      expect(box.value).toBe("Keep this message");
      expect(onSend).not.toHaveBeenCalled();
      expect(host.querySelector('[data-testid="connect-model"] button')?.textContent).toBe("Connect a model");
      await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="connect-model"] button')!.click());
      expect(onOpen).toHaveBeenCalledWith("settings/accounts/add");
    } finally {
      await act(async () => root.unmount());
    }
  });
});
