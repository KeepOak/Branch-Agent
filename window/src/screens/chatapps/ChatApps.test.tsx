// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../connect/engine";
import { comingControls, undeclaredControls } from "../../glass/coming-registry";
import { ChatApps } from "./ChatApps";
import { CHAT_APPS } from "./catalogue";
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root;
afterEach(async () => { if (root) await act(async () => root.unmount()); document.body.innerHTML = ""; });
// The gateway never advertises web.login.*, so the fixture doesn't either.
const methods = ["channels.status", "channels.pairing.list", "channels.pairing.approve", "wizard.start", "wizard.next", "wizard.cancel"];
async function render(status = {}, available = methods, scopes = ["operator.admin"], renderAccess?: (app: { id: string }) => ReactNode) {
  const request = vi.fn(async (method: string) => method === "channels.status" ? status : { accounts: [], requests: [], limits: { ttlMs: 3600000, pendingPerAccount: 3 } });
  const engine = { request, onEvent: () => () => {}, sessionKey: null, scopes, features: { methods: available, events: [] } } as WindowEngine;
  const setup = vi.fn(), manage = vi.fn();
  const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<ChatApps engine={engine} onSetup={setup} onManage={manage} renderAccess={renderAccess} />));
  return { host, request, setup, manage };
}
it("keeps all 74 real catalogue entries visible and only wires the R1 four", async () => {
  const { host, setup } = await render();
  expect(new Set(CHAT_APPS.map(a => a.id)).size).toBe(74);
  expect(host.querySelectorAll(".r1-ca-card")).toHaveLength(74);
  expect(host.querySelectorAll('.r1-ca-card[aria-disabled="true"]')).toHaveLength(71);
  const telegram = [...host.querySelectorAll<HTMLButtonElement>(".r1-ca-card")].find(b => b.textContent?.includes("Telegram"))!;
  await act(async () => telegram.click());
  expect(setup).toHaveBeenCalledWith(expect.objectContaining({ id: "telegram" }));
  const coming = host.querySelector<HTMLButtonElement>('.r1-ca-card[aria-disabled="true"]')!;
  await act(async () => coming.click());
  expect(setup).toHaveBeenCalledTimes(1);
  expect(host.textContent).toContain("No chat app is connected yet.");
  expect(host.textContent).not.toContain("Sapling answers");
});
it("does not advertise setup when the gateway lacks the methods", async () => {
  const { host, setup } = await render({}, ["channels.status"]);
  expect(host.querySelectorAll('.r1-ca-card[aria-disabled="true"]')).toHaveLength(74);
  await act(async () => host.querySelector<HTMLButtonElement>(".r1-ca-card")!.click());
  expect(setup).not.toHaveBeenCalled();
});
it("uses live account health and opens Manage for a configured app", async () => {
  const { host, manage } = await render({ channelAccounts: { telegram: [{ accountId: "default", configured: true, running: true }] } });
  const card = [...host.querySelectorAll<HTMLButtonElement>(".r1-ca-card")].find(b => b.textContent?.includes("Telegram"))!;
  expect(card.textContent).toContain("Connected");
  expect(card.textContent).toContain("Manage");
  await act(async () => card.click());
  expect(manage).toHaveBeenCalledWith(expect.objectContaining({ id: "telegram" }));
});

it("keeps code approval Coming because its engine protocol requires a local-state owner", async () => {
  const {host,request} = await render();
  expect(host.querySelector<HTMLInputElement>('input[aria-label="Pairing code"]')!.disabled).toBe(true);
  expect(host.textContent).toContain("Approval by code comes in a later update.");
  expect(request.mock.calls.some(([method]) => method === "channels.pairing.approve")).toBe(false);
});

it("offers WhatsApp (your number) once the engine lists the WhatsApp channel, though web.login is never advertised", async () => {
  const { host, setup } = await render({ channelOrder: ["telegram", "whatsapp"] });
  expect(host.querySelectorAll('.r1-ca-card[aria-disabled="true"]')).toHaveLength(70);
  const whatsapp = [...host.querySelectorAll<HTMLButtonElement>(".r1-ca-card")].find(b => b.textContent?.includes("WhatsApp (your number)"))!;
  expect(whatsapp.getAttribute("aria-disabled")).toBe("false");
  await act(async () => whatsapp.click());
  expect(setup).toHaveBeenCalledWith(expect.objectContaining({ id: "whatsappweb" }));
});
it("does not offer setup on a connection without full access", async () => {
  const { host, setup } = await render({ channelOrder: ["whatsapp"] }, methods, ["operator.read", "operator.write"]);
  const telegram = [...host.querySelectorAll<HTMLButtonElement>(".r1-ca-card")].find(b => b.textContent?.includes("Telegram"))!;
  expect(telegram.getAttribute("aria-disabled")).toBe("true");
  expect(telegram.textContent).toContain("Needs full access");
  expect(telegram.title).toBe("Setting up Telegram needs full access on this connection.");
  await act(async () => telegram.click());
  expect(setup).not.toHaveBeenCalled();
  expect(host.querySelectorAll('.r1-ca-card[aria-disabled="true"]')).toHaveLength(74);
});

it("draws each chat app card as a frosted pill (item 48) and leaves its fill to the shared glass class", async () => {
  const css = readFileSync("src/screens/chatapps/chatapps.css", "utf8").replace(/\s+/g, " ");
  const rule = (selector: string) => css.match(new RegExp(`(?:^|} )${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\{([^}]*)\\}`))?.[1] ?? "";
  const card = rule(".r1-ca-card");
  expect(card).not.toMatch(/background|box-shadow|var\(--raise\)|solid var\(--line\)/);
  const { host } = await render();
  expect(host.querySelector(".r1-ca-card")!.classList.contains("g-frost")).toBe(true);
  expect(host.querySelector(".r1-ca-card")!.classList.contains("g-chip")).toBe(false);
});
it("gives the pairing buttons a Coming reason when the engine can't approve or dismiss", async () => {
  const request = vi.fn(async (method: string) => method === "channels.status" ? {} : { accounts: [], requests: [{ requestId: "r1", channel: "telegram", channelLabel: "Telegram", accountId: "default", senderLabel: "Ada" }], limits: { ttlMs: 3600000, pendingPerAccount: 3 } });
  const engine = { request, onEvent: () => () => {}, sessionKey: null, scopes: ["operator.admin"], features: { methods: ["channels.status", "channels.pairing.list"], events: [] } } as WindowEngine;
  const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<ChatApps engine={engine} />));
  const coming = [...host.querySelectorAll<HTMLButtonElement>(".r1-ca-request button")];
  expect(coming.map(b => b.textContent)).toEqual(["Coming", "Coming"]);
  expect(coming[0].title).toBe("Approving requests here comes in a later update.");
  expect(coming[1].title).toBe("Dismissing requests here comes in a later update.");
  expect(host.querySelector(".r1-ca-pairing")!.textContent).toContain("Approving requests here comes in a later update.");
});
it("R1-10: against an engine with no methods, every card and the code approval are Coming through <Coming>, naming their calls", async () => {
  const { host, setup } = await render({}, []);
  expect(undeclaredControls(host).map(el => el.getAttribute("aria-label") || el.textContent?.trim())).toEqual([]);
  const telegram = [...host.querySelectorAll<HTMLButtonElement>(".r1-ca-card")].find(b => b.textContent?.includes("Telegram"))!;
  expect(telegram.getAttribute("aria-disabled")).toBe("true");
  expect(telegram.dataset.coming).toBe("Setting up Telegram comes in a later update.");
  await act(async () => telegram.click());
  expect(setup).not.toHaveBeenCalled();
  const where = (name: string) => comingControls().find(c => c.where === name)?.need;
  expect(where("Telegram")).toEqual(["wizard.start", "wizard.next", "wizard.cancel"]);
  expect(where("WhatsApp (your number)")).toEqual(["web.login.start", "web.login.wait"]);
  expect(where("Pairing code")).toEqual(["channels.pairing.approve"]);
  expect(where("Approve by code")).toEqual(["channels.pairing.approve"]);
});
it("explains Who answers instead of leaving an empty card when no app is connected", async () => {
  const access = vi.fn((app: { id: string }) => <p>Access for {app.id}</p>);
  const empty = await render({}, methods, ["operator.admin"], access);
  const section = empty.host.querySelector('[aria-label="Who answers and who may message"]')!;
  expect(section.textContent).toContain("No chat app is connected yet.");
  expect(access).not.toHaveBeenCalled();
  await act(async () => root.unmount()); document.body.innerHTML = "";
  const linked = await render({ channelAccounts: { telegram: [{ accountId: "default", configured: true, running: true }] } }, methods, ["operator.admin"], access);
  expect(linked.host.querySelector('[aria-label="Who answers and who may message"]')!.textContent).toContain("Access for telegram");
  expect(linked.host.textContent).not.toContain("No chat app is connected yet.");
});
