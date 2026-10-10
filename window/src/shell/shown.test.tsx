// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import type { WindowEngine } from "../connect/engine";
import { forgetLookStore, lookStore } from "../places/settings/set1/appearance-store";
import { hideMenuItems, hideTarget, shownFrom, useShown, type Shown } from "./shown";
import { StatusBar } from "./StatusBar";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  forgetLookStore();
  localStorage.clear();
  document.body.innerHTML = "";
});

const engine = { request: async () => ({ status: "no_durable_identity" }), onEvent: () => () => undefined, sessionKey: null, scopes: [] } as unknown as WindowEngine;
const facts = { connection: "connected", gateway: "on", machineName: "here", roomUsed: null, running: 0, version: "1.0", usage: null } as const;

describe("What's shown", () => {
  it("shows each part unless its switch is off; the graphics and memory readout only once switched on", () => {
    expect(shownFrom({})).toEqual({ usage: true, gateway: true, statusBar: true, projects: true, gfx: false });
    expect(shownFrom({ "show.usage": false, "show.gateway": false, "show.statusbar": false, "show.projects": false, "show.gfx": true })).toEqual({ usage: false, gateway: false, statusBar: false, projects: false, gfx: true });
  });

  it("follows a switch changed in Settings › Appearance without a reload", async () => {
    let seen: Shown | null = null;
    function Probe() {
      seen = useShown(engine);
      return null;
    }
    root = createRoot(document.body.appendChild(document.createElement("div")));
    await act(async () => root?.render(<Probe />));
    expect(seen).toMatchObject({ gateway: true, projects: true });
    await act(async () => void (await lookStore(engine).set("show.gateway", false)));
    await act(async () => void (await lookStore(engine).set("show.projects", false)));
    expect(seen).toMatchObject({ gateway: false, projects: false, usage: true, statusBar: true });
  });

  it("the status bar leaves out the gateway when it is switched off", async () => {
    const host = document.body.appendChild(document.createElement("div"));
    root = createRoot(host);
    await act(async () => root?.render(<StatusBar {...facts} open={null} onItem={() => {}} />));
    expect(host.querySelector("[data-testid=sb-gateway]")).not.toBeNull();
    await act(async () => root?.render(<StatusBar {...facts} open={null} onItem={() => {}} gatewayShown={false} />));
    expect(host.querySelector("[data-testid=sb-gateway]")).toBeNull();
    expect(host.querySelector("[data-testid=sb-connection]")).not.toBeNull();
  });

  it("a right-click on the usage ring, the gateway or the Projects heading offers Hide this and Choose what's shown…", async () => {
    const host = document.body.appendChild(document.createElement("div"));
    root = createRoot(host);
    const usage = { name: "Plan", left: 80, low: false, reset: "" };
    await act(async () => root?.render(<StatusBar {...facts} usage={usage} open={null} onItem={() => {}} />));
    const ring = host.querySelector("[data-testid=sb-usage]")?.firstElementChild ?? null;
    expect(hideTarget(ring)).toBe("usage");
    expect(hideTarget(host.querySelector("[data-testid=sb-gateway] svg"))).toBe("gateway");
    expect(hideTarget(host.querySelector("[data-testid=sb-running]"))).toBeNull();
    const heading = document.body.appendChild(document.createElement("button"));
    heading.dataset.hide = "projects";
    expect(hideTarget(heading)).toBe("projects");
    heading.dataset.hide = "unknown"; // a part the window does not know cannot be hidden
    expect(hideTarget(heading)).toBeNull();
    heading.dataset.hide = "pet"; // the pet is not a What's shown part any more: the card is the pet
    expect(hideTarget(heading)).toBeNull();
    const ran: string[] = [];
    const items = hideMenuItems(() => ran.push("hide"), () => ran.push("choose"));
    expect(items.map((i) => ("label" in i ? i.label : ""))).toEqual(["Hide this", "Choose what’s shown…"]);
    items.forEach((i) => "run" in i && i.run());
    expect(ran).toEqual(["hide", "choose"]);
  });
});
