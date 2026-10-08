// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { BrowserDrivingTag, BrowserFirstUseBanner, BrowserModeStrip, BrowserWatchBanner, browserChromeState } from "./BrowserChrome";
import { DEFAULT_READ_MODE, driveMode, readStageNoteSeen, saveStageNoteSeen, STAGE_NOTE_KEY } from "./browser-chrome";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
let host: HTMLDivElement;

async function mount(node: ReactNode) {
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  await act(async () => {
    root!.render(node);
  });
}

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  host?.remove();
  localStorage.removeItem(STAGE_NOTE_KEY);
});

describe("browser pane mode states", () => {
  it("shows the preview's Reads strip with Both pressed and the tool labels", async () => {
    await mount(
      <BrowserModeStrip drawer={false} pageEnabled={false} toolsEnabled={false} onPageMenu={() => {}} onTools={() => {}} />,
    );
    const strip = host.querySelector('[aria-label="Browser tools"]')!;
    expect(strip.textContent).toContain("Reads");
    expect(strip.textContent).toContain("Page");
    expect(strip.textContent).toContain("Picture");
    expect(strip.textContent).toContain("Both");
    expect(strip.textContent).toContain("Numbers");
    expect(strip.textContent).toContain("Comment");
    expect(strip.textContent).toContain("Record");
    const reads = [...strip.querySelectorAll('[aria-label="How it reads the page"] button')];
    expect(reads.map((b) => [b.textContent, b.getAttribute("aria-pressed")])).toEqual([
      ["Page", "false"],
      ["Picture", "false"],
      ["Both", "true"],
    ]);
    expect(DEFAULT_READ_MODE).toBe("both");
  });

  it("shows the first-use banner and dismisses it with Got it", async () => {
    expect(readStageNoteSeen()).toBe(false);
    let gone = false;
    await mount(
      <BrowserFirstUseBanner
        onDismiss={() => {
          saveStageNoteSeen();
          gone = true;
        }}
      />,
    );
    expect(host.textContent).toContain("Your screen, mouse and apps.");
    expect(host.textContent).toContain("Ctrl+Alt+Shift+Esc");
    const got = [...host.querySelectorAll("button")].find((b) => b.textContent === "Got it")!;
    await act(async () => got.click());
    expect(gone).toBe(true);
    expect(readStageNoteSeen()).toBe(true);
  });

  it("maps watch, drive and idle, and renders the matching banner or overlay", async () => {
    expect(driveMode(true, false)).toBe("watch");
    expect(driveMode(true, true)).toBe("drive");
    expect(driveMode(false, false)).toBe("idle");
    expect(browserChromeState("watch", true)).toEqual({ watch: true, drive: false });
    expect(browserChromeState("drive", true)).toEqual({ watch: false, drive: true });
    expect(browserChromeState("idle", true)).toEqual({ watch: false, drive: false });
    expect(browserChromeState("watch", false)).toEqual({ watch: false, drive: false });

    await mount(<BrowserWatchBanner name="Scout" onTakeOver={() => {}} />);
    expect(host.textContent).toContain("Scout is using this page.");
    expect(host.textContent).toContain("Take over");
    await act(async () => root!.render(<BrowserDrivingTag name="Scout" />));
    expect(host.textContent).toContain("You’re driving · Scout is paused");
  });
});
