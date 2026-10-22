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

describe("Pair a phone", () => {
  it("shows the pairing code the phone can type", async () => {
    const setupCode = "eyJ1cmwiOiJ3c3M6Ly9leGFtcGxlIiwiYm9vdHN0cmFwVG9rZW4iOiJ4In0";
    await open({
      "device.pair.setupCode": {
        setupId: "setup-123",
        setupCode,
        confirmCode: "F2S4KP",
        qrDataUrl: "data:image/png;base64,AA==",
      },
    });
    await click("Make the code");
    expect(host.querySelector("[data-testid=pair-setup-code] .copy-token-text")?.textContent).toBe(setupCode);
    // The code is typed by hand on the phone, so it wraps and shows in full instead of ending in an ellipsis.
    expect(host.querySelector("[data-testid=pair-setup-code]")?.classList.contains("wrap")).toBe(true);
    expect(host.textContent).toContain("Or type this pairing code on your phone");
    expect(host.textContent).toContain("this computer shows a short check code");
  });

  it("still keeps a confirm code for the engine even when it only sends setupId", async () => {
    await open({
      "device.pair.setupCode": { setupId: "setup-123", setupCode: "RAW-SETUP-CODE", qrDataUrl: "" },
    });
    await click("Make the code");
    expect(host.querySelector("[data-testid=pair-setup-code] .copy-token-text")?.textContent).toBe("RAW-SETUP-CODE");
    expect(pairingConfirmCode("setup-123")).toBe("F2S4KP");
  });

  it("never shows a loopback or restart error", async () => {
    await open({
      "device.pair.setupCode": new Error(
        "Gateway is only bound to loopback. Set gateway.publicOrigin, then restart the Gateway.",
      ),
    });
    await click("Make the code");
    expect(host.textContent).toContain("Couldn’t make a pairing link. Try again.");
    expect(host.textContent).not.toMatch(/loopback|restart the Gateway|publicOrigin/i);
  });
});
