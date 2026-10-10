// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { MemoryPopover } from "./StatusPopovers";
import { StopWorkDialog } from "./StatusLayer";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
});
const above = { left: 10, right: 220, top: 700, align: "right" as const };
const GB = 1024 ** 3;
async function show(node: React.ReactNode) {
  const host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  await act(async () => root?.render(node));
  await act(async () => undefined);
  return host;
}
/** system.info with `usedGb` of `totalGb` in use. */
const info = (usedGb: number, totalGb: number) => vi.fn(async () => ({ memoryTotalBytes: totalGb * GB, memoryFreeBytes: (totalGb - usedGb) * GB })) as never;
const running = [{ key: "agent:builder:roadmap", title: "Builder" }];

it("shows the memory in use and no action while memory is fine", async () => {
  const host = await show(<MemoryPopover above={above} onClose={vi.fn()} request={info(12, 32)} working={running} onStop={vi.fn()} />);
  expect(host.querySelector("[data-testid=pop-memory]")?.textContent).toContain("12 of 32 GB in use");
  expect(host.textContent).toContain("Plenty free");
  expect(host.querySelector("[data-testid=memory-stop]")).toBeNull();
});

it("offers to stop running work once memory is tight, and only calls onStop from the row", async () => {
  const onStop = vi.fn();
  const onClose = vi.fn();
  const host = await show(<MemoryPopover above={above} onClose={onClose} request={info(28.6, 31.4)} working={running} onStop={onStop} />);
  expect(host.textContent).toContain("Running now: Builder");
  const row = host.querySelector<HTMLButtonElement>("[data-testid=memory-stop]");
  expect(row?.textContent).toContain("Stop the running work in 1 Trunk");
  await act(async () => row?.click());
  expect(onStop).toHaveBeenCalledTimes(1);
  expect(onClose).not.toHaveBeenCalled();
});

it("needs a confirm: Cancel keeps the work running, and only the confirm button stops it", async () => {
  const onStop = vi.fn();
  const onCancel = vi.fn();
  const host = await show(<StopWorkDialog count={2} onCancel={onCancel} onStop={onStop} />);
  expect(host.textContent).toContain("Stop the running work in 2 Trunks?");
  await act(async () => host.querySelector<HTMLButtonElement>("[data-testid=memory-stop-yes]")?.click());
  expect(onStop).toHaveBeenCalledTimes(1);
  await act(async () => host.querySelector<HTMLButtonElement>("button.ghost")?.click());
  expect(onCancel).toHaveBeenCalledTimes(1);
  expect(onStop).toHaveBeenCalledTimes(1);
});
