// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../connect/engine";
import { notify } from "../shell/notify";
import { RecBar } from "./RecBar";
import { isDismissed, tomorrowAt } from "./rec-bar-state";

vi.mock("../shell/notify", () => ({ notify: vi.fn() }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const GATEWAY_TITLE = "Keep your Trunks running when Branch is closed?";
const UPDATE_TITLE = "Keep Branch up to date by itself?";

type Controls = { keepWorking: boolean; keepAwake: boolean; trayUsage: boolean; autoApplyUpdates: boolean; startWithWindows: boolean; branchOnPath: boolean };

/** A fake Branch app bridge: `set` stores the change and answers with the new state, as the app does. */
function installBridge(keepWorking: boolean): { set: ReturnType<typeof vi.fn> } {
  let state: Controls = { keepWorking, keepAwake: false, trayUsage: false, autoApplyUpdates: true, startWithWindows: false, branchOnPath: false };
  const set = vi.fn(async (name: keyof Controls, on: boolean) => (state = { ...state, [name]: on }));
  (window as unknown as { branchDesktop: unknown }).branchDesktop = {
    controls: { get: async () => state, set, openDownload: async () => undefined, setTrayUsage: () => undefined, onOpenUsage: () => () => undefined },
  };
  return { set };
}

/** An engine whose config.get reads the live config, and whose config.patch merges into it. */
function engineWith(config: Record<string, unknown>) {
  const request = vi.fn(async (method: string, params?: Record<string, unknown>) => {
    if (method === "config.get") return { hash: "h1", valid: true, config };
    if (method === "config.patch") {
      const patch = JSON.parse(String(params?.raw)) as { update?: { auto?: { enabled?: boolean } } };
      Object.assign(config, { update: { auto: { enabled: patch.update?.auto?.enabled } } });
      return { ok: true, hash: "h2", config };
    }
    return {};
  });
  const engine = { request, sessionKey: null, scopes: [], onEvent: () => () => undefined } as unknown as WindowEngine;
  return { engine, request };
}

let root: Root | undefined;
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  localStorage.clear();
  delete (window as unknown as { branchDesktop?: unknown }).branchDesktop;
  vi.mocked(notify).mockClear();
});

async function mount(engine: WindowEngine): Promise<HTMLElement> {
  const host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root!.render(<RecBar engine={engine} />); });
  await act(async () => { await new Promise(done => setTimeout(done, 0)); });
  return host;
}
const button = (host: HTMLElement, label: string) => [...host.querySelectorAll("button")].find(b => b.textContent?.trim() === label);
const click = async (target: HTMLElement | undefined) => {
  await act(async () => { target?.click(); });
  await act(async () => { await new Promise(done => setTimeout(done, 0)); });
};

describe("RecBar", () => {
  it("asks the gateway question first, with the preview's wording and three buttons", async () => {
    installBridge(false);
    const { engine } = engineWith({ update: { auto: { enabled: false } } });
    const host = await mount(engine);
    expect(host.querySelector(".recbar")?.textContent).toContain(GATEWAY_TITLE);
    expect(host.textContent).toContain("Recommended");
    expect(host.textContent).toContain("The gateway keeps Telegram, your phone and automations working, and restarts Branch if it ever stops.");
    expect(["Yes", "Not now", "Don’t ask again"].map(label => button(host, label)?.textContent)).toEqual(["Yes", "Not now", "Don’t ask again"]);
    expect(host.textContent).not.toContain(UPDATE_TITLE);
  });

  it("Yes turns the gateway on through the app and then asks about updates", async () => {
    const bridge = installBridge(false);
    const { engine } = engineWith({ update: { auto: { enabled: false } } });
    const host = await mount(engine);
    await click(button(host, "Yes"));
    expect(bridge.set).toHaveBeenCalledWith("keepWorking", true);
    expect(notify).toHaveBeenCalledWith("The gateway is on. Your Trunks keep running when Branch is closed.");
    expect(host.querySelector(".recbar")?.textContent).toContain(UPDATE_TITLE);
  });

  it("Yes on the update question saves update.auto.enabled through config.patch", async () => {
    installBridge(true);
    const { engine, request } = engineWith({ update: { auto: { enabled: false } } });
    const host = await mount(engine);
    expect(host.querySelector(".recbar")?.textContent).toContain(UPDATE_TITLE);
    await click(button(host, "Yes"));
    expect(request).toHaveBeenCalledWith("config.patch", expect.objectContaining({ raw: JSON.stringify({ update: { auto: { enabled: true } } }) }));
    expect(notify).toHaveBeenCalledWith("Branch keeps itself up to date.");
    expect(host.querySelector(".recbar")).toBeNull();
  });

  it("shows nothing when both settings are already on", async () => {
    installBridge(true);
    const { engine } = engineWith({ update: { auto: { enabled: true } } });
    const host = await mount(engine);
    expect(host.querySelector(".recbar")).toBeNull();
  });

  it("Not now hides the question until tomorrow and says so", async () => {
    installBridge(false);
    const { engine } = engineWith({ update: { auto: { enabled: false } } });
    const host = await mount(engine);
    await click(button(host, "Not now"));
    expect(notify).toHaveBeenCalledWith("We’ll ask again tomorrow.");
    expect(isDismissed("gateway")).toBe(true);
    expect(host.querySelector(".recbar")?.textContent).toContain(UPDATE_TITLE);
  });

  it("Don't ask again hides the question for good", async () => {
    installBridge(false);
    const { engine } = engineWith({ update: { auto: { enabled: true } } });
    const host = await mount(engine);
    await click(button(host, "Don’t ask again"));
    expect(host.querySelector(".recbar")).toBeNull();
    expect(isDismissed("gateway", Date.now() + 365 * 24 * 3600e3)).toBe(true);
    expect(notify).not.toHaveBeenCalled();
  });

  it("without the Branch app there is no gateway question, and updates are still offered", async () => {
    const { engine } = engineWith({ update: { auto: { enabled: false } } });
    const host = await mount(engine);
    expect(host.textContent).not.toContain(GATEWAY_TITLE);
    expect(host.querySelector(".recbar")?.textContent).toContain(UPDATE_TITLE);
  });

  it("the dismissal runs until the next local midnight", () => {
    const noon = new Date(2026, 9, 14, 12, 0, 0);
    expect(new Date(tomorrowAt(noon))).toEqual(new Date(2026, 9, 15, 0, 0, 0, 0));
  });
});
