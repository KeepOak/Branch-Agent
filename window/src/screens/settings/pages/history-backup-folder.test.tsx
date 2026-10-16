// @vitest-environment jsdom
// Settings › History & backups: "Where backups go" keeps the folder choice once it is clicked. Before the fix the click
// reset to Git on the next render, so the button read as dead in the button crawl.
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

const METHODS = ["config.get", "config.patch", "config.schema", "config.schema.lookup", "users.prefs.get", "users.prefs.set", "health", "system.info", "backup.status", "backup.schedule.set", "backup.schedule.clear", "backup.run"];
function engineStub() {
  const request = vi.fn(async (method: string) => {
    if (method === "config.get") return { hash: "h1", valid: true, config: {} };
    if (method === "config.schema") return { schema: {}, uiHints: {} };
    if (method === "config.schema.lookup") return { reloadKind: "hot" };
    if (method === "users.prefs.get") return { status: "ok", entries: {} };
    if (method === "backup.status") return {};
    return { ok: true };
  });
  const engine = { request, onEvent: () => () => undefined, sessionKey: "s", agentId: "main", scopes: ["operator.admin"], features: { methods: METHODS, events: [] } } as unknown as WindowEngine;
  return { engine, request };
}
const settle = () => act(async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0)); });

describe("Settings › History & backups: Where backups go", () => {
  it("keeps a folder choice after the click", async () => {
    const env = engineStub();
    await act(async () => root.render(<SettingsFrame engine={env.engine} page="history" pages={R1_PAGES} />));
    await settle();
    const folder = () => [...host.querySelectorAll<HTMLButtonElement>('[role="radio"]')].find((b) => b.textContent?.trim() === "A folder on this computer");
    expect(folder()?.getAttribute("aria-checked")).toBe("false");
    await act(async () => { folder()?.click(); });
    await settle();
    expect(folder()?.getAttribute("aria-checked")).toBe("true");
    expect(host.querySelector('input[aria-label="Folder"]')).not.toBeNull();
  });
});
