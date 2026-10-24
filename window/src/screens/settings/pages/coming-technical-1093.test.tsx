// @vitest-environment jsdom
// Settings (Private #1093 point 5): a "Coming" control shows only at Technical. Regular and Advanced show only what works
// today, so a page's own control that waits for a later update is not drawn there: General's Cover and Quick ask
// shortcut (with their rows), Voice's Test call, History's Restore… and Roll back, and Notifications' Push to this
// browser when the engine can't do it yet. At Technical each shows, Coming, as before; a control that works stays live.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../../connect/engine";
import { forgetLookStore } from "../../../places/settings/set1/appearance-store";
import { SettingsFrame } from "../SettingsFrame";
import { R1_PAGES } from "./plugged";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  host = document.body.appendChild(document.createElement("div")); root = createRoot(host); localStorage.clear(); sessionStorage.clear(); forgetLookStore();
});
afterEach(async () => { await act(async () => root.unmount()); document.body.innerHTML = ""; vi.unstubAllGlobals(); forgetLookStore(); });

const BASE = ["config.get", "config.patch", "config.schema", "config.schema.lookup", "users.prefs.get", "users.prefs.set", "agents.list"];
function engineOf(methods: string[]) {
  const request = vi.fn(async (method: string) => {
    if (method === "config.get") return { hash: "h1", valid: true, config: { plugins: { entries: { "voice-call": { enabled: true } } } } };
    if (method === "config.schema") return { schema: {}, uiHints: {} };
    if (method === "config.schema.lookup") return { reloadKind: "hot" };
    if (method === "users.prefs.get") return { status: "ok", entries: {} };
    if (method === "agents.list") return { agents: [{ id: "main", name: "Sapling" }] };
    if (method === "projects.list") return { projects: [] };
    if (method === "branch.changes.list") return { entries: [{ id: "c1", source: "config-rpc", summary: "Changed the night window", at: Date.now(), kind: "config-write" }] };
    if (method === "backup.status") return { schedules: [], targets: [] };
    return {};
  });
  return { request, onEvent: () => () => undefined, sessionKey: "s", agentId: "main", scopes: ["operator.admin"], features: { methods: [...BASE, ...methods], events: [] } } as unknown as WindowEngine;
}
const settle = () => act(async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0)); });
async function mount(page: string, level: "regular" | "advanced" | "technical", methods: string[] = []) {
  localStorage.setItem("branch.level", level);
  await act(async () => root.render(<SettingsFrame engine={engineOf(methods)} page={page} pages={R1_PAGES} />));
  await settle();
}
const remount = async () => { await act(async () => root.unmount()); root = createRoot(host); forgetLookStore(); localStorage.clear(); };
const row = (id: string) => host.querySelector<HTMLElement>('[data-row="' + id + '"]');
const button = (scope: ParentNode | null, text: string) => [...(scope ?? document).querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.trim() === text);
/** The Coming control drawn in a row, if any. */
const comingIn = (id: string) => row(id)?.querySelector("[data-coming]") ?? null;

describe("Coming controls a page draws itself show only at Technical (Private #1093 point 5)", () => {
  it("General: Cover and Change… are not drawn, nor their rows, at Regular and Advanced", async () => {
    for (const level of ["regular", "advanced"] as const) {
      await mount("general", level);
      expect(row("general.cover.now"), level).toBeNull();
      expect(row("general.quick-ask.shortcut"), level).toBeNull();
      expect(button(host, "Cover"), level).toBeUndefined();
      expect(button(host, "Change…"), level).toBeUndefined();
      expect(host.textContent, level).not.toContain("Cover now");
      await remount();
    }
  });

  it("General: Cover and Change… show at Technical, Coming with their reasons", async () => {
    await mount("general", "technical");
    expect(button(row("general.cover.now"), "Cover")?.closest("[data-coming]")?.getAttribute("data-coming")).toBe("Cover the screen comes in a later update.");
    expect(button(row("general.quick-ask.shortcut"), "Change…")?.closest("[data-coming]")?.getAttribute("data-coming")).toBe("Changing the quick ask shortcut comes in a later update.");
    expect(button(row("general.history-repair.check"), "Check")?.closest("[data-coming]")).not.toBeNull();
  });

  it("Voice: Test call is not drawn Coming at Advanced when the engine can't call, and is Coming at Technical", async () => {
    await mount("voice", "advanced");
    expect(row("voice.calls.test"), "the row stays").not.toBeNull();
    expect(comingIn("voice.calls.test")).toBeNull();
    expect(button(row("voice.calls.test"), "Call me")).toBeUndefined();
    await remount();
    await mount("voice", "technical");
    expect(button(row("voice.calls.test"), "Call me")?.closest("[data-coming]")).not.toBeNull();
  });

  it("Voice: a Test call that works today stays live at Advanced", async () => {
    await mount("voice", "advanced", ["voicecall.initiate"]);
    const call = button(row("voice.calls.test"), "Call me");
    expect(call).toBeTruthy();
    expect(call!.closest("[data-coming]")).toBeNull();
  });

  it("History: Restore… and Roll back are not drawn at Regular and Advanced, and are Coming at Technical", async () => {
    for (const level of ["regular", "advanced"] as const) {
      await mount("history", level, ["backup.status", "branch.changes.list"]);
      expect(row("history.undo.changes")?.textContent, level).toContain("Changed the night window");
      expect(button(host, "Restore…"), level).toBeUndefined();
      expect(button(host, "Roll back"), level).toBeUndefined();
      expect(host.textContent, level).not.toContain("Rolling back a change comes in a later update.");
      await remount();
    }
    await mount("history", "technical", ["backup.status", "branch.changes.list"]);
    expect(button(row("history.backups.last"), "Restore…")?.closest("[data-coming]")).not.toBeNull();
    expect(button(row("history.undo.changes"), "Roll back")?.closest("[data-coming]")).not.toBeNull();
  });

  it("Notifications: Push to this browser is not drawn Coming at Regular and Advanced without Web Push, and is Coming at Technical", async () => {
    for (const level of ["regular", "advanced"] as const) {
      await mount("notifications", level);
      expect(comingIn("notifications.push.browser"), level).toBeNull();
      expect(row("notifications.push.browser")?.querySelector("[role=switch]") ?? null, level).toBeNull();
      await remount();
    }
    await mount("notifications", "technical");
    expect(row("notifications.push.browser")?.querySelector("[role=switch]")?.closest("[data-coming]")).not.toBeNull();
  });

  it("Notifications: Push to this browser that works today stays live at Regular", async () => {
    await mount("notifications", "regular", ["push.web.vapidPublicKey", "push.web.subscribe", "push.web.unsubscribe"]);
    const sw = row("notifications.push.browser")?.querySelector("[role=switch]");
    expect(sw).toBeTruthy();
    expect(sw!.closest("[data-coming]")).toBeNull();
  });
});
