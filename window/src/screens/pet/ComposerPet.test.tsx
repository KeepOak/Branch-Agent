// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../connect/engine";
import { Composer } from "../composer/Composer";
import { ComposerPet } from "./ComposerPet";

const look = vi.hoisted(() => ({ value: { id: "px-squirrel", name: "Hazel", roam: true } }));
const roam = vi.hoisted(() => ({ stop: vi.fn() }));
vi.mock("../../shell/shown", async (load) => ({ ...(await load<typeof import("../../shell/shown")>()), usePetLook: () => look.value }));
vi.mock("../../shell/pet-roam", () => ({ stopRoaming: roam.stop }));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root | undefined;
let reduced = false;
beforeEach(() => {
  reduced = false;
  look.value = { id: "px-squirrel", name: "Hazel", roam: true };
  roam.stop.mockClear();
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("reduced-motion") && reduced, addEventListener() {}, removeEventListener() {} }));
});
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; document.body.innerHTML = ""; localStorage.clear(); vi.unstubAllGlobals(); });

const engine = { sessionKey: "agent:scout:main", agentId: "scout", request: vi.fn(async () => ({})), onEvent: () => () => undefined, scopes: [] } as unknown as WindowEngine;
async function render(node: React.ReactNode) {
  const host = document.body.appendChild(document.createElement("div")); root = createRoot(host);
  await act(async () => root!.render(node));
  return host;
}

describe("the roaming pet on the R1 composer's top edge (parity row 18, QUEUE item 18)", () => {
  it("re-hosts the Classic pet in a zero-height lane right above the pill, so it stands on the rim", async () => {
    const host = await render(<Composer name="Scout" engine={engine} working={false} offline={false} onSend={() => {}} onStop={() => {}} onToast={() => {}} onOpen={() => {}} onOpenConversation={() => {}}
      limits={null} row={{ key: "agent:scout:main", title: "Main", isMain: true } as never} topics={[]} running={[]} />);
    const rim = host.querySelector(".r1c > .r1-pet-rim")!;
    expect(rim.getAttribute("aria-label")).toBe("Pet");
    expect(rim.nextElementSibling?.classList.contains("r1c-pill")).toBe(true);
    // The Classic component, unchanged: its keeper strip and the pet's button and menu.
    expect(rim.querySelector(".keeper .petbox [aria-label='Hazel. Tips and options.']")).not.toBeNull();
    const css = readFileSync("src/screens/pet/pet.css", "utf8").replace(/\s+/g, " ");
    expect(css).toContain(".r1-pet-rim { position: relative; height: 0; pointer-events: none;");
    expect(css).toContain(".r1-pet-rim > .keeper { position: absolute; left: 14px; right: 14px; bottom: 0;");
    expect(css).toContain(".r1-pet-rim .keeper .petbox { bottom: 0; pointer-events: auto; }");
  });

  it("shows nothing unless Appearance › Pet › Let it roam is on, or when the pet is None", async () => {
    look.value = { id: "px-squirrel", name: "Hazel", roam: false };
    let host = await render(<ComposerPet engine={engine} working={false} waiting={null} />);
    expect(host.querySelector(".r1-pet-rim")).toBeNull();
    await act(async () => root!.unmount()); root = undefined;
    look.value = { id: "none", name: "Hazel", roam: true };
    host = await render(<ComposerPet engine={engine} working={false} waiting={null} />);
    expect(host.querySelector(".r1-pet-rim")).toBeNull();
  });

  it("its tip names the Trunk waiting on a yes, and Stop roaming turns the roam off", async () => {
    const host = await render(<ComposerPet engine={engine} working={false} waiting="Ledger" />);
    await act(async () => host.querySelector<HTMLButtonElement>("[aria-label='Hazel. Tips and options.']")!.click());
    await act(async () => document.querySelector<HTMLElement>("[data-testid=pet-tip]")!.click());
    expect(host.querySelector(".pet-say")?.textContent).toBe("Ledger needs a yes. It’s in your Inbox.");
    await act(async () => host.querySelector<HTMLButtonElement>("[aria-label='Hazel. Tips and options.']")!.click());
    await act(async () => document.querySelector<HTMLElement>("[data-testid=pet-stop-roaming]")!.click());
    expect(roam.stop).toHaveBeenCalledOnce();
  });

  it("stands still on the rim with reduced motion", async () => {
    reduced = true;
    const host = await render(<ComposerPet engine={engine} working={false} waiting={null} />);
    const box = host.querySelector<HTMLElement>(".petbox")!;
    const at = box.style.transform;
    await act(async () => { await new Promise(done => setTimeout(done, 800)); });
    expect(box.style.transform).toBe(at);
  });
});
