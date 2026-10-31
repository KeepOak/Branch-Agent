// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ComputerStage } from "./ComputerStage";
import type { WindowEngine } from "../connect/engine";
vi.mock("../face/Face", () => ({ Face: () => null }));
vi.mock("./desktop-client", () => ({
  DesktopClient: class {
    connect = vi.fn();
  },
}));
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
let container: HTMLDivElement;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  document.body.innerHTML = "";
});
const engine: WindowEngine = {
  request: vi.fn(async () => ({ session: { key: "agent:scout:one" } })) as WindowEngine["request"],
  sessionKey: "agent:scout:one",
  scopes: ["operator.admin"],
  onEvent: () => () => {},
};
const render = async (mode: "Computer" | "Browser", running = false) => {
  if (!root) {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  }
  await act(async () => {
    root!.render(
      <ComputerStage
        engine={engine}
        gatewayUrl="ws://gateway.invalid"
        name="Scout"
        mode={mode}
        running={running}
        onMode={() => {}}
        onClose={() => {}}
        onChooseComputer={() => {}}
      />,
    );
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};
const switchPath = () => {
  const sw = container.querySelector<HTMLElement>(
    '.computer-stage [role="group"][aria-label="Show"]',
  )!;
  const path: string[] = [];
  for (
    let el: HTMLElement | null = sw;
    el && !el.classList.contains("computer-stage");
    el = el.parentElement
  ) {
    path.unshift(`${el.className}#${[...(el.parentElement?.children ?? [])].indexOf(el)}`);
  }
  return path;
};

describe("Computer / Browser switch position (DA-70, #1103)", () => {
  it("sits in the stage header after the status, with no bar of its own (#1103)", async () => {
    await render("Computer");
    const sw = container.querySelector('[role="group"][aria-label="Show"]')!;
    expect(sw.parentElement!.className).toBe("st7-top");
    expect(sw.previousElementSibling?.className).toMatch(/^stage-status-st/);
    expect(container.querySelector(".st7-mode")).toBeNull();
  });
  it("keeps the same place in the Computer and Browser stages, working or not", async () => {
    await render("Computer");
    const computer = switchPath();
    await render("Browser");
    expect(switchPath()).toEqual(computer);
    await render("Browser", true);
    expect(switchPath()).toEqual(computer);
    await render("Computer", true);
    expect(switchPath()).toEqual(computer);
    expect(computer).toEqual(["st7-top#0", "st7-sw#3"]);
  });
});
