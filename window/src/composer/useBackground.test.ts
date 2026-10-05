import { afterEach, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useBackground } from "./useBackground";
import type { WindowEngine } from "./engine";

let root: Root | null = null;
let host: HTMLDivElement | null = null;
afterEach(() => { if (root) act(() => root?.unmount()); host?.remove(); root = null; host = null; });

it("background jobs start as titled topics with their first message", async () => {
  const request = vi.fn(async () => ({ key: "agent:oak:job-1" }));
  const engine = { request, onEvent: () => () => undefined, sessionKey: "agent:oak:home", scopes: [] } as unknown as WindowEngine;
  let start: ((text: string) => Promise<string | null>) | undefined;
  function Probe() { start = useBackground(engine, "oak", "home").start; return null; }
  host = document.createElement("div"); document.body.append(host);
  root = createRoot(host);
  await act(async () => root?.render(createElement(Probe)));
  expect(request).not.toHaveBeenCalled();
  await act(async () => { expect(await start?.("  Fix the sync  ")).toBeNull(); });
  expect(request).toHaveBeenCalledExactlyOnceWith("sessions.create", {
    agentId: "oak", parentSessionKey: "agent:oak:home", message: "Fix the sync", displayName: "Fix the sync", titleSource: "Fix the sync",
  });
});
