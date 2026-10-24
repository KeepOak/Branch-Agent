// @vitest-environment jsdom
// Private #1093 point 6: at Regular, Settings > Updates "Already have the app?" Pair your phone opens the pairing dialog.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../../connect/engine";
import { UpdatesBlock } from "./updates";

let host: HTMLDivElement; let root: Root;
const engine: WindowEngine = { gatewayUrl: "ws://127.0.0.1:1", request: vi.fn(async () => ({})) as WindowEngine["request"], onEvent: () => () => {}, scopes: [], sessionKey: null };
const button = (text: string) => [...document.querySelectorAll("button")].find((b) => b.textContent === text);
const dialog = () => document.querySelector('[data-testid="pair"]');

beforeEach(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); document.body.innerHTML = ""; });

it("Pair your phone opens the pairing dialog at Regular, and Cancel closes it", async () => {
  await act(async () => root.render(<UpdatesBlock page="updates" title="Updates" level="regular" engine={engine} part="devices" />));
  expect(host.textContent).toContain("Already have the app?");
  const pair = button("Pair your phone")!;
  expect(pair).toBeTruthy();
  expect(pair.disabled).toBe(false);
  expect(dialog()).toBeNull();
  await act(async () => pair.click());
  expect(dialog()).not.toBeNull();
  expect(document.body.textContent).toContain("Pair a phone");
  expect(document.body.textContent).toContain("What it may do");
  await act(async () => button("Cancel")!.click());
  expect(dialog()).toBeNull();
});
