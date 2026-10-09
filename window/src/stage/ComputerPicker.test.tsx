// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../connect/engine";
import { ComputerPicker } from "./ComputerPicker";
import { readComputer, type Computer, type Placement } from "./computers";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  document.body.innerHTML = "";
});
const host = readComputer({ id: "gateway", type: "gateway", status: "available", desktop: true });
const device = (overrides: Partial<Parameters<typeof readComputer>[0]> = {}): Computer => readComputer({
  id: "node:other", type: "node", label: "Other computer", status: "available", desktop: true,
  sessionHost: true, workerSlots: { total: 1, available: 1 }, ...overrides,
});
const button = (text: string) => [...document.querySelectorAll("button")].find((b) => b.textContent?.trim().startsWith(text));
async function render(computers: Computer[], request = vi.fn(async () => ({})), placement?: Placement, current: string | null = "gateway") {
  const engine = { request, sessionKey: "agent:scout:one", scopes: ["operator.admin"], onEvent: () => () => {} } as WindowEngine;
  const onClose = vi.fn(), onMoved = vi.fn();
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root!.render(<ComputerPicker at={{ x: 0, y: 0 }} engine={engine} name="Scout" computers={computers} profiles={[]} placement={placement} current={current} onClose={onClose} onMoved={onMoved} onAdd={() => {}} onManage={() => {}} />));
  return { request, onClose, onMoved };
}

describe("plain computer picker", () => {
  it.each([
    ["only this computer", [host]],
    ["offline", [host, device({ status: "unavailable" })]],
    ["full", [host, device({ workerSlots: { total: 1, available: 0 } })]],
    ["not a session host", [host, device({ sessionHost: false })]],
  ] as const)("hides automatic choice when %s is available", async (_name, computers) => {
    await render([...computers]);
    expect(button("Whichever is free")).toBeUndefined();
  });
  it("offers automatic choice for a free paired host including reclaimable idle slots", async () => {
    await render([host, device({ workerSlots: { total: 1, available: 0, reclaimableIdle: 1 } })]);
    expect(button("Whichever is free")).toBeDefined();
  });
  it("hides named targets that cannot host another conversation", async () => {
    await render([host, device({ sessionHost: false }), device({ id: "node:offline", label: "Offline computer", status: "unavailable" }), device({ id: "cloud", type: "worker", label: "Cloud computer" })]);
    expect(button("Other computer")).toBeUndefined();
    expect(button("Offline computer")).toBeUndefined();
    expect(button("Cloud computer")).toBeUndefined();
  });
  it("keeps the current computer selectable even when it is offline", async () => {
    const { request, onClose } = await render([host, device({ status: "unavailable" })], undefined, undefined, "node:other");
    await act(async () => button("Other computer")!.click());
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(request).not.toHaveBeenCalled();
  });
  it("hides automatic choice for an active placement", async () => {
    await render([host, device()], undefined, { state: "active", environmentId: "node:other" }, "node:other");
    expect(button("Whichever is free")).toBeUndefined();
  });
  it("removes unsupported allowed-computer controls and developer notes", async () => {
    await render([host, device()]);
    expect(document.body.textContent).not.toContain("Allowed for");
    expect(document.body.textContent).not.toContain("per-Trunk list");
    expect(document.querySelector('[role="menuitemcheckbox"]')).toBeNull();
  });
  it("shows a plain automatic-choice failure without raw engine text", async () => {
    const request = vi.fn(async () => { throw new Error("INVALID_REQUEST: no paired session-host nodes; /private/runtime"); });
    await render([host, device()], request);
    await act(async () => button("Whichever is free")!.click());
    expect(document.querySelector('[role="alert"]')?.textContent).toBe("No other computer is free right now.");
    expect(document.body.textContent).not.toContain("INVALID_REQUEST");
  });
  it("shows a plain named-computer failure and keeps the picker open", async () => {
    const request = vi.fn(async () => { throw new Error("device-placement rejected runtime harness"); });
    const { onClose } = await render([host, device()], request);
    await act(async () => button("Other computer")!.click());
    expect(document.querySelector('[role="alert"]')?.textContent).toBe("Couldn't move this conversation. Try again or pick another computer.");
    expect(onClose).not.toHaveBeenCalled();
  });
  it("dispatches automatic choice and refreshes only after success", async () => {
    const { request, onClose, onMoved } = await render([host, device()]);
    await act(async () => button("Whichever is free")!.click());
    expect(request).toHaveBeenCalledWith("sessions.dispatch", { key: "agent:scout:one", autoDevice: true });
    expect(onMoved).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
