// @vitest-environment jsdom
// Messages sent while a Trunk works wait in line with their display text (/seedbank) and their picks. The one sender
// resolves them when they go: a picked skill sends as /clawhub, a leading command resolves even after a reword, and
// prose is kept as written.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../connect/engine";
import { Composer } from "./Composer";
import { loadLine, reword, saveLine, type QueueItem } from "./queue";
import { newPick } from "./skill-picks";

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

async function mount(working: boolean) {
  const onSend = vi.fn();
  const engine = engineWithSkill();
  const host = document.body.appendChild(document.createElement("div"));
  const root: Root = createRoot(host);
  const render = (isWorking: boolean) => act(async () => root.render(<Composer name="Oak" working={isWorking} disabled={false} onSend={onSend} onStop={vi.fn()} engine={engine} />));
  await render(working);
  await vi.waitFor(() => expect(host.querySelector('[data-testid="composer"]')).not.toBeNull());
  const box = host.querySelector<HTMLTextAreaElement>('[data-testid="composer"]')!;
  return { host, root, box, onSend, render };
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

const queued = (): QueueItem[] => loadLine(localStorage, KEY);

async function cleanup(root: Root, host: HTMLElement) {
  await act(async () => root.unmount());
  host.remove();
}

describe("messages sent while a Trunk works", () => {
  it("a typed leading /seedbank runs as the engine key on send", async () => {
    const { host, root, box, onSend } = await mount(true);
    try {
      await type(box, "/seedbank summarize this");
      await press(box, "Enter");
      await vi.waitFor(() => expect(onSend.mock.calls[0]?.[0]).toBe("/clawhub summarize this"));
    } finally {
      await cleanup(root, host);
    }
  });

  it("a queued pick displays /seedbank in the waiting line, and sends /clawhub when the Trunk is free", async () => {
    const { host, root, box, onSend, render } = await mount(true);
    try {
      await type(box, "please /seed");
      await press(box, "Enter"); // the drawer is open: Enter picks the highlighted skill
      await press(box, "Enter", true); // Ctrl+Enter waits in line
      await vi.waitFor(() => expect(queued()).toHaveLength(1));
      expect(queued()[0].text).toBe("please /seedbank");
      expect(queued()[0].text).not.toMatch(/\/clawhub/);
      expect(onSend).not.toHaveBeenCalled();
      await render(false);
      await vi.waitFor(() => expect(onSend).toHaveBeenCalledWith("please /clawhub", expect.anything(), expect.any(String)));
      expect(queued()).toEqual([]);
    } finally {
      await cleanup(root, host);
    }
  });

  it("a queued leading command still resolves after it is reworded", async () => {
    const { host, root, onSend, render } = await mount(true);
    try {
      const id = "queued-leading";
      saveLine(localStorage, KEY, [{ id, text: "/seedbank summarize this", files: [], state: "waiting", picks: [newPick(0, "clawhub")] }]);
      // A reword in the waiting line: the pick's text changed, so it drops; the leading command still resolves at send.
      saveLine(localStorage, KEY, reword(loadLine(localStorage, KEY), id, "/Seedbank  summarize the invoices"));
      expect(queued()[0].picks).toEqual([]);
      await render(false);
      await vi.waitFor(() => expect(onSend).toHaveBeenCalledWith("/clawhub  summarize the invoices", expect.anything(), id));
    } finally {
      await cleanup(root, host);
    }
  });

  it("a queued message that only mentions /seedbank is sent unchanged", async () => {
    const { host, root, box, onSend, render } = await mount(true);
    try {
      await type(box, "please use /seedbank now");
      await press(box, "Enter", true);
      await vi.waitFor(() => expect(queued()).toHaveLength(1));
      await render(false);
      await vi.waitFor(() => expect(onSend).toHaveBeenCalledWith("please use /seedbank now", expect.anything(), expect.any(String)));
    } finally {
      await cleanup(root, host);
    }
  });
});
