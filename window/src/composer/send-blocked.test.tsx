// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../connect/engine";
import { CONNECT_MODEL_ANSWERS } from "./connect-model";
import { Composer } from "./Composer";
import { FREE_MODEL_FAILED } from "./no-key-default";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.innerHTML = "";
  localStorage.clear();
});

describe("classic composer when no model can answer", () => {
  it("keeps the draft, disables Send, and names Connect a model to get answers", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "agents.list") return { agents: [{ id: "main", name: "Oak" }], defaultId: "main" };
      if (method === "models.list") return { models: [] };
      if (method === "branch.setup.activate") return { ok: false, error: "A free local model isn’t ready on this computer yet. Connecting an account makes answers smarter and faster." };
      return {};
    });
    const engine = { request: request as WindowEngine["request"], onEvent: () => () => undefined, sessionKey: "agent:main:empty", agentId: "main", scopes: [] } as WindowEngine;
    const onSend = vi.fn();
    const host = document.body.appendChild(document.createElement("div"));
    const root = createRoot(host);
    try {
      await act(async () => root.render(<Composer name="Oak" working={false} disabled={false} onSend={onSend} onStop={vi.fn()} engine={engine} />));
      await vi.waitFor(() => expect(host.querySelector('[data-testid="no-model"]')?.textContent).toContain(CONNECT_MODEL_ANSWERS));
      expect(FREE_MODEL_FAILED).toBe(CONNECT_MODEL_ANSWERS);
      const box = host.querySelector<HTMLTextAreaElement>('[data-testid="composer"]')!;
      await act(async () => {
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
        setter.call(box, "Keep this message");
        box.dispatchEvent(new Event("input", { bubbles: true }));
      });
      const sendBtn = host.querySelector<HTMLButtonElement>('[aria-label="Send"]')!;
      expect(sendBtn.disabled).toBe(true);
      await act(async () => box.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })));
      expect(box.value).toBe("Keep this message");
      expect(onSend).not.toHaveBeenCalled();
      expect(host.querySelector('[data-testid="no-model"]')?.textContent).toContain(CONNECT_MODEL_ANSWERS);
    } finally {
      await act(async () => root.unmount());
    }
  });
});

describe("classic send looks blocked", () => {
  it("disabled Send is visibly not-allowed", () => {
    const css = readFileSync(resolve(__dirname, "composer.css"), "utf8");
    expect(css).toMatch(/\.c-wrap \.send:disabled\s*\{[^}]*cursor:\s*not-allowed/);
  });
});
