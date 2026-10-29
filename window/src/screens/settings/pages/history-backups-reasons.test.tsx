// @vitest-environment jsdom
// Settings › History & backups: Save, Back up now and the media limits were greyed with no reason (Private #1093).
// Each greyed control names a visible line with aria-describedby that says why.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../../connect/engine";
import { HISTORY_ROWS } from "./history";
import { BackupNow, BackupWhere, MediaFile } from "./history-live";

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
const SCHEDULE = { mode: "git", push: true, remote: "https://github.com/me/backups.git", target: "https://github.com/me/backups.git", enabled: true, everyMs: 86_400_000 };
function engineStub(status: Record<string, unknown> = {}) {
  const request = vi.fn(async (method: string) => {
    if (method === "config.get") return { hash: "h1", valid: true, config: {} };
    if (method === "config.schema") return { schema: {}, uiHints: {} };
    if (method === "config.schema.lookup") return { reloadKind: "hot" };
    if (method === "users.prefs.get") return { status: "ok", entries: {} };
    if (method === "backup.status") return status;
    return { ok: true };
  });
  const engine = { request, onEvent: () => () => undefined, sessionKey: "s", agentId: "main", scopes: ["operator.admin"], features: { methods: METHODS, events: [] } } as unknown as WindowEngine;
  return { engine, request };
}
const settle = () => act(async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0)); });
const row = (id: string) => HISTORY_ROWS.find((r) => r.id === id)!;
const button = (text: string) => [...host.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.trim() === text);
const described = (el: Element | undefined | null) => {
  expect(el, "greyed control").toBeTruthy();
  expect((el as HTMLButtonElement).disabled).toBe(true);
  const why = document.getElementById(el!.getAttribute("aria-describedby") ?? "");
  expect(why, "aria-describedby target").toBeTruthy();
  expect(why!.textContent?.trim()).toBeTruthy();
  return why!.textContent!.trim();
};

async function mount(status: Record<string, unknown> = {}) {
  const env = engineStub(status);
  await act(async () => root.render(<>
    <BackupWhere engine={env.engine} row={row("history.backups.where")} />
    <BackupNow engine={env.engine} row={row("history.backups.now")} />
    <MediaFile engine={env.engine} row={row("history.backups.media-file")} />
  </>));
  await settle();
  return env;
}

describe("Settings › History & backups: greyed controls say why", () => {
  it("Save, Back up now and Largest media file name a visible reason when nothing is saved", async () => {
    await mount({});
    expect(described(button("Save"))).toBe("Type a folder or repository address first.");
    expect(described(button("Back up now"))).toBe("Choose where backups go first.");
    expect(described(host.querySelector('input[aria-label="Largest media file"]'))).toBe("Choose where backups go first.");
  });

  it("Save says the address is already saved when it matches what is stored", async () => {
    await mount({ schedules: [SCHEDULE] });
    expect(described(button("Save"))).toBe("Already saved. Change the address to save a new one.");
    expect(button("Back up now")?.disabled).toBe(false);
    expect(host.querySelector<HTMLInputElement>('input[aria-label="Largest media file"]')?.disabled).toBe(false);
  });
});
