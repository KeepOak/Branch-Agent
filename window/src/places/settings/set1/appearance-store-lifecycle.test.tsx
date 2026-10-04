// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../../connect/engine";
import { forgetLookStore, lookStore } from "./appearance-store";

afterEach(() => {
  forgetLookStore();
  localStorage.clear();
  document.getElementById("branch-look")?.remove();
});

it("does not send a queued preference write after its store is disposed", async () => {
  let finish!: (value: unknown) => void;
  const request = vi.fn(async (method: string) => {
    if (method === "users.prefs.get") return { status: "ok", entries: {} };
    if (method === "themes.list") return { current: { id: "slate" } };
    if (method === "users.prefs.set") return new Promise((resolve) => { finish = resolve; });
    return {};
  });
  const store = lookStore({ request, onEvent: () => () => undefined } as unknown as WindowEngine);
  await store.load();
  const first = store.set("contrast", true);
  await Promise.resolve();
  const second = store.set("still", true);
  forgetLookStore();
  finish({ status: "ok" });
  await Promise.all([first, second]);
  expect(request.mock.calls.filter(([method]) => method === "users.prefs.set")).toHaveLength(1);
});

it("keeps a choice made while the initial profile read is pending", async () => {
  let finish!: (value: unknown) => void;
  const request = vi.fn(async (method: string) => {
    if (method === "users.prefs.get") return new Promise((resolve) => { finish = resolve; });
    if (method === "themes.list") return { current: { id: "slate" } };
    return { status: "ok" };
  });
  const store = lookStore({ request, onEvent: () => () => undefined } as unknown as WindowEngine);
  const pending = store.load();
  const saved = store.set("contrast", true);
  finish({ status: "ok", entries: { "ui.window.look": { contrast: false, still: true } } });
  await Promise.all([pending, saved]);
  expect(store.snap.look).toMatchObject({ contrast: true, still: true });
  expect(document.documentElement.classList.contains("contrast17")).toBe(true);
});

it("unsubscribes the former profile and ignores its pending appearance read after sign-out", async () => {
  let finish!: (value: unknown) => void;
  const unwatch = vi.fn();
  const request = vi.fn(() => new Promise((resolve) => { finish = resolve; }));
  const engine = { request, onEvent: vi.fn(() => unwatch) } as unknown as WindowEngine;
  const former = lookStore(engine);
  const changed = vi.fn();
  former.subscribe(changed);
  const pending = former.load();

  forgetLookStore();
  finish({ status: "ok", entries: { "ui.accent": "#ff0000" } });
  await pending;

  expect(unwatch).toHaveBeenCalledOnce();
  expect(changed).not.toHaveBeenCalled();
  expect(document.getElementById("branch-look")).toBeNull();
  expect(localStorage.getItem("branch.look")).toBeNull();
  expect(request).toHaveBeenCalledTimes(1);
  expect(lookStore(engine)).not.toBe(former);
});
