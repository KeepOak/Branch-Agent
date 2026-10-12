// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../connect/engine";
import { Pairing, PAIRING_COMING } from "./Pairing";
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root;
afterEach(async () => { if (root) await act(async () => root.unmount()); document.body.innerHTML = ""; });
const snapshot = { requests: [{ requestId: "r1", senderLabel: "Ada", channel: "telegram", channelLabel: "Telegram", accountId: "default" }], accounts: [] } as never;
async function render(methods: string[]) {
  const engine = { request: vi.fn(async () => ({})), onEvent: () => () => {}, sessionKey: null, scopes: ["operator.admin"], features: { methods, events: [] } } as unknown as WindowEngine;
  const host = document.body.appendChild(document.createElement("div")); root = createRoot(host);
  await act(async () => root.render(<Pairing engine={engine} snapshot={snapshot} reload={async () => {}} />));
  return host;
}
const buttons = (host: Element) => [...host.querySelectorAll<HTMLButtonElement>(".r1-ca-request button")];
it("gives Approve and Dismiss a Coming reason, on hover and in a visible line, when the engine lacks them", async () => {
  const host = await render([]);
  const [approve, dismiss] = buttons(host);
  for (const b of [approve, dismiss]) { expect(b.textContent).toBe("Coming"); expect(b.disabled).toBe(true); expect(b.title).toBe(PAIRING_COMING); }
  expect(host.querySelector(".r1-ca-pairing")!.textContent).toContain(PAIRING_COMING);
});
it("shows no Coming reason once both methods are offered", async () => {
  const host = await render(["channels.pairing.approve", "channels.pairing.dismiss"]);
  expect(buttons(host).map(b => [b.textContent, b.title])).toEqual([["Approve", ""], ["Dismiss", ""]]);
  expect(host.textContent).not.toContain(PAIRING_COMING);
});
