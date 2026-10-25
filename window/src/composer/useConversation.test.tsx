// @vitest-environment jsdom
// The permission chip reads each Trunk's default mode from agents.list. Setup saves tools.exec.mode, and the engine announces
// every committed config write as config.changed; the chip must follow it without a reload (QA 1014 main walk: after setup chose
// "Ask first", the chip still read "Full access" until a reload).
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { WindowEngine } from "../connect/engine";
import { resetNoKeyDefaultForTests } from "./no-key-default";
import { useConversation } from "./useConversation";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

it("does not silently activate a free model when none is connected", async () => {
  const request = vi.fn(async (method: string) => {
    if (method === "agents.list") return { defaultId: "main", agents: [{ id: "main", name: "Sapling" }] };
    if (method === "sessions.describe") return { session: { model: "openai/test" } };
    if (method === "sessions.list") return { sessions: [], defaults: { model: "openai/test" } };
    if (method === "models.list") return { models: [] };
    if (method === "branch.setup.activate") return { ok: true };
    return {};
  });
  const engine = {
    request,
    onEvent: () => () => undefined,
    sessionKey: "agent:main:main",
    agentId: "main",
    scopes: ["operator.admin"],
  } as unknown as WindowEngine;
  resetNoKeyDefaultForTests(engine);
  let latest: ReturnType<typeof useConversation> | undefined;
  function Probe() {
    latest = useConversation(engine);
    return null;
  }
  root = createRoot(document.body.appendChild(document.createElement("div")));
  await act(async () => root?.render(<Probe />));
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  await vi.waitFor(() => expect(latest?.loaded).toBe(true));
  expect(latest?.noKeySettled).toBe(true);
  expect(latest?.noKeyError).toBeNull();
  expect(request.mock.calls.some(([m]) => m === "branch.setup.activate")).toBe(false);
  expect(request.mock.calls.some(([m]) => m === "branch.setup.activate.start")).toBe(false);
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
