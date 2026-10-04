// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import type { WindowEngine } from "../../../connect/engine";
import { KitProvider } from "../kit";
import { GENERAL_PREFS, usePrefs } from "./general-conversation";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it("keeps the newer choice when an earlier save fails afterwards", async () => {
  let failFirst!: (reason: Error) => void;
  let writes = 0;
  const request = vi.fn(async (method: string) => {
    if (method === "users.prefs.get") return { status: "ok", entries: {} };
    if (++writes === 1) return new Promise((_, reject) => { failFirst = reject; });
    return { status: "ok" };
  });
  const engine = { request, onEvent: () => () => undefined } as unknown as WindowEngine;
  let prefs!: ReturnType<typeof usePrefs>;
  function Probe() {
    prefs = usePrefs(engine);
    return <output>{String(prefs.get(GENERAL_PREFS.messageTimes))}</output>;
  }
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  try {
    await act(async () => root.render(<KitProvider level={1} scope={null} report={{ saving: vi.fn(), saved: vi.fn(), failed: vi.fn() }}><Probe /></KitProvider>));
    await act(async () => prefs.set(GENERAL_PREFS.messageTimes, "always"));
    await act(async () => prefs.set(GENERAL_PREFS.messageTimes, "never"));
    await act(async () => { failFirst(new Error("Earlier save failed")); });
    expect(host.textContent).toBe("never");
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
