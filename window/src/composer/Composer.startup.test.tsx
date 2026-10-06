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
