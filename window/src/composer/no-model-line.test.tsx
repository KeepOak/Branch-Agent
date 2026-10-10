// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../connect/engine";
import { Composer } from "./Composer";
import { NO_ROUTE } from "./nav";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.innerHTML = "";
  localStorage.clear();
});

function engine(): WindowEngine {
  const request = vi.fn(async (method: string) => method === "agents.list" ? { agents: [{ id: "main", name: "Oak" }], defaultId: "main" } : {});
  return { request: request as WindowEngine["request"], onEvent: () => () => undefined, sessionKey: "agent:main:empty", agentId: "main", scopes: [] } as WindowEngine;
}

async function renderComposer(onOpen?: (target: string) => void) {
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  await act(async () => root.render(<Composer name="Oak" working={false} disabled={false} onSend={vi.fn()} onStop={vi.fn()} engine={engine()} onOpen={onOpen} />));
  await vi.waitFor(() => expect(host.querySelector('[data-testid="no-model"]')).not.toBeNull());
  return { host, root };
}

describe("NoModelLine", () => {
  it("matches the preview copy and opens Settings › Models and local setup", async () => {
    const onOpen = vi.fn();
    const { host, root } = await renderComposer(onOpen);
    try {
      const line = host.querySelector('[data-testid="no-model"]')!;
      expect(line.textContent).toBe("Please connect a model, or click here to set up a local model.");
      const buttons = host.querySelectorAll<HTMLButtonElement>('[data-testid="no-model"] button');
      expect(buttons).toHaveLength(2);
      expect(buttons[0].textContent).toBe("connect a model");
      expect(buttons[1].textContent).toBe("click here");
      await act(async () => buttons[0].click());
      expect(onOpen).toHaveBeenCalledWith("settings/models");
      await act(async () => buttons[1].click());
      expect(onOpen).toHaveBeenCalledWith("local-model-setup");
      expect(onOpen).toHaveBeenCalledTimes(2);
    } finally { await act(async () => root.unmount()); }
  });

  it("greys both links with NO_ROUTE when the window has no route", async () => {
    const { host, root } = await renderComposer();
    try {
      const buttons = host.querySelectorAll<HTMLButtonElement>('[data-testid="no-model"] button');
      expect(buttons).toHaveLength(2);
      expect([...buttons].every((button) => button.disabled && button.title === NO_ROUTE)).toBe(true);
    } finally { await act(async () => root.unmount()); }
  });
});
