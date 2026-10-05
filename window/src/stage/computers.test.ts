import { describe, expect, it, vi } from "vitest";
import type { EnvironmentSummary } from "@branch/gateway-protocol";
import type { WindowEngine } from "../connect/engine";
import { pickerLabel, placementComputer, planSteps, readComputer, stagePill } from "./computers";
import { moveConversation } from "./ComputerPicker";

const engine = (request: WindowEngine["request"]): WindowEngine => ({ request, sessionKey: "agent:a:one", scopes: [], onEvent: () => () => {} });

describe("stage computers", () => {
  it("maps the host to This computer and an explicitly local placement to the host", () => {
    expect(readComputer({ id: "gateway", type: "local", status: "available", platform: "win32", desktop: true } as EnvironmentSummary)).toMatchObject({ name: "This computer", sub: "Windows", desktop: true });
    expect(placementComputer({ state: "local" })).toBe("gateway");
    expect(placementComputer({ state: "active", environmentId: "w1" })).toBe("w1");
    expect(placementComputer(undefined)).toBe("gateway");
    expect(placementComputer({ state: "provisioning", environmentId: "w1" })).toBeNull();
  });
  it("shows busy slots only when the engine reports them, and offline computers as offline", () => {
    const c = readComputer({ id: "node:n1", type: "node", label: "Desk PC", status: "unavailable", platform: "linux", workerSlots: { total: 4, available: 3 } } as EnvironmentSummary);
    expect(c).toMatchObject({ name: "Desk PC", sub: "Linux · no screen · offline", busy: { used: 1, total: 4 }, deviceId: "n1" });
    expect(readComputer({ id: "x", type: "worker", status: "available" } as EnvironmentSummary).busy).toBeUndefined();
  });
  it("reads plan steps and the state pill from the progress card", () => {
    const steps = planSteps({ sessionKey: "k", revision: 1, updatedAt: 1, steps: [{ step: "Look", status: "completed" }, { step: "Search", status: "in_progress" }, { step: "Tell", status: "pending" }] });
    expect(steps.map((s) => s.state)).toEqual(["done", "now", "todo"]);
    expect(stagePill(true, false, steps).text).toBe("Working · step 2 of 3");
    expect(stagePill(true, false, []).text).toBe("Working");
    expect(stagePill(false, false, steps)).toEqual({ kind: "idle", text: "Idle" });
    expect(stagePill(true, true, steps).text).toBe("You have control");
  });
  it("names one computer and counts several", () => {
    const one = readComputer({ id: "gateway", type: "local", status: "available", desktop: true } as EnvironmentSummary);
    const two = readComputer({ id: "w", type: "worker", label: "Cloud box", status: "available", desktop: true } as EnvironmentSummary);
    expect(pickerLabel([one], "gateway")).toBe("This computer");
    expect(pickerLabel([one, two], "gateway")).toBe("2 computers");
  });
});

describe("moving a conversation", () => {
  it("dispatches a local conversation and moves an active one with the placement it expects", async () => {
    const request = vi.fn(async () => ({}));
    await moveConversation(engine(request as never), { state: "local" }, { kind: "device", deviceId: "n1" });
    expect(request).toHaveBeenLastCalledWith("sessions.dispatch", { key: "agent:a:one", deviceId: "n1" });
    await moveConversation(engine(request as never), undefined, { kind: "free" });
    expect(request).toHaveBeenLastCalledWith("sessions.dispatch", { key: "agent:a:one", autoDevice: true });
    await moveConversation(engine(request as never), { state: "active", environmentId: "w1", generation: 3, ownerEpoch: 2 }, { kind: "gateway" });
    expect(request).toHaveBeenLastCalledWith("sessions.move", { key: "agent:a:one", expected: { generation: 3, environmentId: "w1", ownerEpoch: 2 }, target: { kind: "gateway" } });
  });
});
