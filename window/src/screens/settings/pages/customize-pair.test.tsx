// @vitest-environment jsdom
// Settings › Customize › Another Branch: "Show a pairing code" is a working control. The engine never lists
// device.pair.setupCode in its hello (it is not advertised), so the button must not wait on it, or it reads
// "Coming in a later update." at every level. On an engine without graft.join the button is Coming, and Coming
// controls show only at Technical (rows.ts COMING_FROM).
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../../connect/engine";
import { COMING_REASON } from "../../../glass/coming-registry";
import { forgetLookStore } from "../../../places/settings/set1/appearance-store";
import { SettingsFrame } from "../SettingsFrame";
import { R1_PAGES } from "./plugged";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let host: HTMLDivElement;
beforeEach(() => { host = document.body.appendChild(document.createElement("div")); root = createRoot(host); localStorage.clear(); forgetLookStore(); });
afterEach(async () => { await act(async () => root.unmount()); document.body.innerHTML = ""; });

/** The hello's method list as an engine sends it: device.pair.setupCode is never in it. */
const HELLO = ["config.get", "config.patch", "config.schema", "users.prefs.get", "agents.list", "contacts.outside.list", "contacts.outside.set", "skills.library.list"];

function engineOf(methods: string[]): WindowEngine {
  const request = vi.fn(async (method: string) => {
    if (method === "config.get") return { hash: "h1", valid: true, config: {} };
    if (method === "config.schema") return { schema: {}, uiHints: {} };
    if (method === "users.prefs.get") return { status: "ok", entries: {} };
    if (method === "agents.list") return { agents: [{ id: "main", identity: { name: "Sapling" } }], defaultId: "main", mainKey: "agent:main:main" };
    if (method === "contacts.outside.list") return { enabled: true, agents: [] };
    return {};
  });
  return { request, onEvent: () => () => undefined, sessionKey: "s", scopes: ["operator.admin"], features: { methods } } as unknown as WindowEngine;
}

async function mount(engine: WindowEngine, level: "regular" | "advanced" | "technical") {
  await act(async () => root.unmount());
  root = createRoot(host);
  forgetLookStore();
  localStorage.setItem("branch.level", level);
  await act(async () => root.render(<SettingsFrame engine={engine} page="customize" pages={R1_PAGES} />));
  for (let i = 0; i < 4; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

const another = () => host.querySelector<HTMLElement>('.r1s-sec[aria-label="Another Branch"]');
const pairButton = () => [...(another()?.querySelectorAll<HTMLButtonElement>("button") ?? [])].find((b) => b.textContent === "Show a pairing code");

it("shows a working pairing button at Regular and Advanced, never a later-update stub", async () => {
  const engine = engineOf([...HELLO, "graft.join"]);
  for (const level of ["regular", "advanced"] as const) {
    await mount(engine, level);
    const button = pairButton();
    expect(button, level).toBeDefined();
    expect(button?.getAttribute("data-coming"), level).toBeNull();
    expect(button?.getAttribute("aria-disabled"), level).toBeNull();
    expect(another()?.innerHTML, level).not.toContain(COMING_REASON);
  }
});

it("works at Technical too, gated only on a call the engine lists", async () => {
  await mount(engineOf([...HELLO, "graft.join"]), "technical");
  const button = pairButton();
  expect(button?.getAttribute("data-coming")).toBeNull();
  expect(button?.getAttribute("data-need")).toBe("graft.join");
});

it("hides the Coming button below Technical on an engine without graft.join, and shows it greyed at Technical", async () => {
  const engine = engineOf(HELLO);
  for (const level of ["regular", "advanced"] as const) {
    await mount(engine, level);
    expect(pairButton(), level).toBeUndefined();
    expect(another()?.innerHTML ?? "", level).not.toContain(COMING_REASON);
  }
  await mount(engine, "technical");
  expect(pairButton()?.getAttribute("data-coming")).toBe(COMING_REASON);
});
