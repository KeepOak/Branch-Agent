// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { WindowEngine } from "../connect/engine";
import { PeerTyping, usePublishTyping } from "./typing-presence";
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root;
afterEach(async () => { await act(async () => root?.unmount()); document.body.innerHTML = ""; vi.useRealTimers(); });
function fixture() {
  const listeners = new Set<(event: { event: string; payload?: unknown }) => void>();
  const request = vi.fn(async (method: string) => method === "sessions.describe" ? { session: { key: "room", sessionId: "current" } } : method === "users.self" ? { profile: { id: "self" } } : method === "users.list" ? { profiles: [{ id: "Dana", displayName: "Dana", hasAvatar: true, updatedAt: 4 }] } : {});
  const engine: WindowEngine = { sessionKey: "room", scopes: [], request: request as WindowEngine["request"], onEvent: (fn) => { listeners.add(fn); return () => { listeners.delete(fn); }; } };
  const host = document.body.appendChild(document.createElement("div")); root = createRoot(host);
  const emit = (id: string, extras = {}) => listeners.forEach((fn) => fn({ event: "session.typing", payload: { sessionKey: "room", sessionId: "current", actor: { id, label: id }, typing: true, ...extras } }));
  return { engine, host, emit, request };
}
it("renders multiple peers, excludes self and other generations, and expires stopped senders", async () => {
  vi.useFakeTimers(); const f = fixture();
  await act(async () => root.render(<PeerTyping engine={f.engine} />));
  await act(async () => { f.emit("Dana"); f.emit("Ada"); f.emit("self"); f.emit("Old", { sessionId: "old" }); f.emit("Other", { sessionKey: "other" }); });
  expect([...f.host.querySelectorAll('.typing-words')].map((el) => el.textContent)).toEqual(["Dana is typing", "Ada is typing"]);
  expect(f.host.querySelector("img")?.getAttribute("src")).toBe("/api/users/Dana/avatar?v=4");
  await act(async () => f.emit("Dana", { typing: false }));
  expect(f.host.textContent).not.toContain("Dana is typing");
  await act(async () => vi.advanceTimersByTime(2500));
  expect(f.host.querySelectorAll('[data-testid="typing"]')).toHaveLength(0);
});
it("publishes throttled activity without draft contents and stops on blur or unmount", async () => {
  vi.useFakeTimers(); const f = fixture();
  function Composer() { const publish = usePublishTyping(f.engine); return <button onClick={() => publish(true)} onBlur={() => publish(false)}>Type</button>; }
  await act(async () => root.render(<Composer />));
  const button = f.host.querySelector('button')!;
  await act(async () => { button.click(); button.click(); });
  expect(f.request.mock.calls.filter(([method]) => method === "session.typing")).toHaveLength(1);
  expect(f.request).toHaveBeenCalledWith("session.typing", { sessionKey: "room", sessionId: "current", typing: true });
  await act(async () => vi.advanceTimersByTime(2000));
  expect(f.request).toHaveBeenLastCalledWith("session.typing", { sessionKey: "room", sessionId: "current", typing: false });
  await act(async () => button.click());
  await act(async () => root.unmount());
  expect(f.request).toHaveBeenLastCalledWith("session.typing", { sessionKey: "room", sessionId: "current", typing: false });
});
