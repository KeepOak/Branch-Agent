// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import type { WindowEngine } from "../connect/engine";
import { BranchLinkDialog } from "./BranchLinkDialog";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it("makes a real invite code and QR, then joins another Branch through the gateway", async () => {
  const request = vi.fn(async (method: string) => {
    if (method === "device.pair.setupCode") return { setupId: "invite-1", setupCode: "ABCD-EFGH", qrDataUrl: "data:image/png;base64,AA==", expiresAtMs: Date.now() + 600_000 };
    if (method === "graft.join") return { pending: false, link: { url: "wss://other.example.test", name: "This Branch" } };
    return {};
  });
  const linked = vi.fn();
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  await act(async () => root.render(<BranchLinkDialog engine={{ request } as unknown as WindowEngine} onClose={() => undefined} onLinked={linked} />));
  await act(async () => host.querySelector<HTMLButtonElement>(".dlg-f .pri")!.click());
  expect(request).toHaveBeenCalledWith("device.pair.setupCode", { includeQr: true, bootstrapProfile: "limited" });
  expect(host.querySelector("[data-testid=branch-invite-code]")?.textContent).toBe("ABCD-EFGH");
  expect(host.querySelector<HTMLImageElement>("img")?.src).toContain("data:image/png;base64,AA==");
  await act(async () => [...host.querySelectorAll<HTMLButtonElement>("button")].find(b => b.textContent === "Use their code")!.click());
  const field = host.querySelector<HTMLTextAreaElement>("textarea")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(field, "A-SETUP-CODE");
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => host.querySelector<HTMLButtonElement>(".dlg-f .pri")!.click());
  expect(request).toHaveBeenCalledWith("graft.join", { code: "A-SETUP-CODE" });
  expect(host.textContent).toContain("Linked to wss://other.example.test");
  expect(linked).toHaveBeenCalledOnce();
  await act(async () => root.unmount());
  host.remove();
});

it("explains an unreachable gateway and opens the setting that fixes it", async () => {
  const request = vi.fn(async (method: string) => {
    if (method === "device.pair.setupCode") throw new Error("Gateway is only bound to loopback. Set gateway.publicOrigin...");
    return { links: [] };
  });
  const openSettings = vi.fn();
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  await act(async () => root.render(<BranchLinkDialog engine={{ request } as unknown as WindowEngine} onClose={() => undefined} onOpenGatewaySettings={openSettings} />));
  await act(async () => host.querySelector<HTMLButtonElement>(".dlg-f .pri")!.click());
  expect(host.textContent).toContain("This computer can’t be reached by another computer yet");
  expect(host.textContent).not.toContain("gateway.publicOrigin");
  await act(async () => [...host.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === "Open Gateway settings")!.click());
  expect(openSettings).toHaveBeenCalledOnce();
  await act(async () => root.unmount());
  host.remove();
});

it("forgets a saved link through the gateway", async () => {
  const request = vi.fn(async (method: string) => method === "graft.links.list"
    ? { links: [{ name: "Studio Branch", url: "wss://studio.example.test" }] } : {});
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  await act(async () => root.render(<BranchLinkDialog engine={{ request } as unknown as WindowEngine} onClose={() => undefined} />));
  expect(host.textContent).toContain("Studio Branch");
  await act(async () => [...host.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === "Forget link")!.click());
  expect(request).toHaveBeenCalledWith("graft.links.forget", { url: "wss://studio.example.test" });
  expect(host.textContent).not.toContain("Studio Branch");
  await act(async () => root.unmount());
  host.remove();
});

it("keeps the pairing poll running across parent callback changes", async () => {
  vi.useFakeTimers();
  try {
    const request = vi.fn(async (method: string) => method === "device.pair.setupCode"
      ? { setupId: "invite-1", setupCode: "CODE", expiresAtMs: Date.now() + 600_000, access: "limited" }
      : method === "device.pair.setupStatus" ? { completion: {} } : { links: [] });
    const host = document.body.appendChild(document.createElement("div"));
    const root = createRoot(host);
    const engine = { request } as unknown as WindowEngine;
    await act(async () => root.render(<BranchLinkDialog engine={engine} onClose={() => undefined} onLinked={() => undefined} />));
    await act(async () => host.querySelector<HTMLButtonElement>(".dlg-f .pri")!.click());
    await act(async () => vi.advanceTimersByTimeAsync(1500));
    await act(async () => root.render(<BranchLinkDialog engine={engine} onClose={() => undefined} onLinked={() => undefined} />));
    await act(async () => vi.advanceTimersByTimeAsync(1500));
    expect(request.mock.calls.filter(([method]) => method === "device.pair.setupStatus")).toHaveLength(1);
    await act(async () => root.unmount());
    host.remove();
  } finally { vi.useRealTimers(); }
});

it("shows the pending request check code and what the invite grants", async () => {
  const request = vi.fn(async (method: string) => method === "device.pair.setupCode"
    ? { setupId: "invite-1", setupCode: "CODE", expiresAtMs: Date.now() + 600_000, access: "limited" }
    : method === "graft.join" ? { pending: true, requestId: "req-7f2k" } : { links: [] });
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  await act(async () => root.render(<BranchLinkDialog engine={{ request } as unknown as WindowEngine} onClose={() => undefined} />));
  await act(async () => host.querySelector<HTMLButtonElement>(".dlg-f .pri")!.click());
  expect(host.textContent).toContain("What it may do: limited, non-administrator access, including conversations and approval requests");
  await act(async () => [...host.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === "Use their code")!.click());
  const field = host.querySelector<HTMLTextAreaElement>("textarea")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(field, "CODE");
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => host.querySelector<HTMLButtonElement>(".dlg-f .pri")!.click());
  expect(host.textContent).toContain("check code 7F2K");
  await act(async () => root.unmount());
  host.remove();
});
