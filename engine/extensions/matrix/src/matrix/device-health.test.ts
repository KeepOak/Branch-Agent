// Matrix tests cover device health plugin behavior.
import { describe, expect, it } from "vitest";
import { summarizeMatrixDeviceHealth } from "./device-health.js";

describe("matrix device health", () => {
  it("summarizes stale Branch-managed devices separately from the current device", () => {
    const devices = [
      {
        deviceId: "du314Zpw3A",
        displayName: "Branch Agent Gateway",
        current: true,
      },
      {
        deviceId: "BritdXC6iL",
        displayName: "Branch Agent Gateway",
        current: false,
      },
      {
        deviceId: "G6NJU9cTgs",
        displayName: "Branch Agent Debug",
        current: false,
      },
      {
        deviceId: "phone123",
        displayName: "Element iPhone",
        current: false,
      },
      { deviceId: "unnamed", displayName: null, current: false },
    ];

    expect(summarizeMatrixDeviceHealth(devices)).toEqual({
      currentDeviceId: "du314Zpw3A",
      currentBranchDevices: [devices[0]],
      staleBranchDevices: [devices[1], devices[2]],
    });
  });
});
