// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ComponentUpdateStatus } from "../../connect/desktop-component-updates";
import { EXIT_MS, UpdateBanner, UpdateButton } from "./UpdateButton";
import { DONE_MS, useUpdateFlow } from "./useUpdateFlow";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, host: HTMLDivElement;
beforeEach(() => { host = document.body.appendChild(document.createElement("div")); root = createRoot(host); });
afterEach(async () => {
  await act(async () => root.unmount()); host.remove(); document.body.innerHTML = "";
  delete (window as { branchDesktop?: unknown }).branchDesktop; vi.useRealTimers();
});

const URL = "ws://127.0.0.1:18789/";
const base: ComponentUpdateStatus = { phase: "available", currentVersion: "0.4.4", latestVersion: "0.5.0", pendingVersion: null, checkedAt: 1, error: null };
function engine(status: unknown = {}, run: unknown = { ok: true }) {
  const request = vi.fn(async (method: string) => (method === "update.run" ? run : status));
  return { gatewayUrl: URL, request, onEvent: vi.fn(() => () => undefined) };
}
function Harness({ e, rail }: { e: ReturnType<typeof engine>; rail?: boolean }) {
  const flow = useUpdateFlow(e, true, "0.4.4", () => document.body.setAttribute("data-opened", "settings"));
  return <><UpdateButton flow={flow} rail={rail} /><div role="menu"><UpdateBanner flow={flow} /></div></>;
}
const button = () => host.querySelector<HTMLElement>(".r1u-btn");
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

it("renders nothing, button or banner, while there is no update", async () => {
  await act(async () => root.render(<Harness e={engine({})} />));
  await flush();
  expect(button()).toBeNull();
  expect(host.querySelector(".r1u-ban")).toBeNull();
});

it("desktop: Install stages, the ring shows, Restart Branch installs in place, Updated to X, then the button leaves", async () => {
  let current: ComponentUpdateStatus = { ...base };
  const bridge = {
    status: vi.fn(async () => current), check: vi.fn(async () => current),
    stage: vi.fn(async () => { current = { ...base, phase: "staged", pendingVersion: "0.5.0" }; return current; }),
    install: vi.fn(),
  };
  (window as { branchDesktop?: unknown }).branchDesktop = { gatewayUrl: URL, componentUpdates: bridge };
  const e = engine();
  await act(async () => root.render(<Harness e={e} />));
  await flush();
  expect(button()?.getAttribute("aria-label")).toBe("Update to 0.5.0");
  expect(host.querySelector(".r1u-ban-text")?.textContent).toBe("Update to 0.5.0");
  await act(async () => button()?.click());
  await flush();
  expect(bridge.stage).toHaveBeenCalledTimes(1);
  expect(button()?.textContent).toBe("Restart Branch");
  expect(host.querySelector(".r1u-ban-act")?.textContent).toBe("Restart Branch");
  await act(async () => button()?.click());
  expect(bridge.install).toHaveBeenCalledTimes(1);
  expect(button()?.getAttribute("aria-busy")).toBe("true");
  expect(button()?.querySelector(".r1u-ring")).not.toBeNull();
  expect(e.request).not.toHaveBeenCalledWith("update.run", expect.anything());
  vi.useFakeTimers();
  current = { ...base, phase: "current", currentVersion: "0.5.0", latestVersion: "0.5.0" };
  await act(async () => { window.dispatchEvent(new CustomEvent("branch:update-state", { detail: { state: "updated" } })); });
  expect(button()?.textContent).toBe("Updated to 0.5.0");
  await act(async () => { vi.advanceTimersByTime(DONE_MS); });
  expect(button()?.hasAttribute("data-leaving")).toBe(true);
  expect(host.querySelector(".r1u-ban")).toBeNull();
  await act(async () => { vi.advanceTimersByTime(EXIT_MS); });
  expect(button()).toBeNull();
});

it("desktop rail: the restart button is ↻ with its name", async () => {
  const staged = { ...base, phase: "staged" as const, pendingVersion: "0.5.0" };
  (window as { branchDesktop?: unknown }).branchDesktop = { gatewayUrl: URL, componentUpdates: { status: async () => staged, check: async () => staged, stage: async () => staged, install: vi.fn() } };
  await act(async () => root.render(<Harness e={engine()} rail />));
  await flush();
  expect(button()?.textContent).toBe("↻");
  expect(button()?.getAttribute("aria-label")).toBe("Restart Branch");
});

it("engine: Install runs update.run and shows the engine's step; a refusal says why", async () => {
  const e = engine({ updateAvailable: { latestVersion: "0.5.0" } }, { ok: false, message: "Tasks are still running." });
  await act(async () => root.render(<Harness e={e} />));
  await flush();
  expect(button()?.getAttribute("title")).toBe("Update to 0.5.0");
  await act(async () => (host.querySelector(".r1u-ban-act") as HTMLButtonElement).click());
  await flush();
  expect(e.request).toHaveBeenCalledWith("update.run", {});
  expect(button()?.getAttribute("title")).toBe("Tasks are still running.");
  expect(host.querySelector(".r1u-ban-act")?.textContent).toBe("Try again");
});
