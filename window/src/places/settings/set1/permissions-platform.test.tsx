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

  it("shows the PipeWire sentence once under This computer, not on the Location row", async () => {
    await show("Linux x86_64");
    const sentence = "Microphone and camera use PipeWire or the desktop portal. Notifications use this desktop. They open from the Branch app on your computer.";
    expect(host.textContent?.split(sentence)).toHaveLength(2);
    expect([...host.querySelectorAll(".hint")].map((el) => el.textContent).filter((text) => text?.includes("PipeWire"))).toEqual([sentence]);
    const location = host.querySelector('[data-row="Location"]');
    expect(location?.textContent).toContain("Lets a Trunk ask where this computer is when a tool needs it.");
    expect(location?.textContent).not.toContain("PipeWire");
  });

  // PE2: "Location access" and "Precise location" were drawn greyed with no reason (no engine setting backs them).
  for (const [platform, os] of [["MacIntel", "macOS"], ["Win32", "Windows"], ["Linux x86_64", "Linux"]] as const) {
    it(`draws no greyed location controls on ${os}; the Location row says the computer asks`, async () => {
      await show(platform);
      expect(host.querySelector('[data-row="Location access"]')).toBeNull();
      expect(host.querySelector('[data-row="Precise location"]')).toBeNull();
      expect(host.querySelector('[aria-label="Location access"]')).toBeNull();
      expect(host.querySelector('[aria-label="Precise location"]')).toBeNull();
      expect(host.querySelectorAll('.ctl[aria-disabled="true"]')).toHaveLength(0);
      expect(host.querySelector('[data-row="Location"]')?.textContent).toContain(`On ${os} it asks the first time a Trunk needs it.`);
    });
  }
});

describe("Settings › Permissions › This computer status (PE1)", () => {
  type Status = "allowed" | "denied" | "not-asked" | "unknown";
  function fakeDesktop(start: Record<string, Status>) {
    const state = { ...start };
    const calls: string[] = [];
    (window as unknown as { branchDesktop?: unknown }).branchDesktop = {
      permissions: {
        get: async () => ({ ...state }),
        request: async (name: string) => { calls.push(`request:${name}`); state[name] = "allowed"; return { ...state }; },
        open: async (name: string) => { calls.push(`open:${name}`); },
      },
    };
    return calls;
  }
  afterEach(() => { delete (window as unknown as { branchDesktop?: unknown }).branchDesktop; });
  const row = (name: string) => host.querySelector<HTMLElement>(`[data-row="${name}"]`)!;
  const rowButton = (name: string, label: string) => [...row(name).querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.trim() === label);

  it("shows what macOS already allows and one Allow… that asks the system", async () => {
    const calls = fakeDesktop({ microphone: "allowed", camera: "not-asked", location: "unknown", notifications: "unknown" });
    await show("MacIntel");
    expect(row("Microphone").textContent).toContain("Granted");
    expect(row("Microphone").querySelector("button")).toBeNull();
    expect(row("Camera").textContent).toContain("Not yet");
    const allow = rowButton("Camera", "Allow…");
    expect(allow?.disabled).toBe(false);
    await act(async () => allow!.click());
    expect(calls).toContain("request:camera");
    expect(row("Camera").textContent).toContain("Granted");
    expect(rowButton("Camera", "Allow…")).toBeUndefined();
  });

  it("says Turned off and opens System Settings for a refused permission", async () => {
    const calls = fakeDesktop({ microphone: "denied", camera: "denied", location: "unknown", notifications: "unknown" });
    await show("MacIntel");
    expect(row("Microphone").textContent).toContain("Turned off");
    const open = rowButton("Microphone", "Open System Settings");
    expect(open?.disabled).toBe(false);
    await act(async () => open!.click());
    expect(calls).toEqual(["open:microphone"]);
  });

  it("does not guess location or notifications; their settings page opens", async () => {
    const calls = fakeDesktop({ microphone: "allowed", camera: "allowed", location: "unknown", notifications: "unknown" });
    await show("MacIntel");
    for (const name of ["Location", "Notifications"]) {
      expect(row(name).querySelector(".pill")).toBeNull();
      expect(rowButton(name, "Open System Settings")?.disabled).toBe(false);
    }
    await act(async () => rowButton("Notifications", "Open System Settings")!.click());
    expect(calls).toEqual(["open:notifications"]);
    expect(host.textContent).not.toContain("opens from the Branch app on your computer");
  });

  it("never offers Allow… on Windows, where apps can't show the prompt", async () => {
    fakeDesktop({ microphone: "not-asked", camera: "denied", location: "unknown", notifications: "unknown" });
    await show("Win32");
    expect(row("Microphone").textContent).toContain("Not yet");
    expect(rowButton("Microphone", "Allow…")).toBeUndefined();
    expect(rowButton("Microphone", "Open Windows Settings")?.disabled).toBe(false);
  });
  it("says a failed read plainly and folds the system's words under What went wrong", async () => {
    (window as unknown as { branchDesktop?: unknown }).branchDesktop = {
      permissions: { get: async () => { throw new Error("Error invoking remote method 'branch:os-permissions:get'"); }, request: async () => ({}), open: async () => undefined },
    };
    await show("MacIntel");
    await act(async () => { await Promise.resolve(); });
    const hint = host.querySelector<HTMLElement>('[role="status"]')!;
    expect(hint.querySelector("p")?.textContent).toBe("Something went wrong while loading it.");
    expect(hint.querySelector("details")?.open).toBe(false);
    expect(hint.querySelector("summary")?.textContent).toBe("What went wrong");
  });
});

describe("Settings › Permissions › Microphone where the system can't be read (B-032)", () => {
  type Grant = "granted" | "denied" | "prompt";
  const nav = navigator as unknown as { mediaDevices?: unknown; permissions?: unknown };
  const prevMedia = Object.getOwnPropertyDescriptor(nav, "mediaDevices");
  const prevPerms = Object.getOwnPropertyDescriptor(nav, "permissions");
  function fakeMic(state: Grant, ask: () => Promise<unknown>) {
    const stopped: string[] = [];
    Object.defineProperty(nav, "permissions", { configurable: true, value: { query: async () => ({ state }) } });
    Object.defineProperty(nav, "mediaDevices", { configurable: true, value: { getUserMedia: async () => { await ask(); return { getTracks: () => [{ stop: () => stopped.push("audio") }] }; } } });
    return stopped;
  }
  const linuxApp = () => {
    (window as unknown as { branchDesktop?: unknown }).branchDesktop = {
      permissions: { get: async () => ({ microphone: "unknown", camera: "unknown", location: "unknown", notifications: "unknown" }), request: async () => ({}), open: async () => undefined },
    };
  };
  const denied = (name: string) => () => Promise.reject(Object.assign(new Error("Permission denied"), { name }));
  afterEach(() => {
    delete (window as unknown as { branchDesktop?: unknown }).branchDesktop;
    if (prevMedia) Object.defineProperty(nav, "mediaDevices", prevMedia); else delete nav.mediaDevices;
    if (prevPerms) Object.defineProperty(nav, "permissions", prevPerms); else delete nav.permissions;
  });
  const settle = () => act(async () => { for (let i = 0; i < 4; i++) await Promise.resolve(); });
  const row = () => host.querySelector<HTMLElement>('[data-row="Microphone"]')!;
  const allow = () => [...row().querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === "Allow…");

  it("on Linux the Microphone row asks through the app and then reads Granted", async () => {
    linuxApp();
    const stopped = fakeMic("prompt", async () => undefined);
    await show("Linux x86_64");
    await settle();
    expect(row().textContent).toContain("Not yet");
    expect(allow()?.disabled).toBe(false);
    await act(async () => allow()!.click());
    await settle();
    expect(row().textContent).toContain("Granted");
    expect(allow()).toBeUndefined();
    expect(stopped).toEqual(["audio"]);
  });

  it("in a browser a refusal says so in plain words and what to do", async () => {
    fakeMic("prompt", denied("NotAllowedError"));
    await show("MacIntel");
    await settle();
    await act(async () => allow()!.click());
    await settle();
    expect(row().textContent).toContain("Turned off");
    expect(row().textContent).toContain("Microphone access is off for Branch. Allow it for this site in the browser’s settings, then reload.");
    expect(row().querySelector("button")).toBeNull();
  });

  it("a refusal already on record on Linux says where to change it", async () => {
    linuxApp();
    fakeMic("denied", async () => undefined);
    await show("Linux x86_64");
    await settle();
    expect(row().textContent).toContain("Microphone access is off for Branch. Allow it in this computer’s sound settings, then try again.");
  });

  it("no microphone plugged in reads plainly, not as an error", async () => {
    linuxApp();
    fakeMic("prompt", denied("NotFoundError"));
    await show("Linux x86_64");
    await settle();
    await act(async () => allow()!.click());
    await settle();
    expect(row().textContent).toContain("No microphone found. Plug one in, then try again.");
    expect(allow()).toBeUndefined();
    expect(host.textContent).not.toContain("Something went wrong");
  });

  it("a browser with no microphone API says so on the row", async () => {
    await show("MacIntel");
    await settle();
    expect(row().textContent).toContain("This browser can’t use the microphone.");
    expect(allow()).toBeUndefined();
  });
});
