// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../../connect/engine";
import { KitProvider, type SaveReport } from "../kit";
import { PeoplePage } from "./people";
import { PIC_ERRORS, avatarParams, keptDevices, mayOf, pictureFileError, revokePlan } from "./people-data";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const prof = (id: string, displayName: string | null, extra: Record<string, unknown> = {}) => ({ id, displayName, avatarMime: null, mergedInto: null, createdAt: 1, updatedAt: 1, emails: [], githubIdentity: null, hasAvatar: false, ...extra });
const PROFILES = [prof("gateway-owner", "Alex"), prof("p-dana", "Dana Okafor", { emails: ["dana@example.test"] }), prof("p-old", "Old Dana", { mergedInto: "p-dana" })];
const NOW = Date.now();
const PRESENCE = [
  { ts: NOW, ip: "127.0.0.1", deviceId: "dev-owner", user: { id: "gateway-owner" }, scopes: ["operator.admin"], lastActivityAt: NOW },
  { ts: NOW, ip: "10.0.0.7", host: "Dana’s MacBook", deviceId: "dev-dana", user: { id: "p-dana" }, scopes: ["operator.read", "operator.write"], lastActivityAt: NOW - 5 * 60000 },
  { ts: NOW, ip: "10.0.0.8", host: "Shared PC", deviceId: "dev-owner", user: { id: "p-dana" }, scopes: ["operator.read"] },
];
const PAIRED = { pending: [], paired: [
  { deviceId: "dev-dana", tokens: [{ role: "operator", scopes: [], createdAtMs: 1 }, { role: "node", scopes: [], createdAtMs: 1, revokedAtMs: 2 }] },
  { deviceId: "dev-owner", tokens: [{ role: "operator", scopes: [], createdAtMs: 1 }] }] };

let root: Root;
let host: HTMLDivElement;
beforeEach(() => { host = document.body.appendChild(document.createElement("div")); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); document.body.innerHTML = ""; });

function engineOf(over: Record<string, unknown> = {}) {
  const replies: Record<string, unknown> = {
    "users.list": { profiles: PROFILES }, "users.self": { profile: PROFILES[0] }, "system-presence": PRESENCE,
    "config.get": { hash: "h1", valid: true, config: {} }, "device.pair.list": PAIRED, "agents.list": { agents: [] },
    "audit.list": { events: [] }, ...over,
  };
  const request = vi.fn(async (method: string, _params?: unknown) => {
    const r = replies[method];
    if (r instanceof Error) throw r;
    return r ?? {};
  });
  const engine = { request, onEvent: () => () => undefined, sessionKey: "s", scopes: ["operator.read", "operator.write", "operator.admin"] } as unknown as WindowEngine;
  return { engine, request };
}
const report: SaveReport = { saving: vi.fn(), saved: vi.fn(), failed: vi.fn() };
async function render(engine: WindowEngine, level: 0 | 1 | 2 = 0) {
  await act(async () => root.render(<KitProvider level={level} report={report} scope={null}><PeoplePage page="people" title="People" level="regular" engine={engine} openSettings={() => undefined} /></KitProvider>));
}
const button = (label: string) => [...host.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.trim() === label);
const pick = async (name: string) => act(async () => [...host.querySelectorAll<HTMLButtonElement>(".pitem-pp")].find((b) => b.textContent?.includes(name))!.click());

describe("Settings › People", () => {
  it("lists people from users.list grouped by where they use Branch, merged profiles left out", async () => {
    await render(engineOf().engine);
    expect(host.querySelector("p.lede")?.textContent).toBe("Everyone who uses Branch, on this computer or their own.");
    expect([...host.querySelectorAll(".grp-pp")].map((g) => g.textContent)).toEqual(["On this computer", "On their own device"]);
    expect([...host.querySelectorAll(".pitem-pp b")].map((b) => b.textContent)).toEqual(["Alex · you", "Dana Okafor"]);
    expect([...host.querySelectorAll(".pitem-pp small")].map((m) => m.textContent)).toEqual(["Owner · last used Now", "last used 5 min ago"]);
    expect(host.querySelector(".phead-pp b")?.textContent).toBe("Alex");
    expect(host.querySelector(".phead-pp .pill")?.textContent).toBe("Owner");
  });

  it("the empty list uses the empty line", async () => {
    await render(engineOf({ "users.list": { profiles: [] }, "users.self": new Error("users.self requires an authenticated user") }).engine);
    expect(host.querySelector(".empty")?.textContent).toBe("Only you use Branch so far.");
  });

  it("users.self is listed as you even before users.list has them", async () => {
    await render(engineOf({ "users.list": { profiles: [] } }).engine);
    expect(host.querySelector(".empty")).toBeNull();
    expect([...host.querySelectorAll(".pitem-pp b")].map((b) => b.textContent)).toEqual(["Alex · you"]);
    expect(host.querySelector(".grp-pp")?.textContent).toBe("On this computer");
    expect(host.querySelector(".phead-pp b")?.textContent).toBe("Alex");
  });

  it("Invite someone opens the invite dialog, whose own-device tab makes a one-time code", async () => {
    const { engine, request } = engineOf({ "device.pair.setupCode": { setupCode: "INV-1", gatewayUrl: "wss://x", expiresAtMs: NOW + 900000 } });
    await render(engine);
    expect(host.textContent).not.toContain("Branch can’t send invites yet.");
    const invite = button("Invite someone")!;
    expect(invite.disabled).toBe(false);
    await act(async () => invite.click());
    const dlg = document.querySelector(".dlg")!;
    expect(dlg.textContent).toContain("Invite someone");
    await act(async () => [...dlg.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === "On their own device")!.click());
    await act(async () => [...document.querySelectorAll<HTMLButtonElement>(".dlg button")].find((b) => b.textContent === "Make a one-time code")!.click());
    expect(request).toHaveBeenCalledWith("device.pair.setupCode", { bootstrapProfile: "limited", includeQr: true });
    expect(document.querySelector(".dlg .pp-code")?.textContent).toBe("INV-1");
  });

  it("Change saves your name through users.setDisplayName", async () => {
    const { engine, request } = engineOf();
    await render(engine);
    await act(async () => button("Change")!.click());
    const input = host.querySelector<HTMLInputElement>('input[aria-label="Your name"]')!;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "Alex B"); input.dispatchEvent(new Event("input", { bubbles: true })); });
    await act(async () => button("Save")!.click());
    expect(request).toHaveBeenCalledWith("users.setDisplayName", { profileId: "gateway-owner", displayName: "Alex B" });
  });

  it("a wrong picture says why before anything is sent", async () => {
    const { engine, request } = engineOf();
    await render(engine);
    const input = host.querySelector<HTMLInputElement>('input[aria-label="Change your picture"]')!;
    const file = new File(["x"], "a.gif", { type: "image/gif" });
    await act(async () => { Object.defineProperty(input, "files", { value: [file], configurable: true }); input.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(host.querySelector(".picmsg-pp")?.textContent).toBe(PIC_ERRORS.read);
    expect(pictureFileError({ type: "image/png", size: 11 * 1048576 })).toBe(PIC_ERRORS.size);
    expect(avatarParams(`data:image/webp;base64,${"A".repeat(700_001)}`)).toBe(PIC_ERRORS.big);
    expect(avatarParams("data:image/png;base64,QUJD")).toEqual({ mime: "image/png", avatarBase64: "QUJD" });
    expect(request.mock.calls.some(([m]) => m === "users.setAvatar")).toBe(false);
  });

  it("a person's card: may from their scopes, a one-time code, sign out everywhere skips the shared device", async () => {
    const { engine, request } = engineOf({ "device.pair.setupCode": { setupCode: "CODE-123", gatewayUrl: "wss://x", auth: "token", urlSource: "config", expiresAtMs: NOW + 600000 }, "device.token.revoke": { ok: true } });
    await render(engine);
    await pick("Dana");
    const ticks = [...host.querySelectorAll<HTMLInputElement>(".may-pp input")].map((i) => i.checked);
    expect(ticks).toEqual([true, true, true, true, true, false, false]);
    await act(async () => button("Make a one-time code")!.click());
    expect(request).toHaveBeenCalledWith("device.pair.setupCode", { includeQr: false, bootstrapProfile: "limited" });
    expect(host.querySelector(".code-pp code")?.textContent).toBe("CODE-123");
    await act(async () => button("Sign out everywhere")!.click());
    const revoked = request.mock.calls.filter(([m]) => m === "device.token.revoke").map(([, p]) => p);
    expect(revoked).toEqual([{ deviceId: "dev-dana", role: "operator" }]);
    expect(host.querySelector(".kv-pp")?.textContent).toContain("Signed out everywhere");
  });

  it("the role saves through users.setRole when roles are set up", async () => {
    const roles = { default: "Adult", definitions: { Adult: { scopes: ["operator.read"], agents: "*", sessions: { others: "none" } }, Child: { scopes: ["operator.read"], agents: [], sessions: { others: "none" } } } };
    const { engine, request } = engineOf({ "config.get": { hash: "h1", valid: true, config: { gateway: { roles } } }, "users.setRole": { profile: PROFILES[1] } });
    await render(engine);
    await pick("Dana");
    await act(async () => button("Child")!.click());
    expect(request).toHaveBeenCalledWith("users.setRole", { profileId: "p-dana", role: "Child" });
  });

  it("levels: Records and Signing in from Advanced, your scopes at Technical; See the last reads audit.list", async () => {
    const { engine, request } = engineOf({ "audit.list": { events: [{ eventId: "e1", agentId: "main", kind: "tool_action", toolName: "read", status: "succeeded", occurredAt: NOW }] } });
    await render(engine, 0);
    expect(host.querySelector('[data-sec="Records"]')).toBeNull();
    await render(engine, 1);
    expect(host.querySelector(".scopes-pp")).toBeNull();
    await act(async () => button("See the last")!.click());
    expect(request).toHaveBeenCalledWith("audit.list", { limit: 20 });
    expect(document.querySelector(".dlg .prow b")?.textContent).toBe("main · read");
    await render(engine, 2);
    expect([...host.querySelectorAll(".scopes-pp code")].map((c) => c.textContent)).toEqual(["operator.read", "operator.write", "operator.admin"]);
  });

  it("stays inside Settings: Open People is the way out to the People place", async () => {
    const left: unknown[] = [];
    const onLeave = (event: Event) => left.push((event as CustomEvent).detail);
    window.addEventListener("branch:navigate-place", onLeave);
    try {
      await render(engineOf().engine);
      expect(host.querySelector('[data-page-title="People"]')).not.toBeNull();
      expect(host.querySelector('[data-row="Open People"]')).not.toBeNull();
      expect(host.querySelector(".ppl")).toBeNull();
      expect(host.textContent).not.toContain("Live now");
      expect(left).toEqual([]);
      await act(async () => button("Open People")!.click());
      expect(left).toEqual([{ place: "people" }]);
    } finally {
      window.removeEventListener("branch:navigate-place", onLeave);
    }
  });

  it("pure rules: may for the owner, revoke plan", () => {
    expect(mayOf(true, [])).toEqual([true, true, true, true, true, true, true]);
    expect(mayOf(false, ["operator.read"])).toEqual([true, false, false, false, false, false, false]);
    expect(revokePlan(["dev-dana", "dev-owner"], new Set(["dev-owner"]), PAIRED)).toEqual([{ deviceId: "dev-dana", role: "operator" }]);
    const kept = keptDevices([...PRESENCE, { ts: 1, ip: "10.0.0.9", deviceId: "dev-anon" }, { ts: 1, ip: "::1", deviceId: "dev-local", user: { id: "p-dana" } }], null);
    expect([...kept].sort()).toEqual(["dev-anon", "dev-local", "dev-owner"]);
  });
});
