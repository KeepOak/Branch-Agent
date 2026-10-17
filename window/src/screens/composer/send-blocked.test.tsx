// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../composer/engine";
import { CONNECT_MODEL_ANSWERS } from "../../composer/connect-model";
import { Composer } from "./Composer";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root | undefined;
beforeEach(() => { vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} }); });
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  localStorage.clear();
  vi.unstubAllGlobals();
});

async function mount() {
  const request = vi.fn(async (method: string) => {
    if (method === "agents.list") return { defaultId: "scout", agents: [{ id: "scout", name: "Scout" }] };
    if (method === "sessions.describe") return { session: { model: "openai/test" } };
    if (method === "sessions.list") return { defaults: { model: "openai/test" }, sessions: [] };
    if (method === "models.list") return { models: [] };
    if (method === "branch.setup.activate") {
      return { ok: false, error: "A free local model isn’t ready on this computer yet. Connecting an account makes answers smarter and faster." };
    }
    return {};
  });
  const engine = { sessionKey: "agent:scout:main", agentId: "scout", request: request as unknown as WindowEngine["request"], onEvent: () => () => {}, scopes: ["operator.admin"] } as WindowEngine;
  const send = vi.fn();
  const opened = vi.fn();
  const host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  await act(async () => root?.render(<Composer name="Scout" engine={engine} working={false} offline={false} onSend={send} onStop={() => {}} onToast={() => {}} onOpen={opened} onOpenConversation={() => {}}
    limits={{ updatedAt: 0, refreshing: false, rows: [] }} row={{ key: "agent:scout:main", title: "Main" } as never} topics={[]} running={[]} />));
  return { host, send, opened };
}

const type = async (host: HTMLElement, text: string) => act(async () => {
  const box = host.querySelector<HTMLTextAreaElement>('[data-testid="composer"]')!;
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(box, text);
  box.dispatchEvent(new Event("input", { bubbles: true }));
});

describe("send when no model can answer", () => {
  it("keeps the draft, disables Send, and shows the full Connect a model to get answers line", async () => {
    const { host, send } = await mount();
    await vi.waitFor(() => expect(host.querySelector('[data-testid="no-key-failed"]')?.textContent).toContain(CONNECT_MODEL_ANSWERS));
    await type(host, "Hello");
    const box = host.querySelector<HTMLTextAreaElement>('[data-testid="composer"]')!;
    const sendBtn = host.querySelector<HTMLButtonElement>('[aria-label="Send"]')!;
    expect(sendBtn.disabled).toBe(true);
    expect(sendBtn.title).toBe(CONNECT_MODEL_ANSWERS);
    await act(async () => box.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })));
    expect(box.value).toBe("Hello");
    expect(send).not.toHaveBeenCalled();
    const failed = host.querySelector('[data-testid="no-key-failed"]')!;
    expect(failed.textContent).toContain(CONNECT_MODEL_ANSWERS);
    expect(failed.textContent).not.toMatch(/\u2026|\.\.\./);
  });

  it("row names Connect a model to get answers as the one control", async () => {
    const { host, opened } = await mount();
    await vi.waitFor(() => expect(host.textContent).toContain(CONNECT_MODEL_ANSWERS));
    const row = [...host.querySelectorAll("button")].find((b) => b.textContent === CONNECT_MODEL_ANSWERS);
    expect(row).toBeTruthy();
    await act(async () => row!.click());
    expect(opened).toHaveBeenCalledWith("settings/accounts/add");
  });
});

describe("blocked send looks blocked and the banner wraps", () => {
  it("notes wrap in full and disabled Send is a quiet fill, not a faded ready control", () => {
    const css = readFileSync(resolve(__dirname, "composer.css"), "utf8");
    expect(css).toMatch(/\.r1c-note\s*\{[^}]*white-space:\s*normal/);
    expect(css).not.toMatch(/\.r1c-note\s*\{[^}]*text-overflow:\s*ellipsis/);
    expect(css).toMatch(/\.r1c-send:disabled\s*\{[^}]*cursor:\s*not-allowed/);
    expect(css).toMatch(/\.r1c-send:disabled\s*\{[^}]*background:\s*var\(--fill\)/);
  });
});
