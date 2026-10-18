// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { WindowEngine } from "../connect/engine";
import { getToasts } from "../shell/notify";
import { WelcomeHero } from "./SetupBrand";
import { PreConnect } from "./PreConnect";
import { SetupFlow } from "./SetupFlow";
import { SETUP_LATER_TOAST, WELCOME_LEDE, WELCOME_LOCK } from "./steps-early";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  sessionStorage.clear();
});

async function show(node: React.ReactNode) {
  const host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  await act(async () => root?.render(node));
  await act(async () => new Promise((r) => setTimeout(r, 0)));
  return host;
}

function engine() {
  const request = vi.fn(async () => ({}));
  return { request, onEvent: () => () => {}, sessionKey: "k", scopes: ["operator.admin"], agentId: "main" } as unknown as WindowEngine;
}

const tid = (host: HTMLElement, id: string) => host.querySelector(`[data-testid="${id}"]`) as HTMLButtonElement;

describe("Welcome", () => {
  it("shows the preview Welcome copy, Get started enabled, and no promise checkbox", async () => {
    const host = await show(<SetupFlow engine={engine()} version="1.0" trunkNames={["Sapling"]} defaultAgentId="main" defaultName="Sapling" onClose={() => {}} onLocalModel={() => {}} />);
    expect(host.querySelector("h2")?.textContent).toBe("Hi, I’m Branch.");
    expect(host.textContent).toContain(WELCOME_LEDE);
    expect(host.textContent).toContain(WELCOME_LOCK);
    expect(host.textContent).not.toContain("How Branch stays safe");
    expect(host.textContent).not.toContain("An assistant that lives on this computer, with Trunks that each take one job. This takes about three minutes; you can change everything later.");
    expect(host.textContent).not.toContain("I understand Branch can act on this computer when I allow it");
    expect(host.textContent).not.toContain("You choose how much Branch asks before it acts.");
    expect(host.querySelector('input[type="checkbox"]')).toBeNull();
    expect(tid(host, "setup-promise")).toBeNull();
    expect(tid(host, "setup-next").disabled).toBe(false);
    expect(tid(host, "setup-next").textContent).toBe("Get started");
    expect(tid(host, "setup-skip")?.textContent).toBe("Set up later");
    expect(tid(host, "setup-talk-welcome")?.textContent).toBe("Set up by talking");
    expect(host.textContent).toContain("Runs on");
    expect(host.textContent).toContain("this computer");
    await act(async () => tid(host, "setup-next").click());
    expect(host.querySelector("h2")?.textContent).toBe("Which models should answer?");
    expect(host.querySelector('[data-testid="setup-welcome-mark"]')).toBeNull();
  });

  it("draws the Welcome mark as an 88px oak tile", () => {
    const markup = renderToStaticMarkup(<WelcomeHero />);
    expect(markup).toContain('data-testid="setup-welcome-mark"');
    expect(markup).toContain("ob-mark");
    expect(markup).toContain("/keepoak-mark.svg");
    expect(markup).toContain("keepoak-mark-mono-white-1024.png");
    expect(markup).toContain('fill="currentColor"');
  });
});

describe("pre-connect Welcome", () => {
  it("opens Change to Where Branch runs, then the remote form, pairing, and failed states", async () => {
    const host = await show(<PreConnect local="ws://127.0.0.1:18789" address={null} state={{ kind: "address" }} busy={false} onConnect={() => {}} onRetry={() => {}} />);
    expect(host.querySelector("h1")?.textContent).toBe("Hi, I’m Branch.");
    expect(host.querySelector(".ob-rail")).toBeNull();
    expect(host.querySelectorAll(".ob-dots i")).toHaveLength(4);
    expect((host.querySelector(".ob-dots i.on") as HTMLElement).className).toBe("on");
    expect(host.querySelector('input[type="checkbox"]')).toBeNull();
    expect(tid(host, "setup-next").disabled).toBe(false);
    expect(tid(host, "setup-next").textContent).toBe("Get started");
    expect(host.querySelector('[data-testid="setup-address"]')).toBeNull();
    await act(async () => tid(host, "setup-where-change").click());
    const sheet = host.querySelector('[data-testid="setup-where-sheet"]')!;
    expect(sheet.querySelector("h2")?.textContent).toBe("Where Branch runs");
    const radios = [...sheet.querySelectorAll<HTMLButtonElement>('[role=radio]')];
    expect(radios.map((r) => r.querySelector("b")?.textContent)).toEqual(["This computer", "Another computer", "A KeepOak computer"]);
    expect(sheet.textContent).toContain("Your Mac mini, a server or a NAS.");
    await act(async () => radios[1].click());
    expect(host.querySelector('[data-testid="setup-where-sheet"]')).toBeNull();
    expect(host.textContent).toContain("Runs on");
    expect(host.textContent).toContain("another computer");
    expect(host.querySelector('[data-testid="setup-address"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="setup-key"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="setup-pairing"]')).toBeNull();
    expect(host.querySelector('[data-testid="setup-problem"]')).toBeNull();

    await act(async () => root?.render(<PreConnect local="ws://127.0.0.1:18789" address="wss://desk.example.test" state={{ kind: "pairing" }} busy={false} onConnect={() => {}} onRetry={() => {}} />));
    expect(host.querySelector('[data-testid="setup-pairing"]')).not.toBeNull();
    expect(host.textContent).toContain("Allow this window");

    await act(async () => root?.render(<PreConnect local="ws://127.0.0.1:18789" address="wss://desk.example.test" state={{ kind: "failed", code: "AUTH_TOKEN_MISMATCH", message: "unauthorized: gateway token mismatch" }} busy={false} onConnect={() => {}} onRetry={() => {}} />));
    expect(host.querySelector('[data-testid="setup-problem"]')).not.toBeNull();
    expect(host.textContent).not.toContain("VITE_GATEWAY_URL");
  });

  it("Get started on this computer connects locally, and Set up later toasts and connects", async () => {
    const connect = vi.fn();
    const host = await show(<PreConnect local="ws://127.0.0.1:18789" address={null} state={{ kind: "address" }} busy={false} onConnect={connect} onRetry={() => {}} />);
    await act(async () => tid(host, "setup-next").click());
    expect(connect).toHaveBeenCalledWith("ws://127.0.0.1:18789", "");
    connect.mockClear();
    await act(async () => tid(host, "setup-skip").click());
    expect(connect).toHaveBeenCalledWith("ws://127.0.0.1:18789", "");
    expect(getToasts().some((t) => t.text === SETUP_LATER_TOAST)).toBe(true);
    expect(sessionStorage.getItem("branch.setupLater")).toBe("1");
  });

  it("Connect on Another computer hands over the address and key", async () => {
    const connect = vi.fn();
    const host = await show(<PreConnect local="ws://127.0.0.1:18789" address={null} state={{ kind: "address" }} busy={false} onConnect={connect} onRetry={() => {}} />);
    await act(async () => tid(host, "setup-where-change").click());
    await act(async () => tid(host, "setup-pick-remote").click());
    const address = host.querySelector('[data-testid="setup-address"]') as HTMLInputElement;
    const key = host.querySelector('[data-testid="setup-key"]') as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(address, "wss://desk.example.test");
      address.dispatchEvent(new Event("input", { bubbles: true }));
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(key, "secret");
      key.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => tid(host, "setup-next").click());
    expect(connect).toHaveBeenCalledWith("wss://desk.example.test", "secret");
  });
});

describe("Set up later", () => {
  it("closes setup from Welcome with the preview toast", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "config.get") return { hash: "h", config: {} };
      if (method === "config.patch") return { ok: true };
      return {};
    });
    const e = { request, onEvent: () => () => {}, sessionKey: "k", scopes: ["operator.admin"], agentId: "main" } as unknown as WindowEngine;
    const closed = vi.fn();
    const host = await show(<SetupFlow engine={e} version="1.0" trunkNames={["Sapling"]} defaultAgentId="main" defaultName="Sapling" onClose={closed} onLocalModel={() => {}} />);
    await act(async () => tid(host, "setup-skip").click());
    await act(async () => new Promise((r) => setTimeout(r, 0)));
    expect(closed).toHaveBeenCalledWith(false);
    expect(getToasts().some((t) => t.text === SETUP_LATER_TOAST)).toBe(true);
  });
});
