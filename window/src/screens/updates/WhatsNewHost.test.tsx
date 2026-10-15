// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SaplingSession } from "../../connect/session";
import { About } from "../../places/settings/set2/updates";
import { WhatsNewRow } from "../../places/settings/set2/whats-new-row";
import { WHATS_NEW_EVENT, WhatsNewHost } from "./WhatsNewHost";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root | undefined;
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; document.body.innerHTML = ""; });

const session = { request: vi.fn(async () => ({})), subscribe: () => () => undefined, getSnapshot: () => ({ status: { phase: "disconnected" } }), onGatewayEvent: () => () => undefined, engine: { request: vi.fn(async () => ({})), onEvent: () => () => undefined } } as unknown as SaplingSession;
async function render(node: React.ReactNode) {
  const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root!.render(node));
  return host;
}
const button = (text: string) => [...document.querySelectorAll("button")].find((b) => b.textContent?.includes(text))!;
const click = async (el: Element) => { await act(async () => (el as HTMLElement).click()); };

describe("What's new in R1 (Settings › Updates & about)", () => {
  it("Updates & about's What's new row sends branch:whats-new, in the About section", async () => {
    const heard = vi.fn();
    window.addEventListener(WHATS_NEW_EVENT, heard);
    const host = await render(<About />);
    expect(host.querySelector("[data-sec=About]")?.textContent).toContain("What’s new");
    await click(button("What’s new"));
    expect(heard).toHaveBeenCalledOnce();
    window.removeEventListener(WHATS_NEW_EVENT, heard);
  });

  it("opens the Classic What's new dialog on branch:whats-new, and each row opens its R1 place", async () => {
    const go = { onSettings: vi.fn(), onSearch: vi.fn(), onSetup: vi.fn(), onNotice: vi.fn() };
    await render(<><WhatsNewRow /><WhatsNewHost session={session} ready={false} {...go} /></>);
    expect(document.querySelector("[data-testid=whats-new]")).toBeNull();
    await click(button("What’s new"));
    const dialog = document.querySelector("[data-testid=whats-new]")!;
    // README item 48: in R1 the dialog is clear glass and its words sit on pills.
    expect(dialog.className).toContain("g-clear");
    expect(dialog.querySelector("h3")?.className).toBe("g-label");
    expect(dialog.textContent).toContain("Setup and the walkthrough");
    expect(dialog.textContent).toContain("Accounts sign in from Settings");
    await click(button("Accounts sign in from Settings"));
    expect(go.onSettings).toHaveBeenCalledWith("accounts");
    expect(document.querySelector("[data-testid=whats-new]")).toBeNull();
    for (const [row, check] of [["Shortcuts you choose", () => expect(go.onSettings).toHaveBeenLastCalledWith("general")], ["Find anything", () => expect(go.onSearch).toHaveBeenCalledOnce()], ["Setup and the walkthrough", () => expect(go.onSetup).toHaveBeenCalledOnce()]] as const) {
      await act(async () => { window.dispatchEvent(new CustomEvent(WHATS_NEW_EVENT)); });
      await click(button(row));
      check();
    }
    await act(async () => { window.dispatchEvent(new CustomEvent(WHATS_NEW_EVENT)); });
    await click(button("Done"));
    expect(document.querySelector("[data-testid=whats-new]")).toBeNull();
  });
});
