// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../connect/engine";
import { PeopleTab } from "./person";

vi.mock("../../face/Face", () => ({ Face: ({ label, size }: { label?: string; size: number }) => <span role="img" aria-label={label} data-face-size={size} /> }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement;
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = null; document.body.innerHTML = ""; });

type Answer = unknown | ((params: Record<string, unknown>) => unknown);
function fakeEngine(table: Record<string, Answer>, scopes = ["operator.admin"]) {
  const request = vi.fn(async (method: string, params: Record<string, unknown> = {}) => {
    if (!(method in table)) throw new Error(`unknown method ${method}`);
    const answer = table[method];
    const value = typeof answer === "function" ? (answer as (p: Record<string, unknown>) => unknown)(params) : answer;
    if (value instanceof Error) throw value;
    return value;
  });
  const engine: WindowEngine = { request: request as unknown as WindowEngine["request"], onEvent: () => () => {}, sessionKey: null, scopes };
  return { engine, request };
}

async function mount(engine: WindowEngine, me: string, selected: string) {
  const reload = vi.fn();
  const users = { data: BASE["users.list"], loading: false, error: null, reload };
  host = document.createElement("div"); document.body.append(host);
  root = createRoot(host);
  await act(async () => { root!.render(<PeopleTab engine={engine} users={users} me={me} level="regular" selected={selected} onSelect={() => {}} openConversation={() => {}} />); });
  await act(async () => { await Promise.resolve(); });
  return reload;
}

const button = (label: string) => [...document.querySelectorAll("button")].find(b => b.textContent?.trim() === label) as HTMLButtonElement | undefined;
async function click(label: string) { const b = button(label); expect(b, label).toBeTruthy(); await act(async () => { b!.click(); }); await act(async () => { await Promise.resolve(); }); }

const BASE = {
  "users.list": { profiles: [{ id: "gateway-owner", displayName: "Rowan Vale", emails: [], mergedInto: null }, { id: "p-mira", displayName: "Mira Stone", emails: ["mira@home.test"], mergedInto: null, role: "adult" }] },
  "config.get": { hash: "h", valid: true, config: { gateway: { roles: { definitions: { adult: { agents: ["books"], scopes: [] } } } } } },
  "system-presence": [
    { user: { id: "gateway-owner", name: "Rowan Vale" }, deviceId: "d-owner", host: "Mac", ip: "127.0.0.1", deviceFamily: "desktop", mode: "desktop", platform: "macOS", timeZone: "America/New_York", version: "0.19.4", lastInputSeconds: 30, lastActivityAt: Date.now(), onlineSince: Date.now(), watchedSessions: [] },
    { user: { id: "p-mira", name: "Mira Stone" }, deviceId: "d-mira", host: "Mira's laptop", ip: "192.168.1.40", deviceFamily: "desktop", mode: "desktop", platform: "Windows", timeZone: "America/New_York", version: "0.19.4", lastInputSeconds: 30, lastActivityAt: Date.now(), onlineSince: Date.now(), watchedSessions: [] },
  ],
  "sessions.list": { sessions: [] },
};

describe("People › People › Sign out everywhere", () => {
  it("as owner, with a connected device, calls device.pair.list then device.token.revoke and shows signed out", async () => {
    const { engine, request } = fakeEngine({
      ...BASE,
      "device.pair.list": { paired: [{ deviceId: "d-mira", tokens: [{ role: "operator", revokedAtMs: undefined }] }] },
      "device.token.revoke": { ok: true },
      "users.setRole": { profile: {} },
    });
    const reload = await mount(engine, "gateway-owner", "p-mira");
    const btn = button("Sign out everywhere")!;
    expect(btn).toBeTruthy();
    expect(btn.disabled).toBe(false);
    await click("Sign out everywhere");
    await act(async () => { await new Promise(r => setTimeout(r, 10)); });
    expect(request).toHaveBeenCalledWith("device.pair.list", {});
    expect(request).toHaveBeenCalledWith("device.token.revoke", { deviceId: "d-mira", role: "operator" });
    expect(reload).toHaveBeenCalled();
    expect(host.textContent).toContain("Nothing right now");
  });

  it("with no device, the button is disabled with its reason", async () => {
    const { engine } = fakeEngine({
      ...BASE,
      "system-presence": [{ user: { id: "gateway-owner", name: "Rowan Vale" }, deviceId: "d-owner", host: "Mac", ip: "127.0.0.1", deviceFamily: "desktop", mode: "desktop", platform: "macOS", timeZone: "America/New_York", version: "0.19.4", lastInputSeconds: 30, lastActivityAt: Date.now(), onlineSince: Date.now(), watchedSessions: [] }],
      "users.setRole": { profile: {} },
    });
    await mount(engine, "gateway-owner", "p-mira");
    const btn = button("Sign out everywhere")!;
    expect(btn).toBeTruthy();
    expect(btn.disabled).toBe(true);
    expect(btn.title).toBe("No device of Mira's is connected now.");
  });

  it("as non-owner, the button is disabled", async () => {
    const nonOwner = fakeEngine({ ...BASE, "users.setRole": { profile: {} } }, ["operator.read"]);
    await mount(nonOwner.engine, "p-mira", "gateway-owner");
    const btn = button("Sign out everywhere");
    expect(btn).toBeUndefined();
  });

  it("shows an error when device.pair.list returns no tokens to revoke", async () => {
    const { engine, request } = fakeEngine({
      ...BASE,
      "device.pair.list": { paired: [] },
      "users.setRole": { profile: {} },
    });
    await mount(engine, "gateway-owner", "p-mira");
    await click("Sign out everywhere");
    await act(async () => { await new Promise(r => setTimeout(r, 10)); });
    expect(request).toHaveBeenCalledWith("device.pair.list", {});
    expect(host.textContent).toContain("Branch found no sign-in to end on their devices.");
  });

  it("shows an error when device.token.revoke throws", async () => {
    const { engine, request } = fakeEngine({
      ...BASE,
      "device.pair.list": { paired: [{ deviceId: "d-mira", tokens: [{ role: "operator", revokedAtMs: undefined }] }] },
      "device.token.revoke": new Error("Network error"),
      "users.setRole": { profile: {} },
    });
    await mount(engine, "gateway-owner", "p-mira");
    await click("Sign out everywhere");
    await act(async () => { await new Promise(r => setTimeout(r, 10)); });
    expect(request).toHaveBeenCalledWith("device.pair.list", {});
    expect(request).toHaveBeenCalledWith("device.token.revoke", { deviceId: "d-mira", role: "operator" });
    expect(host.textContent).toContain("Network error");
  });
});
