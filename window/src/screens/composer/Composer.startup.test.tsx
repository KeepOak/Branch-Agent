// @vitest-environment jsdom
// The R1 composer says "Getting <Trunk> ready…" while the engine gets the Trunk ready, unless the window already shows
// that line (frame/StartupLine.tsx): then it adds no second one.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../composer/engine";
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

const RAW = "Agent scout has not completed startup inspection and preparation.\nSessions remain unavailable until background inspection and preparation finish.";

async function mount(startupShown: boolean) {
  const request = vi.fn(async (method: string) => {
    if (method === "agents.list") return { defaultId: "scout", agents: [{ id: "scout", name: "Scout" }] };
    if (method === "sessions.describe") return { session: { model: "openai/test" } };
    if (method === "sessions.list") return { defaults: { model: "openai/test" }, sessions: [] };
    if (method === "models.list") throw new Error(RAW);
    return {};
  });
  const engine = { sessionKey: "agent:scout:main", agentId: "scout", request: request as unknown as WindowEngine["request"], onEvent: () => () => {}, scopes: ["operator.admin"] } as WindowEngine;
  const host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  await act(async () => root?.render(<Composer startupShown={startupShown} name="Scout" engine={engine} working={false} offline={false} onSend={() => {}} onStop={() => {}} onToast={() => {}} onOpen={() => {}} onOpenConversation={() => {}}
    limits={null} row={{ key: "agent:scout:main", title: "Main", isMain: true } as never} topics={[]} running={[]} />));
  for (let i = 0; i < 6; i++) await act(async () => { await Promise.resolve(); });
  return host;
}

it("says Getting Scout ready… on its own", async () => {
  const host = await mount(false);
  expect([...host.querySelectorAll(".r1c-note")].map((n) => n.textContent)).toContain("Getting Scout ready…");
  expect(host.textContent).not.toContain("has not completed");
});

it("adds no second line when the window already shows it", async () => {
  const host = await mount(true);
  expect(host.textContent).not.toContain("Getting Scout ready…");
  expect(host.textContent).not.toContain("has not completed");
});
