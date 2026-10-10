// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { WindowEngine } from "../connect/engine";
import { OverviewPlace } from "../places/overview";
import { paletteRows } from "./palette-rows";
import { Palette } from "./Palette";
import { useLockdown } from "./use-lockdown";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});
const noop = () => undefined;
const button = (label: string, scope: ParentNode = document) => [...scope.querySelectorAll("button")].find(b => b.textContent === label)!;
function fixture() {
  const request = vi.fn(async (method: string, params?: unknown) => {
    if (method === "config.get") return { hash: "h1", valid: true, config: {} };
    if (method === "config.patch") return { hash: "h2", valid: true, config: JSON.parse((params as { raw: string }).raw) };
    return {};
  });
  const engine = { request, sessionKey: null, scopes: ["operator.admin"], onEvent: () => noop } as WindowEngine;
  return { engine, request, patches: () => request.mock.calls.filter(([method]) => method === "config.patch") };
}
async function render(node: React.ReactNode) {
  const host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  await act(async () => root!.render(node));
  return host;
}

it("palette Lockdown action changes nothing until confirmation is accepted", async () => {
  const f = fixture();
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: noop });
  function Harness() {
    const [open, setOpen] = useState(false);
    const lockdown = useLockdown(f.engine, true);
    const rows = paletteRows({ conversations: [], trunks: [], trunkName: () => "Trunk", newConversation: noop,
      toggleTheme: noop, focusMode: noop, shortcuts: noop, setup: noop, tour: noop, quickAsk: noop,
      openConversation: noop, openPlace: noop, openSettings: noop, newTrunk: noop,
      toggleLockdown: () => void lockdown.toggle(), lockdownOn: lockdown.on,
    });
    return <>
      <button onClick={() => setOpen(true)}>Find anything</button>
      {open && <Palette rows={rows} request={f.engine.request} rowName={() => ""} onOpenMessage={noop} onClose={() => setOpen(false)} />}
      {lockdown.confirmation}
    </>;
  }
  async function run(label = "Turn Lockdown on") {
    await act(async () => button("Find anything").click());
    const input = document.querySelector("input")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, label);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
  }
  await render(<Harness />);
  await run();
  expect(f.patches()).toHaveLength(0);
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Stops every Trunk from using tools until you turn this off");
  await act(async () => button("Cancel").click());
  expect(f.patches()).toHaveLength(0);
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  await run();
  await act(async () => button("Turn Lockdown on", document.querySelector('[role="dialog"]')!).click());
  expect(f.patches()).toEqual([["config.patch", { raw: '{"security":{"lockdown":true}}', baseHash: "h1" }]]);
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  await run("Turn Lockdown off");
  expect(f.patches()[1]).toEqual(["config.patch", { raw: '{"security":{"lockdown":false}}', baseHash: "h2" }]);
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});

it("Overview explains the secondary Lockdown button and confirms before changing state", async () => {
  const f = fixture();
  const host = await render(<OverviewPlace engine={f.engine} facts={{ running: 0, waiting: 0 }} openConversation={noop} openPlace={noop} level="regular" />);
  expect(host.textContent).toContain("Stops every Trunk from using tools until you turn this off");
  expect(button("Lockdown").className).toBe("btn sm");
  await act(async () => button("Lockdown").click());
  expect(f.patches()).toHaveLength(0);
  expect(document.querySelector('[role="dialog"]')?.getAttribute("aria-label")).toBe("Turn Lockdown on?");
  await act(async () => button("Turn Lockdown on").click());
  expect(f.patches()).toHaveLength(1);
  expect(button("Turn Lockdown off")).toBeTruthy();
});
