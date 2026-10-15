// @vitest-environment jsdom
// Settings › Remote access: "Restart the engine" says what the engine answered once the request succeeds. Before this,
// the click had no visible result, so the button read as dead in the button crawl.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../../connect/engine";
import { SettingsFrame } from "../SettingsFrame";
import { R1_PAGES } from "./plugged";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  localStorage.clear();
  sessionStorage.clear();
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

const METHODS = ["config.get", "config.patch", "config.schema", "config.schema.lookup", "users.prefs.get", "users.prefs.set", "health", "system.info", "presence.query", "gateway.restart.request"];

/** The engine answers the restart with the status it was given; every other read gets a plain ok. */
function engineAnswering(status: string) {
  const request = vi.fn(async (method: string) => {
    if (method === "config.get") return { hash: "h1", valid: true, config: {} };
    if (method === "config.schema") return { schema: {}, uiHints: {} };
    if (method === "config.schema.lookup") return { reloadKind: "hot" };
    if (method === "users.prefs.get") return { status: "ok", entries: {} };
    if (method === "gateway.restart.request") return { status };
    return { ok: true };
  });
  const engine = { request, onEvent: () => () => undefined, sessionKey: "s", agentId: "main", scopes: ["operator.admin"], features: { methods: METHODS, events: [] } } as unknown as WindowEngine;
  return { engine, request };
}
const settle = () => act(async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0)); });
const restartButton = () => [...host.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.trim() === "Restart the engine");

async function restartWith(status: string) {
  const env = engineAnswering(status);
  await act(async () => root.render(<SettingsFrame engine={env.engine} page="remote" pages={R1_PAGES} />));
  await settle();
  await act(async () => { restartButton()?.click(); });
  await settle();
  return { ...env, text: host.textContent ?? "" };
}

describe("Settings › Remote access: Restart the engine", () => {
  it("says the restart waits for running work when the engine defers it", async () => {
    const { request, text } = await restartWith("deferred");
    expect(request).toHaveBeenCalledWith("gateway.restart.request", { reason: "settings" });
    expect(text).toContain("Restart requested. Branch restarts when its current work ends.");
  });

  it("says a restart is under way when the engine schedules it now", async () => {
    const { text } = await restartWith("scheduled");
    expect(text).toContain("Restart requested. Branch is restarting.");
  });
});
