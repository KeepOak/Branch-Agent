// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../../connect/engine";
import { KitProvider } from "../kit";
import { Asking, type Pairing } from "./chatapps-asking";
import { appOf } from "./chatapps-data";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("pairing mutation concurrency", () => {
  it.each(["approve", "dismiss"] as const)("sends one %s even for two clicks before rerender", async (operation) => {
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => { finish = resolve; });
    const request = vi.fn(() => pending);
    const engine = { request } as unknown as WindowEngine;
    const host = document.body.appendChild(document.createElement("div"));
    const root = createRoot(host);
    const pairing: Pairing = {
      accounts: [], commandOwnerConfigured: true, limits: { pendingPerAccount: 3, ttlMs: 3600000 },
      requests: [{ requestId: "r1", channel: "telegram", channelLabel: "Telegram", accountId: "default", senderId: "551", senderLabel: "Person", createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 3600000).toISOString(), notifySupported: false }],
    };
    const app = appOf({} as never, { id: "telegram", name: "Telegram", detail: "" });
    const report = { saving: vi.fn(), saved: vi.fn(), failed: vi.fn() };
    const reload = vi.fn(async () => undefined);
    const label = operation === "approve" ? "Approve" : "Dismiss";
    try {
      await act(async () => root.render(<KitProvider level={0} report={report} scope={null}><Asking engine={engine} apps={[app]} pairing={pairing} reload={reload} filter={{ app: "", acct: "" }} setFilter={() => undefined} trunkFor={() => "Oak"} /></KitProvider>));
      await act(async () => [...host.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === label)!.click());
      const confirm = document.querySelector<HTMLButtonElement>(`[data-testid="chatapps-${operation}"] .dlg-f button:last-child`)!;
      await act(async () => { confirm.click(); confirm.click(); });
      expect(request).toHaveBeenCalledTimes(1);
      expect(request).toHaveBeenCalledWith(`channels.pairing.${operation}`, { channel: "telegram", accountId: "default", requestId: "r1" });
      expect(confirm.disabled).toBe(true);
      expect(confirm.textContent).toBe(operation === "approve" ? "Approving…" : "Dismissing…");
      await act(async () => finish());
      expect(reload).toHaveBeenCalledTimes(1);
      expect(document.querySelector(`[data-testid="chatapps-${operation}"]`)).toBeNull();
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });
});
