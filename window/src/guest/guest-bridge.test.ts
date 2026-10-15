// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { guestBridge } from "./guest-bridge";

type Desktop = { branchDesktop?: { browserGuest?: unknown } };
const desktop = window as unknown as Desktop;

afterEach(() => {
  delete desktop.branchDesktop;
});

describe("guestBridge", () => {
  it("is null on a plain web page", () => {
    expect(guestBridge()).toBeNull();
  });

  it("exists whenever the desktop exposes the browser object, even without its methods", () => {
    desktop.branchDesktop = { browserGuest: { local: true } };
    const bridge = guestBridge();
    expect(bridge).not.toBeNull();
    expect(bridge?.local).toBe(true);
    expect(() => bridge?.openPopout("https://keepoak.com/")).not.toThrow();
    expect(bridge?.onOpenTab(() => {})).toEqual(expect.any(Function));
  });

  it("reads local as false unless the desktop says true", () => {
    desktop.branchDesktop = { browserGuest: { local: "yes" } };
    expect(guestBridge()?.local).toBe(false);
  });

  it("calls the desktop's methods and keeps one identity per bridge object", () => {
    const openPopout = vi.fn(async () => undefined);
    const onOpenTab = vi.fn(() => () => {});
    const raw = { local: true, openPopout, onOpenTab };
    desktop.branchDesktop = { browserGuest: raw };
    const first = guestBridge();
    expect(guestBridge()).toBe(first);
    void first?.openPopout("https://keepoak.com/");
    first?.onOpenTab(() => {});
    expect(openPopout).toHaveBeenCalledWith("https://keepoak.com/");
    expect(onOpenTab).toHaveBeenCalledOnce();
  });
});
