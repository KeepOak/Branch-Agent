// @vitest-environment jsdom
// #1103 item 4: next to Chrome, the Trunk's browser stacked four thin bars (Computer | Browser, Your | Trunk's browser,
// the tab strip, a thin address bar). It is now one Chrome-like toolbar row (back, forward, reload, a full-height rounded
// address bar, the tabs and the page's tools), and both switches sit in the stage header.
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { R1Stage } from "../screens/stage/R1Stage";
import type { StageMode } from "./ComputerStage";
import type { WindowEngine } from "../connect/engine";

vi.mock("../face/Face", () => ({ Face: () => null }));
vi.mock("./desktop-client", () => ({ DesktopClient: class { connect = vi.fn(); } }));
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
function Host({ owner }: { owner: WindowEngine }) {
  const [mode, setMode] = useState<StageMode>("Browser");
  return <R1Stage engine={owner} gatewayUrl="ws://gateway.invalid" name="Scout" mode={mode} blocks={[]} running={false} onMode={setMode} onClose={() => {}} onChooseComputer={() => {}} onPip={() => {}} />;
}
async function mount() {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root!.render(<Host owner={engine()} />));
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  return container;
}

describe("the Trunk's browser has one Chrome-like toolbar (#1103)", () => {
  it("puts back, forward, reload, the address bar, the tabs and New tab in one toolbar row", async () => {
    const host = await mount();
    const row = host.querySelector<HTMLElement>('.br-chrome-st[role="toolbar"]')!;
    expect(row).not.toBeNull();
    const kids = [...row.children];
    const at = (sel: string) => kids.findIndex((el) => el.matches(sel));
    expect(at('button[aria-label="Back"]')).toBe(0);
    expect(at('button[aria-label="Forward"]')).toBe(1);
    expect(at('button[aria-label="Reload"]')).toBe(2);
    expect(at("form.br-url-st")).toBe(3);
    expect(row.querySelector('form.br-url-st input[aria-label="Search or enter an address"]')).not.toBeNull();
    expect(at('[role="tablist"][aria-label="Tabs"]')).toBe(4);
    expect(row.querySelector('[role="tablist"] button[aria-label="New tab"]')).not.toBeNull();
    // No second bar: the page tools no longer get a row of their own, and the tab strip is not a separate band.
    expect(host.querySelector(".bar-br")).toBeNull();
    expect(host.querySelectorAll('[role="toolbar"][aria-label="Browser tools"]').length).toBe(1);
  });

  it("moves the Computer | Browser and Your | Trunk's browser switches into the stage header", async () => {
    desktop.branchDesktop = { browserGuest: { local: true, openPopout: vi.fn(async () => undefined), onOpenTab: vi.fn(() => () => {}) } };
    const host = await mount();
    const top = host.querySelector(".computer-stage > .st7-top")!;
    expect(top.querySelector('[role="group"][aria-label="Show"]')).not.toBeNull();
    const which = top.querySelector('[role="group"][aria-label="Which browser"]')!;
    expect(which).not.toBeNull();
    expect([...which.querySelectorAll("button")].map((b) => b.textContent)).toEqual(["Your browser", "Trunk's browser"]);
    expect(host.querySelector(".st7-mode")).toBeNull();
    // Picking a browser from the header still switches the pane.
    await act(async () => (which.querySelector("button") as HTMLButtonElement).click());
    expect(host.querySelector(".guest-slot")?.getAttribute("data-shown")).toBe("true");
  });

  it("draws the row full height and rounded, and gives the empty page room", () => {
    const css = readFileSync("src/stage/stage.css", "utf8").replace(/\s+/g, " ");
    const rule = (sel: string) => css.match(new RegExp(sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + " \\{([^}]*)\\}"))?.[1] ?? "";
    expect(rule(".br-chrome-st")).toMatch(/display:flex;align-items:center;/);
    expect(rule(".br-url-st")).toMatch(/height:36px;/);
    expect(rule(".br-url-st")).toMatch(/border-radius:999px;/);
    expect(rule(".blank-st")).toMatch(/padding:48px 32px;/);
    expect(rule(".blank-st b")).toMatch(/font-size:20px;/);
  });
});
