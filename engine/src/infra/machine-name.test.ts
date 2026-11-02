// Covers machine name resolution fallback behavior.
import os from "node:os";
import { importFreshModule } from "branch/plugin-sdk/test-fixtures";
import { afterEach, describe, expect, it, vi } from "vitest";

const runExecMock = vi.hoisted(() => vi.fn());

vi.mock("../process/exec.js", () => ({ runExec: runExecMock }));

async function importMachineName(scope: string) {
  return await importFreshModule<typeof import("./machine-name.js")>(
    import.meta.url,
    `./machine-name.js?scope=${scope}`,
  );
}

afterEach(() => {
  runExecMock.mockReset();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("getMachineDisplayName", () => {
  it.each([
    {
      name: "uses the hostname fallback in test mode and strips a trimmed .local suffix",
      scope: "test-fallback",
      hostname: "  grovebox.LOCAL  ",
      expected: "grovebox",
      expectedCalls: 1,
      repeatLookup: true,
    },
    {
      name: "falls back to the default product name when hostname is blank",
      scope: "blank-hostname",
      hostname: "   ",
      expected: "branch",
      expectedCalls: 1,
      repeatLookup: false,
    },
  ])("$name", async ({ scope, hostname, expected, expectedCalls, repeatLookup }) => {
    const hostnameSpy = vi.spyOn(os, "hostname").mockReturnValue(hostname);
    const machineName = await importMachineName(scope);

    await expect(machineName.getMachineDisplayName()).resolves.toBe(expected);
    if (repeatLookup) {
      await expect(machineName.getMachineDisplayName()).resolves.toBe(expected);
    }
    expect(hostnameSpy).toHaveBeenCalledTimes(expectedCalls);
    expect(runExecMock).not.toHaveBeenCalled();
  });

  it("shows BRANCH_DISPLAY_HOSTNAME instead of the real name, even after the real name is cached", async () => {
    vi.stubEnv("BRANCH_DISPLAY_HOSTNAME", "");
    const hostnameSpy = vi.spyOn(os, "hostname").mockReturnValue("grovebox.local");
    const machineName = await importMachineName("display-override");

    await expect(machineName.getMachineDisplayName()).resolves.toBe("grovebox");
    vi.stubEnv("BRANCH_DISPLAY_HOSTNAME", "  tour-machine  ");
    await expect(machineName.getMachineDisplayName()).resolves.toBe("tour-machine");
    expect(hostnameSpy).toHaveBeenCalledTimes(1);
  });
});

describe("displayHostname", () => {
  it("returns the trimmed BRANCH_DISPLAY_HOSTNAME when set and the real name otherwise", async () => {
    const { displayHostname } = await importMachineName("display-helper");

    vi.stubEnv("BRANCH_DISPLAY_HOSTNAME", "  tour-machine  ");
    expect(displayHostname("grovebox")).toBe("tour-machine");
    vi.stubEnv("BRANCH_DISPLAY_HOSTNAME", "   ");
    expect(displayHostname("grovebox")).toBe("grovebox");
    vi.stubEnv("BRANCH_DISPLAY_HOSTNAME", undefined);
    expect(displayHostname("grovebox")).toBe("grovebox");
  });
});
