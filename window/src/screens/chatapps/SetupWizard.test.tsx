// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../connect/engine";
import { SetupWizard } from "./SetupWizard";
import { WhatsAppSetup } from "./WhatsAppSetup";
import { CHAT_APPS } from "./catalogue";
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root;
afterEach(async () => { if (root) await act(async () => root.unmount()); document.body.innerHTML = ""; vi.useRealTimers(); });
const app = CHAT_APPS.find(a => a.id === "telegram")!;
async function render(request: ReturnType<typeof vi.fn>, whatsapp = false) {
  const engine = { request, sessionKey: null, scopes: [], onEvent: () => () => {}, features: { methods: ["channels.pairing.list"], events: [] } } as WindowEngine;
  const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  const close = vi.fn();
  await act(async () => root.render(whatsapp ? <WhatsAppSetup engine={engine} app={CHAT_APPS.find(a => a.id === "whatsappweb")!} onClose={close} /> : <SetupWizard engine={engine} app={app} onClose={close} />));
  return { host, close };
}
const button = (host: Element, name: string) => [...host.querySelectorAll<HTMLButtonElement>("button")].find(b => b.textContent === name)!;
it("starts the engine only after Create and cancels an unfinished setup on close", async () => {
  const request = vi.fn(async (method: string) => method === "wizard.start" ? { sessionId: "setup", done: false, step: { id: "token", type: "text", title: "Bot token", sensitive: true } } : {});
  const { host, close } = await render(request);
  expect(request).not.toHaveBeenCalled();
  expect(host.querySelectorAll('.r1-cw-steps li')).toHaveLength(5);
  await act(async () => button(host, "I have the details").click());
  expect(request).toHaveBeenCalledWith("wizard.start", { flow: "channels", channel: "telegram" });
  expect(host.querySelector('input[aria-label="Bot token"]')?.getAttribute("type")).toBe("password");
  expect(button(host, "Continue").disabled).toBe(true);
  await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="Close"]')!.click());
  expect(request).toHaveBeenCalledWith("wizard.cancel", { sessionId: "setup" });
  expect(close).toHaveBeenCalledWith(false);
});
it("passes the engine step id and refuses to claim success on a failed token check", async () => {
  const request = vi.fn(async (method: string) => {
    if (method === "wizard.start") return { sessionId: "setup", done: false, step: { id: "engine-token", type: "text", title: "Bot token", sensitive: true, initialValue: "123456:" + "a".repeat(32) } };
    if (method === "wizard.next") throw new Error("That token did not work");
    return {};
  });
  const { host } = await render(request);
  await act(async () => button(host, "I have the details").click());
  await act(async () => button(host, "Continue").click());
  expect(request).toHaveBeenCalledWith("wizard.next", { sessionId: "setup", answer: { stepId: "engine-token", value: "123456:" + "a".repeat(32) } });
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("That token did not work");
  expect(host.textContent).not.toContain("setup is saved");
  expect(host.querySelector('[aria-current="step"]')?.textContent).toContain("Check");
  await act(async () => button(host, "Try again").click());
  expect(request.mock.calls.filter(([method]) => method === "wizard.next")).toHaveLength(2);
});
it("cancels a session that arrives after its dialog unmounts", async () => {
  let resolve!: (value: unknown) => void;
  const request = vi.fn((method: string) => method === "wizard.start" ? new Promise(r => { resolve = r; }) : Promise.resolve({}));
  const { host } = await render(request);
  await act(async () => button(host, "I have the details").click());
  await act(async () => root.render(null));
  await act(async () => resolve({ sessionId: "late", done: false, step: { id: "x", type: "text" } }));
  expect(request).toHaveBeenCalledWith("wizard.cancel", { sessionId: "late" });
});
it("renders only the gateway WhatsApp QR and stops waiting after unmount", async () => {
  vi.useFakeTimers();
  const qr = "data:image/png;base64,engineFixture";
  const request = vi.fn(async (method: string) => method === "web.login.start" ? { qrDataUrl: qr } : { qrDataUrl: qr, connected: false });
  const { host } = await render(request, true);
  expect(host.querySelectorAll('.r1-cw-steps li')).toHaveLength(2);
  expect(host.querySelector('img')?.getAttribute('src')).toBe(qr);
  await act(async () => vi.advanceTimersByTimeAsync(500));
  expect(request).toHaveBeenCalledWith("web.login.wait", { channel: "whatsapp", timeoutMs: 120000, currentQrDataUrl: qr });
  await act(async () => root.render(null));
  const count = request.mock.calls.length;
  await act(async () => vi.advanceTimersByTimeAsync(2000));
  expect(request).toHaveBeenCalledTimes(count);
});

it.each([["telegram", true], ["discord", false]] as const)("shows Telegram's Save options as Coming only for Telegram (%s)", async (id, shown) => {
  const request = vi.fn(async (method: string) => method === "wizard.start" ? { sessionId: "setup", done: true, status: "done" } : method === "config.get" ? { config: {}, hash: "fixture", valid: true } : method === "agents.list" ? { agents: [] } : method === "channels.pairing.list" ? { accounts: [], requests: [] } : {});
  const engine = { request, sessionKey: null, scopes: ["operator.admin"], onEvent: () => () => {}, features: { methods: ["channels.pairing.list"], events: [] } } as WindowEngine;
  const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<SetupWizard engine={engine} app={CHAT_APPS.find(a => a.id === id)!} onClose={() => {}} />));
  await act(async () => button(host, "I have the details").click());
  await act(async () => button(host, "Continue to Save").click());
  expect(host.textContent).toContain("setup is saved by the engine");
  for (const label of ["Keep forum topics apart", "Photos and files reach the task"]) {
    const toggle = host.querySelector<HTMLInputElement>(`[aria-label="${label}"]`);
    if (!shown) { expect(toggle).toBeNull(); continue; }
    expect(toggle).not.toBeNull();
    expect(toggle!.disabled).toBe(true);
    // Greyed with its reason, as Manage does; the kit keeps the developer note out of the visible text.
    expect(host.querySelector(`[data-row="${label}"]`)?.getAttribute("aria-disabled")).toBe("true");
  }
});
