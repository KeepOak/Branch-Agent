// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../connect/engine";
import { shouldShowThreadColumn } from "../shell/ThreadColumn";
import { SettingsFrame } from "./SettingsFrame";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const engine: WindowEngine = { request: vi.fn(async () => ({})) as WindowEngine["request"], onEvent: () => () => {}, sessionKey: "test", scopes: [] };
let root: Root | undefined;
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe("narrow window", () => {
  it("collapses the thread column below 900px but keeps it at 900px and above", () => {
    const props = { chat: true, focus: false, stage: false, draft: false, generalKey: "agent:oak:main", topicRow: false };
    for (const viewportWidth of [760, 880, 899.5]) expect(shouldShowThreadColumn({ ...props, viewportWidth })).toBe(false);
    for (const viewportWidth of [900, 1280]) expect(shouldShowThreadColumn({ ...props, viewportWidth })).toBe(true);
  });

  it("uses a working Settings page select under 900px and restores links after resizing", async () => {
    let width = 880;
    const listeners = new Set<() => void>();
    vi.stubGlobal("matchMedia", (query: string) => ({
      get matches() { return query === "(max-width: 1000px)" ? width <= 1000 : width < 900; },
      addEventListener: (_: string, listener: () => void) => listeners.add(listener),
      removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
    }));
    const host = document.body.appendChild(document.createElement("div"));
    root = createRoot(host);
    const onPage = vi.fn();
    await act(async () => root?.render(<SettingsFrame page="general" backName="Oak" engine={engine} onPage={onPage} onBack={() => {}} />));
    const select = host.querySelector<HTMLSelectElement>('select[aria-label="Settings page"]');
    expect(select).not.toBeNull();
    expect(select?.value).toBe("general");
    expect(host.querySelector(".set-nav .set-item")).toBeNull();
    const destination = select!.options[1].value;
    await act(async () => { select!.value = destination; select!.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(onPage).toHaveBeenCalledWith(destination);
    await act(async () => { width = 1280; listeners.forEach((listener) => listener()); });
    expect(host.querySelector('select[aria-label="Settings page"]')).toBeNull();
    expect(host.querySelector('.set-item[data-page="general"]')).not.toBeNull();
    await act(async () => { width = 880; listeners.forEach((listener) => listener()); });
    expect(host.querySelector('select[aria-label="Settings page"]')).not.toBeNull();
  });
});
