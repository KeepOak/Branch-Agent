// @vitest-environment jsdom
// Seedbank Copy writes through writeClipboard (window, then the Branch app bridge). A refused clipboard shows a
// plain next-step sentence and a working action (the seed selected, Try again), never a raw error.
import { act, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Entry } from "./catalog";
import { SEED_NOT_COPIED, SeedIcons } from "./parts";
import { seedLink } from "./seed";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ENTRY: Entry = {
  id: "mcp:github",
  kind: "mcp",
  name: "GitHub",
  by: "Ada",
  desc: "Repos",
  badge: "Community",
  checked: false,
  installed: false,
  source: { type: "plugin", catalogId: "", pluginId: "github", packageName: "@ada/github", install: { source: "clawhub", packageName: "@ada/github" }, unavailable: false },
};
const LINK = seedLink(ENTRY)!;
const RAW = /NotAllowedError|Write permission denied|no clipboard|no answer/;

const originalClipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");
const desktopWindow = window as unknown as { branchDesktop?: { clipboard?: { writeText: (text: string) => Promise<void> } } };

let root: Root | null = null;
let host: HTMLDivElement;
beforeEach(() => {
  localStorage.clear();
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  delete desktopWindow.branchDesktop;
});
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = null;
  host.remove();
  document.body.innerHTML = "";
  localStorage.clear();
  delete desktopWindow.branchDesktop;
  if (originalClipboard) Object.defineProperty(navigator, "clipboard", originalClipboard);
  else Reflect.deleteProperty(navigator, "clipboard");
  vi.restoreAllMocks();
});

function Harness() {
  const [notice, setNotice] = useState<ReactNode>(null);
  return <>
    {notice ? <p className="sb-notice" role="status">{notice}</p> : null}
    <SeedIcons entry={ENTRY} onNotice={setNotice} />
  </>;
}

async function render() {
  await act(async () => { root!.render(<Harness />); });
}
async function clickCopy() {
  const copy = host.querySelector<HTMLButtonElement>(`[aria-label="Copy ${ENTRY.name}’s seed"]`);
  expect(copy).toBeTruthy();
  await act(async () => { copy!.click(); });
  for (let i = 0; i < 6; i++) await act(async () => { await Promise.resolve(); });
}

describe("Seedbank Copy", () => {
  it("writes the seed link to the clipboard", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    await render();
    await clickCopy();
    expect(writeText).toHaveBeenCalledWith(LINK);
    expect(host.querySelector("[role='status']")?.textContent).toBe(`Copied ${ENTRY.name}’s seed. Paste it anywhere in Branch.`);
    expect(host.querySelector("button")?.textContent).not.toBe("Try again");
  });

  it("uses the Branch app clipboard when the window clipboard is refused", async () => {
    const browserWrite = vi.fn(async () => { throw new DOMException("Write permission denied", "NotAllowedError"); });
    const desktopWrite = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: browserWrite } });
    desktopWindow.branchDesktop = { clipboard: { writeText: desktopWrite } };
    await render();
    await clickCopy();
    expect(browserWrite).toHaveBeenCalledWith(LINK);
    expect(desktopWrite).toHaveBeenCalledWith(LINK);
    expect(host.querySelector("[role='status']")?.textContent).toBe(`Copied ${ENTRY.name}’s seed. Paste it anywhere in Branch.`);
    expect(host.textContent).not.toMatch(RAW);
  });

  it("shows a plain next-step message and action when nothing can copy, not a raw error", async () => {
    const browserWrite = vi.fn(async () => { throw new DOMException("Write permission denied", "NotAllowedError"); });
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: browserWrite } });
    await render();
    await clickCopy();
    const banner = host.querySelector(".sb-notice");
    const notice = banner?.textContent ?? "";
    expect(notice).toContain(SEED_NOT_COPIED);
    expect(notice).toContain("Select it and copy it yourself.");
    expect(notice).toContain("Try again");
    expect(notice).not.toBe("The seed couldn’t be copied.");
    expect(notice).not.toMatch(RAW);
    expect(host.textContent).not.toMatch(RAW);
    const retry = [...(banner?.querySelectorAll("button") ?? [])].find((b) => b.textContent === "Try again");
    expect(retry).toBeTruthy();
    const field = banner?.querySelector<HTMLInputElement>(`input[aria-label="${ENTRY.name}’s seed"]`);
    expect(field?.value).toBe(LINK);
    expect(field?.selectionStart).toBe(0);
    expect(field?.selectionEnd).toBe(LINK.length);
  });
});
