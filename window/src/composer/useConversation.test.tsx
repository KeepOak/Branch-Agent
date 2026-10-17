// @vitest-environment jsdom
// The permission chip reads each Trunk's default mode from agents.list. Setup saves tools.exec.mode, and the engine announces
// every committed config write as config.changed; the chip must follow it without a reload (QA 1014 main walk: after setup chose
// "Ask first", the chip still read "Full access" until a reload).
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { WindowEngine } from "../connect/engine";
import { useConversation } from "./useConversation";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

it("re-reads the Trunk's default mode when the engine announces a config change", async () => {
  let mode = "full";
  let announce: ((event: { event: string; payload: unknown }) => void) | undefined;
  const request = vi.fn(async (method: string) => {
    if (method === "agents.list") return { defaultId: "main", agents: [{ id: "main", name: "Sapling", defaultPermissionMode: mode }] };
    if (method === "sessions.describe") return { session: {} };
    if (method === "sessions.list") return { sessions: [], defaults: {} };
    if (method === "models.list") return { models: [] };
    return {};
  });
  const engine = {
    request,
    onEvent: (handler: (event: { event: string; payload: unknown }) => void) => { announce = handler; return () => undefined; },
    sessionKey: "agent:main:main",
    agentId: "main",
    scopes: ["operator.admin"],
  } as unknown as WindowEngine;
  let latest: ReturnType<typeof useConversation> | undefined;
  function Probe() {
    latest = useConversation(engine);
    return null;
  }
  root = createRoot(document.body.appendChild(document.createElement("div")));
  await act(async () => root?.render(<Probe />));
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  expect(latest?.trunk?.defaultMode).toBe("full");

  // Setup saved "Ask first" (tools.exec.mode = ask); the engine now resolves the Trunk's default to guarded and says so.
  mode = "guarded";
  await act(async () => announce?.({ event: "config.changed", payload: { path: "tools.exec" } }));
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  expect(latest?.trunk?.defaultMode).toBe("guarded");
});
