// @vitest-environment jsdom
// #977: Settings › Learn more › Ask a Trunk. With a host that asks and an engine that offers chat.send it is live and
// hands the question over; with no methods it is Coming, naming chat.send, and nothing on the page is undeclared.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../connect/engine";
import { comingControls, undeclaredControls } from "../../glass/coming-registry";
import { forgetLookStore } from "../../places/settings/set1/appearance-store";
import { SettingsFrame } from "./SettingsFrame";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, host: HTMLDivElement;
beforeEach(() => { host = document.body.appendChild(document.createElement("div")); root = createRoot(host); localStorage.clear(); forgetLookStore(); });
afterEach(async () => { await act(async () => root.unmount()); document.body.innerHTML = ""; });

function engineOf(methods: string[]) {
  const request = vi.fn(async (method: string) => {
    if (method === "config.get") return { hash: "h1", valid: true, config: {} };
    if (method === "config.schema") return { schema: {}, uiHints: {} };
    if (method === "users.prefs.get") return { status: "ok", entries: {} };
    if (method === "themes.list") return { current: {} };
    return { ok: true, status: "ok" };
  });
  return { request, onEvent: () => () => undefined, sessionKey: "s", scopes: ["operator.admin"], features: { methods, events: [] } } as unknown as WindowEngine;
}
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
const openHelp = async () => {
  await act(async () => host.querySelector<HTMLElement>("[data-page='general']")!.click()); await settle();
  await act(async () => host.querySelector<HTMLElement>(".r1s-learn")!.click()); await settle();
  return [...host.querySelectorAll<HTMLElement>(".r1s-help .r1s-btn")].find((b) => b.textContent === "Ask a Trunk")!;
};

it("asks the host's Trunk about the page when the engine offers chat.send", async () => {
  const onAsk = vi.fn();
  await act(async () => root.render(<SettingsFrame engine={engineOf(["config.get", "config.patch", "chat.send"])} onAsk={onAsk} />));
  await settle();
  const ask = await openHelp();
  expect(ask.getAttribute("aria-disabled")).toBeNull();
  expect(ask.dataset.need).toBe("chat.send");
  await act(async () => ask.click());
  expect(onAsk).toHaveBeenCalledWith("Help me with Settings › General.");
});

it("does not draw a Coming Ask a Trunk below Technical", async () => {
  await act(async () => root.render(<SettingsFrame engine={engineOf([])} onAsk={vi.fn()} />));
  await settle();
  await act(async () => host.querySelector<HTMLElement>("[data-page='general']")!.click()); await settle();
  await act(async () => host.querySelector<HTMLElement>(".r1s-learn")!.click()); await settle();
  expect([...host.querySelectorAll(".r1s-help button")].map((b) => b.textContent)).not.toContain("Ask a Trunk");
});

it("keeps Ask a Trunk Coming at Technical, naming chat.send, on an engine with no methods", async () => {
  const onAsk = vi.fn();
  localStorage.setItem("branch.level", "technical");
  await act(async () => root.render(<SettingsFrame engine={engineOf([])} onAsk={onAsk} />));
  await settle();
  const ask = await openHelp();
  expect(ask.getAttribute("aria-disabled")).toBe("true");
  await act(async () => ask.click());
  expect(onAsk).not.toHaveBeenCalled();
  expect(comingControls().find((entry) => entry.where === "Ask a Trunk")?.missing).toEqual(["chat.send"]);
  expect(undeclaredControls(host.querySelector(".r1s-help")!)).toEqual([]);
});
