// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Conversation } from "../../connect/conversations";
import { useMarkRead } from "./use-mark-read";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const row = (patch: Partial<Conversation> = {}): Conversation => ({
  key: "agent:ledger:t1", title: "Month-end", agentId: "ledger", isMain: false, pinned: false, archived: false, unread: true, snoozedUntil: null,
  createdAt: 1, updatedAt: 1, preview: "", working: false, kind: "direct", system: false, automation: false, totalTokens: 0, contextTokens: 0, ...patch,
});
let root: Root, host: HTMLDivElement;
beforeEach(() => { host = document.body.appendChild(document.createElement("div")); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

function Probe({ request, value, shown, refresh }: { request: (m: string, p?: unknown) => Promise<unknown>; value: Conversation | null; shown: boolean; refresh: () => void }) {
  useMarkRead(request, value, shown, refresh);
  return null;
}
const flush = async () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });

it("clears an opened conversation's unread flag once through sessions.patch, then reads the list again", async () => {
  const request = vi.fn(async () => ({})), refresh = vi.fn();
  await act(async () => root.render(<Probe request={request} value={row()} shown refresh={refresh} />));
  await flush();
  expect(request).toHaveBeenCalledTimes(1);
  expect(request).toHaveBeenCalledWith("sessions.patch", { key: "agent:ledger:t1", unread: false, agentId: "ledger", expectedMarkedUnreadAt: null });
  expect(refresh).toHaveBeenCalledTimes(1);
  await act(async () => root.render(<Probe request={request} value={row({ preview: "still unread" })} shown refresh={refresh} />));
  await flush();
  expect(request).toHaveBeenCalledTimes(1);
});

it("acknowledges fresh activity once the read is confirmed, and leaves a hidden conversation alone", async () => {
  const request = vi.fn(async () => ({})), refresh = vi.fn();
  await act(async () => root.render(<Probe request={request} value={row()} shown={false} refresh={refresh} />));
  await flush();
  expect(request).not.toHaveBeenCalled();
  await act(async () => root.render(<Probe request={request} value={row()} shown refresh={refresh} />));
  await flush();
  await act(async () => root.render(<Probe request={request} value={row({ unread: false })} shown refresh={refresh} />));
  await act(async () => root.render(<Probe request={request} value={row({ unread: true })} shown refresh={refresh} />));
  await flush();
  expect(request).toHaveBeenCalledTimes(2);
});

it("never undoes a person's own Mark unread on the open conversation", async () => {
  const request = vi.fn(async () => ({})), refresh = vi.fn();
  await act(async () => root.render(<Probe request={request} value={row({ unread: false })} shown refresh={refresh} />));
  await act(async () => root.render(<Probe request={request} value={row({ unread: true, markedUnreadAt: 500 })} shown refresh={refresh} />));
  await flush();
  expect(request).not.toHaveBeenCalled();
});
