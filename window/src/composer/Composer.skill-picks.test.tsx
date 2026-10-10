// @vitest-environment jsdom
// Messages sent while a Trunk works go through the same send transform. Ctrl+Enter waits in line (the queued path):
// a picked skill runs from anywhere, and prose is kept as written. A typed leading command runs on send.
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../connect/engine";
import { Composer } from "./Composer";
import { loadLine } from "./queue";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const KEY = "agent:main:queued";

afterEach(() => {
  document.body.innerHTML = "";
  localStorage.clear();
});

function engineWithSkill(): WindowEngine {
  const request = vi.fn(async (method: string) => {
    if (method === "agents.list") return { agents: [{ id: "main", name: "Oak" }], defaultId: "main" };
    if (method === "sessions.describe") return { session: { model: "openai/test" } };
    if (method === "sessions.list") return { defaults: { model: "openai/test" } };
    if (method === "models.list") return { models: [{ id: "openai/test", provider: "openai", name: "Test", contextWindow: 32768 }] };
    if (method === "skills.status") return { skills: [{ name: "clawhub", skillKey: "clawhub", userInvocable: true, eligible: true, disabled: false, modelVisible: true }] };
    return {};
  });
  return { request: request as WindowEngine["request"], onEvent: () => () => undefined, sessionKey: KEY, agentId: "main", scopes: [] } as WindowEngine;
}

async function mount() {
  const onSend = vi.fn();
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  await act(async () => root.render(<Composer name="Oak" working disabled={false} onSend={onSend} onStop={vi.fn()} engine={engineWithSkill()} />));
  await vi.waitFor(() => expect(host.querySelector('[data-testid="composer"]')).not.toBeNull());
  const box = host.querySelector<HTMLTextAreaElement>('[data-testid="composer"]')!;
  return { host, root, box, onSend };
}

async function type(box: HTMLTextAreaElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(box, value);
    box.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function press(box: HTMLTextAreaElement, key: string, ctrlKey = false) {
  await act(async () => {
    box.dispatchEvent(new KeyboardEvent("keydown", { key, ctrlKey, bubbles: true, cancelable: true }));
  });
}

const queuedTexts = () => loadLine(localStorage, KEY).map((item) => item.text);

describe("messages sent while a Trunk works", () => {
  it("a typed leading /seedbank runs as the engine key on send", async () => {
    const { host, root, box, onSend } = await mount();
    try {
      await type(box, "/seedbank summarize this");
      await press(box, "Enter");
      await vi.waitFor(() => expect(onSend).toHaveBeenCalledWith("/clawhub summarize this", expect.anything()));
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });

  it("a queued message with a picked skill mid-message is stored as the engine key, with no hidden characters", async () => {
    const { host, root, box } = await mount();
    try {
      await type(box, "please /seed");
      await press(box, "Enter"); // the drawer is open: Enter picks the highlighted skill
      expect(box.value).toContain("/seedbank");
      await press(box, "Enter", true); // Ctrl+Enter waits in line
      await vi.waitFor(() => expect(queuedTexts()).toHaveLength(1));
      expect(queuedTexts()[0]).toMatch(/^please \/clawhub ?$/);
      expect(queuedTexts()[0]).not.toMatch(/⁠/);
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });

  it("a queued message that only mentions /seedbank is stored unchanged", async () => {
    const { host, root, box } = await mount();
    try {
      await type(box, "please use /seedbank now");
      await press(box, "Enter", true);
      await vi.waitFor(() => expect(queuedTexts()).toEqual(["please use /seedbank now"]));
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });
});
