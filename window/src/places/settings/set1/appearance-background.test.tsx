// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import type { WindowEngine } from "../../../connect/engine";
import { BackgroundSec } from "./appearance-sections";
import { forgetLookStore, sceneFile, useLook } from "./appearance-store";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
it("AP2 previews supported backgrounds and applies each choice, including keyboard-native buttons", async () => {
  localStorage.clear();
  forgetLookStore();
  const prefs: Record<string, unknown> = { "ui.window.look": { bg: "painted", scene: "lake", season: "winter" } };
  const engine = { onEvent: () => () => undefined, request: vi.fn(async (method: string, params?: { entries: object }) => {
    if (method === "users.prefs.get") return { status: "ok", entries: prefs };
    if (method === "users.prefs.set") Object.assign(prefs, params?.entries);
    return { status: "ok" };
  }) } as unknown as WindowEngine;
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  function App() { return <BackgroundSec look={useLook(engine)} />; }
  try {
    await act(async () => root.render(<App />));
    const picker = host.querySelector('[role="group"][aria-label="Background style"]')!;
    expect(picker).not.toBeNull();
    const buttons = [...picker.querySelectorAll("button")];
    expect(buttons.map((b) => b.textContent)).toEqual(["None", "Landscape", "Seasonal"]);
    for (const [index, id] of ["none", "painted", "grove"].entries()) {
      const button = buttons[index];
      expect(button.type).toBe("button");
      const thumbnail = button.firstElementChild as HTMLElement;
      expect(thumbnail.getAttribute("aria-hidden")).toBe("true");
      if (id !== "none") expect(thumbnail.style.backgroundImage).toContain(sceneFile({ bg: id, scene: "lake", season: "winter" }));
      await act(async () => button.click());
      expect(button.getAttribute("aria-pressed")).toBe("true");
      expect(buttons.filter((b) => b.getAttribute("aria-pressed") === "true")).toHaveLength(1);
      expect((prefs["ui.window.look"] as Record<string, unknown>).bg ?? "none").toBe(id);
      expect(document.documentElement.hasAttribute("data-scene")).toBe(id !== "none");
    }
    expect(host.querySelector('[data-row="Season"]')).not.toBeNull();
    await act(async () => buttons[0].click());
    expect(host.querySelector('[data-row="Season"]')).toBeNull();
    expect(document.documentElement.hasAttribute("data-scene")).toBe(false);
  } finally {
    await act(async () => root.unmount());
    host.remove();
    forgetLookStore();
  }
});
