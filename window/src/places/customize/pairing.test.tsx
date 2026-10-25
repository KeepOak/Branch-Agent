// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../connect/engine";
import { pairingConfirmCode } from "../../shared/pairing-confirm-code";
import { PairDialog } from "./pairing";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement;

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = null;
  document.body.innerHTML = "";
  localStorage.removeItem("branch.level");
});

async function open(fx: Record<string, unknown> = {}) {
  const request = vi.fn((method: string) => {
    const value = fx[method];
    return value instanceof Error ? Promise.reject(value) : Promise.resolve(value ?? { ok: true });
  });
  const engine = { request, onEvent: () => () => {}, sessionKey: null, scopes: ["operator.admin"] } as unknown as WindowEngine;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(<PairDialog engine={engine} close={() => undefined} />);
  });
  return request;
}

const click = async (text: string) => {
  const button = [...host.querySelectorAll("button")].find((el) => el.textContent?.trim() === text);
  expect(button).toBeTruthy();
  await act(async () => {
    (button as HTMLButtonElement).click();
  });
  await act(async () => {
    await Promise.resolve();
  });
};

const button = (text: string, scope: ParentNode = host) => [...scope.querySelectorAll("button")].find((el) => el.textContent?.trim() === text);

describe("Pair a phone", () => {
  it("shows a six-character confirm code instead of the raw setup code", async () => {
    const request = await open({
      "device.pair.setupCode": {
        setupId: "setup-123",
        setupCode: "eyJ1cmwiOiJ3c3M6Ly9leGFtcGxlIiwiYm9vdHN0cmFwVG9rZW4iOiJ4In0",
        confirmCode: "F2S4KP",
        qrDataUrl: "data:image/png;base64,AA==",
      },
    });
    await click("Make the code");
    expect(request).toHaveBeenCalledWith("device.pair.setupCode", { includeQr: true });
    expect(host.querySelector("[data-testid=pair-code] .copy-token-text")?.textContent).toBe("F2S4KP");
    expect(host.textContent).not.toContain("eyJ1cmwiOiJ3c3M6Ly9leGFtcGxl");
    expect(host.textContent).toContain("Check that both screens show this code");
  });

  it("Private #1103: a very long setup code and link each sit on one truncating line with their own Copy button", async () => {
    const code = "eyJ1cmwiOiJ3c3M6Ly9" + "Q".repeat(300);
    const link = "branch://join?code=" + code;
    const writeText = vi.fn(async (_text: string) => undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const request = await open({
      "device.pair.setupCode": { setupId: "s1", setupCode: code, qrDataUrl: "", joinUrl: link },
    });
    await click("Make the code");
    expect(request).toHaveBeenCalledWith("device.pair.setupCode", { includeQr: true });
    const shown = host.querySelector<HTMLElement>("[data-testid=pair-code] .copy-token-text")!;
    expect(shown.textContent).toBe("9M36D8");
    expect(shown.title).toBe("9M36D8");
    expect(host.querySelector<HTMLElement>("[data-testid=pair-link] .copy-token-text")!.title).toBe(link);
    await click("Copy code");
    expect(writeText).toHaveBeenCalledWith("9M36D8");
    expect(button("Copied")).toBeTruthy();
    await click("Copy link");
    expect(writeText).toHaveBeenLastCalledWith(link);
  });

  it("derives the confirm code from setupId when the engine omits it", async () => {
    await open({
      "device.pair.setupCode": { setupId: "setup-123", setupCode: "RAW-SETUP-CODE", qrDataUrl: "" },
    });
    await click("Make the code");
    expect(host.querySelector("[data-testid=pair-code] .copy-token-text")?.textContent).toBe(
      pairingConfirmCode("setup-123"),
    );
    expect(host.textContent).not.toContain("RAW-SETUP-CODE");
  });

  it("never shows a loopback or restart error", async () => {
    await open({
      "device.pair.setupCode": new Error(
        "Gateway is only bound to loopback. Set gateway.publicOrigin, then restart the Gateway.",
      ),
    });
    await click("Make the code");
    expect(host.textContent).toContain("Your phone can't reach this computer yet.");
    expect(host.textContent).not.toMatch(/loopback|restart the Gateway|publicOrigin/i);
  });

  const loopbackError = "Gateway is only bound to loopback. Set gateway.publicOrigin to your public HTTPS origin, configure plugins.entries.device-pair.config.publicUrl, enable tailscale serve, or set gateway.bind=lan.";

  it("shows a plain loopback failure at Regular with one working retry action", async () => {
    localStorage.setItem("branch.level", "regular");
    const request = await open({ "device.pair.setupCode": new Error(loopbackError) });
    await click("Make the code");
    expect(host.querySelector('[role="alert"]')?.textContent).toBe("Your phone can't reach this computer yet.");
    expect(host.innerHTML).not.toMatch(/publicOrigin|gateway\.bind|tailscale serve/i);
    expect([...host.querySelectorAll(".dlg-f button")].map(button => button.textContent?.trim())).toEqual(["Cancel", "Try again"]);
    request.mockResolvedValueOnce({ setupId: "retry-setup", setupCode: "retry-code", confirmCode: "ABC123" });
    await click("Try again");
    expect(request).toHaveBeenCalledTimes(2);
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(host.querySelector("[data-testid=pair-code] .copy-token-text")?.textContent).toBe("ABC123");
  });

  it.each(["advanced", "technical"])("keeps the exact loopback engine words at %s", async level => {
    localStorage.setItem("branch.level", level);
    await open({ "device.pair.setupCode": new Error(loopbackError) });
    await click("Make the code");
    expect(host.querySelector('[role="alert"]')?.textContent).toBe(loopbackError);
  });
});
