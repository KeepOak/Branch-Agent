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
  expect(request).toHaveBeenCalledWith("device.pair.setupCode", { includeQr: true });
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
