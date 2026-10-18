// @vitest-environment jsdom
// Settings save line: a raw engine dump reads as "Not saved: " plus one plain sentence at Regular.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../connect/engine";
import { SettingsFrame } from "./SettingsFrame";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const RAW = /ECONNREFUSED|127\.0\.0\.1|19031|unknown method|logbook\.status/;
const ENGINE = "connect ECONNREFUSED 127.0.0.1:19031";
const REACH = "Branch can’t reach its engine right now. It keeps trying, so try again in a moment.";

let root: Root;
beforeEach(() => {
  localStorage.clear();
  root = createRoot(document.body.appendChild(document.createElement("div")));
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = "";
  localStorage.clear();
});

const settle = async () => { for (let i = 0; i < 10; i += 1) await act(async () => { await Promise.resolve(); }); };

function engineOf(request: (method: string, params?: Record<string, unknown>) => Promise<unknown>) {
  return { request, onEvent: () => () => undefined, sessionKey: "s", agentId: "main", scopes: ["operator.admin"] } as unknown as WindowEngine;
}

describe("Settings save line never shows a raw engine error at Regular", () => {
  it("names a failed appearance save as Not saved plus a plain sentence", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "users.prefs.set") throw new Error(ENGINE);
      if (method === "users.prefs.get") return { status: "ok", entries: {} };
      if (method === "themes.list") return { current: { id: "grove", mode: "system" }, themes: [{ id: "grove", name: "Grove", modes: ["light", "dark"] }] };
      if (method === "agents.list") return { defaultId: "main", agents: [{ id: "main", name: "Birch" }] };
      if (method === "config.get") return { hash: "h", valid: true, config: {} };
      if (method === "models.list") return { models: [] };
      return {};
    });
    await act(async () => root.render(
      <SettingsFrame page="appearance" backName="Birch" engine={engineOf(request)} onPage={() => undefined} onBack={() => undefined} />,
    ));
    await settle();
    const sw = document.querySelector<HTMLInputElement>('input[aria-label="Reduce transparency"]');
    expect(sw).not.toBeNull();
    await act(async () => sw!.click());
    await settle();
    const line = document.querySelector(".set-save")?.textContent ?? "";
    expect(line).toBe(`Not saved: ${REACH}`);
    expect(line).not.toMatch(RAW);
  });

  it("keeps the exact words at Advanced", async () => {
    localStorage.setItem("branch.level", "advanced");
    const request = vi.fn(async (method: string) => {
      if (method === "users.prefs.set") throw new Error(ENGINE);
      if (method === "users.prefs.get") return { status: "ok", entries: {} };
      if (method === "themes.list") return { current: { id: "grove", mode: "system" }, themes: [{ id: "grove", name: "Grove", modes: ["light", "dark"] }] };
      if (method === "agents.list") return { defaultId: "main", agents: [{ id: "main", name: "Birch" }] };
      if (method === "config.get") return { hash: "h", valid: true, config: {} };
      if (method === "models.list") return { models: [] };
      return {};
    });
    await act(async () => root.render(
      <SettingsFrame page="appearance" backName="Birch" engine={engineOf(request)} onPage={() => undefined} onBack={() => undefined} />,
    ));
    await settle();
    await act(async () => document.querySelector<HTMLInputElement>('input[aria-label="Reduce transparency"]')!.click());
    await settle();
    expect(document.querySelector(".set-save")?.textContent).toBe(`Not saved: ${ENGINE}`);
  });
});
