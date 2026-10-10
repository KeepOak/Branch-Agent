// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { KitProvider, type SaveReport } from "../kit";
import { ThisPc } from "./permissions-top";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLDivElement;
const report: SaveReport = { saving: () => undefined, saved: () => undefined, failed: () => undefined };
const prevPlatform = Object.getOwnPropertyDescriptor(Navigator.prototype, "platform");

beforeEach(() => { host = document.body.appendChild(document.createElement("div")); root = createRoot(host); });
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = "";
  if (prevPlatform) Object.defineProperty(Navigator.prototype, "platform", prevPlatform);
});

async function show(platform: string) {
  Object.defineProperty(Navigator.prototype, "platform", { configurable: true, get: () => platform });
  await act(async () => root.render(<KitProvider level={0} report={report} scope={null}><ThisPc /></KitProvider>));
}
const button = (label: string) => [...host.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.trim() === label);

describe("Settings › Permissions › This computer", () => {
  it("keeps Windows Settings wording on Windows", async () => {
    await show("Win32");
    expect(host.textContent).toContain("Windows asks for very little. Branch asks before taking over.");
    expect(host.textContent).toContain("Windows asks for an administrator yes each time. Branch asks you first.");
    expect(host.textContent).toContain("Windows permissions open from the Branch app on your computer.");
    expect(button("Open Windows Settings")?.disabled).toBe(true);
    expect(button("Open Windows Settings")?.title).toBe("Windows permissions open from the Branch app on your computer.");
    expect(host.textContent).not.toContain("Open System Settings");
    expect(host.textContent).not.toContain("PipeWire");
  });

  it("names System Settings › Privacy & Security on macOS", async () => {
    await show("MacIntel");
    expect(host.textContent).toContain("macOS asks for very little. Branch asks before taking over.");
    expect(host.textContent).toContain("macOS asks for an administrator yes each time. Branch asks you first.");
    expect(host.textContent).toContain("System Settings › Privacy & Security");
    expect(button("Open System Settings")?.disabled).toBe(true);
    expect(button("Open System Settings")?.title).toBe("System Settings › Privacy & Security opens from the Branch app on your computer.");
    expect(host.textContent).not.toContain("Windows");
    expect(host.textContent).not.toContain("Open Windows Settings");
  });

  it("explains Linux portals and hides a Windows Settings button", async () => {
    await show("Linux x86_64");
    expect(host.textContent).toContain("Linux uses the desktop portal for microphone, camera and notifications.");
    expect(host.textContent).toContain("PipeWire or the desktop portal");
    expect(host.textContent).toContain("Linux asks for an administrator yes each time. Branch asks you first.");
    expect(host.querySelector('[data-row="Microphone"]')).not.toBeNull();
    expect(host.querySelector('[data-row="Camera"]')).not.toBeNull();
    expect(host.querySelector('[data-row="Notifications"]')).not.toBeNull();
    expect(button("Open Windows Settings")).toBeUndefined();
    expect(button("Open System Settings")).toBeUndefined();
    expect(host.textContent).not.toContain("Windows");
  });

  it("shows the PipeWire sentence once under This computer", async () => {
    await show("Linux x86_64");
    const sentence = "Microphone and camera use PipeWire or the desktop portal. Notifications use this desktop. They open from the Branch app on your computer.";
    expect(host.textContent?.split(sentence)).toHaveLength(2);
    expect([...host.querySelectorAll(".hint")].map((el) => el.textContent).filter((text) => text?.includes("PipeWire"))).toEqual([sentence]);
    expect(host.querySelector('[data-row="Location access"]')).toBeNull();
    expect(host.querySelector('[data-row="Precise location"]')).toBeNull();
  });
});
