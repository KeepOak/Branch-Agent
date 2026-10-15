// @vitest-environment jsdom
// A call that cannot start is a dead end unless the screen says so: one plain line and one way out, never a live-looking
// Mute with the engine's raw error under it.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { WindowEngine } from "../connect/engine";
import { VoiceScreen } from "./VoiceParts";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, host: HTMLDivElement;
beforeEach(() => { host = document.body.appendChild(document.createElement("div")); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

function engineThat(refuse: string): WindowEngine {
  const request = (method: string) => (method === "talk.session.create" ? Promise.reject(new Error(refuse)) : Promise.resolve({}));
  return { sessionKey: "agent:main:main", request, onEvent: () => () => undefined } as unknown as WindowEngine;
}

it("says a call cannot start in one plain line, with one way out and no dead controls", async () => {
  const onClose = vi.fn();
  await act(async () => root.render(<VoiceScreen engine={engineThat("Not supported")} name="Juniper" onClose={onClose} />));
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  const text = document.body.textContent ?? "";
  expect(text).toContain("Live voice isn’t available right now.");
  expect(text).not.toContain("Not supported");
  expect([...document.querySelectorAll("button")].map((b) => b.textContent)).toEqual(["Close"]);
  await act(async () => [...document.querySelectorAll("button")][0]!.click());
  expect(onClose).toHaveBeenCalledTimes(1);
});

it("offers no live call in a window that cannot reach a microphone", async () => {
  const { windowCanCall } = await import("./VoiceParts");
  expect(windowCanCall()).toBe(false);
});
