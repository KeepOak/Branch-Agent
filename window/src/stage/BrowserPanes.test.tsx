// @vitest-environment jsdom
// The R1 browser route: the header's browser stage is R1Stage in Browser mode, which hosts ComputerStage. Its browser
// view is BrowserPanes, so the owner's switch must show there whenever the desktop bridge exists. The Trunk's browser is
// the default on every start; Your browser opens only when the owner picks it.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { R1Stage } from "../screens/stage/R1Stage";
import type { StageMode } from "./ComputerStage";
import type { WindowEngine } from "../connect/engine";

vi.mock("../face/Face", () => ({ Face: () => null }));
vi.mock("./desktop-client", () => ({
  DesktopClient: class {
    connect = vi.fn();
  },
}));
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

type Desktop = { branchDesktop?: { browserGuest?: unknown } };
const desktop = window as unknown as Desktop;
let root: Root | undefined;
let container: HTMLDivElement | undefined;

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  container?.remove();
  container = undefined;
  delete desktop.branchDesktop;
});

const engine = (): WindowEngine => ({
  request: vi.fn(async () => ({})) as unknown as WindowEngine["request"],
  sessionKey: "agent:scout:one",
  scopes: ["operator.admin"],
  onEvent: () => () => {},
});

// The route as the owner reaches it: the stage opens in Computer mode, and the Computer | Browser tabs change the mode
// through the parent, as R1Window does with onMode.
function RouteHost({ engine: owner }: { engine: WindowEngine }) {
  const [mode, setMode] = useState<StageMode>("Computer");
  return (
    <R1Stage
      engine={owner}
      gatewayUrl="ws://gateway.invalid"
      name="Scout"
      mode={mode}
      blocks={[]}
      running={false}
      onMode={setMode}
      onClose={() => {}}
      onChooseComputer={() => {}}
      onPip={() => {}}
    />
  );
}

async function mountBrowserRoute() {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<RouteHost engine={engine()} />);
  });
  const browserTab = [...container.querySelectorAll<HTMLButtonElement>('[role="group"][aria-label="Show"] button')].find((button) => button.textContent?.trim() === "Browser");
  expect(browserTab, "the stage has a Browser tab").toBeDefined();
  await act(async () => {
    browserTab!.click();
  });
}

const switchOf = () => container?.querySelector<HTMLElement>('[role="group"][aria-label="Which browser"]');

const full = () => ({ openPopout: vi.fn(async () => undefined), onOpenTab: vi.fn(() => () => {}) });
const switchButtons = () => [...switchOf()!.querySelectorAll<HTMLButtonElement>("button")];
const yourPane = () => container?.querySelector<HTMLElement>('section.guest-pane[aria-label="Your browser"]');

describe("R1 browser route", () => {
  it("shows Your browser and Trunk's browser when the desktop bridge exists, Trunk's browser by default even on a local gateway", async () => {
    desktop.branchDesktop = { browserGuest: { local: true, ...full() } };
    await mountBrowserRoute();

    const group = switchOf();
    expect(group).not.toBeNull();
    const buttons = switchButtons();
    expect(buttons.map((button) => button.textContent)).toEqual(["Your browser", "Trunk's browser"]);
    expect(buttons[0]!.getAttribute("aria-pressed")).toBe("false");
    expect(buttons[1]!.getAttribute("aria-pressed")).toBe("true");
    expect(container!.querySelector('.guest-slot')?.getAttribute("data-shown")).toBe("false");
    expect(yourPane()?.getAttribute("data-visible")).toBe("false");
  });

  it("opens Your browser when the owner picks it, and goes back to Trunk's browser", async () => {
    const bridge = { local: true, ...full() };
    desktop.branchDesktop = { browserGuest: bridge };
    await mountBrowserRoute();

    await act(async () => switchButtons()[0]!.click());
    expect(switchButtons()[0]!.getAttribute("aria-pressed")).toBe("true");
    expect(switchButtons()[1]!.getAttribute("aria-pressed")).toBe("false");
    expect(container!.querySelector('.guest-slot')?.getAttribute("data-shown")).toBe("true");
    expect(yourPane()?.getAttribute("data-visible")).toBe("true");
    expect(bridge.onOpenTab).toHaveBeenCalled();

    await act(async () => switchButtons()[1]!.click());
    expect(switchButtons()[1]!.getAttribute("aria-pressed")).toBe("true");
    expect(yourPane()?.getAttribute("data-visible")).toBe("false");
  });

  it("starts on Trunk's browser again on a fresh start after the owner picked Your browser", async () => {
    desktop.branchDesktop = { browserGuest: { local: true, ...full() } };
    await mountBrowserRoute();
    await act(async () => switchButtons()[0]!.click());
    expect(switchButtons()[0]!.getAttribute("aria-pressed")).toBe("true");

    await act(async () => root!.unmount());
    root = undefined;
    container?.remove();
    await mountBrowserRoute();
    expect(switchButtons()[0]!.getAttribute("aria-pressed")).toBe("false");
    expect(switchButtons()[1]!.getAttribute("aria-pressed")).toBe("true");
  });

  it("defaults to Trunk's browser on a remote gateway, and still shows the switch", async () => {
    desktop.branchDesktop = { browserGuest: { local: false, ...full() } };
    await mountBrowserRoute();

    const buttons = switchButtons();
    expect(buttons[0]!.getAttribute("aria-pressed")).toBe("false");
    expect(buttons[1]!.getAttribute("aria-pressed")).toBe("true");
  });

  it("shows the switch whenever the bridge object exists; without its methods Your browser is greyed with its reason and Trunk's browser stays selected", async () => {
    desktop.branchDesktop = { browserGuest: { local: true } };
    await mountBrowserRoute();
    expect(switchOf()).not.toBeNull();
    const [yours, trunks] = switchButtons();
    expect(trunks!.getAttribute("aria-pressed")).toBe("true");
    expect(yours!.getAttribute("aria-pressed")).toBe("false");
    expect(yours!.disabled).toBe(true);
    expect(yours!.title).toBe("Your browser comes in a later update.");

    await act(async () => yours!.click());
    expect(switchButtons()[1]!.getAttribute("aria-pressed")).toBe("true");
    expect(yourPane()).toBeNull();
  });

  it("shows no switch in a plain web page", async () => {
    await mountBrowserRoute();
    expect(switchOf()).toBeNull();
  });
});
